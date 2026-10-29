import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type Tree = {
  position: number[];
  height: number;
  width: number;
  rotation?: number;
  kind?: string;
};

const TREE_MODELS = [
  '/trees/tree_lowpoly.glb',
  '/trees/tree_lowpoly2.glb',
];

type SourceMesh = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  local: THREE.Matrix4;
};

type TreeModel = {
  meshes: SourceMesh[];
  center: THREE.Vector3;
  minY: number;
  width: number;
  height: number;
};

let modelsPromise: Promise<TreeModel[]> | null = null;

function loadModels(): Promise<TreeModel[]> {
  if (!modelsPromise) {
    const loader = new GLTFLoader();

    modelsPromise = Promise.all(
      TREE_MODELS.map(async url => {
        const gltf = await loader.loadAsync(url);
        const root = gltf.scene;
        root.updateMatrixWorld(true);

        const bounds = new THREE.Box3().setFromObject(root);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const meshes: SourceMesh[] = [];
        const inverseRoot = root.matrixWorld.clone().invert();

        root.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;

          meshes.push({
            geometry: object.geometry,
            material: object.material,
            local: inverseRoot.clone().multiply(object.matrixWorld),
          });
        });

        return {
          meshes,
          center,
          minY: bounds.min.y,
          width: Math.max(size.x, size.z, 0.001),
          height: Math.max(size.y, 0.001),
        };
      })
    ).catch(error => {
      modelsPromise = null;
      throw error;
    });
  }

  return modelsPromise;
}

export function createTreeStand(
  trees: Tree[],
  name: string,
  _multisampled: boolean
) {
  const group = new THREE.Group();
  group.name = name;

  let disposed = false;

  void loadModels()
    .then(models => {
      if (disposed) return;

      trees.forEach((tree, index) => {
        const model = models[index % models.length];
        if (!model) return;
      });

      models.forEach((model, modelIndex) => {
        const indices = trees
          .map((tree, index) => ({ tree, index }))
          .filter(({ index }) => index % models.length === modelIndex);

        if (!indices.length) return;

        const normalization = new THREE.Matrix4().makeTranslation(
          -model.center.x,
          -model.minY,
          -model.center.z
        );

        model.meshes.forEach(source => {
          const instances = new THREE.InstancedMesh(
            source.geometry,
            source.material,
            indices.length
          );

          instances.name = `Tree model ${modelIndex + 1}`;
          instances.castShadow = true;
          instances.receiveShadow = true;

          indices.forEach(({ tree, index }, instanceIndex) => {
            const horizontalScale = tree.width / model.width;
            const verticalScale = tree.height / model.height;

            const transform = new THREE.Matrix4().compose(
              new THREE.Vector3(
                tree.position[0],
                tree.position[1],
                tree.position[2]
              ),
              new THREE.Quaternion().setFromEuler(
                new THREE.Euler(0, tree.rotation ?? index * 2.4, 0)
              ),
              new THREE.Vector3(
                horizontalScale,
                verticalScale,
                horizontalScale
              )
            );

            transform.multiply(normalization);
            transform.multiply(source.local);

            instances.setMatrixAt(instanceIndex, transform);
          });

          instances.instanceMatrix.needsUpdate = true;
          instances.computeBoundingSphere();
          group.add(instances);
        });
      });
    })
    .catch(error => {
      console.error('Failed to load campus tree models:', error);
    });

  return {
    group,
    setLeafy(_on: boolean) {
      group.visible = true;
    },
    update(_time: number) {},
    dispose() {
      disposed = true;
      group.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      group.clear();
    },
  };
}

export type TreeStand = ReturnType<typeof createTreeStand>;