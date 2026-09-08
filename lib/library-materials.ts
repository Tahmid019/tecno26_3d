import * as THREE from 'three';

/** A small, once-baked daylight environment is enough for the library's glazing. */
export function applyLibraryMaterials(root: THREE.Object3D, renderer: THREE.WebGLRenderer) {
  const environment = daylightEnvironment(renderer);
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial && material.name.startsWith('Library | ')) materials.add(material);
    }
  });

  for (const material of materials) {
    const name = material.name.slice('Library | '.length);
    // Cast bronze is metallic: with no environment to reflect it renders black.
    const bronze = name.startsWith('statue ');
    if (bronze || ['glass', 'silver', 'gold', 'plinth', 'solar', 'frame'].includes(name)) {
      material.envMap = environment.texture;
      material.envMapIntensity = name === 'glass' ? .9 : bronze ? .95 : .55;
    }
    if (name === 'glass') {
      // Opaque blue solar-control glazing: reflected daylight, without a costly
      // transmission pass or pretending that the unmodelled rooms are visible.
      material.color.set('#537b88');
      material.roughness = .19;
      material.metalness = .42;
    } else if (name === 'silver') {
      material.roughness = .38;
      material.metalness = .72;
    } else if (name === 'gold') {
      material.roughness = .38;
      material.metalness = .72;
    }
    if (['sandstone', 'ivory', 'terracotta', 'roof', 'path', 'asphalt', 'grass', 'plinth'].includes(name) && !material.map) {
      addMineralVariation(material, ['sandstone', 'ivory', 'terracotta'].includes(name));
    }
    material.needsUpdate = true;
  }
  return () => environment.dispose();
}

function daylightEnvironment(renderer: THREE.WebGLRenderer) {
  const capture = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(80, 24, 12);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const horizon = new THREE.Color('#d4e3e7');
  const zenith = new THREE.Color('#5d9bc7');
  const ground = new THREE.Color('#555d47');
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const height = position.getY(i) / 80;
    if (height >= 0) color.copy(horizon).lerp(zenith, Math.pow(height, .6));
    else color.copy(horizon).lerp(ground, Math.min(1, -height * 8));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  capture.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  // Broad cloud shapes leave soft, recognisable highlights across each pane.
  // They are captured only once; there are no extra draw calls in the game.
  const cloudGeometry = new THREE.SphereGeometry(1, 10, 6);
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: '#eef4ef' });
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.39996;
    for (let j = 0; j < 3; j++) {
      const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial);
      cloud.position.set(Math.cos(angle) * 42 + (j - 1) * 5, 15 + (i % 4) * 5 + (j % 2) * 2, Math.sin(angle) * 42);
      cloud.scale.set(7, 2.2 + (j % 2), 4.5);
      capture.add(cloud);
    }
  }
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(capture, .04, .1, 100, { size: 128 });
  generator.dispose();
  geometry.dispose();
  (capture.children[0] as THREE.Mesh).material instanceof THREE.Material &&
    ((capture.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  cloudGeometry.dispose();
  cloudMaterial.dispose();
  return target;
}

function addMineralVariation(material: THREE.MeshStandardMaterial, masonry: boolean) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vLibrarySurface;\nvarying vec3 vLibraryNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vLibrarySurface = (modelMatrix * vec4(position, 1.0)).xyz;
      vLibraryNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = `
      varying vec3 vLibrarySurface;
      varying vec3 vLibraryNormal;
      float libraryHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * .1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float libraryNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(libraryHash(i), libraryHash(i + vec2(1.0, 0.0)), f.x),
          mix(libraryHash(i + vec2(0.0, 1.0)), libraryHash(i + vec2(1.0)), f.x), f.y);
      }
      ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 libraryAxis = abs(vLibraryNormal);
      vec2 libraryUV = libraryAxis.y > max(libraryAxis.x, libraryAxis.z) ? vLibrarySurface.xz :
        (libraryAxis.x > libraryAxis.z ? vLibrarySurface.zy : vLibrarySurface.xy);
      float libraryStone = libraryNoise(libraryUV * .65) * .65 + libraryNoise(libraryUV * 22.0) * .35;
      diffuseColor.rgb *= .79 + libraryStone * .30;
      ${masonry ? `
      float libraryDamp = (1.0 - smoothstep(.15, 1.6, vLibrarySurface.y)) * (.3 + libraryNoise(libraryUV * vec2(1.7, .12)) * .7);
      diffuseColor.rgb *= 1.0 - libraryDamp * .22;
      float libraryRain = libraryNoise(libraryUV * vec2(6.0, .10));
      diffuseColor.rgb *= .96 + .045 * libraryRain;` : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + (libraryStone - .5) * .055, .12, 1.0);`);
  };
  material.customProgramCacheKey = () => `library-mineral-v1-${masonry ? 'masonry' : 'ground'}`;
}
