
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type ComingSoonPlacement = {
  position: [number, number, number];
  rotation?: number;
  scale?: number | [number, number, number];
};

type PlacementFile = {
  objects: ComingSoonPlacement[];
};

export async function createComingSoon(
  loader: GLTFLoader,
  modelUrl: string,
  jsonUrl: string
) {
  const [gltf, response] = await Promise.all([
    loader.loadAsync(modelUrl),
    fetch(jsonUrl)
  ]);

  if (!response.ok) throw new Error(`Failed to load ${jsonUrl}`);

  const data = await response.json() as PlacementFile;
  const group = new THREE.Group();
  group.name = 'Coming Soon Objects';

  gltf.scene.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  for (const item of data.objects) {
    const object = gltf.scene.clone(true);
    object.position.set(...item.position);
    object.rotation.y = item.rotation ?? 0;

    const scale = item.scale ?? 1;
    if (typeof scale === 'number') {
      object.scale.setScalar(scale);
    } else {
      object.scale.set(...scale);
    }

    group.add(object);
  }

  return { group };
}
