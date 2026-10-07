import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAMP_SLOTS } from './surfaces.ts';

/**
 * Street lights along the roads, and the campus's own lamps, lit at dusk.
 *
 * New lamps stand every 32 m or so along the roads, alternating sides, on
 * dark green poles like the ones already on the campus's southern road. By
 * day they are just poles. As the sun goes down their heads light up warm
 * white with a soft glow round each, and the dozen nearest the camera light
 * the road, the verges, walls, people and bicycles beneath them through the
 * surface shader (see `surfaces.ts`): real light, without the cost of real
 * lights. Poles, heads and glows are instanced: three draw calls in all.
 */
export const POLE_HEIGHT = 7;
const ARM = 1.45;
export type Lamp = { head: THREE.Vector3; base: THREE.Vector3; ours: boolean; glow?: boolean };
export type LampSite = {
  ground: (x: number, z: number) => number | null;
  /** Why a pole cannot stand here: in a wall, a tree, a road, a rack. */
  blocked: (x: number, z: number, y: number) => boolean;
};

function lampGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(.065, .11, POLE_HEIGHT, 10, 1, true); pole.translate(0, POLE_HEIGHT / 2, 0); parts.push(pole);
  const foot = new THREE.CylinderGeometry(.17, .22, .6, 10); foot.translate(0, .3, 0); parts.push(foot);
  // The arm curves out over the road from just below the top.
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, POLE_HEIGHT - .4, 0), new THREE.Vector3(0, POLE_HEIGHT + .22, .25), new THREE.Vector3(0, POLE_HEIGHT + .12, ARM));
  parts.push(new THREE.TubeGeometry(curve, 10, .045, 6));
  const housing = new THREE.CylinderGeometry(.16, .24, .16, 12); housing.scale(1, 1, 1.6); housing.translate(0, POLE_HEIGHT + .1, ARM + .14); parts.push(housing);
  const metal = mergeGeometries(parts.map(g => { const q = g.index ? g.toNonIndexed() : g; q.deleteAttribute('uv'); return q; }));
  for (const g of parts) g.dispose();
  const lens = new THREE.CircleGeometry(.19, 16); lens.rotateX(Math.PI / 2); lens.scale(1, 1, 1.5); lens.translate(0, POLE_HEIGHT + .015, ARM + .14);
  return { metal, lens };
}

/** Additive glows that always face the camera, one per lamp head. */
function glowMaterial() {
  return new THREE.ShaderMaterial({
    name: 'Street lights | glow', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uLevel: { value: 0 }, uColor: { value: new THREE.Color('#ffc98e') } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vFade;
      void main() {
        vUv = uv;
        vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // Seen from far off a glow shrinks less than the lamp, as a bright
        // point does through a little haze, then fades into it.
        float distance = -centre.z;
        centre.xy += position.xy * (2.4 + distance * .012);
        vFade = 1.0 - smoothstep(180.0, 420.0, distance);
        gl_Position = projectionMatrix * centre;
      }`,
    fragmentShader: /* glsl */`
      uniform float uLevel; uniform vec3 uColor;
      varying vec2 vUv; varying float vFade;
      void main() {
        float r = length(vUv - .5) * 2.0;
        float glow = exp(-r * r * 9.0) * 1.1 + exp(-r * 4.0) * .25;
        glow *= 1.0 - smoothstep(.85, 1.0, r);
        gl_FragColor = vec4(uColor * glow * uLevel * vFade, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export function createStreetLights(site: LampSite) {
  const group = new THREE.Group(); group.name = 'Street lights';
  const lamps: Lamp[] = [];
  const { metal, lens } = lampGeometry();
  const metalMaterial = new THREE.MeshStandardMaterial({ name: 'Street lights | dark green steel', color: '#22382d', roughness: .5, metalness: .5 });
  const lensMaterial = new THREE.MeshStandardMaterial({ name: 'Street lights | lamp glass', color: '#cfcabb', roughness: .25, emissive: new THREE.Color('#ffd6a0'), emissiveIntensity: 0 });
  const glow = glowMaterial();
  const quad = new THREE.PlaneGeometry(1, 1);
  /** Materials of lamps that came with the campus model, lit with ours. */
  const adopted: THREE.MeshStandardMaterial[] = [];
  let poles: THREE.InstancedMesh | null = null, heads: THREE.InstancedMesh | null = null, glows: THREE.InstancedMesh | null = null;
  let level = -1, reassign = 0;

  const rebuild = () => {
    for (const mesh of [poles, heads, glows]) if (mesh) { group.remove(mesh); mesh.dispose(); }
    const ours = lamps.filter(l => l.ours);
    poles = new THREE.InstancedMesh(metal, metalMaterial, Math.max(1, ours.length));
    heads = new THREE.InstancedMesh(lens, lensMaterial, Math.max(1, ours.length));
    poles.count = heads.count = ours.length;
    poles.castShadow = true; poles.receiveShadow = true;
    poles.name = 'Street lights | poles'; heads.name = 'Street lights | heads';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    ours.forEach((lamp, i) => {
      q.setFromAxisAngle(up, Math.atan2(lamp.head.x - lamp.base.x, lamp.head.z - lamp.base.z));
      m.compose(lamp.base, q, one);
      poles!.setMatrixAt(i, m); heads!.setMatrixAt(i, m);
    });
    const glowing = lamps.filter(l => l.glow !== false);
    glows = new THREE.InstancedMesh(quad, glow, Math.max(1, glowing.length));
    glows.count = glowing.length; glows.name = 'Street lights | glows'; glows.frustumCulled = false; glows.renderOrder = 3;
    glowing.forEach((lamp, i) => glows!.setMatrixAt(i, m.makeTranslation(lamp.head.x, lamp.head.y - .12, lamp.head.z)));
    for (const mesh of [poles, heads]) mesh.computeBoundingSphere();
    group.add(poles, heads, glows);
    glows.visible = level > .01;
  };

  const near = (x: number, z: number, gap: number) => lamps.some(l => Math.hypot(l.head.x - x, l.head.z - z) < gap);

  /** Plants lamps along roads, `offset` metres out from the centre line. */
  const plant = (roads: number[][][], offset: number, spacing = 32) => {
    for (const road of roads) {
      let carry = spacing * .5, side = 1;
      for (let i = 1; i < road.length; i++) {
        const ax = road[i - 1][0], az = road[i - 1][1], bx = road[i][0], bz = road[i][1];
        const span = Math.hypot(bx - ax, bz - az);
        if (span < 1e-3) continue;
        const dx = (bx - ax) / span, dz = (bz - az) / span;
        let s = carry;
        for (; s < span; s += spacing) {
          const px = ax + dx * s, pz = az + dz * s;
          const nx = dz * side, nz = -dx * side;
          side = -side;
          // Try the verge first, then a little further out if that is taken.
          for (const out of [offset, offset + .9, offset + 1.8]) {
            const x = px + nx * out, z = pz + nz * out;
            const y = site.ground(x, z);
            if (y === null || near(x, z, 18) || site.blocked(x, z, y)) continue;
            // The arm reaches back over the carriageway.
            const head = new THREE.Vector3(x - nx * (ARM + .14), y + POLE_HEIGHT + .02, z - nz * (ARM + .14));
            lamps.push({ head, base: new THREE.Vector3(x, y, z), ours: true });
            break;
          }
        }
        carry = s - span;
      }
    }
    rebuild();
  };

  /**
   * Takes in lamps already modelled with the buildings: every separate lump
   * of `meshes` above `above` metres with `vertices` vertices or thereabouts
   * is one lamp head. `glow` lights their material up at night too.
   */
  const adopt = (meshes: THREE.Mesh[], options: { above?: number; vertices?: [number, number]; glow?: boolean } = {}) => {
    const { above = -Infinity, vertices = [1, Infinity], glow = true } = options;
    const v = new THREE.Vector3();
    for (const mesh of meshes) {
      const heads: { sum: THREE.Vector3; n: number }[] = [];
      mesh.updateWorldMatrix(true, false);
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        if (v.y < above) continue;
        const cluster = heads.find(h => h.sum.clone().divideScalar(h.n).distanceTo(v) < 1.6);
        if (cluster) { cluster.sum.add(v); cluster.n++; } else heads.push({ sum: v.clone(), n: 1 });
      }
      for (const h of heads) {
        if (h.n < vertices[0] || h.n > vertices[1]) continue;
        const head = h.sum.divideScalar(h.n);
        if (!near(head.x, head.z, 1.6)) lamps.push({ head, base: head.clone().setY(head.y - POLE_HEIGHT), ours: false });
      }
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (glow && material.isMeshStandardMaterial && !adopted.includes(material)) {
        material.emissive = new THREE.Color('#ffd6a0'); material.emissiveIntensity = 0; adopted.push(material);
      }
    }
    rebuild();
  };

  /** Lights with no lamp to show, such as a stage's wash: light only. */
  const addLights = (points: THREE.Vector3[]) => {
    for (const head of points) lamps.push({ head: head.clone(), base: head.clone().setY(head.y - POLE_HEIGHT), ours: false, glow: false });
    rebuild();
  };

  const order: number[] = [];
  return {
    group, lamps, plant, adopt, addLights,
    /**
     * Lights up with `on`, 0 by day and 1 at night, and hands the lamps
     * nearest `viewer` to the surface shader's slots.
     */
    update(dt: number, on: number, viewer: THREE.Vector3, slots: THREE.Vector4[]) {
      if (Math.abs(on - level) > .002) {
        level = on;
        lensMaterial.emissiveIntensity = on * 6;
        for (const m of adopted) m.emissiveIntensity = on * 6;
        glow.uniforms.uLevel.value = on;
        if (glows) glows.visible = on > .01;
        reassign = 0;
      }
      reassign -= dt;
      if (reassign > 0) return;
      reassign = .35;
      order.length = 0;
      for (let i = 0; i < lamps.length; i++) order.push(i);
      order.sort((a, b) => lamps[a].head.distanceToSquared(viewer) - lamps[b].head.distanceToSquared(viewer));
      for (let i = 0; i < slots.length; i++) {
        const lamp = lamps[order[i]];
        if (lamp && on > .01) slots[i].set(lamp.head.x, lamp.head.y - .25, lamp.head.z, 210);
        else slots[i].set(0, -1000, 0, 0);
      }
    },
    /** Our poles, for people and bicycles to walk round. */
    poles() { return lamps.filter(l => l.ours).map(l => l.base); },
    dispose() {
      for (const mesh of [poles, heads, glows]) mesh?.dispose();
      metal.dispose(); lens.dispose(); quad.dispose(); metalMaterial.dispose(); lensMaterial.dispose(); glow.dispose();
    },
  };
}
export type StreetLights = ReturnType<typeof createStreetLights>;
export { LAMP_SLOTS };
