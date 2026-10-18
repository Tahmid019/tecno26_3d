import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Campus bicycles, built in code rather than downloaded.
 *
 * Every bicycle on campus is one entry in a fleet, and the whole fleet draws
 * as a handful of instanced meshes: the frame, the steering (fork, bars and
 * basket), the wheels, the cranks and the pedals each turn on their own, so
 * each is its own instanced part. A dozen parked bicycles and the riders on
 * the roads cost the same nine draw calls as one.
 *
 * The frame is a real roadster's, sized for the student: 26 inch wheels, a
 * saddle at 0.83 m and swept-back city bars. The rider is fitted to the
 * bicycle by inverse kinematics (see `rider.ts`), not the other way round.
 * Bicycle space: origin on the ground under the crank axle, +Z forward, +Y up,
 * +X on the rider's left.
 */
export const BICYCLE_SPEED = 8;
export const BICYCLE_SPRINT = 12;
/** How close the student has to be, in metres, before one can be picked up. */
export const MOUNT_RANGE = 3;

export type RiderFit = {
  crank: { y: number; z: number };
  crankRadius: number;
  bar: { x: number; y: number; z: number };
  saddle: { y: number; z: number };
};

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const STEER_DIR = V(0, Math.sin(THREE.MathUtils.degToRad(70)), -Math.cos(THREE.MathUtils.degToRad(70)));
export const BIKE = {
  wheelRadius: .335,
  rearAxle: V(0, .335, -.42),
  frontAxle: V(0, .335, .625),
  bb: V(0, .29, 0),
  crank: .17,
  /** Distance of each pedal's centre from the frame's centre line. */
  pedalX: .13,
  /** Where the sit bones rest on the saddle. */
  saddle: V(0, .835, -.2),
  /** The rider's left grip; the right one mirrors it across x. */
  grip: V(.27, .985, .36),
  steerPivot: V(0, .6, .545),
  steerAxis: STEER_DIR,
  /** Metres travelled per turn of the cranks: 80 rpm cruising, 120 sprinting. */
  development: 6,
};

export type BikeLook = { paint: string; basket?: boolean; stepThrough?: boolean };
export const LOOKS: BikeLook[] = [
  { paint: '#16181b' }, { paint: '#1f6f63', basket: true }, { paint: '#a3262a' },
  { paint: '#1d4f91', stepThrough: true, basket: true }, { paint: '#2c3136', basket: true },
  { paint: '#d8d4c8', stepThrough: true }, { paint: '#6b7a2a' }, { paint: '#c45a1c', basket: true },
];

export type Bike = {
  id: number; look: BikeLook;
  position: THREE.Vector3; heading: number;
  /** Roll about the wheels' contact line, positive to the rider's left. */
  lean: number; steer: number; wheel: number; crank: number;
  /** 1 parked on its stand, 0 ridden. */
  stand: number; scale: number; visible: boolean;
  /** The wheels' angle as drawn, which never jumps more than a spoke can be followed. */
  shown?: number; last?: number;
  /** Who is on it, so one bicycle is never taken twice. */
  rider: unknown;
};

// ---- geometry ----------------------------------------------------------------

type Piece = THREE.BufferGeometry;
const tint = (geometry: Piece, color: string) => {
  const c = new THREE.Color(color), n = geometry.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (geometry.index) { const g = geometry.toNonIndexed(); geometry.dispose(); return g; }
  return geometry;
};
const tube = (from: THREE.Vector3, to: THREE.Vector3, radius: number, color: string, sides = 7) => {
  const span = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(radius, radius, span.length(), sides, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), span.clone().normalize()));
  g.translate(from.x + span.x / 2, from.y + span.y / 2, from.z + span.z / 2);
  return tint(g, color);
};
const path = (points: THREE.Vector3[], radius: number, color: string) => points.slice(1).map((p, i) => tube(points[i], p, radius, color));
const box = (centre: THREE.Vector3, size: THREE.Vector3, color: string, rotation?: THREE.Euler) => {
  const g = new THREE.BoxGeometry(size.x, size.y, size.z);
  if (rotation) g.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation));
  g.translate(centre.x, centre.y, centre.z);
  return tint(g, color);
};
/** An arc in the bicycle's side plane, centred on an axle. */
const arc = (centre: THREE.Vector3, radius: number, from: number, to: number, width: number, color: string, x = 0) => {
  const steps = 14, positions: number[] = [], index: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + (to - from) * i / steps;
    const y = centre.y + Math.cos(t) * radius, z = centre.z + Math.sin(t) * radius;
    positions.push(x - width / 2, y, z, x + width / 2, y, z);
    if (i) { const k = i * 2; index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index); g.computeVertexNormals();
  return tint(g, color);
};
// Each primitive keeps its own smooth normals; recomputing them across the
// merged, unindexed mesh would facet every tube and tyre.
const merge = (pieces: Piece[]) => {
  const g = mergeGeometries(pieces.map(p => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); return q; }));
  for (const piece of pieces) piece.dispose();
  g.computeBoundingSphere();
  return g;
};

const CHROME = '#c3c8cb', BLACK = '#17181a', RUBBER = '#1d1e1f', SADDLE = '#3a2a20', DARK = '#45484c', WHITE = '#ffffff';

function frameGeometry(stepThrough: boolean) {
  const { bb, rearAxle } = BIKE;
  const seatTop = V(0, .765, -.155), headBottom = V(0, .62, .538), headTop = V(0, .75, .49);
  const paint: Piece[] = [
    tube(bb, headBottom, .022, WHITE), tube(bb, seatTop, .02, WHITE), tube(headBottom, headTop, .024, WHITE),
    ...[-1, 1].flatMap(s => [tube(bb, rearAxle.clone().setX(s * .06), .011, WHITE), tube(seatTop, rearAxle.clone().setX(s * .06), .01, WHITE)]),
    // Mudguard over the rear wheel, painted with the frame as roadsters are.
    arc(rearAxle, BIKE.wheelRadius + .03, -2.2, .25, .055, WHITE),
  ];
  // A step-through frame swaps the top tube for a low, curved one.
  if (stepThrough) paint.push(...path([V(0, .70, .51), V(0, .62, .34), V(0, .52, .12), V(0, .47, -.05)], .02, WHITE));
  else paint.push(tube(seatTop, headTop, .019, WHITE));
  const fit: Piece[] = [
    tube(seatTop, V(0, .81, -.18), .013, CHROME),
    // Saddle: broad at the back, narrowing to the nose.
    box(V(0, .835, -.215), V(.17, .045, .12), SADDLE), box(V(0, .835, -.115), V(.09, .04, .1), SADDLE), box(V(0, .838, -.05), V(.05, .035, .06), SADDLE),
    // Carrier over the rear wheel.
    box(V(0, .7, -.47), V(.14, .012, .36), DARK),
    ...[-1, 1].flatMap(s => [tube(V(s * .065, .7, -.62), rearAxle.clone().setX(s * .06), .007, DARK), tube(V(s * .065, .7, -.3), seatTop.clone().setX(s * .02), .007, DARK)]),
    // Chainring and chain on the right-hand side.
    tint(new THREE.TorusGeometry(.095, .009, 4, 22).rotateY(Math.PI / 2).translate(-.075, bb.y, bb.z), DARK),
    tint(new THREE.TorusGeometry(.035, .007, 4, 12).rotateY(Math.PI / 2).translate(-.075, rearAxle.y, rearAxle.z), DARK),
    tube(V(-.075, bb.y + .095, bb.z), V(-.075, rearAxle.y + .035, rearAxle.z), .005, BLACK),
    tube(V(-.075, bb.y - .095, bb.z), V(-.075, rearAxle.y - .035, rearAxle.z), .005, BLACK),
    // Chain guard, standard on a campus roadster.
    box(V(-.088, bb.y + .02, -.2), V(.012, .09, .42), BLACK, new THREE.Euler(.07, 0, 0)),
    tint(new THREE.CylinderGeometry(.025, .025, .09, 8).rotateZ(Math.PI / 2).translate(bb.x, bb.y, bb.z), DARK),
  ];
  return { paint: merge(paint), fit: merge(fit) };
}

function steerGeometry(basket: boolean) {
  const { frontAxle } = BIKE;
  const crown = V(0, .585, .555);
  const paint: Piece[] = [
    tube(V(0, .62, .538), crown, .022, WHITE),
    ...[-1, 1].map(s => tube(crown.clone().setX(s * .05), frontAxle.clone().setX(s * .045), .011, WHITE)),
    arc(frontAxle, BIKE.wheelRadius + .03, -.35, 1.65, .05, WHITE),
  ];
  const clamp = V(0, .95, .52);
  const fit: Piece[] = [
    tube(V(0, .75, .49), V(0, .9, .455), .014, CHROME), tube(V(0, .9, .455), clamp, .013, CHROME),
    ...path([V(-.27, .985, .37), V(-.19, .97, .47), clamp, V(.19, .97, .47), V(.27, .985, .37)], .011, CHROME),
    ...[-1, 1].map(s => tube(V(s * .25, .983, .405), V(s * .285, .987, .325), .017, RUBBER)),
    tint(new THREE.SphereGeometry(.024, 8, 6).translate(.17, .99, .47), CHROME),
    tint(new THREE.CylinderGeometry(.032, .028, .05, 10).rotateX(Math.PI / 2).translate(0, .78, .6), CHROME),
  ];
  if (basket) {
    const c = V(0, .84, .7), w = .34, h = .22, d = .26, t = .008, wicker = '#7a5634';
    fit.push(box(V(c.x, c.y - h / 2, c.z), V(w, t, d), wicker),
      box(V(c.x + w / 2, c.y, c.z), V(t, h, d), wicker), box(V(c.x - w / 2, c.y, c.z), V(t, h, d), wicker),
      box(V(c.x, c.y, c.z + d / 2), V(w, h, t), wicker), box(V(c.x, c.y, c.z - d / 2), V(w, h, t), wicker),
      tube(V(0, c.y - h / 2, c.z - d / 2), V(0, .62, .56), .008, DARK));
  }
  return { paint: merge(paint), fit: merge(fit) };
}

function wheelGeometry() {
  const R = BIKE.wheelRadius;
  const pieces: Piece[] = [
    tint(new THREE.TorusGeometry(R - .019, .019, 6, 30).rotateY(Math.PI / 2), RUBBER),
    tint(new THREE.TorusGeometry(R - .042, .009, 4, 30).rotateY(Math.PI / 2), CHROME),
    tint(new THREE.CylinderGeometry(.022, .022, .1, 8).rotateZ(Math.PI / 2), CHROME),
  ];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, side = i % 2 ? .035 : -.035;
    pieces.push(tube(V(side, Math.cos(a) * .02, Math.sin(a) * .02), V(0, Math.cos(a + .2) * (R - .045), Math.sin(a + .2) * (R - .045)), .0018, CHROME, 3));
  }
  return merge(pieces);
}

function crankGeometry() {
  const { crank } = BIKE;
  return merge([
    // Right arm points up and left arm down at angle 0; the axle runs between.
    box(V(-.085, crank / 2, 0), V(.018, crank + .03, .03), CHROME), box(V(.085, -crank / 2, 0), V(.018, crank + .03, .03), CHROME),
    tint(new THREE.CylinderGeometry(.012, .012, .2, 6).rotateZ(Math.PI / 2), CHROME),
  ]);
}

function pedalGeometry() {
  return merge([box(V(0, 0, 0), V(.095, .022, .075), BLACK), box(V(0, 0, 0), V(.1, .01, .02), CHROME)]);
}

function standGeometry() {
  return merge([tube(V(0, 0, 0), V(0, -.3, 0), .009, DARK), box(V(0, -.3, 0), V(.03, .01, .05), DARK)]);
}

function shadowGeometry() {
  const g = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  g.scale(.3, 1, .82); g.translate(0, .02, .1);
  return g;
}

// ---- the fleet -------------------------------------------------------------

const m4 = new THREE.Matrix4(), base = new THREE.Matrix4(), part = new THREE.Matrix4(), steer = new THREE.Matrix4();
const q = new THREE.Quaternion(), e = new THREE.Euler(), one = V(1, 1, 1), p = new THREE.Vector3();

/** World matrix of a bicycle's frame. */
export function frameMatrix(bike: Bike, out: THREE.Matrix4) {
  e.set(0, bike.heading, 0, 'YXZ'); q.setFromEuler(e);
  out.compose(bike.position, q, p.setScalar(bike.scale));
  return out.multiply(m4.makeRotationZ(-bike.lean));
}
/** World matrix of the steering assembly, which turns about the head tube. */
export function steerMatrix(bike: Bike, out: THREE.Matrix4) {
  frameMatrix(bike, out);
  const pivot = BIKE.steerPivot;
  return out.multiply(m4.makeTranslation(pivot.x, pivot.y, pivot.z))
    .multiply(m4.makeRotationAxis(BIKE.steerAxis, bike.steer))
    .multiply(m4.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}
/** A pedal's centre in world space; side +1 is the rider's left. */
export function pedalWorld(bike: Bike, side: 1 | -1, out: THREE.Vector3) {
  const { bb, crank, pedalX } = BIKE;
  // The right crank (side -1) points along (0, cos θ, sin θ).
  const k = side === -1 ? 1 : -1;
  out.set(side * pedalX, bb.y + k * crank * Math.cos(bike.crank), bb.z + k * crank * Math.sin(bike.crank));
  return out.applyMatrix4(frameMatrix(bike, base));
}
export function gripWorld(bike: Bike, side: 1 | -1, out: THREE.Vector3) {
  return out.set(side * BIKE.grip.x, BIKE.grip.y, BIKE.grip.z).applyMatrix4(steerMatrix(bike, base));
}
export function frameWorld(bike: Bike, local: THREE.Vector3, out: THREE.Vector3) {
  return out.copy(local).applyMatrix4(frameMatrix(bike, base));
}

export function createFleet(capacity: number) {
  const group = new THREE.Group(); group.name = 'Campus bicycles';
  const paint = new THREE.MeshStandardMaterial({ name: 'Bicycle | enamel paint', vertexColors: true, roughness: .36, metalness: .3, side: THREE.DoubleSide });
  const fittings = new THREE.MeshStandardMaterial({ name: 'Bicycle | steel, rubber and leather', vertexColors: true, roughness: .5, metalness: .35 });
  const shade = new THREE.MeshBasicMaterial({ name: 'Bicycle | contact shadow', color: 0x13221a, transparent: true, opacity: .26, depthWrite: false });
  const frames = [frameGeometry(false), frameGeometry(true)], steers = [steerGeometry(false), steerGeometry(true)];
  steers[1].paint.dispose(); frames[1].fit.dispose();
  const make = (geometry: THREE.BufferGeometry, material: THREE.Material, count: number, name: string) => {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `Bicycles | ${name}`; mesh.count = 0; mesh.frustumCulled = false;
    mesh.castShadow = material !== shade; group.add(mesh); return mesh;
  };
  const parts = {
    framePaint: frames.map((g, i) => make(g.paint, paint, capacity, i ? 'step-through frames' : 'diamond frames')),
    frameFit: make(frames[0].fit, fittings, capacity, 'saddles, chains and carriers'),
    steerPaint: make(steers[0].paint, paint, capacity, 'forks'),
    steerFit: steers.map((g, i) => make(g.fit, fittings, capacity, i ? 'bars and baskets' : 'bars')),
    wheels: make(wheelGeometry(), fittings, capacity * 2, 'wheels'),
    cranks: make(crankGeometry(), fittings, capacity, 'cranks'),
    pedals: make(pedalGeometry(), fittings, capacity * 2, 'pedals'),
    stands: make(standGeometry(), fittings, capacity, 'stands'),
    shadows: make(shadowGeometry(), shade, capacity, 'shadows'),
  };
  for (const p of [parts.shadows, parts.stands]) p.castShadow = false;
  const bikes: Bike[] = [];
  const color = new THREE.Color();

  const add = (look: BikeLook, position: THREE.Vector3, heading: number): Bike => {
    if (bikes.length >= capacity) throw new Error('The bicycle fleet is full');
    const bike: Bike = { id: bikes.length, look, position: position.clone(), heading, lean: 0, steer: 0, wheel: Math.random() * 6, crank: Math.random() * 6, stand: 1, scale: 1, visible: true, rider: null };
    bikes.push(bike);
    return bike;
  };

  /** Writes every bicycle's parts into the instanced meshes. */
  const update = () => {
    const counts = new Map<THREE.InstancedMesh, number>();
    const put = (mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, paintColor?: THREE.Color) => {
      const i = counts.get(mesh) ?? 0;
      mesh.setMatrixAt(i, matrix);
      if (paintColor) mesh.setColorAt(i, paintColor);
      counts.set(mesh, i + 1);
    };
    for (const bike of bikes) {
      if (!bike.visible) continue;
      color.set(bike.look.paint);
      frameMatrix(bike, base);
      put(parts.framePaint[bike.look.stepThrough ? 1 : 0], base, color);
      put(parts.frameFit, base);
      steerMatrix(bike, steer);
      put(parts.steerPaint, steer, color);
      put(parts.steerFit[bike.look.basket ? 1 : 0], steer);
      const { rearAxle, frontAxle, bb, crank, pedalX } = BIKE;
      // Spokes turning faster than a frame can follow strobe: at riding pace
      // a phone drew them three spokes on each frame, so they seemed to
      // stutter or spin backwards. Drawn, they never turn more than a
      // fraction of a spoke a frame, so they always roll forward smoothly.
      const turned = bike.wheel - (bike.last ?? bike.wheel);
      bike.last = bike.wheel;
      bike.shown = (bike.shown ?? bike.wheel) + THREE.MathUtils.clamp(turned, -.085, .085);
      put(parts.wheels, part.copy(base).multiply(m4.makeTranslation(rearAxle.x, rearAxle.y, rearAxle.z)).multiply(m4.makeRotationX(bike.shown)));
      put(parts.wheels, part.copy(steer).multiply(m4.makeTranslation(frontAxle.x, frontAxle.y, frontAxle.z)).multiply(m4.makeRotationX(bike.shown)));
      put(parts.cranks, part.copy(base).multiply(m4.makeTranslation(bb.x, bb.y, bb.z)).multiply(m4.makeRotationX(bike.crank)));
      for (const side of [1, -1]) {
        const k = side === -1 ? 1 : -1;
        put(parts.pedals, part.copy(base).multiply(m4.makeTranslation(side * pedalX, bb.y + k * crank * Math.cos(bike.crank), bb.z + k * crank * Math.sin(bike.crank))));
      }
      // The stand swings down on its pivot behind the crank as the bicycle is parked.
      put(parts.stands, part.copy(base).multiply(m4.makeTranslation(.07, bb.y + .02, -.12)).multiply(m4.makeRotationX(-.15 + (1 - bike.stand) * 1.7)));
      e.set(0, bike.heading, 0, 'YXZ'); q.setFromEuler(e);
      put(parts.shadows, part.compose(p.set(bike.position.x, bike.position.y, bike.position.z), q, one));
    }
    for (const mesh of group.children as THREE.InstancedMesh[]) {
      mesh.count = counts.get(mesh) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    group, bikes, add, update,
    /** The nearest free bicycle within `range` of a point. */
    nearest(point: THREE.Vector3, range: number) {
      let best: Bike | null = null, bestDistance = range;
      for (const bike of bikes) {
        if (bike.rider || !bike.visible) continue;
        const d = Math.hypot(bike.position.x - point.x, bike.position.z - point.z);
        if (d < bestDistance && Math.abs(bike.position.y - point.y) < 1.5) { best = bike; bestDistance = d; }
      }
      return best;
    },
    /**
     * Parked bicycles as two circles each, round the wheels, for anyone
     * walking or riding by to bump into. `except` is the one being ridden.
     */
    posts(out: { x: number; y: number; z: number; r: number; bike?: unknown }[], except: Bike | null = null) {
      // The list's objects are reused frame to frame rather than made anew.
      let n = 0;
      for (const bike of bikes) {
        if (bike.rider || !bike.visible || bike === except) continue;
        const sin = Math.sin(bike.heading), cos = Math.cos(bike.heading);
        for (const along of [-.3, .5]) {
          const post = out[n] ?? (out[n] = { x: 0, y: 0, z: 0, r: 0 });
          post.x = bike.position.x + sin * along * bike.scale; post.y = bike.position.y; post.z = bike.position.z + cos * along * bike.scale; post.r = .3 * bike.scale; post.bike = bike;
          n++;
        }
      }
      out.length = n;
      return out;
    },
    /** Whether the bicycles cast into the sun's shadow map, or rely on their contact shadows. */
    setCastShadows(on: boolean) {
      for (const mesh of group.children as THREE.InstancedMesh[]) mesh.castShadow = on && mesh !== parts.shadows && mesh !== parts.stands;
    },
    setEnvironment(texture: THREE.Texture | null) {
      for (const m of [paint, fittings]) { m.envMap = texture; m.envMapIntensity = .7; m.needsUpdate = true; }
    },
    dispose() {
      for (const mesh of group.children as THREE.InstancedMesh[]) { mesh.geometry.dispose(); mesh.dispose(); }
      paint.dispose(); fittings.dispose(); shade.dispose();
    },
  };
}
export type Fleet = ReturnType<typeof createFleet>;


export function createBicycle(fit: RiderFit) {
  const group = new THREE.Group();
  group.name = "Remote bicycle";

  const paint = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.36,
    metalness: 0.3,
    side: THREE.DoubleSide,
  });

  const fittings = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.35,
  });

  const frame = frameGeometry(false);
  const steering = steerGeometry(false);

  const addMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D = group,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  };

  addMesh(frame.paint, paint);
  addMesh(frame.fit, fittings);

  const steerGroup = new THREE.Group();
  const pivot = BIKE.steerPivot.clone();
  steerGroup.position.copy(pivot);

  steering.paint.translate(-pivot.x, -pivot.y, -pivot.z);
  steering.fit.translate(-pivot.x, -pivot.y, -pivot.z);

  addMesh(steering.paint, paint, steerGroup);
  addMesh(steering.fit, fittings, steerGroup);
  group.add(steerGroup);

  const wheelGeo = wheelGeometry();
  const rearWheel = addMesh(wheelGeo.clone(), fittings);
  const frontWheel = addMesh(wheelGeo.clone(), fittings);

  rearWheel.position.copy(BIKE.rearAxle);
  frontWheel.position.copy(BIKE.frontAxle);

  const crankGroup = new THREE.Group();
  crankGroup.position.set(0, fit.crank.y, fit.crank.z);
  addMesh(crankGeometry(), fittings, crankGroup);
  group.add(crankGroup);

  const pedalGeo = pedalGeometry();
  const pedals = [
    addMesh(pedalGeo.clone(), fittings),
    addMesh(pedalGeo.clone(), fittings),
  ];

  const wheelCircumference = 2 * Math.PI * BIKE.wheelRadius;
  let wheelAngle = 0;
  let crankAngle = 0;

  const setCranks = (angle: number) => {
    crankAngle = angle;
    crankGroup.rotation.x = angle;

    const radius = fit.crankRadius || BIKE.crank;

    pedals.forEach((pedal, i) => {
      const side = i === 0 ? -1 : 1;
      const phase = angle + (i === 0 ? 0 : Math.PI);

      pedal.position.set(
        side * BIKE.pedalX,
        fit.crank.y + radius * Math.cos(phase),
        fit.crank.z + radius * Math.sin(phase),
      );
    });
  };

  setCranks(0);

  return {
    group,
    bars: steerGroup,
    pedals,
    lean: 0,

    update(delta: number, speed: number, steer: number) {
      wheelAngle += speed * delta / wheelCircumference * Math.PI * 2;

      rearWheel.rotation.x = wheelAngle;
      frontWheel.rotation.x = wheelAngle;
      steerGroup.rotation.y = steer;

      setCranks(crankAngle + speed * delta / wheelCircumference
        * Math.PI * 2 * BIKE.wheelRadius / BIKE.development);
    },

    setCranks,

    dispose() {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
        }
      });

      paint.dispose();
      fittings.dispose();
      group.removeFromParent();
    },
  };
}

