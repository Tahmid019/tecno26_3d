import * as THREE from 'three';
import { CAMPUS_BOUNDS } from './campus-layout.ts';

type Quality = 'performance' | 'balanced' | 'high';
export type GrassSurface = { y: number; height: number };
export type SurfaceProbe = (x: number, z: number) => GrassSurface | null;
const TILE = 9;
const TRAILS = 12;

/** Only actual planting surfaces qualify; roads, clay and roof gardens stay clear. */
export function grassHeight(materialName: string) {
  if (materialName === 'Campus | varied monsoon ground') return .17;
  if (materialName === 'Library | grass') return .14;
  if (materialName === 'Site | lawn') return .14;
  if (materialName === 'Campus | turf' || materialName.startsWith('Cricket | packed drone turf')) return .05;
  return 0;
}

/**
 * The highest a planting surface may stand and still grow blades. Anything
 * higher is a roof garden, except the administration's lawns, which climb the
 * slopes to its raised podium.
 */
export function grassCeiling(materialName: string) {
  return materialName === 'Site | lawn' ? 4.5 : .7;
}

/**
 * Two rays instead of one per campus mesh: the planting surfaces alone say
 * where grass could grow, and the single walkable-collision tree says whether
 * a road, court, stage or building already covers it. Testing every display
 * mesh made a tile of probes cost more than a frame.
 */
export function createGrassProbe(lawns: THREE.Mesh[], solidHeight: (x: number, z: number) => number | null): SurfaceProbe {
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 100);
  ray.firstHitOnly = true;
  const entries = lawns.map(mesh => ({ mesh, bounds: new THREE.Box3().setFromObject(mesh) }));
  return (x, z) => {
    if (x < CAMPUS_BOUNDS.minX+2 || x > CAMPUS_BOUNDS.maxX-2 || z < CAMPUS_BOUNDS.minZ+2 || z > CAMPUS_BOUNDS.maxZ-2) return null;
    ray.ray.origin.set(x, 70, z);
    let closest: THREE.Intersection | undefined;
    for (const { mesh, bounds } of entries) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      const hit = ray.intersectObject(mesh, false)[0];
      if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
    }
    if (!closest) return null;
    const mesh = closest.object as THREE.Mesh;
    const material = Array.isArray(mesh.material) ? mesh.material[closest.face?.materialIndex || 0] : mesh.material;
    if (closest.point.y > grassCeiling(material.name)) return null;
    const covering = solidHeight(x, z);
    if (covering !== null && covering > closest.point.y + .01) return null;
    const height = grassHeight(material.name);
    return height ? { y: closest.point.y + .003, height } : null;
  };
}

// Damped spring response after a footprint is released; shared with the shader.
export function grassRecovery(seconds: number) {
  const t = Math.max(0, seconds);
  return Math.exp(-2.8 * t) * (Math.cos(4 * t) + .7 * Math.sin(4 * t));
}

function randomSequence(seed: number) {
  let value = seed | 0;
  return () => {
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
  };
}



export function createGrass(probe: SurfaceProbe) {
  const group = new THREE.Group(); group.name = 'Living grass';
  const time = { value: 0 };
  const player = { value: new THREE.Vector4(0, -100, 0, 0) };
  const trails = { value: Array.from({ length: TRAILS }, () => new THREE.Vector4(0, 0, -100, 0)) };
  const fade = { value: new THREE.Vector2(24, 32) };
  const material = new THREE.MeshStandardMaterial({ color: '#63803a', roughness: .92, side: THREE.DoubleSide });
  material.name = 'Grass | flexible blades';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uGrassTime: time, uGrassPlayer: player, uGrassTrails: trails, uGrassFade: fade });
    shader.vertexShader = `
      uniform float uGrassTime;
      uniform vec4 uGrassPlayer;
      uniform vec4 uGrassTrails[${TRAILS}];
      uniform vec2 uGrassFade;
      attribute vec3 aRoot;
      attribute vec3 aBlade;
      varying float vGrassHeight;
      varying float vGrassTint;
      ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      float bladeAngle = aBlade.z;
      mat2 bladeRotation = mat2(cos(bladeAngle), -sin(bladeAngle), sin(bladeAngle), cos(bladeAngle));
      vec2 bladeNormal = bladeRotation * vec2(0.0, 1.0);
      vec3 objectNormal = normalize(vec3(bladeNormal.x, .48, bladeNormal.y));
      `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      vec3 rootWorld = (modelMatrix * vec4(aRoot, 1.0)).xyz;
      float t = position.y;
      vec2 edge = bladeRotation * vec2(position.x * aBlade.y, t * t * aBlade.x * .12);
      float wind = sin(uGrassTime * 1.5 + rootWorld.x * .28 + rootWorld.z * .19) * .13
        + sin(uGrassTime * 2.4 + rootWorld.z * .6) * .045;
      vec2 bend = vec2(wind, wind * .6);
      vec2 away = rootWorld.xz - uGrassPlayer.xz;
      float nearPlayer = (1.0 - smoothstep(.2, 1.15, length(away))) * uGrassPlayer.w;
      bend += away / max(length(away), .12) * nearPlayer * .9;
      for (int i = 0; i < ${TRAILS}; i++) {
        vec4 mark = uGrassTrails[i];
        float age = max(0.0, uGrassTime - mark.z);
        vec2 delta = rootWorld.xz - mark.xy;
        float falloff = 1.0 - smoothstep(.10, .95, length(delta));
        float spring = exp(-2.8 * age) * (cos(4.0 * age) + .7 * sin(4.0 * age));
        bend += delta / max(length(delta), .15) * falloff * spring * mark.w * .26;
      }
      float flatten = min(.66, length(bend) * .42);
      float visibility = 1.0 - smoothstep(uGrassFade.x, uGrassFade.y, distance(cameraPosition.xz, rootWorld.xz));
      vec3 transformed = aRoot + vec3(edge.x + bend.x * aBlade.x * t * t,
        t * aBlade.x * (1.0 - flatten * t), edge.y + bend.y * aBlade.x * t * t) * visibility;
      vGrassHeight = t;
      vGrassTint = .82 + .25 * fract(sin(dot(rootWorld.xz, vec2(17.13, 93.27))) * 4573.2);
      `);
    shader.fragmentShader = 'varying float vGrassHeight;\nvarying float vGrassTint;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(vec3(.50, .58, .38), vec3(.99, .96, .70), vGrassHeight) * vGrassTint;
      `);
  };
  material.customProgramCacheKey = () => 'campus-flexible-grass-v1';

  // Tapered geometry, no alpha cards. Roots remain fixed as the tips bend.
  const blade = new THREE.BufferGeometry();
  const vertices: number[] = [], indices: number[] = [];
  for (let row = 0; row < 3; row++) {
    const t = row / 3;
    vertices.push(-.5 * (1 - t), t, 0, .5 * (1 - t), t, 0);
    if (row) { const k = row * 2; indices.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  vertices.push(0, 1, 0); indices.push(4, 5, 6);
  blade.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  blade.setIndex(indices); blade.computeVertexNormals();

  type Tile = { mesh: THREE.Mesh<THREE.InstancedBufferGeometry>; x: number; z: number; used: number };
  type Draft = { x: number; z: number; rng: () => number; roots: number[]; shapes: number[]; sample: number; share: number };
  const tiles = new Map<string, Tile>();
  let draft: Draft | null = null;
  let quality: Quality = 'balanced', clock = 0, lastTrail = -1, trailIndex = 0;
  let previousX = Infinity, previousZ = Infinity;
  // Short blades only read from close by, so the budget buys density inside a
  // tight radius rather than sparse tufts stretching to the horizon.
  // Phones run this, so the budget buys a thick close carpet rather than thin
  // cover stretching away: five blades per probed root, inside a short radius.
  const limits = () => quality === 'performance' ? { radius: 15, density: 620 } : quality === 'high' ? { radius: 30, density: 1500 } : { radius: 22, density: 1050 };
  // Probing a whole tile at once stalls a frame while walking. Each frame takes
  // a fixed slice of the nearest missing tile instead, so the cost is bounded.
  const SAMPLES_PER_FRAME = 260;
  function advanceDraft() {
    if (!draft) return;
    const density = Math.round(limits().density * draft.share);
    const ox = draft.x * TILE, oz = draft.z * TILE, rng = draft.rng;
    const until = Math.min(density, draft.sample + SAMPLES_PER_FRAME);
    for (; draft.sample < until; draft.sample++) {
      const x = rng() * TILE, z = rng() * TILE;
      const surface = probe(ox + x, oz + z);
      if (!surface) continue;
      const height = surface.height * (.6 + rng() * .8);
      for (let j = 0; j < 5; j++) {
        // A tuft rather than a single blade: five sprays from one probe keeps
        // the ground covered without five times the raycasting.
        draft.roots.push(x + (rng() - .5) * .34, surface.y, z + (rng() - .5) * .34);
        draft.shapes.push(height * (.66 + rng() * .5), surface.height * (.10 + rng() * .07), rng() * Math.PI * 2);
      }
    }
    if (draft.sample < density) return;
    const { x: tx, z: tz, roots, shapes } = draft;
    draft = null;
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = blade.index;
    geometry.attributes.position = blade.attributes.position;
    geometry.attributes.normal = blade.attributes.normal;
    geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(new Float32Array(roots), 3));
    geometry.setAttribute('aBlade', new THREE.InstancedBufferAttribute(new Float32Array(shapes), 3));
    geometry.instanceCount = roots.length / 3;
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -.3, -1), new THREE.Vector3(TILE + 1, .9, TILE + 1));
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(tx * TILE, 0, tz * TILE);
    mesh.name = `Grass tile ${tx},${tz}`; group.add(mesh);
    tiles.set(`${tx},${tz}`, { mesh, x: tx, z: tz, used: clock });
  }
  function clearTiles() { draft = null; for (const tile of tiles.values()) { group.remove(tile.mesh); tile.mesh.geometry.dispose(); } tiles.clear(); }
  return {
    group,
    update(dt: number, position: THREE.Vector3, grounded: boolean, overview: boolean) {
      clock += Math.min(dt, .1); time.value = clock;
      group.visible = !overview;
      player.value.set(position.x, position.y, position.z, grounded ? 1 : 0);
      if (grounded && clock - lastTrail > .10 && Math.hypot(position.x - previousX, position.z - previousZ) > .2) {
        trails.value[trailIndex].set(position.x, position.z, clock, 1);
        trailIndex = (trailIndex + 1) % TRAILS; lastTrail = clock; previousX = position.x; previousZ = position.z;
      }
      if (overview) return;
      const { radius } = limits(); fade.value.set(radius * .62, radius);
      const tx = Math.floor(position.x / TILE), tz = Math.floor(position.z / TILE), count = Math.ceil(radius / TILE);
      const pending: { x: number; z: number; distance: number }[] = [];
      for (const tile of tiles.values()) tile.mesh.visible = false;
      for (let x = tx - count; x <= tx + count; x++) for (let z = tz - count; z <= tz + count; z++) {
        const distance = Math.hypot((x + .5) * TILE - position.x, (z + .5) * TILE - position.z);
        if (distance > radius + TILE * .5) continue;
        const existing = tiles.get(`${x},${z}`);
        if (existing) { existing.mesh.visible = true; existing.used = clock; }
        else pending.push({ x, z, distance });
      }
      // The nearest missing tile is planted first, a slice at a time.
      pending.sort((a, b) => a.distance - b.distance);
      if (draft && Math.hypot((draft.x + .5) * TILE - position.x, (draft.z + .5) * TILE - position.z) > radius + TILE) draft = null;
      // Distant tiles are planted thinner. The carpet underfoot stays thick
      // while the lawn still reaches the horizon for a fraction of the cost.
      if (!draft && pending[0]) draft = { x: pending[0].x, z: pending[0].z, roots: [], shapes: [], sample: 0,
        share: pending[0].distance > radius * .5 ? .42 : 1,
        rng: randomSequence(Math.imul(pending[0].x + 7919, 73856093) ^ Math.imul(pending[0].z + 104729, 19349663)) };
      advanceDraft();
      if (tiles.size > 100) {
        for (const [key, tile] of [...tiles.entries()].sort((a, b) => a[1].used - b[1].used)) {
          if (tiles.size <= 90) break;
          if (!tile.mesh.visible) { group.remove(tile.mesh); tile.mesh.geometry.dispose(); tiles.delete(key); }
        }
      }
    },
    setQuality(value: Quality) { if (value !== quality) { quality = value; clearTiles(); } },
    stats() { let blades = 0; for (const tile of tiles.values()) if (tile.mesh.visible) blades += tile.mesh.geometry.instanceCount; return { blades, tiles: tiles.size }; },
    dispose() { clearTiles(); blade.dispose(); material.dispose(); },
  };
}
