import * as THREE from 'three';
import type { SkyPalette } from './sky.ts';

/**
 * Time of day on campus: where the sun and moon are, and what colour
 * everything is lit by.
 *
 * The sun rises in the east, crosses the southern sky (Silchar is at 24.8
 * degrees north, so at noon it stands 64 degrees up, a little to the south)
 * and sets in the west; the moon follows half a day behind. Campus axes: +x
 * is west and +z north. Every colour is keyed to the sun's height, so the
 * golden hour, the rose and purple of dusk and the blue of moonlight follow
 * from where the sun actually is rather than from a clock.
 */
export const TIMES = { morning: 7.3, noon: 12.6, evening: 17.55, night: 21.5 } as const;
export type TimeName = keyof typeof TIMES | 'auto';

const NOON_HEIGHT = THREE.MathUtils.degToRad(64);
export function sunDirection(hours: number, out = new THREE.Vector3()) {
  const theta = (hours - 6) / 12 * Math.PI;
  return out.set(-Math.cos(theta), Math.sin(theta) * Math.sin(NOON_HEIGHT), -Math.sin(theta) * Math.cos(NOON_HEIGHT)).normalize();
}
export function moonDirection(hours: number, out = new THREE.Vector3()) {
  const theta = (hours - 18.6) / 12 * Math.PI;
  const height = THREE.MathUtils.degToRad(56);
  return out.set(-Math.cos(theta), Math.sin(theta) * Math.sin(height), -Math.sin(theta) * Math.cos(height) * .7 + .25).normalize();
}

/** How fast the clock runs: a day hour in a minute, the night three times faster. */
export function hoursPerSecond(hours: number) {
  const night = hours < 5.5 || hours > 19.2;
  return night ? 1 / 20 : 1 / 60;
}

type Key = { at: number; zenith: string; horizon: string; sun: string; cloudLit: string; cloudShade: string; sky: string; ground: string; hemi: number; light: number; exposure: number };
// Keyed by the sun's height, the sine of its elevation; read top to bottom
// from noon down through the golden hour, sunset and dusk into night.
const KEYS: Key[] = [
  { at: .55, zenith: '#2a62b0', horizon: '#bdd7df', sun: '#fff0d6', cloudLit: '#ffffff', cloudShade: '#8b98ac', sky: '#d8efff', ground: '#68794c', hemi: 1.55, light: 2.5, exposure: 1 },
  { at: .25, zenith: '#2e5fa6', horizon: '#c4d6da', sun: '#ffe2b8', cloudLit: '#fff6e8', cloudShade: '#8a92a6', sky: '#d8ecfa', ground: '#65744a', hemi: 1.45, light: 2.35, exposure: 1 },
  { at: .08, zenith: '#29508c', horizon: '#e6c39d', sun: '#ffb46a', cloudLit: '#ffd7a8', cloudShade: '#7c7a92', sky: '#f0dccb', ground: '#5f6446', hemi: 1.15, light: 1.75, exposure: 1.02 },
  { at: .0, zenith: '#22386a', horizon: '#e89a72', sun: '#ff7a3c', cloudLit: '#ff9c78', cloudShade: '#6a5c78', sky: '#e0b8a8', ground: '#4b4c3c', hemi: .8, light: .9, exposure: 1.05 },
  { at: -.07, zenith: '#131c3c', horizon: '#6a4c6a', sun: '#ff6a4a', cloudLit: '#a06a7a', cloudShade: '#3a3248', sky: '#8a7ca0', ground: '#2e302c', hemi: .7, light: .0, exposure: 1.18 },
  // Night is moonlit blue rather than black: the eye adapts, and so does the game.
  { at: -.18, zenith: '#060a1a', horizon: '#1a2236', sun: '#7a5a6a', cloudLit: '#2c3448', cloudShade: '#14182a', sky: '#56688f', ground: '#232a24', hemi: .66, light: .0, exposure: 1.42 },
  { at: -1, zenith: '#03050d', horizon: '#0d1424', sun: '#5a5468', cloudLit: '#1f2738', cloudShade: '#0a0d18', sky: '#4e5f86', ground: '#1d231e', hemi: .62, light: .0, exposure: 1.48 },
];

export type DaylightState = SkyPalette & {
  hours: number;
  /** Where the directional light comes from: the sun by day, the moon by night. */
  light: THREE.Vector3; lightColor: THREE.Color; lightIntensity: number;
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemiIntensity: number;
  exposure: number;
  /** 0 by day, 1 once it is dark enough for street lights and lit windows. */
  lamps: number;
};

const mixColor = (a: string, b: string, t: number, out: THREE.Color) => out.set(a).lerp(new THREE.Color(b), t);

export function daylightAt(hours: number, state?: DaylightState): DaylightState {
  const s: DaylightState = state ?? {
    hours, sun: new THREE.Vector3(), moon: new THREE.Vector3(), zenith: new THREE.Color(), horizon: new THREE.Color(), sunColor: new THREE.Color(),
    cloudLit: new THREE.Color(), cloudShade: new THREE.Color(), sunAmount: 1, night: 0, dusk: 0,
    light: new THREE.Vector3(), lightColor: new THREE.Color(), lightIntensity: 1, hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 1, exposure: 1, lamps: 0,
  };
  s.hours = hours;
  sunDirection(hours, s.sun); moonDirection(hours, s.moon);
  const height = s.sun.y;
  let i = 0;
  while (i < KEYS.length - 2 && height < KEYS[i + 1].at) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((a.at - height) / (a.at - b.at), 0, 1);
  mixColor(a.zenith, b.zenith, t, s.zenith); mixColor(a.horizon, b.horizon, t, s.horizon);
  mixColor(a.sun, b.sun, t, s.sunColor); mixColor(a.cloudLit, b.cloudLit, t, s.cloudLit); mixColor(a.cloudShade, b.cloudShade, t, s.cloudShade);
  mixColor(a.sky, b.sky, t, s.hemiSky); mixColor(a.ground, b.ground, t, s.hemiGround);
  s.hemiIntensity = THREE.MathUtils.lerp(a.hemi, b.hemi, t);
  s.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);
  s.sunAmount = THREE.MathUtils.smoothstep(height, -.03, .03);
  s.night = THREE.MathUtils.smoothstep(-height, .04, .2);
  s.dusk = Math.max(0, 1 - Math.abs(height - .01) / .14);
  s.lamps = THREE.MathUtils.smoothstep(-height, -.06, .06);
  // The sun lights the campus until it sets; then the moon, faint and blue.
  const sunLight = THREE.MathUtils.lerp(a.light, b.light, t);
  const moonUp = THREE.MathUtils.smoothstep(s.moon.y, .02, .25);
  const moonLight = s.night * moonUp * .6;
  if (sunLight >= moonLight) { s.light.copy(s.sun); s.lightColor.copy(s.sunColor); s.lightIntensity = sunLight; }
  else { s.light.copy(s.moon); s.lightColor.set('#9fb4e0'); s.lightIntensity = moonLight; }
  // Keep the light from skimming flat across the ground at the horizon.
  if (s.light.y < .06) { s.light.y = .06; s.light.normalize(); }
  return s;
}

/** A short label for the clock: 17:35 and so on. */
export function clockLabel(hours: number) {
  const h = Math.floor(((hours % 24) + 24) % 24), m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Sky light for every surface: a small copy of the sky, sun glow included,
 * baked into an environment map whenever the light has changed enough to
 * notice. Lit by it, walls facing the sky are brighter than walls facing the
 * ground, glass and metal reflect the hour, and corners read as corners.
 */
export function createSkyLight(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(50, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uSunAmount: { value: 1 } },
    vertexShader: 'varying vec3 vDir;void main(){vDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `uniform vec3 uZenith,uHorizon,uGround,uSun,uSunColor;uniform float uSunAmount;varying vec3 vDir;
      void main(){vec3 d=normalize(vDir);float up=max(d.y,0.0);
        vec3 c=d.y>=0.0?mix(uHorizon,uZenith,pow(up,0.5)):mix(uHorizon,uGround,min(1.0,-d.y*6.0));
        c+=uSunColor*uSunAmount*(pow(max(dot(d,uSun),0.0),24.0)*2.5+pow(max(dot(d,uSun),0.0),3.0)*0.25);
        gl_FragColor=vec4(c,1.0);}`,
  });
  scene.add(new THREE.Mesh(geometry, material));
  const generator = new THREE.PMREMGenerator(renderer);
  let target: THREE.WebGLRenderTarget | null = null;
  let bakedHours = -99;
  return {
    get texture() { return target?.texture ?? null; },
    /** Re-bakes when the hour has moved on; returns the texture to use. */
    update(state: DaylightState, force = false) {
      if (!force && target && Math.abs(state.hours - bakedHours) < .12) return target.texture;
      const u = material.uniforms;
      u.uZenith.value.copy(state.zenith); u.uHorizon.value.copy(state.horizon);
      // Ground bounce: the lawns' green, lit by the same light.
      u.uGround.value.copy(state.hemiGround).multiplyScalar(.55);
      u.uSun.value.copy(state.sun); u.uSunColor.value.copy(state.sunColor); u.uSunAmount.value = state.sunAmount;
      const next = generator.fromScene(scene, 0, .1, 100, { size: 64 });
      target?.dispose();
      target = next; bakedHours = state.hours;
      return target.texture;
    },
    dispose() { target?.dispose(); generator.dispose(); geometry.dispose(); material.dispose(); },
  };
}
