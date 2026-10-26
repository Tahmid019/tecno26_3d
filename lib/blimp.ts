import * as THREE from 'three';

export type BlimpOptions = {
  textureUrl?: string;
  center?: { x: number; z: number }; // Center of the flight orbit
  radius?: number;                    // Orbit radius in metres
  altitude?: number;                  // Flying height in metres
  speed?: number;                     // Orbital speed (rad/s)
  scale?: number;                     // Size multiplier
};

export function createBlimp(options: BlimpOptions = {}) {
  const {
    textureUrl = '/assets/blimp_texture.png', // Path to your custom texture
    center = { x: -350, z: 200 },           // Central campus area
    radius = 320,
    altitude = 95,
    speed = 0.04,
    scale = 1.0,
  } = options;

  const group = new THREE.Group();
  group.name = 'Airship Blimp';

  // 1. Texture Loader
  const textureLoader = new THREE.TextureLoader();
  const hullTexture = textureLoader.load(textureUrl);
  hullTexture.colorSpace = THREE.SRGBColorSpace;
  hullTexture.wrapS = THREE.RepeatWrapping;
  hullTexture.wrapT = THREE.ClampToEdgeWrapping;

  // 2. Main Blimp Hull (Elongated aerodynamic ellipsoid)
  const hullGeo = new THREE.SphereGeometry(12, 32, 24);
  hullGeo.scale(1.0, 1.0, 2.8); // Stretch along Z to form the blimp body
  hullGeo.rotateY(Math.PI / 2); // Align forward along +Z

  const hullMat = new THREE.MeshStandardMaterial({
    map: hullTexture,
    roughness: 0.45,
    metalness: 0.1,
  });
  const hullMesh = new THREE.Mesh(hullGeo, hullMat);
  hullMesh.castShadow = true;
  group.add(hullMesh);

  // 3. Passenger Cabin / Gondola
  const gondolaGeo = new THREE.BoxGeometry(4.5, 3, 16);
  const gondolaMat = new THREE.MeshStandardMaterial({
    color: 0x22262a,
    roughness: 0.3,
    metalness: 0.6,
  });
  const gondola = new THREE.Mesh(gondolaGeo, gondolaMat);
  gondola.position.set(0, -11.5, -2);
  gondola.castShadow = true;
  group.add(gondola);

  // 4. Stabilizer Tail Fins (Top, Bottom, Left, Right)
  const finGeo = new THREE.BoxGeometry(0.4, 8, 9);
  const finMat = new THREE.MeshStandardMaterial({ color: 0xdd3333, roughness: 0.5 });

  const finTop = new THREE.Mesh(finGeo, finMat);
  finTop.position.set(0, 8.5, -24);
  const finBottom = new THREE.Mesh(finGeo, finMat);
  finBottom.position.set(0, -8.5, -24);
  const finLeft = new THREE.Mesh(finGeo, finMat);
  finLeft.rotation.z = Math.PI / 2;
  finLeft.position.set(-8.5, 0, -24);
  const finRight = new THREE.Mesh(finGeo, finMat);
  finRight.rotation.z = Math.PI / 2;
  finRight.position.set(8.5, 0, -24);

  group.add(finTop, finBottom, finLeft, finRight);
  group.scale.setScalar(scale);

  // Flight Orbit State
  let angle = 0;
  let time = 0;

  function update(elapsed: number) {
    time += elapsed;
    angle += speed * elapsed;

    // Circumscribe circle around center
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    
    // Gentle floating / bobbing up and down
    const y = altitude + Math.sin(time * 0.8) * 3.5;
    group.position.set(x, y, z);

    // Tangent heading facing forward in direction of flight
    const heading = -angle + Math.PI / 2;
    group.rotation.y = heading;

    // Subtle bank/roll into turns and pitch bobbing
    group.rotation.z = Math.sin(time * 0.5) * 0.03 + 0.05; // banking into turn
    group.rotation.x = Math.cos(time * 0.8) * 0.02;        // pitch wave
  }

  return { group, update };
}