import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BIKE, LOOKS, type Bike, type Fleet } from './bicycle.ts';
import { createRider, type RideState, type Rider } from './rider.ts';
import { findBones, poseBuffer, turnWorld, type Bones } from './rig.ts';
import { ARMS_IN, settleArms } from './posture.ts';
import { pushOut, type Post } from './obstacles.ts';

/**
 * The other students on campus.
 *
 * Walkers stroll the verges of the campus roads, now and then stopping, and
 * turn back at a road's end. Groups of two to four stand chatting outside the
 * buildings, glancing at whoever is talking. Cyclists keep to the left of the
 * road, as traffic does in India, on the same bicycles and the same pedalling
 * rig as the player's. Everyone is the student's own model, lightened for
 * distance, recoloured per person: shirt, trousers and skin, with a little
 * spread of height. They look at you as you come near, stop rather than walk
 * through you, step round lamp posts, parked bicycles and each other, fall in
 * behind someone slower, and cyclists slow and swing out to pass. Walk into
 * someone and they stagger, stop and look round at you; hit them on a bicycle
 * at speed and they go down, lie there a moment and get up again.
 *
 * Only the people within reach of the player exist at all. Walkers and
 * cyclists who fall far behind are moved to a road ahead or to the side,
 * out of sight, so the campus always feels lived in for the same cost.
 */
const WALK_CLIP_SPEED = 1.39;
const KEEP = 170, SPAWN_NEAR = 45, SPAWN_FAR = 135;

type Budget = { walkers: number; cyclists: number; grouped: number };
const BUDGETS: Record<'performance' | 'balanced' | 'high', Budget> = {
  performance: { walkers: 5, cyclists: 2, grouped: 6 },
  balanced: { walkers: 10, cyclists: 4, grouped: 12 },
  high: { walkers: 16, cyclists: 6, grouped: 18 },
};

/** Linear shirt and trouser colours, and how far the skin is deepened. */
export type Outfit = { top: [number, number, number]; bottom: [number, number, number]; skin: number };
export const OUTFITS: Outfit[] = [
  { top: [.62, .6, .55], bottom: [.035, .05, .1], skin: .45 },     // white shirt, dark jeans
  { top: [.25, .02, .03], bottom: [.02, .02, .025], skin: .65 },   // maroon, black trousers
  { top: [.07, .12, .04], bottom: [.22, .18, .11], skin: .55 },    // olive tee, khaki
  { top: [.012, .013, .016], bottom: [.05, .08, .16], skin: .3 },  // black hoodie, light denim
  { top: [.45, .27, .03], bottom: [.03, .04, .08], skin: .75 },    // mustard kurta, navy
  { top: [.16, .3, .5], bottom: [.12, .12, .13], skin: .5 },       // sky blue, grey trousers
  { top: [.4, .04, .03], bottom: [.04, .06, .12], skin: .6 },      // red, jeans
  { top: [.3, .3, .3], bottom: [.02, .025, .035], skin: .2 },      // grey, charcoal
  { top: [.009, .012, .04], bottom: [.06, .09, .18], skin: 0 },    // the student's own navy and blue
  { top: [.5, .44, .34], bottom: [.06, .045, .03], skin: .85 },    // beige, brown
];

/** The recolouring itself, reading uTop, uBottom and uSkin. */
export const OUTFIT_FRAGMENT = /* glsl */`
      {
        vec3 c = diffuseColor.rgb;
        float sum = c.r + c.g + c.b + 1e-4;
        float lum = dot(c, vec3(.2126, .7152, .0722));
        float blue = smoothstep(.42, .52, c.b / sum);
        // Dark navy is the hoodie, lighter blue the jeans.
        float topMask = blue * (1.0 - smoothstep(.035, .07, lum));
        float bottomMask = blue * smoothstep(.035, .07, lum);
        vec3 top = uTop * clamp(lum / .016, .25, 2.4);
        vec3 bottom = uBottom * clamp(lum / .15, .3, 2.0);
        c = mix(c, top, topMask);
        c = mix(c, bottom, bottomMask);
        // Skin: warm, reddish and fairly bright.
        float skin = smoothstep(.42, .5, c.r / sum) * smoothstep(.08, .16, lum) * (1.0 - blue);
        c = mix(c, c * vec3(.52, .4, .32), skin * uSkin);
        diffuseColor.rgb = c;
      }`;

/**
 * Paints one outfit over the student's texture. Navy cloth becomes the shirt
 * and the lighter blue of the jeans becomes the trousers, both keeping every
 * fold and seam of the original; skin is deepened toward a browner tone.
 */
function outfitMaterial(map: THREE.Texture | null, outfit: Outfit) {
  const material = new THREE.MeshStandardMaterial({ name: 'Campus student | outfit', map, roughness: .86, metalness: 0, side: THREE.DoubleSide });
  const uniforms = {
    uTop: { value: new THREE.Vector3(...outfit.top) },
    uBottom: { value: new THREE.Vector3(...outfit.bottom) },
    uSkin: { value: outfit.skin },
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform vec3 uTop, uBottom;\nuniform float uSkin;\n' + shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + OUTFIT_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'campus-student-outfit-v1';
  return material;
}

export type Route = { points: THREE.Vector2[]; at: number[]; length: number };
export function makeRoute(points: number[][]): Route {
  const v = points.map(p => new THREE.Vector2(p[0], p[1]));
  const at = [0];
  for (let i = 1; i < v.length; i++) at.push(at[i - 1] + v[i].distanceTo(v[i - 1]));
  return { points: v, at, length: at[at.length - 1] };
}
const segment = (route: Route, s: number) => {
  let i = 1;
  while (i < route.at.length - 1 && route.at[i] < s) i++;
  return i;
};
/** Point and direction along a route, `lane` metres to the left of its run. */
export function along(route: Route, s: number, lane: number, out: THREE.Vector2, tangent: THREE.Vector2) {
  const clamped = THREE.MathUtils.clamp(s, 0, route.length);
  const i = segment(route, clamped);
  const a = route.points[i - 1], b = route.points[i];
  const span = Math.max(1e-4, route.at[i] - route.at[i - 1]);
  tangent.subVectors(b, a).divideScalar(span);
  out.lerpVectors(a, b, (clamped - route.at[i - 1]) / span);
  // Left of the direction of travel along the route, in campus axes.
  out.x += tangent.y * lane; out.y += -tangent.x * lane;
  return out;
}

export type Spot = { x: number; z: number; members: number; facing: number };

type Mode = 'off' | 'walk' | 'group' | 'ride';
type Person = {
  index: number; root: THREE.Group; model: THREE.Object3D; mixer: THREE.AnimationMixer;
  walk: THREE.AnimationAction; idle: THREE.AnimationAction;
  bones: Bones; animated: ReturnType<typeof poseBuffer>; rider: Rider | null;
  mode: Mode; route: Route | null; s: number; dir: 1 | -1; lane: number; laneShift: number;
  speed: number; pace: number; pause: number; heading: number;
  position: THREE.Vector3; ground: number; groundAge: number;
  bike: Bike | null; ride: RideState; spot: Spot | null; slot: number;
  look: number; lookAt: THREE.Vector3; lookTimer: number; skip: number; pending: number; scale: number;
  coastTimer: number; coasting: boolean; rang: number;
  /** Where a shove has left them, off their path, and how fast it still moves them. */
  offset: THREE.Vector2; shove: THREE.Vector2;
  /** 1 just shoved, easing back to 0. */
  stagger: number;
  /** Seconds since being knocked down, or -1 when on their feet. */
  down: number;
  /** Which way they lean, stagger or fall: away from whoever hit them. */
  fallDir: THREE.Vector2;
  /** Seconds left staring at something that just happened nearby. */
  alarm: number; alarmAt: THREE.Vector3;
};

export type CrowdOptions = {
  model: THREE.Object3D; clips: THREE.AnimationClip[]; map: THREE.Texture | null;
  fleet: Fleet; ground: (x: number, z: number, from: number) => number | null;
  /** How far each clip leaves the shoes above or below the ground. */
  planted: Record<string, number>;
  /** A cyclist rang their bell at someone in the lane, from this point. */
  onBell?: (x: number, z: number) => void;
  /** Someone was shoved or knocked down, at this closing speed in m/s. */
  onHit?: (kind: 'shove' | 'down', x: number, z: number, speed: number) => void;
};

export function createCrowd(options: CrowdOptions) {
  const group = new THREE.Group(); group.name = 'Campus students';
  const materials = OUTFITS.map(o => outfitMaterial(options.map, o));
  const walkClip = options.clips.find(c => c.name === 'Walk')!, idleClip = options.clips.find(c => c.name === 'Idle')!;
  const shade = new THREE.MeshBasicMaterial({ name: 'Campus students | contact shadows', color: 0x13221a, transparent: true, opacity: .24, depthWrite: false });
  const shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(.36, 16).rotateX(-Math.PI / 2), shade, 64);
  shadows.count = 0; shadows.frustumCulled = false; group.add(shadows);
  const people: Person[] = [];
  const routes: Route[] = [], rideRoutes: Route[] = [];
  const spots: Spot[] = [];
  let budget = BUDGETS.balanced;
  // People cast into the sun's shadow map only when it is redrawn every frame;
  // otherwise their contact shadows follow them.
  let castShadows = false;
  let seed = 4321;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  const create = (): Person => {
    const model = cloneSkinned(options.model);
    const root = new THREE.Group(); root.add(model); group.add(root);
    const index = people.length;
    model.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) { mesh.material = materials[index % materials.length]; mesh.frustumCulled = false; mesh.castShadow = castShadows; }
    });
    const mixer = new THREE.AnimationMixer(model);
    const walk = mixer.clipAction(walkClip), idle = mixer.clipAction(idleClip);
    walk.play(); idle.play(); walk.setEffectiveWeight(0); idle.setEffectiveWeight(1);
    idle.time = random() * idleClip.duration; walk.time = random() * walkClip.duration;
    mixer.update(0);
    const bones = findBones(model);
    const all: THREE.Object3D[] = []; model.traverse(o => { if ((o as THREE.Bone).isBone) all.push(o); });
    const animated = poseBuffer(all); animated.save();
    const scale = .92 + random() * .13;
    root.scale.setScalar(scale);
    const person: Person = {
      index, root, model, mixer, walk, idle, bones, animated, rider: null, mode: 'off', route: null, s: 0, dir: 1, lane: 0, laneShift: 0,
      speed: 1.3, pace: 0, pause: 0, heading: 0, position: new THREE.Vector3(), ground: 0, groundAge: 99,
      bike: null, ride: { standing: 0, footDown: 0, turn: 0, ground: 0 }, spot: null, slot: 0,
      look: 0, lookAt: new THREE.Vector3(), lookTimer: 0, skip: 0, pending: 0, scale, coastTimer: 0, coasting: false, rang: 0,
      offset: new THREE.Vector2(), shove: new THREE.Vector2(), stagger: 0, down: -1, fallDir: new THREE.Vector2(0, 1), alarm: 0, alarmAt: new THREE.Vector3(),
    };
    root.visible = false;
    people.push(person);
    return person;
  };

  const free = () => people.find(p => p.mode === 'off') ?? create();
  const count = (mode: Mode) => people.reduce((n, p) => n + (p.mode === mode ? 1 : 0), 0);
  const groundAt = (p: Person, x: number, z: number) => {
    const y = options.ground(x, z, p.position.y + 2.5);
    return y ?? p.ground;
  };
  const release = (p: Person) => {
    p.mode = 'off'; p.root.visible = false; p.spot = null;
    p.offset.set(0, 0); p.shove.set(0, 0); p.stagger = 0; p.down = -1;
    if (p.bike) { p.bike.visible = false; }
  };

  const tangent = new THREE.Vector2(), point = new THREE.Vector2();
  const toPlayer = new THREE.Vector3(), headPos = new THREE.Vector3(), q = new THREE.Quaternion(), face = new THREE.Vector3(), front = new THREE.Vector3();
  const camForward = new THREE.Vector3(), push = new THREE.Vector3(), tiltAxis = new THREE.Vector3(), tilt = new THREE.Quaternion();

  /** Finds a place on a route, out of the camera's view and within reach. */
  const placeOnRoute = (p: Person, list: Route[], player: THREE.Vector3, camera: THREE.Camera, lane: number) => {
    if (!list.length) return false;
    camera.getWorldDirection(camForward);
    for (let attempt = 0; attempt < 14; attempt++) {
      const route = list[Math.floor(random() * list.length)];
      const s = random() * route.length, dir: 1 | -1 = random() < .5 ? 1 : -1;
      along(route, s, lane * dir, point, tangent);
      const dx = point.x - player.x, dz = point.y - player.z, d = Math.hypot(dx, dz);
      if (d < SPAWN_NEAR || d > SPAWN_FAR) continue;
      // Never appear in plain view: behind the camera, or far off to the side.
      if ((dx * camForward.x + dz * camForward.z) / d > .35 && d < 110) continue;
      p.route = route; p.s = s; p.dir = dir;
      p.position.set(point.x, p.position.y, point.y);
      p.ground = options.ground(point.x, point.y, 40) ?? 0; p.groundAge = 0;
      p.position.y = p.ground;
      p.heading = Math.atan2(tangent.x * dir, tangent.y * dir);
      return true;
    }
    return false;
  };

  const startWalker = (p: Person, player: THREE.Vector3, camera: THREE.Camera) => {
    p.lane = (4.05 + (random() - .5) * .5);
    if (!placeOnRoute(p, routes, player, camera, p.lane)) return false;
    p.mode = 'walk'; p.speed = 1.12 + random() * .38; p.pace = p.speed; p.pause = 0; p.laneShift = 0;
    p.root.visible = true;
    return true;
  };

  const startCyclist = (p: Person, player: THREE.Vector3, camera: THREE.Camera) => {
    p.lane = 1.7 + random() * .4;
    if (!placeOnRoute(p, rideRoutes, player, camera, p.lane)) return false;
    if (!p.bike) {
      p.bike = options.fleet.add(LOOKS[(p.index * 3 + 1) % LOOKS.length], p.position, p.heading);
      p.bike.rider = p;
    }
    p.rider ??= createRider(p.model);
    const bike = p.bike;
    bike.visible = true; bike.stand = 0; bike.lean = 0; bike.steer = 0; bike.scale = p.scale;
    p.mode = 'ride'; p.speed = 4.2 + random() * 2.2; p.pace = p.speed; p.laneShift = 0; p.coasting = false; p.coastTimer = 2 + random() * 6;
    p.ride.footDown = 0; p.ride.standing = 0;
    p.root.visible = true;
    return true;
  };

  const joinSpot = (spot: Spot, slot: number) => {
    const p = free();
    const angle = spot.facing + slot / spot.members * Math.PI * 2 + (random() - .5) * .3;
    const radius = .8 + spot.members * .08;
    p.position.set(spot.x + Math.sin(angle) * radius, 0, spot.z + Math.cos(angle) * radius);
    p.ground = options.ground(p.position.x, p.position.z, 40) ?? 0; p.position.y = p.ground;
    // Facing the middle of the group.
    p.heading = Math.atan2(spot.x - p.position.x, spot.z - p.position.z) + (random() - .5) * .35;
    p.mode = 'group'; p.spot = spot; p.slot = slot; p.pace = 0; p.root.visible = true;
    p.lookTimer = random() * 3;
    p.lookAt.set(spot.x, p.ground + 1.5, spot.z);
    return p;
  };

  /** Turns the head toward a point, never past what a neck can turn. */
  const lookToward = (p: Person, target: THREE.Vector3, amount: number) => {
    if (amount < .02) return;
    const { Head, headfront, neck } = p.bones;
    Head.getWorldPosition(headPos); headfront.getWorldPosition(front);
    face.subVectors(front, headPos).normalize();
    toPlayer.subVectors(target, headPos);
    const flat = Math.hypot(toPlayer.x, toPlayer.z);
    if (flat < .05) return;
    // Clamp the turn to 65 degrees either side of the body's facing.
    const body = p.heading;
    let yaw = Math.atan2(toPlayer.x, toPlayer.z) - body;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    yaw = THREE.MathUtils.clamp(yaw, -1.15, 1.15);
    const pitch = THREE.MathUtils.clamp(Math.atan2(toPlayer.y, flat), -.5, .4);
    toPlayer.set(Math.sin(body + yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(body + yaw) * Math.cos(pitch));
    q.setFromUnitVectors(face, toPlayer);
    const partial = new THREE.Quaternion().slerp(q, amount * .45);
    turnWorld(neck, partial);
    Head.getWorldPosition(headPos); headfront.getWorldPosition(front);
    face.subVectors(front, headPos).normalize();
    q.setFromUnitVectors(face, toPlayer);
    turnWorld(Head, new THREE.Quaternion().slerp(q, amount * .8));
  };

  const update = (dt: number, player: THREE.Vector3, playerHeadY: number, camera: THREE.Camera, posts: readonly (readonly Post[])[] = []) => {
    // Keep the population topped up, one newcomer a frame.
    const want: [Mode, number][] = [['walk', budget.walkers], ['ride', budget.cyclists]];
    for (const [mode, target] of want) {
      if (count(mode) < target) {
        const p = free();
        if (!(mode === 'walk' ? startWalker(p, player, camera) : startCyclist(p, player, camera))) release(p);
        break;
      }
    }
    // Groups gather at their spots while the player is within reach.
    let grouped = count('group');
    for (const spot of spots) {
      const d = Math.hypot(spot.x - player.x, spot.z - player.z);
      const members = people.filter(p => p.mode === 'group' && p.spot === spot);
      if (d > KEEP + 10) { for (const p of members) release(p); continue; }
      if (!members.length && d < KEEP - 10 && grouped + spot.members <= budget.grouped) {
        for (let slot = 0; slot < spot.members; slot++) joinSpot(spot, slot);
        grouped += spot.members;
      }
    }
    // Over budget after a quality change: let the furthest go.
    for (const [mode, target] of [['walk', budget.walkers], ['ride', budget.cyclists]] as [Mode, number][]) {
      const extra = people.filter(p => p.mode === mode).sort((a, b) => b.position.distanceToSquared(player) - a.position.distanceToSquared(player));
      for (let i = 0; i < extra.length - target; i++) release(extra[i]);
    }

    let shadowCount = 0;
    const m4 = new THREE.Matrix4();
    for (const p of people) {
      if (p.mode === 'off') continue;
      toPlayer.set(player.x - p.position.x, 0, player.z - p.position.z);
      const distance = toPlayer.length();
      if (distance > KEEP && p.mode !== 'group') { release(p); continue; }
      // A shove carries them a step or two; a knock-down keeps them on the
      // ground for a few seconds before they pick themselves up.
      if (p.mode === 'group') { p.position.x += p.shove.x * dt; p.position.z += p.shove.y * dt; }
      else { p.offset.addScaledVector(p.shove, dt); p.offset.multiplyScalar(Math.exp(-dt * .7)); }
      p.shove.multiplyScalar(Math.exp(-dt * 5));
      p.stagger = Math.max(0, p.stagger - dt * 1.8);
      if (p.down >= 0) { p.down += dt; if (p.down > 3.6) p.down = -1; }
      p.alarm = Math.max(0, p.alarm - dt);
      const shaken = p.down >= 0 || p.stagger > .25 || p.alarm > 1.2;

      if (p.mode === 'walk' && p.route) {
        const route = p.route;
        // Stop short of the player rather than walk into them.
        const ahead = (toPlayer.x * Math.sin(p.heading) + toPlayer.z * Math.cos(p.heading)) / Math.max(distance, 1e-3);
        const blocked = distance < 1.7 && ahead > .2;
        if (p.pause > 0) p.pause -= dt;
        else if (random() < dt * .012) p.pause = 2 + random() * 4;
        let target = blocked || p.pause > 0 || shaken ? 0 : p.speed;
        // Someone slower just ahead the same way: fall in behind them.
        for (const q of people) {
          if (q === p || q.mode !== 'walk' || q.route !== route || q.dir !== p.dir || Math.abs(q.lane - p.lane) > .6) continue;
          const gap = (q.s - p.s) * p.dir;
          if (gap > 0 && gap < 1.6) target = Math.min(target, q.pace * (gap < .9 ? .5 : 1));
        }
        p.pace += (target - p.pace) * (1 - Math.exp(-dt * 4));
        p.s += p.dir * p.pace * dt;
        if (p.s < 0 || p.s > route.length) { p.s = THREE.MathUtils.clamp(p.s, 0, route.length); p.dir = (-p.dir) as 1 | -1; p.pause = 1 + random() * 2; }
        along(route, p.s, p.lane * p.dir, point, tangent);
        p.position.x = point.x + p.offset.x; p.position.z = point.y + p.offset.y;
        // Lamp posts, parked bicycles and other people are walked round.
        for (const list of posts) { pushOut(p.position.x, p.position.y, p.position.z, .28 * p.scale, list, push); p.position.x += push.x; p.position.z += push.z; }
        for (const q of people) {
          if (q === p || (q.mode !== 'walk' && q.mode !== 'group')) continue;
          const dx = p.position.x - q.position.x, dz = p.position.z - q.position.z, d = Math.hypot(dx, dz), min = .3 * (p.scale + q.scale);
          if (d < min && d > 1e-4) { p.position.x += dx / d * (min - d); p.position.z += dz / d * (min - d); }
        }
        const wanted = Math.atan2(tangent.x * p.dir, tangent.y * p.dir);
        p.heading += Math.atan2(Math.sin(wanted - p.heading), Math.cos(wanted - p.heading)) * (1 - Math.exp(-dt * 5));
      } else if (p.mode === 'ride' && p.route && p.bike) {
        const route = p.route, bike = p.bike;
        const sin = Math.sin(p.heading), cos = Math.cos(p.heading);
        const ahead = toPlayer.x * sin + toPlayer.z * cos;
        const across = -toPlayer.x * cos + toPlayer.z * sin;
        // Someone in the lane ahead: ease off and swing out round them.
        const playerInLane = ahead > 0 && ahead < 14 && Math.abs(across) < 1.6;
        // A ring of the bell for anyone in the way, once in a while.
        p.rang = Math.max(0, p.rang - dt);
        if (playerInLane && ahead < 11 && p.rang === 0) { p.rang = 6 + random() * 4; options.onBell?.(p.position.x, p.position.z); }
        // The nearest thing in the lane: the player, a parked bicycle, a
        // lamp post, another cyclist.
        let blockAhead = playerInLane ? ahead : Infinity, blockAcross = playerInLane ? across : 0;
        const consider = (dx: number, dz: number, width: number) => {
          const a = dx * sin + dz * cos, c = -dx * cos + dz * sin;
          if (a > 0 && a < blockAhead && a < 14 && Math.abs(c) < width) { blockAhead = a; blockAcross = c; }
        };
        for (const list of posts) for (const post of list) consider(post.x - p.position.x, post.z - p.position.z, 1.1 + post.r);
        for (const q of people) if (q !== p && q.mode === 'ride') consider(q.position.x - p.position.x, q.position.z - p.position.z, 1);
        const inLane = blockAhead < 14;
        p.laneShift += ((inLane ? -1.8 : 0) - p.laneShift) * (1 - Math.exp(-dt * 1.5));
        const close = blockAhead < 3 && Math.abs(blockAcross) < 1.1;
        p.coastTimer -= dt;
        if (p.coastTimer < 0) { p.coasting = !p.coasting; p.coastTimer = p.coasting ? 1.5 + random() * 2 : 4 + random() * 8; }
        const target = close ? 0 : inLane ? Math.min(p.speed, 2.6) : p.speed;
        p.pace += (target - p.pace) * (1 - Math.exp(-dt * (target < p.pace ? 2.5 : .8)));
        p.s += p.dir * p.pace * dt;
        if (p.s < 0 || p.s > route.length) { release(p); continue; }
        along(route, p.s, (p.lane + p.laneShift) * p.dir, point, tangent);
        p.position.x = point.x; p.position.z = point.y;
        const wanted = Math.atan2(tangent.x * p.dir, tangent.y * p.dir);
        const turn = Math.atan2(Math.sin(wanted - p.heading), Math.cos(wanted - p.heading)) * (1 - Math.exp(-dt * 3));
        p.heading += turn;
        bike.heading = p.heading;
        bike.position.copy(p.position);
        bike.wheel += p.pace * dt / BIKE.wheelRadius;
        const pedalling = !p.coasting && p.pace > .4 && target > .1;
        if (pedalling) bike.crank += p.pace * dt / BIKE.development * Math.PI * 2;
        const stopped = p.pace < .35;
        p.ride.footDown += ((stopped ? 1 : 0) - p.ride.footDown) * (1 - Math.exp(-dt * 5));
        const yawRate = turn / Math.max(dt, 1e-4);
        p.ride.turn += (THREE.MathUtils.clamp(yawRate * .8, -1, 1) - p.ride.turn) * (1 - Math.exp(-dt * 4));
        bike.lean += (THREE.MathUtils.clamp(yawRate * p.pace * .09, -.32, .32) + p.ride.footDown * .11 - bike.lean) * (1 - Math.exp(-dt * 5));
        bike.steer += (THREE.MathUtils.clamp(yawRate * .25, -.35, .35) - bike.steer) * (1 - Math.exp(-dt * 6));
      } else if (p.mode === 'group' && p.spot) {
        // Members of a group turn to whoever is talking, and to the player.
        p.lookTimer -= dt;
        if (p.lookTimer < 0) {
          const others = people.filter(o => o !== p && o.mode === 'group' && o.spot === p.spot);
          const other = others[Math.floor(random() * others.length)];
          if (other) p.lookAt.set(other.position.x, other.position.y + 1.55 * other.scale, other.position.z);
          p.lookTimer = 2 + random() * 4;
        }
      }

      // Ground under the feet, refreshed a few times a second.
      p.groundAge += dt;
      if (p.mode !== 'group' && p.groundAge > .18) { p.ground = groundAt(p, p.position.x, p.position.z); p.groundAge = 0; }
      p.position.y += (p.ground - p.position.y) * (1 - Math.exp(-dt * 10));
      if (p.bike) { p.bike.position.y = p.position.y; p.ride.ground = p.position.y; }

      // Animation, at a lower rate further away.
      const every = distance > 90 ? 6 : distance > 40 ? 3 : 1;
      p.pending += dt;
      p.skip = (p.skip + 1) % every;
      if (p.skip === 0) {
        const step = p.pending; p.pending = 0;
        const walking = p.mode === 'walk' ? THREE.MathUtils.clamp(p.pace / .5, 0, 1) : 0;
        p.walk.setEffectiveWeight(walking); p.idle.setEffectiveWeight(1 - walking);
        p.walk.setEffectiveTimeScale(THREE.MathUtils.clamp(p.pace / WALK_CLIP_SPEED, .5, 1.4));
        p.animated.restore(); p.mixer.update(step); p.animated.save();
        const plant = options.planted.Walk * walking + options.planted.Idle * (1 - walking);
        p.root.position.set(p.position.x, p.position.y, p.position.z);
        p.root.rotation.set(0, p.heading, 0);
        if (p.down >= 0 || p.stagger > .01) {
          // Tipped about the feet, away from whoever hit them: a lean when
          // shoved, a fall flat when knocked down, then back up again.
          const t = p.down;
          let angle = p.stagger * .2;
          if (t >= 0) angle = Math.max(angle, t < .45 ? 1.48 * (t / .45) ** 2 : t < 2.6 ? 1.48 : 1.48 * (1 - THREE.MathUtils.smoothstep(t, 2.6, 3.6)));
          tiltAxis.set(p.fallDir.y, 0, -p.fallDir.x);
          p.root.quaternion.premultiply(tilt.setFromAxisAngle(tiltAxis, angle));
          p.root.position.y += Math.sin(angle) * .12;
        }
        p.model.position.y = p.mode === 'ride' ? 0 : plant;
        p.root.updateMatrixWorld(true);
        settleArms(p.bones, p.model, p.mode === 'ride' ? 0 : ARMS_IN.Walk * walking + ARMS_IN.Idle * (1 - walking));
        if (p.mode === 'ride' && p.rider && p.bike) p.rider.apply(p.bike, p.ride, 1);
        else if (p.down < 0) {
          // A glance at the player passing close by, otherwise at the group.
          const near = distance < 5.5 ? 1 - Math.max(0, distance - 3) / 2.5 : 0;
          p.look += (near - p.look) * (1 - Math.exp(-step * 3));
          if (p.alarm > 0) lookToward(p, p.alarmAt, Math.min(1, p.alarm));
          else if (p.look > .05) lookToward(p, headPos.set(player.x, playerHeadY, player.z), p.look);
          else if (p.mode === 'group') lookToward(p, p.lookAt, .9);
        }
      }

      if (shadowCount < shadows.instanceMatrix.count && p.mode !== 'ride') {
        m4.makeTranslation(p.position.x, p.position.y + .02, p.position.z);
        shadows.setMatrixAt(shadowCount++, m4);
      }
    }
    shadows.count = shadowCount; shadows.instanceMatrix.needsUpdate = true;
  };

  return {
    group, people, materials,
    setQuality(quality: 'performance' | 'balanced' | 'high') { budget = BUDGETS[quality]; },
    setCastShadows(on: boolean) {
      castShadows = on;
      for (const p of people) p.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.castShadow = on; });
    },
    addRoutes(walk: number[][][], ride: number[][][]) {
      for (const r of walk) if (r.length > 1) routes.push(makeRoute(r));
      for (const r of ride) if (r.length > 1) rideRoutes.push(makeRoute(r));
    },
    addSpots(list: Spot[]) { spots.push(...list); },
    /** Distance from a point to the nearest member of a chatting group. */
    nearestGroup(point: THREE.Vector3) {
      let best = Infinity;
      for (const p of people) if (p.mode === 'group') best = Math.min(best, Math.hypot(p.position.x - point.x, p.position.z - point.z));
      return best;
    },
    update,
    /** Something happened here, a crash or a fall: everyone near turns to look, and walkers stop a moment. */
    alarm(x: number, y: number, z: number, range = 16) {
      for (const p of people) {
        if (p.mode === 'off' || p.mode === 'ride' || p.down >= 0) continue;
        if (Math.hypot(p.position.x - x, p.position.z - z) > range) continue;
        p.alarm = 2.5 + random() * 1.5; p.alarmAt.set(x, y + .4, z);
      }
    },
    /**
     * Pushes a point out of anyone standing on it; returns how far it moved.
     * Given the velocity it came in at, the person reacts as well: a shove
     * from someone walking into them, a fall from a bicycle at speed.
     */
    separate(position: THREE.Vector3, radius: number, out: THREE.Vector3, hit?: { x: number; z: number; riding: boolean }) {
      out.set(0, 0, 0);
      for (const p of people) {
        if (p.mode === 'off' || p.mode === 'ride' || p.down >= 0) continue;
        const dx = position.x - p.position.x, dz = position.z - p.position.z, d = Math.hypot(dx, dz), min = radius + .28 * p.scale;
        if (d < min && d > 1e-4 && Math.abs(position.y - p.position.y) < 1.2) {
          let give = 1;
          const closing = hit ? -(hit.x * dx + hit.z * dz) / d : 0;
          if (hit && closing > .5) {
            if (hit.riding && closing > 4.5) {
              p.down = 0; p.fallDir.set(-dx / d, -dz / d); p.shove.set(-dx / d, -dz / d).multiplyScalar(1.6); give = .2;
              options.onHit?.('down', p.position.x, p.position.z, closing);
            } else if (p.stagger < .5) {
              p.stagger = 1; p.fallDir.set(-dx / d, -dz / d); p.shove.set(-dx / d, -dz / d).multiplyScalar(Math.min(2.6, .7 + closing * .45));
              p.pause = Math.max(p.pause, 1.5); p.look = 1; give = .5;
              options.onHit?.('shove', p.position.x, p.position.z, closing);
            }
          }
          out.x += dx / d * (min - d) * give; out.z += dz / d * (min - d) * give;
        }
      }
      return out;
    },
    dispose() {
      for (const p of people) p.mixer.stopAllAction();
      for (const m of materials) m.dispose();
      shadows.geometry.dispose(); shadows.dispose(); shade.dispose();
    },
  };
}
export type Crowd = ReturnType<typeof createCrowd>;
