import * as THREE from 'three';

/**
 * The administration building's glass, steel and cladding reflect the daylight
 * sky. Metal with no environment to reflect renders nearly black, which is how
 * the glass stair tower and the grey panels looked beside the drone photographs.
 */
const REFLECTIONS: [RegExp, number][] = [
  [/^Glass \|/, .9],
  [/^Vehicles \| tinted glass/, .8],
  [/^Site \| pond water/, .7],
  [/^Roof \| (aluminium|photovoltaic)/, .6],
  [/^Vehicles \| (silver paint|alloy rim)/, .6],
  [/^(Cladding|Columns|Railings|Frames) \|/, .55],
];

export function applyAdminMaterials(root: THREE.Object3D, environment: THREE.Texture) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const rule = REFLECTIONS.find(([pattern]) => pattern.test(material.name));
      if (!rule) continue;
      material.envMap = environment;
      material.envMapIntensity = rule[1];
      material.needsUpdate = true;
    }
  });
}
