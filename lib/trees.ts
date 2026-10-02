import * as THREE from 'three';

/**
 * One planted tree, as `export_web.py` and the library, gallery and
 * administration builds list them. The administration names its Norfolk pines.
 */
export type Tree = { position: number[]; height: number; width: number; rotation?: number; kind?: string };

/**
 * The campus's trees, drawn two ways from the same planting list.
 *
 * Everyday quality draws a trunk and four lumps per tree: cheap, and it reads
 * from a distance. High draws each tree with a trunk and limbs carrying clumps
 * of leaf clusters, cards painted with overlapping leaves. That costs about as
 * many triangles as the lumps did (half a thousand a tree); the realism is in
 * the texture and the lighting:
 * - the card normals are bent out from the middle of the crown, so a crown is
 *   lit as one rounded mass that its leaves break up, not as glittering cards;
 * - leaves low and deep in the crown are shaded darker, as the canopy shades them;
 * - with the sun behind them the leaves glow, as thin leaves do;
 * - crowns sway in the wind and each clump flutters a little on its own.
 * Nothing is downloaded: the leaf texture is painted when High is first chosen.
 */
export function createTreeStand(trees: Tree[], name: string, multisampled: boolean) {
  const group = new THREE.Group();
  group.name = name;
  const plain = plainTrees(trees);
  group.add(plain);
  let leafy: ReturnType<typeof leafyTrees> | null = null;
  return {
    group,
    /** Swaps between the everyday lumps and the leafy trees. */
    setLeafy(on: boolean) {
      if (on && !leafy) { leafy = leafyTrees(trees, multisampled); group.add(leafy.group); }
      plain.visible = !on;
      if (leafy) leafy.group.visible = on;
    },
    update(time: number) { if (leafy?.group.visible) leafy.time.value = time; },
    dispose() {
      plain.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
      if (leafy) { group.remove(leafy.group); leafy.release(); }
    },
  };
}
export type TreeStand = ReturnType<typeof createTreeStand>;

function plainTrees(trees: Tree[]) {
  const group=new THREE.Group();const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.12,.22,1,6),new THREE.MeshStandardMaterial({color:0x665543,roughness:1}),trees.length);
  const broad=trees.filter(t=>t.kind!=='pine'),pines=trees.filter(t=>t.kind==='pine');
  const crowns=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),broad.length*4);const dummy=new THREE.Object3D();
  trees.forEach((t,i)=>{const [x,y,z]=t.position;dummy.position.set(x,y+t.height*.3,z);dummy.scale.set(t.width*.18,t.height*.6,t.width*.18);dummy.rotation.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);});
  broad.forEach((t,i)=>{const [x,y,z]=t.position;
    for(let j=0;j<4;j++){const a=j*2.4;dummy.position.set(x+Math.sin(a)*t.width*.17,y+t.height*(.6+(j%2)*.16),z+Math.cos(a)*t.width*.17);dummy.scale.set(t.width*.3,t.height*.29,t.width*.3);dummy.rotation.set(i*.15,j,0);dummy.updateMatrix();crowns.setMatrixAt(i*4+j,dummy.matrix);crowns.setColorAt(i*4+j,new THREE.Color().setHSL(.25+(i%5)*.012,.29,.18+(i%7)*.012));}
  });
  group.add(trunks);if(broad.length)group.add(crowns);
  if(pines.length){
    // A Norfolk pine is a spire of level tiers, not a rounded crown.
    const tiers=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7),new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),pines.length*4);
    pines.forEach((t,i)=>{const [x,y,z]=t.position;
      for(let j=0;j<4;j++){const r=t.width*.5*(1-.22*j);dummy.position.set(x,y+t.height*(.35+.18*j),z);dummy.scale.set(r,t.height*(.3-.02*j),r);dummy.rotation.set(0,i+j*1.3,0);dummy.updateMatrix();tiers.setMatrixAt(i*4+j,dummy.matrix);tiers.setColorAt(i*4+j,new THREE.Color().setHSL(.33,.3,.12+(i%5)*.01));}
    });group.add(tiers);
  }
  return group;
}

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

// ---- the leafy trees ----------------------------------------------------

/** Shared by every stand: one texture, one pair of materials, six shapes. */
type Kit = {
  shapes: Shape[]; leaves: THREE.MeshStandardMaterial; wood: THREE.MeshStandardMaterial;
  atlas: THREE.Texture; time: { value: number }; users: number;
};
type Shape = { leaves: THREE.BufferGeometry; wood: THREE.BufferGeometry; width: number; height: number; shrub: boolean };
let kit: Kit | null = null;
/** Indices into the kit's shapes: four broadleaves, then these two. */
const SHRUB = 4, CONIFER = 5;
const PINE = new THREE.Color(.72, .84, .82);

function leafyTrees(trees: Tree[], multisampled: boolean) {
  kit ??= makeKit(multisampled);
  kit.users++;
  const own = kit;
  const group = new THREE.Group();
  group.name = 'Leafy trees';
  // Which shape each tree takes: pines get the conifer, undergrowth the shrub,
  // and the rest share the four broadleaves by a hash of where they stand, so
  // neighbours differ.
  const chosen = trees.map(t => {
    if (t.kind === 'pine') return CONIFER;
    if (t.height < 3.6) return SHRUB;
    const h = Math.abs(Math.sin(t.position[0] * 12.9898 + t.position[2] * 78.233) * 43758.5453);
    return Math.min(SHRUB - 1, Math.floor((h - Math.floor(h)) * SHRUB));
  });
  const random = seeded(trees.length * 7919 + 17);
  const placement = new THREE.Object3D(), tint = new THREE.Color();
  own.shapes.forEach((shape, s) => {
    const members = trees.map((t, i) => ({ t, i })).filter(({ i }) => chosen[i] === s);
    if (!members.length) return;
    const leaves = new THREE.InstancedMesh(shape.leaves, own.leaves, members.length);
    const wood = new THREE.InstancedMesh(shape.wood, own.wood, members.length);
    members.forEach(({ t, i }, k) => {
      const across = t.width / shape.width;
      placement.position.set(t.position[0], t.position[1], t.position[2]);
      placement.rotation.set(0, t.rotation ?? i * 2.4, 0);
      placement.scale.set(across, t.height / shape.height, across);
      placement.updateMatrix();
      leaves.setMatrixAt(k, placement.matrix);
      wood.setMatrixAt(k, placement.matrix);
      // No two crowns quite the same green; the pines' is darker and bluer.
      const value = .84 + random() * .24;
      tint.setRGB(value * (.93 + random() * .12), value, value * (.82 + random() * .16));
      if (s === CONIFER) tint.multiply(PINE);
      leaves.setColorAt(k, tint);
    });
    leaves.name = `Leafy tree ${s} | leaves`;
    wood.name = `Leafy tree ${s} | trunk and limbs`;
    group.add(wood, leaves);
  });
  return {
    group, time: own.time,
    release() {
      group.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      if (--own.users === 0 && kit === own) {
        for (const shape of own.shapes) { shape.leaves.dispose(); shape.wood.dispose(); }
        own.leaves.dispose(); own.wood.dispose(); own.atlas.dispose();
        kit = null;
      }
    },
  };
}

function makeKit(multisampled: boolean): Kit {
  const atlas = leafAtlas();
  const time = { value: 0 };
  const leaves = new THREE.MeshStandardMaterial({
    name: 'Leafy trees | leaves', map: atlas, alphaTest: .5, side: THREE.DoubleSide,
    vertexColors: true, roughness: .8, metalness: 0,
  });
  // Alpha to coverage feathers the leaf edges where the canvas is
  // multisampled; without multisampling the plain cut-out is the cheap choice.
  leaves.alphaToCoverage = multisampled;
  leaves.onBeforeCompile = shader => {
    shader.uniforms.uTreeTime = time;
    shader.vertexShader = 'uniform float uTreeTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 treeRoot = instanceMatrix[3].xyz;
      #else
        vec3 treeRoot = vec3(0.0);
      #endif
      // The crown leans with the wind as a whole; each clump flutters on its own.
      float treeSway = smoothstep(2.0, 10.0, position.y);
      float treePhase = dot(treeRoot.xz, vec2(.13, .21));
      transformed.x += sin(uTreeTime * 1.1 + treePhase) * .10 * treeSway
        + sin(uTreeTime * 3.3 + position.y * 2.1 + position.x * 1.7) * .03 * treeSway;
      transformed.z += cos(uTreeTime * .87 + treePhase * 1.3) * .08 * treeSway
        + cos(uTreeTime * 2.9 + position.z * 1.9 + position.y) * .03 * treeSway;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
        // The crown-rounded normal serves both faces of a card. Flipping it for
        // the back face, as double-sided surfaces normally are, lit half the
        // leaves as if they faced into the trunk.
        vec3 normal = normalize( vNormal );
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // A leaf's waxy sheen is faint and scattered. At full strength the
        // grazing glare facing the sun bleached whole crowns to straw.
        reflectedLight.directSpecular *= .3;
        reflectedLight.indirectSpecular *= .5;
        // Leaves on the far side of the crown are seen from behind, through
        // the crown: shaded by it, and lit only by what shines through.
        reflectedLight.directDiffuse *= mix(.4, 1.0, smoothstep(-.35, .35, dot(normal, normalize(vViewPosition))));
        #if NUM_DIR_LIGHTS > 0
          // Thin leaves glow yellow-green with the sun behind them. Any
          // stronger and the crowns round the sun bleached to straw.
          float treeThrough = pow(max(0.0, dot(normalize(vViewPosition), -directionalLights[0].direction)), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(.85, 1.0, .5) * directionalLights[0].color * treeThrough * .16;
        #endif`);
  };
  leaves.customProgramCacheKey = () => 'campus-leafy-trees-v1';
  const wood = new THREE.MeshStandardMaterial({ name: 'Leafy trees | bark', vertexColors: true, roughness: .95, metalness: 0 });
  const shapes = [
    growTree(101, { lobes: 6, spread: 2.9, low: 6.0, high: 7.6, lobe: 2.25, top: 2.5, trunk: 4.7 }),   // broad, flat-topped
    growTree(202, { lobes: 5, spread: 2.2, low: 6.2, high: 8.2, lobe: 2.35, top: 2.6, trunk: 4.4 }),   // round and dense
    growTree(303, { lobes: 5, spread: 1.8, low: 6.6, high: 8.9, lobe: 2.0, top: 2.3, trunk: 5.4 }),    // tall and oval
    growTree(404, { lobes: 7, spread: 3.1, low: 5.6, high: 7.9, lobe: 2.0, top: 2.1, trunk: 4.2 }),    // open and spreading
    growShrub(505),
    growConifer(606),
  ];
  return { shapes, leaves, wood, atlas, time, users: 0 };
}

type Build = { positions: number[]; normals: number[]; colors: number[]; uvs: number[]; indices: number[] };
const newBuild = (): Build => ({ positions: [], normals: [], colors: [], uvs: [], indices: [] });
function geometry(build: Build) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(build.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(build.normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(build.colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(build.uvs, 2));
  g.setIndex(build.indices);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0), ACROSS = new THREE.Vector3(1, 0, 0);
const BARK = new THREE.Color('#7d6752');

/** A tapered tube along a path: trunks and limbs. */
function tube(out: Build, path: THREE.Vector3[], radii: number[], sides: number) {
  const base = out.positions.length / 3;
  const along = new THREE.Vector3(), side = new THREE.Vector3(), round = new THREE.Vector3(), dir = new THREE.Vector3();
  path.forEach((point, i) => {
    along.subVectors(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]).normalize();
    side.crossVectors(along, Math.abs(along.y) > .95 ? ACROSS : UP).normalize();
    round.crossVectors(side, along).normalize();
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * Math.PI * 2;
      dir.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(round, Math.sin(a));
      out.positions.push(point.x + dir.x * radii[i], point.y + dir.y * radii[i], point.z + dir.z * radii[i]);
      out.normals.push(dir.x, dir.y, dir.z);
      // Darker at the foot, where the grass and the canopy shade it.
      const shade = (.5 + .5 * Math.min(1, point.y / 3.5)) * (.88 + .12 * Math.cos(a * 3 + i * 1.7));
      out.colors.push(BARK.r * shade, BARK.g * shade, BARK.b * shade);
      out.uvs.push(k / sides, i / (path.length - 1));
    }
  });
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = base + i * (sides + 1) + k, b = a + sides + 1;
    out.indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

/** Cards are bent this far towards pointing out of the crown. */
const BEND = .62;

/** One leaf-cluster card, lit as part of the crown around it. */
function card(out: Build, centre: THREE.Vector3, facing: THREE.Vector3, roll: number, size: number, cell: number, flip: boolean,
  crown: { centre: THREE.Vector3; bottom: number; top: number; radius: number }, tone: number) {
  const base = out.positions.length / 3;
  const n = facing.clone().normalize();
  const t = new THREE.Vector3().crossVectors(n, Math.abs(n.y) > .9 ? ACROSS : UP).normalize().applyAxisAngle(n, roll);
  const b = new THREE.Vector3().crossVectors(n, t);
  const u0 = (cell % 2) * .5 + .006, v0 = Math.floor(cell / 2) * .5 + .006, u1 = u0 + .488, v1 = v0 + .488;
  const corners: [number, number, number, number][] = [[-1, -1, flip ? u1 : u0, v0], [1, -1, flip ? u0 : u1, v0], [1, 1, flip ? u0 : u1, v1], [-1, 1, flip ? u1 : u0, v1]];
  const p = new THREE.Vector3(), outward = new THREE.Vector3(), normal = new THREE.Vector3();
  for (const [sx, sy, u, v] of corners) {
    p.copy(centre).addScaledVector(t, sx * size / 2).addScaledVector(b, sy * size / 2);
    out.positions.push(p.x, p.y, p.z);
    outward.subVectors(p, crown.centre).normalize();
    normal.copy(n).multiplyScalar(1 - BEND).addScaledVector(outward, BEND).normalize();
    out.normals.push(normal.x, normal.y, normal.z);
    // The canopy shades its own underside and its heart.
    const height = THREE.MathUtils.clamp((p.y - crown.bottom) / (crown.top - crown.bottom), 0, 1);
    const reach = THREE.MathUtils.clamp(Math.hypot(p.x - crown.centre.x, p.z - crown.centre.z) / crown.radius, 0, 1);
    const shade = (.5 + .5 * Math.pow(height, .7)) * (.78 + .22 * reach) * tone;
    // Sunlit tops yellow slightly; shaded undersides stay blue-green.
    out.colors.push(shade * (.92 + .1 * height), shade, shade * (.96 - .1 * height));
    out.uvs.push(u, v);
  }
  out.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

type Habit = { lobes: number; spread: number; low: number; high: number; lobe: number; top: number; trunk: number };

/**
 * One broadleaf, about the size of the Blender scene's own (7-8 m across and
 * 10 m tall; each planted tree scales it to its listed size). A trunk forks
 * into limbs, each limb ends in a clump of leaf clusters, and one clump crowns
 * the top, so the silhouette is lumpy the way a real canopy is.
 */
function growTree(seed: number, habit: Habit): Shape {
  const random = seeded(seed);
  const wood = newBuild(), leaves = newBuild();
  const lean = new THREE.Vector3((random() - .5) * .5, 0, (random() - .5) * .5);
  const trunk = [0, .3, .6, 1].map(f => new THREE.Vector3(lean.x * f * f, habit.trunk * f, lean.z * f * f));
  tube(wood, trunk, [.34, .27, .22, .17], 8);
  const fork = trunk[trunk.length - 1];
  const lobes: { centre: THREE.Vector3; radius: number }[] = [];
  for (let j = 0; j < habit.lobes; j++) {
    const a = (j + random() * .6) / habit.lobes * Math.PI * 2;
    const reach = habit.spread * (.75 + random() * .45);
    lobes.push({
      centre: new THREE.Vector3(Math.cos(a) * reach, habit.low + random() * (habit.high - habit.low), Math.sin(a) * reach),
      radius: habit.lobe * (.85 + random() * .3),
    });
  }
  lobes.push({ centre: new THREE.Vector3(lean.x * .6, habit.high + .5, lean.z * .6), radius: habit.top });
  for (const { centre } of lobes) {
    // A limb from the fork into the clump, sagging a little under its weight.
    const end = fork.clone().lerp(centre, .82);
    const middle = fork.clone().lerp(end, .5).add(new THREE.Vector3(0, .35 + random() * .3, 0));
    tube(wood, [fork.clone().add(new THREE.Vector3(0, -.35, 0)), middle, end], [.15, .1, .05], 5);
  }
  const bottom = Math.min(...lobes.map(l => l.centre.y - l.radius)), top = Math.max(...lobes.map(l => l.centre.y + l.radius));
  const crown = { centre: new THREE.Vector3(0, (bottom + top) / 2, 0), bottom, top, radius: habit.spread + habit.lobe };
  const dir = new THREE.Vector3(), facing = new THREE.Vector3();
  for (const { centre, radius } of lobes) {
    const count = Math.round(radius * radius * 5.8);
    for (let i = 0; i < count; i++) {
      // Mostly on the clump's skin, a quarter inside so it never looks hollow.
      dir.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
      dir.normalize();
      if (dir.y < 0) dir.y *= .7;
      const depth = random() < .24 ? .25 + random() * .35 : .62 + Math.sqrt(random()) * .38;
      const at = centre.clone().addScaledVector(dir, radius * depth);
      facing.copy(dir).add(new THREE.Vector3(random() - .5, random() - .5, random() - .5).multiplyScalar(.9));
      card(leaves, at, facing, random() * Math.PI * 2, 1.55 + random() * .75, Math.floor(random() * 4), random() < .5, crown,
        depth < .6 ? .8 : .93 + random() * .13);
    }
  }
  return finish(leaves, wood, false);
}

/** Undergrowth: a low mound of leaf clusters on a few short stems. */
function growShrub(seed: number): Shape {
  const random = seeded(seed);
  const wood = newBuild(), leaves = newBuild();
  const lobes: { centre: THREE.Vector3; radius: number }[] = [];
  for (let j = 0; j < 4; j++) {
    const a = (j + random() * .5) / 4 * Math.PI * 2;
    lobes.push({ centre: new THREE.Vector3(Math.cos(a) * .7, .85 + random() * .4, Math.sin(a) * .7), radius: .85 + random() * .25 });
  }
  lobes.push({ centre: new THREE.Vector3(0, 1.45, 0), radius: .9 });
  for (const { centre } of lobes) tube(wood, [new THREE.Vector3(0, 0, 0), centre.clone().multiplyScalar(.6)], [.06, .03], 4);
  const crown = { centre: new THREE.Vector3(0, 1.1, 0), bottom: 0, top: 2.35, radius: 1.7 };
  const dir = new THREE.Vector3();
  for (const { centre, radius } of lobes) {
    for (let i = 0; i < 12; i++) {
      dir.set(random() * 2 - 1, random() * 1.6 - .5, random() * 2 - 1).normalize();
      const at = centre.clone().addScaledVector(dir, radius * (.55 + random() * .45));
      card(leaves, at, dir.clone().add(new THREE.Vector3(random() - .5, random() - .5, random() - .5)), random() * Math.PI * 2,
        .85 + random() * .4, Math.floor(random() * 4), random() < .5, crown, .9 + random() * .12);
    }
  }
  return finish(leaves, wood, true);
}

/**
 * A Norfolk pine, about 10 m tall: a straight trunk carrying level tiers of
 * limbs, each a bottle-brush of foliage, the tiers shortening to a spire.
 */
function growConifer(seed: number): Shape {
  const random = seeded(seed);
  const wood = newBuild(), leaves = newBuild();
  const height = 10, tiers = 10;
  tube(wood, [0, .3, .65, 1].map(f => new THREE.Vector3(0, height * f, 0)), [.2, .16, .1, .03], 7);
  const crown = { centre: new THREE.Vector3(0, 6.2, 0), bottom: 2.2, top: height, radius: 2.6 };
  const along = new THREE.Vector3(), across = new THREE.Vector3(), at = new THREE.Vector3(), facing = new THREE.Vector3();
  for (let tier = 0; tier < tiers; tier++) {
    const f = tier / (tiers - 1);
    const y = 2.3 + f * (height - 3.1);
    const reach = .5 + 2.3 * Math.pow(1 - f, 1.1);
    const limbs = 5 + tier % 2, turn = random() * Math.PI * 2;
    for (let j = 0; j < limbs; j++) {
      const a = turn + (j + (random() - .5) * .3) / limbs * Math.PI * 2;
      along.set(Math.cos(a), 0, Math.sin(a));
      across.set(-along.z, 0, along.x);
      // Level limbs whose tips turn up a little.
      const tip = new THREE.Vector3(along.x * reach, y + .1 + reach * .12, along.z * reach);
      tube(wood, [new THREE.Vector3(0, y - .08, 0), tip], [.045, .012], 3);
      const tufts = Math.max(1, Math.round(reach * 2.2));
      for (let k = 0; k < tufts; k++) {
        const t = (k + .7) / (tufts + .2);
        at.set(tip.x * t, y + (tip.y - y) * t, tip.z * t);
        // One spray lies nearly flat on the limb and one stands across it, so
        // from any side the limb reads as a bottle-brush, not a flat card.
        facing.copy(along).multiplyScalar(.45).add(new THREE.Vector3((random() - .5) * .3, 1, (random() - .5) * .3));
        card(leaves, at, facing, random() * Math.PI * 2, .9 + random() * .4 * (1 - f * .5), Math.floor(random() * 4), random() < .5, crown,
          .74 + random() * .1);
        facing.copy(across).multiplyScalar(random() < .5 ? 1 : -1).add(new THREE.Vector3(0, .35, 0));
        card(leaves, at, facing, random() * Math.PI * 2, .75 + random() * .35, Math.floor(random() * 4), random() < .5, crown,
          .7 + random() * .1);
      }
    }
  }
  // The leader: a narrow tuft at the very top.
  for (let k = 0; k < 4; k++) {
    card(leaves, new THREE.Vector3(0, height - .9 + k * .25, 0), new THREE.Vector3(random() - .5, .3, random() - .5),
      random() * Math.PI * 2, .7, Math.floor(random() * 4), random() < .5, crown, .78);
  }
  return finish(leaves, wood, false);
}

function finish(leaves: Build, wood: Build, shrub: boolean): Shape {
  const leafGeometry = geometry(leaves), woodGeometry = geometry(wood);
  const box = leafGeometry.boundingBox!.clone().union(woodGeometry.boundingBox!);
  const size = box.getSize(new THREE.Vector3());
  // A listed width is a full crown's. The outermost clusters here are sparse,
  // so the dense part, a sixth in from them, is what is matched to it.
  return { leaves: leafGeometry, wood: woodGeometry, width: (size.x + size.z) / 2 * .84, height: box.max.y, shrub };
}

// ---- the leaf texture -----------------------------------------------------

/**
 * Four clusters of overlapping leaves, painted once on a canvas: darker, older
 * leaves at the back and the heart of a cluster, lighter young ones round its
 * edge, each with a midrib and a soft shadow on the leaves beneath it.
 *
 * The mipmaps are made by hand. Averaged the ordinary way, a cut-out's alpha
 * thins with every level, and a tree across the field faded to a sparse ghost
 * of itself; each level here is re-thresholded to keep the full-size share of
 * leaf. The see-through texels keep a leaf colour, so filtering cannot draw a
 * black line round every leaf.
 */
function leafAtlas() {
  const SIZE = 512, CELL = SIZE / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const c = canvas.getContext('2d')!;
  const random = seeded(7331);
  const leafPath = (length: number, width: number) => {
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(width * .6, -length * .18, width * .62, -length * .72, 0, -length);
    c.bezierCurveTo(-width * .62, -length * .72, -width * .6, -length * .18, 0, 0);
  };
  for (let k = 0; k < 4; k++) {
    c.save();
    c.beginPath(); c.rect((k % 2) * CELL, Math.floor(k / 2) * CELL, CELL, CELL); c.clip();
    c.translate((k % 2) * CELL + CELL / 2, Math.floor(k / 2) * CELL + CELL / 2);
    c.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const a = random() * Math.PI * 2;
      c.strokeStyle = 'rgba(70, 54, 36, .85)'; c.lineWidth = 2.6 - i * .2;
      c.beginPath(); c.moveTo(0, 0);
      c.quadraticCurveTo(Math.cos(a + .35) * 42, Math.sin(a + .35) * 42, Math.cos(a) * 96, Math.sin(a) * 96);
      c.stroke();
    }
    const count = k === 3 ? 96 : 78, small = k === 3 ? .75 : 1;
    const placed = Array.from({ length: count }, () => { const r = Math.sqrt(random()) * 106, a = random() * Math.PI * 2; return { r, a }; })
      .sort((p, q) => p.r - q.r);
    for (const { r, a } of placed) {
      const length = (30 + random() * 22) * small, width = length * (.38 + random() * .12);
      const front = r / 106;
      const hue = 84 + random() * 24, saturation = 40 + random() * 22;
      const light = (19 + random() * 12) * (.74 + .46 * front);
      c.save();
      c.translate(Math.cos(a) * r, Math.sin(a) * r);
      c.rotate(a + Math.PI / 2 + (random() - .5) * 1.3);
      c.save(); c.translate(2.2, 3.2); c.fillStyle = 'rgba(6, 16, 5, .34)'; leafPath(length, width); c.fill(); c.restore();
      const shade = c.createLinearGradient(-width / 2, 0, width / 2, -length);
      shade.addColorStop(0, `hsl(${hue} ${saturation}% ${light * .74}%)`);
      shade.addColorStop(.55, `hsl(${hue} ${saturation}% ${light}%)`);
      shade.addColorStop(1, `hsl(${hue + 5} ${saturation - 5}% ${light * 1.22}%)`);
      c.fillStyle = shade; leafPath(length, width); c.fill();
      c.strokeStyle = `hsla(${hue + 8} ${saturation - 14}% ${Math.min(70, light * 1.6)}% / .5)`; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -1.5); c.lineTo(0, -length * .84); c.stroke();
      c.restore();
    }
    c.restore();
  }
  const levels = coverageMips(c.getImageData(0, 0, SIZE, SIZE));
  const texture = new THREE.Texture(levels[0] as unknown as HTMLImageElement);
  texture.mipmaps = levels;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function coverageMips(full: ImageData) {
  const covered = (data: Uint8ClampedArray, cut: number) => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > cut) n++; return n / (data.length / 4); };
  const target = covered(full.data, 127);
  // A leaf colour behind every clear texel, taken from the leaves themselves.
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < full.data.length; i += 4) if (full.data[i + 3] > 200) { r += full.data[i]; g += full.data[i + 1]; b += full.data[i + 2]; n++; }
  const fill = [r / n, g / n, b / n];
  const tidy = (image: ImageData) => { for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3] < 8) { image.data[i] = fill[0]; image.data[i + 1] = fill[1]; image.data[i + 2] = fill[2]; } return image; };
  const levels: ImageData[] = [tidy(full)];
  let source = full;
  while (source.width > 1) {
    const size = source.width / 2;
    const next = new ImageData(size, size), raw = new Uint8ClampedArray(size * size * 4);
    // Box-filter the untouched previous level, weighting colour by coverage.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let alpha = 0; const colour = [0, 0, 0];
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y * 2 + dy) * source.width + x * 2 + dx) * 4;
        const w = source.data[i + 3] + 1;
        alpha += source.data[i + 3];
        colour[0] += source.data[i] * w; colour[1] += source.data[i + 1] * w; colour[2] += source.data[i + 2] * w;
      }
      const weight = alpha + 4, o = (y * size + x) * 4;
      raw[o] = colour[0] / weight; raw[o + 1] = colour[1] / weight; raw[o + 2] = colour[2] / weight; raw[o + 3] = alpha / 4;
    }
    // Find the alpha cut that keeps the full-size share of leaf, then move it to 0.5.
    let low = 0, high = 255;
    for (let step = 0; step < 9; step++) { const mid = (low + high) / 2; if (covered(raw, mid) > target) low = mid; else high = mid; }
    const cut = (low + high) / 2;
    for (let i = 0; i < raw.length; i += 4) {
      next.data[i] = raw[i]; next.data[i + 1] = raw[i + 1]; next.data[i + 2] = raw[i + 2];
      next.data[i + 3] = THREE.MathUtils.clamp(127.5 + (raw[i + 3] - cut) * 3, 0, 255);
    }
    levels.push(tidy(next));
    source = new ImageData(raw, size, size);
  }
  return levels;
}
