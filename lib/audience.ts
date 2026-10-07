import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { findBones, poseBuffer, reach, setWorldPosition, turnAbout, type Bones } from './rig.ts';
import { ARMS_IN, settleArms } from './posture.ts';
import { OUTFITS, OUTFIT_FRAGMENT } from './npcs.ts';

/**
 * The TECNOESIS audience and band: real people, not mannequins.
 *
 * The student's model, lightened to under four thousand triangles, is posed
 * a dozen ways once at load (arms up in a V, clapping above the head and in
 * front of the chest, filming on a phone, punching the air, bouncing at the
 * knees, nodding, playing guitar and keys, sitting at the drums) and every
 * pose is baked into one mesh as a morph target. The whole crowd is then one
 * instanced draw: each person blends between their poses in time with the
 * music, a little ahead of or behind the beat, in their own clothes.
 */
export type Spot = { x: number; z: number; y: number; scale: number; phase: number; cheer: boolean };
export type Role = 'crowd' | 'singer' | 'guitar' | 'keys' | 'drums';

const POSES = ['cheer', 'overhead', 'clapOpen', 'clapShut', 'phone', 'fist', 'bounce', 'nod', 'guitar', 'keys', 'sit'] as const;
type Pose = typeof POSES[number];
const P = Object.fromEntries(POSES.map((name, i) => [name, i])) as Record<Pose, number>;

/** Beats a second: 126 to the minute. */
const BEAT = 2.1;

/** Poses the bones for one morph target, starting from the settled idle pose. */
function posers(b: Bones) {
  const at = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
  const arm = (side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3) => {
    const [upper, lower, hand] = side === 1 ? [b.LeftArm, b.LeftForeArm, b.LeftHand] : [b.RightArm, b.RightForeArm, b.RightHand];
    reach(upper, lower, hand, target, pole);
  };
  const leg = (side: 1 | -1, target: THREE.Vector3, pole: THREE.Vector3) => {
    const [upper, lower, foot] = side === 1 ? [b.LeftUpLeg, b.LeftLeg, b.LeftFoot] : [b.RightUpLeg, b.RightLeg, b.RightFoot];
    reach(upper, lower, foot, target, pole);
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const X = v(1, 0, 0);
  /** Lowers the hips by `drop` (and back by `back`), keeping the feet planted. */
  const crouch = (drop: number, back: number, feetForward: number) => {
    const feet = [at(b.LeftFoot), at(b.RightFoot)];
    setWorldPosition(b.Hips, at(b.Hips).add(v(0, -drop, -back)));
    ([1, -1] as const).forEach((side, i) => leg(side, feet[i].add(v(0, 0, feetForward)), at(side === 1 ? b.LeftUpLeg : b.RightUpLeg).add(v(side * .05, 0, .6))));
  };
  return {
    cheer() { for (const s of [1, -1] as const) { const sh = at(s === 1 ? b.LeftArm : b.RightArm); arm(s, sh.clone().add(v(s * .3, .55, .06)), sh.add(v(s * .6, -.1, -.25))); } },
    overhead() { for (const s of [1, -1] as const) { const sh = at(s === 1 ? b.LeftArm : b.RightArm); arm(s, sh.clone().add(v(-s * .12, .6, .12)), sh.add(v(s * .6, .1, -.2))); } },
    clapOpen() { const chest = at(b.Spine02); for (const s of [1, -1] as const) { const sh = at(s === 1 ? b.LeftArm : b.RightArm); arm(s, chest.clone().add(v(s * .22, -.04, .3)), sh.add(v(s * .35, -.45, -.1))); } },
    clapShut() { const chest = at(b.Spine02); for (const s of [1, -1] as const) { const sh = at(s === 1 ? b.LeftArm : b.RightArm); arm(s, chest.clone().add(v(s * .035, 0, .34)), sh.add(v(s * .35, -.45, -.1))); } },
    // The right hand up at eye level, filming; the left stays down.
    phone() { const head = at(b.Head), sh = at(b.RightArm); arm(-1, head.add(v(-.13, .1, .36)), sh.add(v(-.45, -.35, .05))); },
    fist() { const sh = at(b.RightArm); arm(-1, sh.clone().add(v(-.12, .5, .14)), sh.add(v(-.55, .1, .1))); },
    bounce() { crouch(.075, .02, 0); turnAbout(b.Spine01, X, .06); },
    nod() { turnAbout(b.neck, X, .12); turnAbout(b.Head, X, .24); },
    guitar() {
      const chest = at(b.Spine02), hips = at(b.Hips), left = at(b.LeftArm), right = at(b.RightArm);
      arm(1, chest.clone().add(v(.42, -.08, .2)), left.add(v(.25, -.45, -.25)));
      arm(-1, hips.add(v(-.02, .14, .24)), right.add(v(-.4, -.25, -.1)));
    },
    keys() { const hips = at(b.Hips); for (const s of [1, -1] as const) { const sh = at(s === 1 ? b.LeftArm : b.RightArm); arm(s, hips.clone().add(v(s * .2, .2, .4)), sh.add(v(s * .4, -.35, -.1))); } },
    sit() { crouch(.42, .14, .3); turnAbout(b.Spine01, X, .1); },
  } satisfies Record<Pose, () => void>;
}

/** Skins every vertex of `mesh` as posed now: positions and normals, model space. */
function skinNow(mesh: THREE.SkinnedMesh, lift: number) {
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  const { bones, boneInverses } = mesh.skeleton;
  const blended = new THREE.Matrix4(), part = new THREE.Matrix4(), full = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const positions = new Float32Array(position.count * 3), normals = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    blended.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(i, k);
      if (!w) continue;
      const bone = skinIndex.getComponent(i, k);
      part.multiplyMatrices(bones[bone].matrixWorld, boneInverses[bone]);
      for (let e = 0; e < 16; e++) blended.elements[e] += part.elements[e] * w;
    }
    full.copy(mesh.bindMatrixInverse).multiply(blended).multiply(mesh.bindMatrix).premultiply(mesh.matrixWorld);
    p.fromBufferAttribute(position, i).applyMatrix4(full);
    n.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix.getNormalMatrix(full)).normalize();
    positions.set([p.x, p.y + lift, p.z], i * 3);
    normals.set([n.x, n.y, n.z], i * 3);
  }
  return { positions, normals };
}

/** The crowd model with every pose baked into morph targets. */
export function bakeAudienceGeometry(model: THREE.Object3D, idle: THREE.AnimationClip, lift: number) {
  const rig = cloneSkinned(model);
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.set(1, 1, 1);
  let mesh: THREE.SkinnedMesh | null = null;
  rig.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('The crowd model has no skinned mesh');
  const skinned: THREE.SkinnedMesh = mesh;
  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(idle).play();
  const bones = findBones(rig), pose = posers(bones);
  mixer.setTime(0); rig.updateMatrixWorld(true); settleArms(bones, rig, ARMS_IN.Idle); rig.updateMatrixWorld(true);
  // The mixer leaves alone any bone whose clip value has not changed, so a
  // pose would carry into the next; every pose starts again from this one.
  const all: THREE.Object3D[] = []; rig.traverse(o => { if ((o as THREE.Bone).isBone) all.push(o); });
  const start = poseBuffer(all); start.save();
  const base = skinNow(skinned, lift);
  const morphs = POSES.map(name => {
    start.restore(); rig.updateMatrixWorld(true); pose[name](); rig.updateMatrixWorld(true);
    const posed = skinNow(skinned, lift);
    for (let i = 0; i < posed.positions.length; i++) { posed.positions[i] -= base.positions[i]; posed.normals[i] -= base.normals[i]; }
    return posed;
  });
  mixer.stopAllAction();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(base.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(base.normals, 3));
  geometry.setAttribute('uv', skinned.geometry.getAttribute('uv'));
  geometry.setIndex(skinned.geometry.getIndex());
  geometry.morphAttributes.position = morphs.map(m => new THREE.BufferAttribute(m.positions, 3));
  geometry.morphAttributes.normal = morphs.map(m => new THREE.BufferAttribute(m.normals, 3));
  geometry.morphTargetsRelative = true;
  geometry.computeBoundingSphere();
  return geometry;
}

/** The student's texture, recoloured per person from instance attributes. */
function audienceMaterial(map: THREE.Texture | null) {
  const material = new THREE.MeshStandardMaterial({ name: 'Concert audience | outfits', map, roughness: .86, metalness: 0 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec3 aTop, aBottom;\nattribute float aSkin;\nvarying vec3 vTop, vBottom;\nvarying float vSkin;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTop = aTop; vBottom = aBottom; vSkin = aSkin;');
    shader.fragmentShader = 'varying vec3 vTop, vBottom;\nvarying float vSkin;\n#define uTop vTop\n#define uBottom vBottom\n#define uSkin vSkin\n'
      + shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + OUTFIT_FRAGMENT);
  };
  material.customProgramCacheKey = () => 'concert-audience-v1';
  return material;
}

/** A solid-body electric guitar, in a guitarist's own frame: body at the hip, neck to the left hand. */
function guitarGeometry() {
  const paint = (g: THREE.BufferGeometry, color: string) => {
    const c = new THREE.Color(color), n = g.getAttribute('position').count, colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const body = new THREE.CylinderGeometry(.19, .21, .06, 18); body.rotateX(Math.PI / 2); body.scale(1.05, .82, 1); body.translate(-.03, 1.03, .23);
  const guard = new THREE.CylinderGeometry(.1, .1, .065, 12); guard.rotateX(Math.PI / 2); guard.translate(.02, 1.0, .232);
  const neck = new THREE.BoxGeometry(.56, .05, .03); neck.rotateZ(.2); neck.translate(.38, 1.14, .22);
  const head = new THREE.BoxGeometry(.13, .07, .025); head.rotateZ(.2); head.translate(.7, 1.205, .22);
  const parts = [paint(body, '#8a1d17'), paint(guard, '#e8e2d4'), paint(neck, '#3a2618'), paint(head, '#151515')];
  const merged = mergeGeometries(parts);
  for (const g of [body, guard, neck, head, ...parts]) g.dispose();
  return merged;
}

type Person = { role: Role; style: number; phase: number; lag: number; x: number; y: number; z: number; yaw: number; scale: number; energy: number };

export function createAudience(options: { geometry: THREE.BufferGeometry; map: THREE.Texture | null; crowd: Spot[]; band: { spot: Spot; role: Role }[] }) {
  const people: Person[] = [];
  let seed = 9173;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (const s of options.crowd) {
    // Everyone faces the stage, give or take, and has their own way of enjoying it.
    const r = random();
    const style = s.cheer ? (r < .5 ? 0 : 3) : r < .35 ? 1 : r < .55 ? 2 : r < .75 ? 4 : 0;
    people.push({ role: 'crowd', style, phase: s.phase, lag: (random() - .5) * .16, x: s.x, y: s.y, z: s.z, yaw: Math.atan2(-s.x, -s.z) * .8 + (random() - .5) * .25, scale: s.scale, energy: .6 + random() * .4 });
  }
  for (const { spot, role } of options.band) {
    people.push({ role, style: 0, phase: spot.phase, lag: 0, x: spot.x, y: spot.y, z: spot.z, yaw: role === 'drums' || role === 'keys' ? 0 : (random() - .5) * .3, scale: 1, energy: 1 });
  }
  const material = audienceMaterial(options.map);
  const geometry = options.geometry;
  const n = people.length;
  const top = new Float32Array(n * 3), bottom = new Float32Array(n * 3), skin = new Float32Array(n);
  people.forEach((p, i) => {
    const outfit = OUTFITS[(i * 7 + 3) % OUTFITS.length];
    // A band in black; the crowd in whatever they came in, a shade either way.
    const shade = .8 + random() * .4;
    top.set(p.role === 'crowd' ? outfit.top.map(c => c * shade) : [.012, .012, .014], i * 3);
    bottom.set(p.role === 'crowd' ? outfit.bottom : [.015, .015, .02], i * 3);
    skin[i] = outfit.skin;
  });
  geometry.setAttribute('aTop', new THREE.InstancedBufferAttribute(top, 3));
  geometry.setAttribute('aBottom', new THREE.InstancedBufferAttribute(bottom, 3));
  geometry.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 1));
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.name = 'TECNOESIS | audience and band';
  mesh.castShadow = true; mesh.receiveShadow = true;
  // The guitarists' guitars, slung where the guitar pose holds them.
  const guitarists = people.map((p, i) => ({ p, i })).filter(({ p }) => p.role === 'guitar');
  const guitar = guitarGeometry();
  const guitarPaint = new THREE.MeshStandardMaterial({ name: 'Concert | guitars', vertexColors: true, roughness: .35, metalness: .1 });
  const guitars = new THREE.InstancedMesh(guitar, guitarPaint, Math.max(1, guitarists.length));
  guitars.count = guitarists.length; guitars.castShadow = true; guitars.name = 'TECNOESIS | guitars';
  const weights = new THREE.Mesh(geometry);
  weights.updateMorphTargets();
  const influence = weights.morphTargetInfluences!;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), size = new THREE.Vector3();
  const pulse = (t: number) => Math.pow(Math.max(0, Math.cos(t * Math.PI * 2)), 3);

  const animate = (time: number) => {
    people.forEach((p, i) => {
      influence.fill(0);
      const t = time * BEAT + p.lag;
      const beat = pulse(t), half = pulse(t * .5);
      let hop = 0, sway = Math.sin(time * 1.3 + p.phase) * .04;
      if (p.role === 'crowd') {
        if (p.style === 0) {
          // Arms up: a V, then hands together overhead, jumping on the beat.
          const k = .5 + .5 * Math.sin(t * Math.PI + p.phase);
          influence[P.cheer] = k; influence[P.overhead] = 1 - k;
          influence[P.bounce] = beat * p.energy;
          hop = Math.max(0, Math.sin((t + .25) * Math.PI * 2)) * .07 * p.energy;
        } else if (p.style === 1) {
          // Clapping in front of the chest, on every beat.
          influence[P.clapShut] = beat; influence[P.clapOpen] = 1 - beat;
          influence[P.bounce] = beat * .5; influence[P.nod] = half * .6;
        } else if (p.style === 2) {
          // Filming on a phone, swaying a little.
          influence[P.phone] = 1; influence[P.nod] = half * .3;
          sway *= 1.6;
        } else if (p.style === 3) {
          // Punching the air every other beat.
          influence[P.fist] = .55 + .45 * half; influence[P.bounce] = beat * .8;
          hop = half * .05 * p.energy;
        } else {
          // Nodding along with the arms down.
          influence[P.nod] = beat; influence[P.bounce] = beat * .45;
        }
      } else if (p.role === 'singer') {
        influence[P.phone] = 1; influence[P.bounce] = beat * .6; influence[P.nod] = half * .4;
        sway = Math.sin(time * .9) * .25;
      } else if (p.role === 'guitar') {
        influence[P.guitar] = 1; influence[P.nod] = beat * .7; influence[P.bounce] = half * .5;
      } else if (p.role === 'keys') {
        influence[P.keys] = 1; influence[P.nod] = beat * .5;
      } else {
        influence[P.sit] = 1; influence[P.keys] = 1; influence[P.nod] = beat * .6;
        // Sticks up and down: the forearms lift off the drums between hits.
        influence[P.clapOpen] = (1 - beat) * .25;
      }
      e.set(0, p.yaw + sway, Math.sin(time * 1.1 + p.phase * 2) * .02);
      q.setFromEuler(e);
      m.compose(at.set(p.x, p.y + hop, p.z), q, size.setScalar(p.scale));
      mesh.setMatrixAt(i, m);
      mesh.setMorphAt(i, weights);
      const g = guitarists.findIndex(x => x.i === i);
      if (g >= 0) guitars.setMatrixAt(g, m);
    });
    mesh.instanceMatrix.needsUpdate = true; guitars.instanceMatrix.needsUpdate = true;
    if (mesh.morphTexture) mesh.morphTexture.needsUpdate = true;
  };
  animate(0);
  mesh.computeBoundingSphere();
  if (mesh.boundingSphere) mesh.boundingSphere.radius += 1;

  let last = -1;
  return {
    mesh, guitars, material, guitarPaint, count: options.crowd.length,
    /**
     * Moves everyone to the music; twenty times a second is plenty. From
     * further off than `range` metres nobody is drawn at all: a hundred and
     * twenty people a kilometre away would cost as much as near.
     */
    update(time: number, distance = 0, range = 320) {
      const seen = distance < range;
      mesh.visible = guitars.visible = seen;
      if (seen && time - last > .05) { animate(time); last = time; }
    },
    dispose() { mesh.dispose(); geometry.dispose(); material.dispose(); guitars.dispose(); guitar.dispose(); guitarPaint.dispose(); },
  };
}
export type Audience = ReturnType<typeof createAudience>;
