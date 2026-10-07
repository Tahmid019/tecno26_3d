import * as T from 'three';

/**
 * The sky: a gradient dome with the sun, its glow and a deck of drifting
 * cumulus, all drawn by one shader on one sphere.
 *
 * The clouds are painted from a tiling noise texture that the GPU renders
 * once at start-up: billowy cells in one channel, rolling noise in another,
 * fine detail and stretched cirrus streaks in the last two. Each pixel of sky
 * finds where its ray meets the cloud deck, so the clouds hang over the
 * campus and slide past as you walk, rather than riding along with the
 * camera. They are lit from the sun's side by looking a little way towards
 * it through the same noise, shaded blue-grey beneath, rimmed with light
 * when you look towards the sun, and lost in the same haze as the fog.
 *
 * Performance draws the deck flat and unlit; Balanced lights it; High adds
 * fine detail, a second light sample and a high, thin cirrus layer.
 *
 * The day-and-night cycle sets its colours every frame: the sun's glow turns
 * orange and rose at sunrise and sunset, the clouds take the light of whatever
 * is up, and at night stars come out and a moon rises, both hidden by cloud.
 */
export type SkyQuality = 'performance' | 'balanced' | 'high';

const SIZE = 512;

const noiseShader = /* glsl */`
precision highp float;
varying vec2 vUv;
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Gradient noise that repeats every 'period' cells, so the texture tiles.
float gradient(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  vec2 g00 = hash2(mod(i, period)) * 2.0 - 1.0;
  vec2 g10 = hash2(mod(i + vec2(1.0, 0.0), period)) * 2.0 - 1.0;
  vec2 g01 = hash2(mod(i + vec2(0.0, 1.0), period)) * 2.0 - 1.0;
  vec2 g11 = hash2(mod(i + vec2(1.0, 1.0), period)) * 2.0 - 1.0;
  float a = dot(g00, f), b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0)), d = dot(g11, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
}
float fbm(vec2 p, float period, int octaves) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 7; o++) {
    if (o >= octaves) break;
    sum += amp * gradient(p, period); norm += amp;
    p *= 2.0; period *= 2.0; amp *= 0.5;
  }
  return sum / norm;
}
// Cellular noise, inverted: round, billowing cells like cumulus tops.
float cells(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + hash2(mod(i + o, period)) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - sqrt(d);
}
void main() {
  vec2 p = vUv;
  float billow = cells(p * 5.0, 5.0) * 0.55 + cells(p * 10.0, 10.0) * 0.3 + cells(p * 20.0, 20.0) * 0.15;
  float rolling = fbm(p * 4.0, 4.0, 6);
  float detail = fbm(p * 16.0, 16.0, 4);
  // Cirrus: noise stretched along one axis into fibrous streaks.
  float streaks = fbm(vec2(p.x * 3.0, p.y * 24.0), 3.0, 5);
  gl_FragColor = vec4(billow, rolling, detail, streaks);
}`;

function bakeNoise(renderer: T.WebGLRenderer) {
  const target = new T.WebGLRenderTarget(SIZE, SIZE, { generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping, depthBuffer: false });
  target.texture.wrapS = target.texture.wrapT = T.RepeatWrapping;
  target.texture.colorSpace = T.NoColorSpace;
  const material = new T.ShaderMaterial({ vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}', fragmentShader: noiseShader, depthTest: false, depthWrite: false });
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), material);
  const scene = new T.Scene(); scene.add(quad);
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target); renderer.render(scene, camera); renderer.setRenderTarget(previous);
  quad.geometry.dispose(); material.dispose();
  return target;
}

const skyVertex = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const skyFragment = /* glsl */`
uniform sampler2D uNoise;
uniform vec3 uSunDir, uMoonDir, uHorizon, uZenith, uSunColor, uCloudLit, uCloudShade;
uniform float uTime, uCover, uSoft, uScale, uSunAmount, uNight, uDusk;
varying vec3 vWorld;

float deck(vec2 p, out float billow) {
  vec4 n = texture2D(uNoise, p);
  billow = n.r;
  #ifdef DETAIL
    // Billows dominate: heaped cumulus, their edges frayed by fine detail.
    float shape = n.r * 0.7 + n.g * 0.3;
    vec4 m = texture2D(uNoise, p * 3.7 + vec2(0.31, 0.72));
    shape -= (1.0 - m.b) * 0.16;
  #else
    float shape = n.r * 0.6 + n.g * 0.4;
  #endif
  return shape;
}
float starHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float up = max(dir.y, 0.0);
  float mu = dot(dir, uSunDir);
  float sunSide = max(mu, 0.0);
  // Rayleigh-like gradient: deep blue overhead, pale haze at the horizon,
  // warmer and brighter on the sun's side.
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.5));
  sky = mix(sky, uHorizon * vec3(1.06, 1.0, 0.92), pow(sunSide, 3.0) * 0.35 * (1.0 - up));
  // At sunrise and sunset the low sky round the sun burns orange and rose.
  sky += uSunColor * uDusk * (pow(sunSide, 4.0) * 0.55 + pow(sunSide, 1.5) * 0.12) * pow(1.0 - up, 3.0);
  sky += uSunColor * uSunAmount * (pow(sunSide, 6.0) * 0.08 + pow(sunSide, 80.0) * 0.45);
  sky += uSunColor * uSunAmount * smoothstep(0.99955, 0.99975, mu) * 30.0;

  // Night: stars, the moon and its halo, all hidden behind cloud.
  float moonCos = dot(dir, uMoonDir);
  vec3 night = vec3(0.0);
  if (uNight > 0.01 && dir.y > 0.0) {
    vec3 cell = floor(dir * 260.0);
    vec3 local = fract(dir * 260.0) - 0.5;
    float h = starHash(cell);
    if (h > 0.985) {
      vec3 offset = vec3(starHash(cell + 1.3), starHash(cell + 2.7), starHash(cell + 4.1)) - 0.5;
      float d = length(local - offset * 0.6);
      float twinkle = 0.7 + 0.3 * sin(uTime * (1.5 + h * 4.0) + h * 80.0);
      float bright = (h - 0.985) / 0.015;
      night += vec3(0.85, 0.9, 1.0) * smoothstep(0.16, 0.0, d) * (0.4 + bright * 2.2) * twinkle;
    }
    night *= smoothstep(0.02, 0.25, dir.y);
    // A pale moon with darker seas, and its glow in the haze around it.
    float disc = smoothstep(0.99988, 0.99992, moonCos);
    vec3 moonUp = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + 1e-4);
    vec2 face = vec2(dot(dir - uMoonDir, moonUp), dot(dir - uMoonDir, cross(moonUp, uMoonDir))) * 900.0;
    float seas = texture2D(uNoise, face * 0.08 + 0.37).g;
    night += vec3(0.95, 0.96, 1.0) * disc * (2.6 - seas * 1.4);
    night += vec3(0.32, 0.38, 0.55) * pow(max(moonCos, 0.0), 350.0) * 0.35 + vec3(0.12, 0.15, 0.24) * pow(max(moonCos, 0.0), 12.0) * 0.08;
    night *= uNight;
  }

  float cloudAlpha = 0.0;
  #ifdef CLOUDS
  if (dir.y > 0.004) {
    // Where this ray meets the cloud deck, 600 m up, in world metres.
    float t = (600.0 - cameraPosition.y) / dir.y;
    vec2 world = cameraPosition.xz + dir.xz * t;
    vec2 p = world / uScale + vec2(uTime, uTime * 0.43) * (5.5 / uScale);
    float billow;
    float shape = deck(p, billow);
    float density = smoothstep(uCover, uCover + uSoft, shape);
    // Light: how much thinner the deck gets a little way towards the light.
    vec3 lit = uCloudLit;
    #ifdef LIGHTING
      vec3 lightDir = normalize(mix(uSunDir, uMoonDir, uNight));
      vec2 toward = normalize(lightDir.xz + vec2(1e-4)) * 0.012;
      float b2;
      float ahead = deck(p + toward, b2);
      float shade = clamp(0.54 + (shape - ahead) * 5.5, 0.0, 1.0);
      #ifdef DETAIL
        float b3;
        float further = deck(p + toward * 2.4, b3);
        shade = clamp(shade * 0.65 + clamp(0.6 + (shape - further) * 2.5, 0.0, 1.0) * 0.35, 0.0, 1.0);
      #endif
      // Thick cores are darker underneath; thin edges let the light through.
      float core = smoothstep(uCover + 0.08, uCover + 0.42, shape);
      shade = mix(shade, shade * 0.66, core);
      lit = mix(uCloudShade, uCloudLit, shade);
      // A bright rim on clouds seen against the sun, glowing at sunset.
      lit += uSunColor * pow(sunSide, 10.0) * (1.0 - density * 0.6) * (0.9 * uSunAmount + uDusk * 0.6);
    #else
      lit = mix(uCloudShade, uCloudLit, billow);
    #endif
    // Far clouds sink into the horizon haze, the way distance flattens them.
    float haze = 1.0 - exp(-t * 0.00022);
    vec3 cloud = mix(lit, uHorizon * 1.05, haze * 0.85);
    cloudAlpha = density * smoothstep(0.004, 0.09, dir.y) * (1.0 - haze * 0.55);
    sky = mix(sky, cloud, cloudAlpha);

    #ifdef CIRRUS
      // A high, thin layer of cirrus, drifting a little faster.
      float t2 = (2400.0 - cameraPosition.y) / dir.y;
      vec2 q = (cameraPosition.xz + dir.xz * t2) / 9000.0 + vec2(uTime * 0.0012, -uTime * 0.0004);
      vec4 c = texture2D(uNoise, vec2(q.x * 0.9 + q.y * 0.4, q.y * 0.9 - q.x * 0.4));
      float wisps = smoothstep(0.52, 0.85, c.a) * (1.0 - density) * smoothstep(0.02, 0.25, dir.y);
      sky = mix(sky, mix(uCloudLit, uSunColor, 0.3) * 1.05, wisps * 0.42);
      cloudAlpha = max(cloudAlpha, wisps * 0.42);
    #endif
  }
  #endif
  sky += night * (1.0 - cloudAlpha);

  // Below the horizon the dome shows only haze, matching the fog on the ground.
  sky = mix(uHorizon, sky, smoothstep(-0.015, 0.02, dir.y));
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Everything the sky needs to know about the hour, set every frame. */
export type SkyPalette = {
  sun: T.Vector3; moon: T.Vector3; zenith: T.Color; horizon: T.Color; sunColor: T.Color;
  cloudLit: T.Color; cloudShade: T.Color; sunAmount: number; night: number; dusk: number;
};

export function createSky(renderer: T.WebGLRenderer) {
  const group = new T.Group(); group.name = 'Sky, sun and drifting clouds';
  const noise = bakeNoise(renderer);
  const uniforms = {
    uNoise: { value: noise.texture },
    uSunDir: { value: new T.Vector3(.37, .44, -.81) },
    uMoonDir: { value: new T.Vector3(-.4, .6, .6).normalize() },
    uHorizon: { value: new T.Color(.51, .68, .73) },
    uZenith: { value: new T.Color(0.17, 0.39, 0.78) },
    uSunColor: { value: new T.Color(1.0, 0.93, 0.8) },
    uCloudLit: { value: new T.Color(1.1, 1.02, .88) },
    uCloudShade: { value: new T.Color(.42, .49, .61) },
    uSunAmount: { value: 1 },
    uNight: { value: 0 },
    uDusk: { value: 0 },
    uTime: { value: 0 },
    uCover: { value: 0.5 },
    uSoft: { value: 0.2 },
    /** Metres per tile of cloud noise: the size of the weather. */
    uScale: { value: 2600 },
  };
  const material = new T.ShaderMaterial({ name: 'Sky | gradient, sun and clouds', uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: T.BackSide, depthWrite: false, fog: false });
  material.toneMapped = true;
  const dome = new T.Mesh(new T.SphereGeometry(980, 48, 24), material);
  dome.renderOrder = -10; dome.frustumCulled = false;
  group.add(dome);

  const setQuality = (quality: SkyQuality) => {
    const defines: Record<string, string> = { CLOUDS: '' };
    if (quality !== 'performance') defines.LIGHTING = '';
    if (quality === 'high') { defines.DETAIL = ''; defines.CIRRUS = ''; }
    material.defines = defines;
    // A fuller deck where it is lit well enough to read as cloud, not blots.
    uniforms.uCover.value = quality === 'performance' ? .56 : quality === 'high' ? .47 : .5;
    uniforms.uSoft.value = quality === 'high' ? .17 : .2;
    uniforms.uScale.value = quality === 'high' ? 3200 : 2600;
    material.needsUpdate = true;
  };
  setQuality('balanced');

  return {
    group, setQuality,
    update(time: number) { uniforms.uTime.value = time; },
    /** Colours and lights for the hour, from the day-and-night cycle. */
    setPalette(p: SkyPalette) {
      uniforms.uSunDir.value.copy(p.sun); uniforms.uMoonDir.value.copy(p.moon);
      uniforms.uZenith.value.copy(p.zenith); uniforms.uHorizon.value.copy(p.horizon);
      uniforms.uSunColor.value.copy(p.sunColor); uniforms.uCloudLit.value.copy(p.cloudLit); uniforms.uCloudShade.value.copy(p.cloudShade);
      uniforms.uSunAmount.value = p.sunAmount; uniforms.uNight.value = p.night; uniforms.uDusk.value = p.dusk;
    },
    dispose() { noise.dispose(); dome.geometry.dispose(); material.dispose(); },
  };
}
