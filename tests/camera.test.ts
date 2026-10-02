import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Mesh, BoxGeometry, PerspectiveCamera, Ray, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CollisionWorld, PlayerPhysics, movementVector } from '../lib/physics.ts';
import { FollowCamera, FixedStep, CAMERA_PASSES_THROUGH } from '../lib/follow-camera.ts';
import { BICYCLE_SPRINT } from '../lib/bicycle.ts';

const load = async (path: string) => {
  const b = readFileSync(path);
  return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')).scene;
};

// Display refresh patterns a phone or laptop actually produces: a 60 Hz panel
// whose frames land a millisecond early or late, a 90 Hz panel, a 144 Hz one,
// and a device dropping between 60 and 30.
function frameTimes(kind: string, count: number) {
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: count }, (_, i) => {
    if (kind === '60 Hz jitter') return (16.67 + (random() - .5) * 2.2) / 1000;
    if (kind === '90 Hz') return 1 / 90;
    if (kind === '144 Hz') return 1 / 144;
    return (i % 7 === 3 ? 33.3 : 16.67) / 1000;
  });
}

/** Rides a straight line and measures how much the student and the view shake on screen. */
function ride(world: CollisionWorld, start: number[], yaw: number, speed: number, kind: string) {
  const physics = new PlayerPhysics(world);
  physics.teleport(start[0], start[1], start[2]);
  for (let i = 0; i < 240; i++) physics.step(1 / 120, new Vector3(), 0);
  const probe = (origin: Vector3, direction: Vector3, far: number) => {
    const hit = world.rayIntersect(new Ray(origin.clone(), direction.clone()));
    return hit && hit.distance <= far ? hit.distance : null;
  };
  const rig = new FollowCamera(probe);
  const stepper = new FixedStep();
  const last = physics.feet, next = physics.feet, drawn = physics.feet;
  const camera = new PerspectiveCamera(58, 16 / 9, .08, 1700);
  const direction = movementVector(1, 0, yaw);
  const chest = new Vector3(), landmark = new Vector3();
  const screen: number[][] = [], horizon: number[][] = [], travel: number[] = [];
  let previous: Vector3 | null = null;
  rig.update(0, drawn, 1.55, yaw, .26, 6.2, true);
  for (const dt of frameTimes(kind, 360)) {
    const blend = stepper.advance(dt, step => {
      last.copy(next); physics.step(step, direction, speed); next.copy(physics.feet);
    });
    drawn.lerpVectors(last, next, blend);
    rig.update(dt, drawn, 1.55, yaw, .26, 6.2);
    camera.position.copy(rig.position); camera.lookAt(rig.target); camera.updateMatrixWorld();
    // Pixel positions on a 1920 x 1080 screen: the student's chest, and a
    // point far down the line of travel standing in for the scenery.
    chest.copy(drawn).setY(drawn.y + 1.2).project(camera);
    screen.push([chest.x * 960, chest.y * 540]);
    landmark.copy(drawn).addScaledVector(direction, 400).setY(0).project(camera);
    horizon.push([landmark.x * 960, landmark.y * 540]);
    if (previous) travel.push(camera.position.distanceTo(previous) / dt);
    previous = camera.position.clone();
  }
  // Judge the steady stretch, once the student is up to speed.
  const settled = (list: number[][]) => list.slice(120);
  const wobble = (list: number[][]) => {
    let worst = 0;
    for (let i = 1; i < list.length; i++) worst = Math.max(worst, Math.hypot(list[i][0] - list[i - 1][0], list[i][1] - list[i - 1][1]));
    return worst;
  };
  const speeds = travel.slice(120);
  const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
  const spread = Math.sqrt(speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length);
  return { student: wobble(settled(screen)), scenery: wobble(settled(horizon)), mean, spread, feet: physics.feet };
}

function flatGround() {
  const g = new Group();
  const ground = new Mesh(new BoxGeometry(2000, 1, 2000)); ground.position.y = -.5; g.add(ground);
  return new CollisionWorld(g);
}

test('the view holds steady at riding pace on every refresh pattern', () => {
  const world = flatGround();
  for (const kind of ['60 Hz jitter', '90 Hz', '144 Hz', '60 to 30 Hz drops']) {
    for (const speed of [5.5, BICYCLE_SPRINT]) {
      const r = ride(world, [0, .6, 0], 0, speed, kind);
      // The student stays put on screen, and the scenery streams past evenly.
      assert.ok(r.student < .5, `${kind} at ${speed} m/s: the student jumps ${r.student.toFixed(2)} px between frames`);
      assert.ok(r.scenery < .5, `${kind} at ${speed} m/s: the view twitches ${r.scenery.toFixed(2)} px between frames`);
      assert.ok(Math.abs(r.mean - speed) < .05 * speed, `${kind}: the camera travels at ${r.mean.toFixed(2)} m/s for ${speed}`);
      assert.ok(r.spread < .02 * speed, `${kind} at ${speed} m/s: camera speed wavers by ${r.spread.toFixed(3)} m/s`);
    }
  }
});

test('riding the real library road at full speed keeps the picture steady', async () => {
  const site = new Group();
  site.add(await load('public/assets/collision.glb'), await load('public/assets/library-collision.glb'));
  const world = new CollisionWorld(site);
  // East along the straight from the campus junction towards the library gate
  // (x grows west, so this is towards -x, which yaw pi/2 faces).
  const r = ride(world, [-296, .5, 270], Math.PI / 2, BICYCLE_SPRINT, '60 Hz jitter');
  assert.ok(r.feet.x < -340, `the ride was cut short at ${r.feet.x.toFixed(1)}`);
  assert.ok(r.student < .75, `the student jumps ${r.student.toFixed(2)} px between frames`);
  assert.ok(r.scenery < .75, `the view twitches ${r.scenery.toFixed(2)} px between frames`);
});

test('the fixed step drops a stall instead of replaying it as a burst', () => {
  const stepper = new FixedStep(1 / 120, 12);
  let steps = 0;
  const blend = stepper.advance(.5, () => steps++);
  assert.equal(steps, 12);
  assert.ok(blend < 1 && blend >= 0);
  steps = 0;
  stepper.advance(1 / 120, () => steps++);
  assert.ok(steps <= 1, `a stall carried ${steps} extra steps into the next frame`);
});

test('the boom draws in for walls but not for leaves, posts or trusses', () => {
  for (const name of ['Library | hedge', 'Gallery | trunk', 'Campus | dark green streetlight metal', 'Campus | fine netting', 'Concert | truss silver', 'Dark painted window grilles'])
    assert.ok(CAMERA_PASSES_THROUGH.test(name), `${name} should not pull the camera in`);
  for (const name of ['Campus | varied monsoon ground', 'SC • Aged ivory exterior plaster', 'Library | glass', 'Warm pale ochre | painted stucco', 'Concert | stage deck'])
    assert.ok(!CAMERA_PASSES_THROUGH.test(name), `${name} must still stop the camera`);
  // A wall behind the student pulls the camera in front of it.
  const g = new Group();
  const ground = new Mesh(new BoxGeometry(80, 1, 80)); ground.position.y = -.5; g.add(ground);
  const wall = new Mesh(new BoxGeometry(20, 10, .4)); wall.position.set(0, 5, 3); g.add(wall);
  const world = new CollisionWorld(g);
  const rig = new FollowCamera((origin, direction, far) => {
    const hit = world.rayIntersect(new Ray(origin.clone(), direction.clone()));
    return hit && hit.distance <= far ? hit.distance : null;
  });
  rig.update(0, new Vector3(0, 0, 0), 1.3, 0, .26, 6.2, true);
  assert.ok(rig.position.z < 2.8, `the camera went through the wall to z ${rig.position.z.toFixed(2)}`);
});
