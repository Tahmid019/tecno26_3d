import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, Vector2, Vector3 } from 'three';
import { BIKE, LOOKS, createFleet, gripWorld, pedalWorld, type Bike } from '../lib/bicycle.ts';
import { findBones, reach } from '../lib/rig.ts';
import { createRider } from '../lib/rider.ts';
import { along, makeRoute } from '../lib/npcs.ts';

async function student() {
  const bytes = readFileSync('public/assets/student.glb');
  // Node has no image decoder; the skeleton and mesh are all these tests need.
  const loader = new GLTFLoader().register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf;
}
const bikeAt = (heading = .4): Bike => ({ id: 0, look: LOOKS[0], position: new Vector3(10, 0, -4), heading, lean: 0, steer: 0, wheel: 0, crank: .7, stand: 0, scale: 1, visible: true, rider: null });

test('the pedals turn on the crank circle, always opposite each other', () => {
  const bike = bikeAt();
  for (const crank of [0, .9, 2.4, 4.1]) {
    bike.crank = crank;
    const left = pedalWorld(bike, 1, new Vector3()), right = pedalWorld(bike, -1, new Vector3());
    const middle = left.clone().add(right).multiplyScalar(.5);
    const axle = new Vector3(0, BIKE.bb.y, BIKE.bb.z).applyAxisAngle(new Vector3(0, 1, 0), bike.heading).add(bike.position);
    assert.ok(middle.distanceTo(axle) < 1e-6, 'the two pedals straddle the crank axle');
    assert.ok(Math.abs(left.distanceTo(right) - Math.hypot(2 * BIKE.crank, 2 * BIKE.pedalX)) < 1e-6, 'each pedal is a crank length from the axle');
  }
  // Leaning the bicycle into a left turn carries the bars to the left.
  const upright = gripWorld(bike, 1, new Vector3());
  bike.lean = .3;
  const leaning = gripWorld(bike, 1, new Vector3());
  const left = new Vector3(Math.cos(bike.heading), 0, -Math.sin(bike.heading));
  assert.ok(leaning.clone().sub(upright).dot(left) > .2, 'a positive lean tips the bicycle to the rider\'s left');
});

test('the leg and arm solver reaches what it can and says how far short it fell', async () => {
  const { scene } = await student();
  const bones = findBones(scene);
  const hip = bones.LeftUpLeg.getWorldPosition(new Vector3());
  const target = hip.clone().add(new Vector3(.05, -.55, .25));
  const pole = hip.clone().add(new Vector3(0, 0, 1));
  assert.equal(reach(bones.LeftUpLeg, bones.LeftLeg, bones.LeftFoot, target, pole), 0);
  assert.ok(bones.LeftFoot.getWorldPosition(new Vector3()).distanceTo(target) < 2e-3, 'the ankle lands on the target');
  const knee = bones.LeftLeg.getWorldPosition(new Vector3());
  assert.ok(knee.z > hip.z, 'the knee bends forward, toward the pole');
  const far = hip.clone().add(new Vector3(0, -2, 0));
  assert.ok(reach(bones.LeftUpLeg, bones.LeftLeg, bones.LeftFoot, far, pole) > 1, 'an unreachable target is reported as a shortfall');
});

test('a rider sits on the saddle with the feet on the pedals and the hands on the grips', async () => {
  const { scene, animations } = await student();
  const rider = createRider(scene);
  const bike = bikeAt(1.1);
  scene.rotation.y = bike.heading; scene.position.copy(bike.position);
  // As in the game, the riding pose is laid over the idle clip.
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(animations.find(c => c.name === 'Idle')!).play();
  mixer.update(0); scene.updateMatrixWorld(true);
  for (const crank of [0, 1.6, 3.3, 5]) {
    bike.crank = crank;
    mixer.setTime(crank);
    rider.apply(bike, { standing: 0, footDown: 0, turn: 0, ground: 0 }, 1);
    for (const side of [1, -1] as const) {
      const pedal = pedalWorld(bike, side, new Vector3());
      const toe = (side === 1 ? rider.bones.LeftToeBase : rider.bones.RightToeBase).getWorldPosition(new Vector3());
      assert.ok(toe.distanceTo(pedal) < .09, `the ball of the foot is on the pedal at crank ${crank}: ${toe.distanceTo(pedal).toFixed(3)} m`);
      const grip = gripWorld(bike, side, new Vector3());
      const wrist = (side === 1 ? rider.bones.LeftHand : rider.bones.RightHand).getWorldPosition(new Vector3());
      assert.ok(wrist.distanceTo(grip) < .1, `the hand holds the grip: ${wrist.distanceTo(grip).toFixed(3)} m`);
    }
    const hips = rider.bones.Hips.getWorldPosition(new Vector3());
    const saddle = new Vector3(0, BIKE.saddle.y, BIKE.saddle.z).applyAxisAngle(new Vector3(0, 1, 0), bike.heading).add(bike.position);
    assert.ok(hips.y > saddle.y + .05 && hips.distanceTo(saddle) < .25, 'the hips sit just above the saddle');
  }
});

test('everyone on the roads keeps to the left of their direction of travel', () => {
  // A road running due north. In campus axes x grows west, so the left of a
  // northbound rider is +x, and of a southbound one -x.
  const route = makeRoute([[0, 0], [0, 100]]);
  const point = new Vector2(), tangent = new Vector2();
  along(route, 50, 1.7, point, tangent);
  assert.ok(point.x > 1.6, 'northbound keeps to the west side');
  along(route, 50, -1.7, point, tangent);
  assert.ok(point.x < -1.6, 'southbound, the same lane value flips to the east side');
});

test('the whole fleet draws as a fixed handful of instanced parts', () => {
  const fleet = createFleet(12);
  for (let i = 0; i < 12; i++) fleet.add(LOOKS[i % LOOKS.length], new Vector3(i, 0, 0), i);
  fleet.update();
  assert.ok(fleet.group.children.length <= 12, 'one instanced mesh per part, not per bicycle');
  const wheels = fleet.group.children.find(c => c.name === 'Bicycles | wheels') as unknown as { count: number };
  assert.equal(wheels.count, 24, 'two wheels a bicycle');
  assert.equal(fleet.nearest(new Vector3(3.2, 0, 0), 1)?.id, 3, 'the nearest free bicycle is offered');
  fleet.dispose();
});
