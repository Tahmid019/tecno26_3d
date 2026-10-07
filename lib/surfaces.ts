import * as THREE from 'three';

/**
 * Texture and weathering for the campus's flat-coloured surfaces, and light
 * from the street lamps and the windows at night.
 *
 * The buildings were modelled with plain colours and no textures, which is
 * what made them look like toys. Rather than ship hundreds of megabytes of
 * photographs, every surface is given a pattern drawn from where it is in the
 * world: rain and algae streaks down plaster, mottled concrete, the joints
 * and slightly uneven sheets of ACP cladding, interlocking pavers and tiles,
 * granite speckle, corrugated roofs, clumps of leaves on the hedges and drier
 * patches in the lawns. All of it comes from one small noise texture, so the
 * cost is a few texture reads a pixel and no downloads.
 *
 * At night the nearest street lamps light everything around them (the people
 * and bicycles too) and about half the windows glow, warm or tube-light white.
 */
export type SurfaceKind = 'plaster' | 'concrete' | 'panels' | 'pavers' | 'tiles' | 'stone' | 'asphalt' | 'roof' | 'clay' | 'glass' | 'interior' | 'foliage' | 'ground' | 'metal' | 'generic' | 'lamps';
const KIND_ID: Record<SurfaceKind, number> = { lamps: 0, plaster: 1, concrete: 2, panels: 3, pavers: 4, tiles: 5, stone: 6, asphalt: 7, roof: 8, clay: 9, glass: 10, interior: 11, foliage: 12, ground: 13, metal: 14, generic: 15 };

// First match wins. "lamps" means no pattern, only the light of the lamps.
const RULES: [RegExp, SurfaceKind][] = [
  [/Vehicles|Two-wheelers|Signage|Emblem|artwork|^Sky|Concert|chalk|markings|lane paint|water|Fixtures|Props|bins|streetlight|rubber|saddles|reflectors|lamps and plates|flagpole|Grass \| flexible|photovoltaic|solar|netting|lily|statue|gold|Leafy trees|Campus student|Bicycles|Street lights/i, 'lamps'],
  [/Interior \| rooms/i, 'interior'],
  [/Plain trees \| (crowns|pine tiers)/i, 'foliage'],
  [/glass|glazing/i, 'glass'],
  [/hedge|^Plants \||shrub|bush/i, 'foliage'],
  [/terracotta (red )?tiles|ridge caps/i, 'clay'],
  [/roof sheets|roof caps|metal roof|corrugated|galvanized|repair sheeting|membrane/i, 'roof'],
  [/ACP|cladding/i, 'panels'],
  [/asphalt/i, 'asphalt'],
  [/paver|paving|interlock|path|sidewalk/i, 'pavers'],
  [/tiles|terrazzo/i, 'tiles'],
  [/granite|stone|marble|sandstone/i, 'stone'],
  [/lawn|turf|grass|soil|earth|sand|monsoon ground|clay|ochre square/i, 'ground'],
  [/parapet|facade frames|painted stucco/i, 'plaster'],
  [/frame|mullion|railing|steel|alumin|silver|grille|metal|truss|rigging|equipment|mounting/i, 'metal'],
  [/concrete|kerb|slab|plinth|column|deck|soffit|step/i, 'concrete'],
  [/plaster|paint|stucco|wall|cream|ivory|Campus \| (red|green|coral|turquoise|blue)|terracotta|recesses|canopy|awning|band|doors|timber|trim/i, 'plaster'],
];
export function surfaceKind(name: string): SurfaceKind {
  for (const [pattern, kind] of RULES) if (pattern.test(name)) return kind;
  return 'generic';
}

/** Tileable noise: R broad blotches, G mid detail, B fine grain, A cells. */
function noiseTexture(size = 256) {
  const lattice = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let s = seed >>> 0;
    for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return g;
  };
  const wrap = (i: number, n: number) => ((i % n) + n) % n;
  const value = (g: Float32Array, period: number, x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => g[wrap(j, period) * period + wrap(i, period)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const fbm = (base: number, octaves: number, seed: number) => {
    const layers = Array.from({ length: octaves }, (_, o) => ({ period: base << o, g: lattice(base << o, seed + o * 101) }));
    return (u: number, v: number) => {
      let sum = 0, amp = .5, norm = 0;
      for (const l of layers) { sum += amp * value(l.g, l.period, u * l.period, v * l.period); norm += amp; amp *= .5; }
      return sum / norm;
    };
  };
  const cells = (count: number, seed: number) => {
    const px = lattice(count, seed), pz = lattice(count, seed + 7);
    return (u: number, v: number) => {
      const x = u * count, y = v * count, xi = Math.floor(x), yi = Math.floor(y);
      let best = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const k = wrap(yi + j, count) * count + wrap(xi + i, count);
        best = Math.min(best, Math.hypot(xi + i + px[k] - x, yi + j + pz[k] - y));
      }
      return best;
    };
  };
  const channels = [fbm(4, 5, 11), fbm(8, 4, 37), fbm(32, 2, 71), cells(16, 5)];
  const raw = channels.map(() => new Float32Array(size * size));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    for (let c = 0; c < 4; c++) raw[c][y * size + x] = channels[c](x / size, y / size);
  }
  // Stretch each channel to the full range: fractal noise bunches round the middle.
  const data = new Uint8Array(size * size * 4);
  raw.forEach((values, c) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < values.length; i++) data[i * 4 + c] = Math.round((values[i] - lo) / Math.max(hi - lo, 1e-6) * 255);
  });
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  return texture;
}

export const LAMP_SLOTS = 12;

const vertexPars = /* glsl */`
varying vec3 vSurfWorld;
varying vec3 vSurfNormal;
`;
const vertexMain = /* glsl */`
{
  vec4 surfPoint = vec4(transformed, 1.0);
  vec3 surfNormal = objectNormal;
  #ifdef USE_INSTANCING
    surfPoint = instanceMatrix * surfPoint;
    surfNormal = mat3(instanceMatrix) * surfNormal;
  #endif
  vSurfWorld = (modelMatrix * surfPoint).xyz;
  vSurfNormal = mat3(modelMatrix) * surfNormal;
}
#include <project_vertex>`;

const fragmentPars = /* glsl */`
uniform sampler2D uSurfNoise;
uniform vec4 uLamps[${LAMP_SLOTS}];
uniform vec3 uLampColor;
uniform float uLampLevel;
uniform float uWindows;
varying vec3 vSurfWorld;
varying vec3 vSurfNormal;
float surfHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec4 surfNoise(vec2 p) { return texture2D(uSurfNoise, p); }
// 1 in the joints of a grid of cells \`size\` metres across, faded out where
// they would be thinner than a pixel and only shimmer.
float surfJoints(vec2 uv, vec2 size, float width, float aa) {
  vec2 f = fract(uv / size) * size;
  vec2 d = min(f, size - f);
  float line = 1.0 - smoothstep(width, width + aa * 1.5, min(d.x, d.y));
  return line * (1.0 - smoothstep(width * .8, width * 3.0, aa));
}
// Bump from screen derivatives of a height in metres (Mikkelsen 2010). The
// pixel's own footprint is left unnormalised so the slope is height over
// distance on the surface, the same near and far.
vec3 surfPerturb(vec3 sigmaX, vec3 sigmaY, vec3 normal, vec2 dHdxy, float facing) {
  vec3 r1 = cross(sigmaY, normal), r2 = cross(normal, sigmaX);
  float det = dot(sigmaX, r1) * facing;
  vec3 n = abs(det) * normal - sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return dot(n, n) > 1e-24 ? normalize(n) : normal;
}
`;

// Runs once the normal is known, before lighting: tints, roughness, bumps.
const patternMain = /* glsl */`
#include <normal_fragment_maps>
vec3 sN = normalize(vSurfNormal) * faceDirection;
vec3 sA = abs(sN);
float sFloor = step(.7, sA.y);
vec2 sWall = sA.x > sA.z ? vec2(vSurfWorld.z, vSurfWorld.y) : vec2(vSurfWorld.x, vSurfWorld.y);
vec2 sUV = mix(sWall, vSurfWorld.xz, sFloor);
float sAA = max(fwidth(sUV.x), fwidth(sUV.y));
float sDistance = length(vViewPosition);
#ifndef SURF_LITE
vec3 sSigmaX = dFdx(-vViewPosition), sSigmaY = dFdy(-vViewPosition);
#endif
#if SURF_KIND > 0
{
  vec3 tint = vec3(1.0);
  float rough = 0.0, height = 0.0;
  vec4 big = surfNoise(sUV / 23.0), mid = surfNoise(sUV / 5.3);
  #ifdef SURF_LITE
    vec4 fine = mid;
  #else
    vec4 fine = surfNoise(sUV * .71);
  #endif
  #if SURF_KIND == 1
    // Painted plaster: blotchy fading, long streaks where the monsoon rain
    // runs down from sills and parapets, damp along the foot of the walls.
    tint *= .9 + .2 * (big.r * .6 + mid.g * .4);
    float streak = smoothstep(.5, .8, surfNoise(vec2(sUV.x / 1.7, sUV.y / 31.0)).g) * (1.0 - sFloor) * smoothstep(.2, .8, big.a + .25);
    tint *= mix(vec3(1.0), vec3(.72, .76, .7), streak * .55);
    float damp = (1.0 - smoothstep(.1, 1.2, vSurfWorld.y)) * (1.0 - sFloor) * (.5 + .5 * mid.r);
    tint *= 1.0 - damp * .26;
    tint *= mix(1.0, .86, sFloor);
    height = (fine.b - .5) * .002 + (mid.b - .5) * .002;
    rough = (mid.g - .5) * .08;
  #elif SURF_KIND == 2
    // Cast concrete: mottled, stained in patches and darkened by run-off.
    tint *= .85 + .27 * (big.r * .5 + mid.r * .5);
    tint *= 1.0 - smoothstep(.12, .03, surfNoise(sUV / 7.0 + .37).a) * .14;
    tint *= 1.0 - smoothstep(.55, .82, surfNoise(vec2(sUV.x / 1.2, sUV.y / 18.0)).g) * (1.0 - sFloor) * .16;
    tint *= 1.0 - (1.0 - smoothstep(.05, .8, vSurfWorld.y)) * (1.0 - sFloor) * .18;
    height = (fine.b - .5) * .003 + (mid.b - .5) * .003;
    rough = (mid.g - .5) * .1;
  #elif SURF_KIND == 3
    // Aluminium composite panels: dark recessed joints, each sheet a shade
    // different and a little bowed, so reflections break up panel by panel.
    vec2 size = mix(vec2(1.22, .92), vec2(1.22, 1.22), sFloor);
    vec2 cell = floor(sUV / size);
    float joint = surfJoints(sUV, size, .009, sAA);
    // Each sheet's own shade fades to the average before a pixel can span
    // several sheets, where it would only sparkle as the view moves.
    float tone = mix(.5, surfHash(cell + .5), 1.0 - smoothstep(size.x * .15, size.x * .5, sAA));
    tint *= (.94 + .1 * tone) * (1.0 - joint * .62) * (.97 + .06 * big.r);
    rough = (tone - .5) * .12;
    vec2 local = fract(sUV / size) - .5;
    height = -joint * .006 + (1.0 - dot(local, local) * 2.0) * .004 * (tone - .3);
  #elif SURF_KIND == 4
    // Pavers on the ground; on kerbs and edges just weathered.
    #ifdef PAVER_SQUARE
      vec2 size = vec2(.4);
      vec2 laid = sUV;
    #else
      vec2 size = vec2(.22, .11);
      vec2 laid = sUV + vec2(mod(floor(sUV.y / .11), 2.0) * .11, 0.0);
    #endif
    vec2 cell = floor(laid / size);
    float joint = surfJoints(laid, size, .005, sAA);
    float near = 1.0 - smoothstep(size.y * .2, size.y * .7, sAA);
    float tone = mix(.5, surfHash(cell), near);
    vec3 paver = vec3(.88 + .2 * tone);
    #ifdef PAVER_DARK
      // Charcoal pavers scattered through the red, as mixed batches are laid.
      paver = mix(paver, vec3(.42, .42, .44) * (.9 + .2 * tone), mix(.1, step(.9, surfHash(cell + 41.7)), near));
    #endif
    paver *= (.86 + .26 * big.r) * (1.0 - joint * .5);
    tint *= mix(vec3(.9 + .2 * mid.r), paver, sFloor);
    height = -joint * .004 * sFloor + (fine.b - .5) * .0015;
    rough = (tone - .5) * .1;
  #elif SURF_KIND == 5
    // Tiles and terrazzo: square tiles, thin grout, a polished speckle.
    vec2 size = vec2(.6);
    float joint = surfJoints(sUV, size, .0035, sAA) * sFloor;
    float tone = mix(.5, surfHash(floor(sUV / size)), 1.0 - smoothstep(.12, .4, sAA));
    tint *= (.94 + .1 * tone) * (1.0 - joint * .4) * (.9 + .16 * fine.b);
    rough = -.06 + (tone - .5) * .06;
    height = -joint * .002;
  #elif SURF_KIND == 6
    // Granite and stone: speckled slabs.
    vec2 size = vec2(.9, .6);
    float joint = surfJoints(sUV, size, .004, sAA);
    float speck = surfNoise(sUV * 4.3).b;
    tint *= (.84 + .3 * speck) * (.93 + .14 * mix(.5, surfHash(floor(sUV / size)), 1.0 - smoothstep(.12, .4, sAA))) * (1.0 - joint * .32);
    rough = (speck - .5) * .12;
    height = (speck - .5) * .0015 - joint * .003;
  #elif SURF_KIND == 7
    // Tarmac: worn grey with darker patches of newer repairs.
    tint *= (.86 + .2 * big.r) * (.88 + .24 * fine.b);
    tint *= 1.0 - smoothstep(.62, .72, surfNoise(sUV / 17.0 + .21).g) * .09;
    rough = (fine.b - .5) * .1;
    height = (fine.b - .5) * .003;
  #elif SURF_KIND == 8 || SURF_KIND == 9
    // Roofs: ribs or tile courses running down the slope.
    vec3 across = normalize(cross(vec3(0.0, 1.0, 0.0), sN) + vec3(1e-4, 0.0, 0.0));
    vec3 down = cross(sN, across);
    vec2 ruv = vec2(dot(vSurfWorld, across), dot(vSurfWorld, down));
    float raa = max(fwidth(ruv.x), fwidth(ruv.y));
    #if SURF_KIND == 8
      float ribs = sin(ruv.x / .076 * 6.2832) * (1.0 - smoothstep(.02, .06, raa));
      float rust = smoothstep(.5, .8, surfNoise(vec2(ruv.x / 2.2, ruv.y / 12.0)).g);
      tint *= mix(vec3(1.0), vec3(.8, .68, .58), rust * .45) * (.9 + .2 * big.r) * (1.0 + ribs * .05);
      rough = (mid.g - .5) * .14;
      height = ribs * .008;
    #else
      float row = ruv.y / .32;
      float col = ruv.x / .24 + mod(floor(row), 2.0) * .5;
      float fade = 1.0 - smoothstep(.03, .09, raa);
      float lip = smoothstep(.72, 1.0, fract(row)) * fade;
      float curve = sin(fract(col) * 3.1416) * fade;
      tint *= (.84 + .26 * mix(.5, surfHash(floor(vec2(col, row))), fade)) * (1.0 - lip * .28) * (.9 + .2 * big.r);
      tint = mix(tint, tint * vec3(.68, .7, .58), smoothstep(.6, .8, mid.a) * .5);
      height = curve * .012 - lip * .01;
    #endif
  #elif SURF_KIND == 10 || SURF_KIND == 11
    // Glazing: each pane a fraction out of plane, so neighbours reflect the
    // sky differently, as real curtain walls do.
    #if SURF_KIND == 10
      vec2 pane = floor(sUV / vec2(1.25, 1.55));
      vec3 tilt = (vec3(surfHash(pane + 1.3), surfHash(pane + 2.9), surfHash(pane + 4.1)) - .5) * .07;
      normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
      tint *= .9 + .2 * surfHash(pane + 7.7);
      rough = (surfHash(pane + 9.1) - .5) * .05;
    #else
      tint *= .85 + .3 * mid.g;
    #endif
  #elif SURF_KIND == 12
    // Clipped hedges: clumps of leaves with shadowed gaps between them.
    vec2 fuv = sA.y > .5 ? vSurfWorld.xz : sWall;
    float clump = 1.0 - surfNoise(fuv / 1.9).a;
    float leaves = surfNoise(fuv * 2.7).b;
    float bush = clump * .6 + leaves * .4;
    tint *= (.5 + .85 * bush) * mix(vec3(1.0), vec3(1.07, 1.1, .9), big.r);
    rough = .1;
    height = bush * .05 * (1.0 - smoothstep(30.0, 70.0, sDistance));
  #elif SURF_KIND == 13
    // Lawns and bare earth: drier and lusher patches, a little lumpy.
    vec2 guv = vSurfWorld.xz;
    float patches = surfNoise(guv / 37.0).r * .6 + surfNoise(guv / 9.0).g * .4;
    tint *= mix(vec3(.84, .95, .8), vec3(1.16, 1.08, .78), smoothstep(.3, .75, patches)) * (.86 + .26 * surfNoise(guv * .9).b);
    height = (surfNoise(guv * 2.3).b - .5) * .012 * sFloor;
    rough = .05;
  #elif SURF_KIND == 14
    // Painted and anodised metal: uneven sheen.
    tint *= .95 + .1 * big.r;
    rough = (mid.g - .5) * .12;
  #else
    tint *= .93 + .14 * (big.r * .5 + mid.g * .5);
    rough = (mid.g - .5) * .06;
  #endif
  diffuseColor.rgb *= tint;
  roughnessFactor = clamp(roughnessFactor + rough, .04, 1.0);
  // Fine relief fades with distance, where it would only sparkle.
  // Phones and Performance leave the relief out: the colour and joints carry it.
  #ifndef SURF_LITE
    height *= 1.0 - smoothstep(40.0, 90.0, sDistance);
    normal = surfPerturb(sSigmaX, sSigmaY, normal, vec2(dFdx(height), dFdy(height)), faceDirection);
  #endif
}
#endif
`;

// Lit rooms behind the glass at night: about half of them, warm or tube white.
const windowMain = /* glsl */`
#include <emissivemap_fragment>
#if SURF_KIND == 10 || SURF_KIND == 11
if (uWindows > .001) {
  float storey = (vSurfWorld.y + .4) / 3.35;
  vec2 room = floor(vec2(sUV.x / 3.4, storey));
  float lit = surfHash(room + 17.3);
  vec3 tube = mix(vec3(1.0, .8, .56), vec3(.84, .91, 1.0), step(.5, surfHash(room + 3.3)));
  // Brighter towards the ceiling, where the lights are; blinds dim some rooms.
  float glow = (.22 + .4 * fract(lit * 7.0)) * (.7 + .6 * fract(storey));
  totalEmissiveRadiance += tube * step(.5, lit) * glow * uWindows * (1.0 - sFloor);
}
#endif
`;

// The street lamps nearest the camera, as soft downward lights.
const lampMain = /* glsl */`
#include <lights_fragment_end>
if (uLampLevel > .001) {
  vec3 lampNormal = inverseTransformDirection(normal, viewMatrix);
  vec3 lampSum = vec3(0.0);
  for (int i = 0; i < SURF_LAMPS; i++) {
    vec3 toLamp = uLamps[i].xyz - vSurfWorld;
    float d2 = dot(toLamp, toLamp);
    float reach = 1.0 - d2 / 760.0;
    if (reach > 0.0) {
      vec3 l = toLamp * inversesqrt(d2);
      lampSum += vec3(uLamps[i].w * reach * reach / (d2 + 4.0) * smoothstep(-.1, .6, l.y) * max(dot(lampNormal, l), 0.0));
    }
  }
  reflectedLight.directDiffuse += uLampColor * uLampLevel * lampSum * BRDF_Lambert(material.diffuseColor);
}
`;

/**
 * `lite` (phones, and Performance) leaves out the bump relief and one noise
 * read, and lights each pixel from the six nearest lamps rather than twelve.
 */
export function createSurfaces(options: { lite?: boolean } = {}) {
  let lite = !!options.lite;
  const all: THREE.MeshStandardMaterial[] = [];
  const uniforms = {
    uSurfNoise: { value: noiseTexture() },
    uLamps: { value: Array.from({ length: LAMP_SLOTS }, () => new THREE.Vector4(0, -1000, 0, 0)) },
    uLampColor: { value: new THREE.Color('#ffc78f') },
    uLampLevel: { value: 0 },
    uWindows: { value: 0 },
  };
  const patched = new WeakSet<THREE.Material>();

  /** Gives one material its pattern (from its name unless told) and the lamps' light. */
  const patch = (material: THREE.Material, kind?: SurfaceKind) => {
    if (!(material instanceof THREE.MeshStandardMaterial) || patched.has(material)) return;
    patched.add(material);
    // Textured materials and those that already draw their own pattern keep it.
    const custom = material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
    let chosen = kind ?? surfaceKind(material.name);
    if (material.map || (custom && chosen !== 'glass' && chosen !== 'interior')) chosen = 'lamps';
    const id = KIND_ID[chosen];
    const flags = chosen === 'pavers' ? (/red and black/i.test(material.name) ? 'PAVER_DARK' : /concrete pavers|courtyard|sidewalk|Gallery/i.test(material.name) ? 'PAVER_SQUARE' : '') : '';
    const previous = material.onBeforeCompile.bind(material);
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = vertexPars + shader.vertexShader.replace('#include <project_vertex>', vertexMain);
      shader.fragmentShader = `#define SURF_KIND ${id}\n#define SURF_LAMPS ${lite ? 6 : LAMP_SLOTS}\n${lite ? '#define SURF_LITE\n' : ''}${flags ? `#define ${flags}\n` : ''}${fragmentPars}` + shader.fragmentShader
        .replace('#include <normal_fragment_maps>', patternMain)
        .replace('#include <emissivemap_fragment>', windowMain)
        .replace('#include <lights_fragment_end>', lampMain);
    };
    material.customProgramCacheKey = () => `${previousKey}|surface-v1-${id}-${flags}-${lite ? 'lite' : 'full'}`;
    all.push(material);
    material.needsUpdate = true;
  };

  return {
    uniforms,
    patch,
    /** Patches every lit material under `root`. */
    apply(root: THREE.Object3D, kind?: SurfaceKind) {
      root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patch(m, kind);
      });
    },
    /** Night level: 0 by day, 1 once the lamps and windows are fully on. */
    setNight(level: number) { uniforms.uLampLevel.value = level; uniforms.uWindows.value = level; },
    /** Switches every patched material to the lighter or the full shader. */
    setLite(on: boolean) {
      if (on === lite) return;
      lite = on;
      for (const m of all) m.needsUpdate = true;
    },
    get lite() { return lite; },
    dispose() { uniforms.uSurfNoise.value.dispose(); },
  };
}
export type Surfaces = ReturnType<typeof createSurfaces>;
