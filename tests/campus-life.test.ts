import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3, Vector4 } from 'three';
import { CollisionWorld, PlayerPhysics } from '../lib/physics.ts';
import { BIKE, LOOKS, createFleet, frameWorld, gripWorld, type Bike } from '../lib/bicycle.ts';
import { createRider } from '../lib/rider.ts';
import { bakeAudienceGeometry, createAudience } from '../lib/audience.ts';
import { audienceSpots, bandSpots, createConcert } from '../lib/concert.ts';
import { createSurfaces, surfaceKind, LAMP_SLOTS } from '../lib/surfaces.ts';
import { createStreetLights } from '../lib/streetlights.ts';
import { pushOut } from '../lib/obstacles.ts';
import { clockLabel, daylightAt, sunDirection } from '../lib/daylight.ts';

async function student() {
  const bytes = readFileSync('public/assets/student.glb');
  const loader = new GLTFLoader().register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf;
}
const bikeAt = (heading = .4): Bike => ({ id: 0, look: LOOKS[0], position: new Vector3(10, 0, -4), heading, lean: .11, steer: 0, wheel: 0, crank: 1.05, stand: 0, scale: 1, visible: true, rider: null });

test('getting on: from standing beside the bicycle, over the back wheel, into the saddle', async () => {
  const { scene, animations } = await student();
  const rider = createRider(scene);
  const bike = bikeAt(.8);
  // The student stands on the bicycle's left, square to it, as the game puts them.
  const left = new Vector3(Math.cos(bike.heading), 0, -Math.sin(bike.heading));
  scene.position.copy(bike.position).addScaledVector(left, .52); scene.rotation.y = bike.heading;
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(animations.find(c => c.name === 'Idle')!).play();
  const pose = (mount: number) => {
    mixer.setTime(0); scene.updateMatrixWorld(true);
    const standing = rider.bones.Hips.getWorldPosition(new Vector3());
    rider.apply(bike, { standing: 0, footDown: 1, turn: 0, ground: 0, mount }, 1);
    return { standing, hips: rider.bones.Hips.getWorldPosition(new Vector3()), right: rider.bones.RightFoot.getWorldPosition(new Vector3()), hand: rider.bones.LeftHand.getWorldPosition(new Vector3()) };
  };
  const start = pose(0);
  assert.ok(start.hips.distanceTo(start.standing) < .03, 'at the start the hips have not moved off the standing pose');
  const swing = pose(.55);
  const rearWheelTop = frameWorld(bike, new Vector3(0, BIKE.wheelRadius * 2, BIKE.rearAxle.z), new Vector3());
  assert.ok(swing.right.y > rearWheelTop.y, `half way on, the right foot swings up over the back wheel: ${swing.right.y.toFixed(2)} m`);
  assert.ok(swing.hand.distanceTo(gripWorld(bike, 1, new Vector3())) < .16, `the hands already hold the bars: ${swing.hand.distanceTo(gripWorld(bike, 1, new Vector3())).toFixed(3)} m`);
  const seated = pose(1);
  const saddle = frameWorld(bike, BIKE.saddle, new Vector3());
  assert.ok(seated.hips.distanceTo(saddle) < .25 && seated.hips.y > saddle.y, 'at the end the hips sit on the saddle');
  assert.ok(seated.right.distanceTo(start.right) > .3, 'the right foot has gone over to its pedal');
});

test('the audience is baked into morph targets that only move what each pose moves', async () => {
  const { scene, animations } = await student();
  const geometry = bakeAudienceGeometry(scene, animations.find(c => c.name === 'Idle')!, 0);
  const morphs = geometry.morphAttributes.position ?? [];
  assert.equal(morphs.length, 11, 'one morph target per pose');
  const size = (k: number) => { let max = 0, sum = 0; const a = morphs[k]; for (let i = 0; i < a.count; i++) { const l = Math.hypot(a.getX(i), a.getY(i), a.getZ(i)); max = Math.max(max, l); sum += l; } return { max, mean: sum / a.count }; };
  for (let k = 0; k < morphs.length; k++) assert.ok(size(k).max < 1.35, `pose ${k} moves nothing further than an arm can reach`);
  // A pose must never carry another pose's arms with it: nodding moves the head only.
  assert.ok(size(7).mean < .02, `the nod moves only the head: ${size(7).mean.toFixed(3)} m on average`);
  assert.ok(size(6).max < .2, 'the bounce only bends the knees');
  const audience = createAudience({ geometry, map: null, crowd: audienceSpots(), band: bandSpots() });
  assert.equal(audience.mesh.count, 120 + 5, 'the crowd and the band are one instanced draw');
  const before = Array.from(audience.mesh.morphTexture!.image.data as Float32Array);
  audience.update(1.234);
  const after = Array.from(audience.mesh.morphTexture!.image.data as Float32Array);
  assert.notDeepEqual(after, before, 'people move to the music');
  audience.dispose();
});

test('the concert keeps a clear aisle and a collider for every member of the audience', () => {
  const spots = audienceSpots();
  assert.equal(spots.length, 120);
  assert.ok(spots.every(s => Math.abs(s.x) >= 1.6), 'nobody stands in the aisle');
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) >= .74, 'nobody stands inside anyone else');
  const front = spots.filter(s => s.z < 20).length, back = spots.filter(s => s.z > 32).length;
  assert.ok(front > back, 'the crowd is thicker near the stage');
  const concert = createConcert();
  assert.equal(concert.colliders.children.filter(c => (c as unknown as { geometry?: { parameters?: { height?: number } } }).geometry?.parameters?.height === 1.65).length, 120);
});

test('every building surface gets a pattern by what it is made of', () => {
  const cases: [string, string][] = [
    ['Cladding | grey ACP panels', 'panels'], ['Wall | cream exterior paint', 'plaster'], ['SC • Algae-streaked exterior plaster', 'plaster'],
    ['Site | red and black interlocking pavers', 'pavers'], ['Glass | reflective curtain wall', 'glass'], ['Interior | rooms behind windows', 'interior'],
    ['Plants | maroon hedge (Iresine)', 'foliage'], ['Site | asphalt road', 'asphalt'], ['Stone | grey granite steps', 'stone'],
    ['Aged terracotta red tiles', 'clay'], ['SC • Weathered charcoal roof sheets', 'roof'], ['Site | lawn', 'ground'],
    ['Frames | dark window aluminium', 'metal'], ['Concrete | grey slab edges', 'concrete'], ['Campus | streetlight glass', 'lamps'],
    ['Vehicles | tinted glass', 'lamps'], ['Stair | light grey terrazzo flights', 'tiles'],
  ];
  for (const [name, kind] of cases) assert.equal(surfaceKind(name), kind, name);
  const surfaces = createSurfaces();
  const material = new MeshStandardMaterial({ name: 'Cladding | grey ACP panels' });
  surfaces.patch(material);
  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: 'void main(){\n#include <project_vertex>\n}',
    fragmentShader: 'void main(){\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <lights_fragment_end>\n}',
  };
  material.onBeforeCompile(shader as never, null as never);
  assert.match(shader.fragmentShader, /#define SURF_KIND 3/);
  assert.match(shader.fragmentShader, /uLamps\[i\]/, 'every patched surface is lit by the street lamps');
  assert.match(shader.vertexShader, /vSurfWorld/);
  assert.ok(shader.uniforms.uLamps && shader.uniforms.uSurfNoise, 'the shared uniforms are wired in');
  assert.notEqual(material.customProgramCacheKey(), new MeshStandardMaterial().customProgramCacheKey(), 'patched programs are cached apart');
  surfaces.dispose();
});

test('street lamps line the verges, alternate sides and light the nearest few at night', () => {
  const lights = createStreetLights({ ground: () => 0, blocked: (x) => x > 140 });
  lights.plant([[[0, 0], [200, 0]]], 5);
  const ours = lights.lamps.filter(l => l.ours);
  assert.ok(ours.length >= 4 && ours.length <= 5, `about one lamp every 32 m: ${ours.length}`);
  assert.ok(ours.every(l => Math.abs(Math.abs(l.base.z) - 5) < 1e-6), 'poles stand on the verges, 5 m out');
  assert.ok(ours.some(l => l.base.z > 0) && ours.some(l => l.base.z < 0), 'they alternate sides of the road');
  assert.ok(ours.every(l => l.base.x <= 140), 'blocked ground is skipped');
  assert.ok(ours.every(l => Math.abs(l.head.z) < Math.abs(l.base.z)), 'the arm reaches out over the road');
  const slots = Array.from({ length: LAMP_SLOTS }, () => new Vector4());
  lights.update(1, 1, new Vector3(16, 2, 0), slots);
  assert.ok(Math.hypot(slots[0].x - 16, slots[0].z) < 5 && slots[0].w > 0, 'the nearest lamp takes the first slot');
  lights.update(1, 0, new Vector3(16, 2, 0), slots);
  assert.ok(slots.every(s => s.w === 0), 'by day no lamp gives light');
  lights.dispose();
});

test('lamp posts and parked bicycles push people round them', () => {
  const out = new Vector3();
  pushOut(.2, 0, 0, .3, [{ x: 0, y: 0, z: 0, r: .14 }], out);
  assert.ok(Math.abs(out.x - .24) < 1e-6 && out.z === 0, 'pushed straight out to touching distance');
  pushOut(.2, 3, 0, .3, [{ x: 0, y: 0, z: 0, r: .14 }], out);
  assert.equal(out.lengthSq(), 0, 'a post on another level is ignored');
  const fleet = createFleet(4);
  const parked = fleet.add(LOOKS[0], new Vector3(), 0), ridden = fleet.add(LOOKS[1], new Vector3(5, 0, 0), 0);
  ridden.rider = {};
  const posts = fleet.posts([]);
  assert.equal(posts.length, 2, 'two circles for the parked bicycle, none for the ridden one');
  assert.ok(posts.every(p => Math.hypot(p.x - parked.position.x, p.z - parked.position.z) < .6));
  fleet.dispose();
});

test('the sun rises in the east, sets in the west, and the lamps come on after dark', () => {
  // Campus axes: +x is west.
  assert.ok(sunDirection(6.5).x < -.9, 'morning sun in the east');
  assert.ok(sunDirection(17.5).x > .9, 'evening sun in the west');
  assert.ok(sunDirection(12.6).y > .85, 'high at noon');
  assert.equal(daylightAt(12).lamps, 0);
  assert.equal(daylightAt(22).lamps, 1);
  assert.ok(daylightAt(22).lightIntensity > 0, 'the moon still lights the campus at night');
  assert.equal(clockLabel(17.55), '17:33');
});

test('what can be seen is solid: an extra world blocks, carries and reports a hard hit', () => {
  const ground = new Group(), floor = new Mesh(new BoxGeometry(40, .2, 40)); floor.position.y = -.1; ground.add(floor);
  const solids = new Group(), car = new Mesh(new BoxGeometry(2, 1.4, 4)); car.position.set(5, .7, 0); solids.add(car);
  const player = new PlayerPhysics(new CollisionWorld(ground));
  player.extra.push(new CollisionWorld(solids));
  player.teleport(0, .05, 0);
  for (let i = 0; i < 240; i++) player.step(1 / 120, new Vector3(1, 0, 0), 5.5);
  assert.ok(player.feet.x < 4 - .29 + .02, `the car stops the runner: ${player.feet.x.toFixed(2)}`);
  assert.ok(player.impact > 3, `the hit is reported for crashes: ${player.impact.toFixed(1)} m/s`);
  // Dropped onto its roof, the player stands on it.
  player.teleport(5, 3, 0);
  for (let i = 0; i < 240; i++) player.step(1 / 120, new Vector3(), 0);
  assert.ok(player.grounded && Math.abs(player.feet.y - 1.4) < .05, `standing on the roof at ${player.feet.y.toFixed(2)} m`);
  // On foot the body has a little weight: a run takes a moment to reach full speed.
  player.teleport(-10, .05, 0);
  player.step(1 / 120, new Vector3(0, 0, 1), 5.5, 10);
  assert.ok(Math.hypot(player.velocity.x, player.velocity.z) < 1, 'not at full speed in one step');
});
