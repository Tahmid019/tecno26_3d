import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { PlayerPhysics, movementVector, CollisionWorld } from './physics';
import { createConcert, CONCERT } from './concert';
import { createAudience, bakeAudienceGeometry } from './audience';
import { createSky } from './sky';
import { LIBRARY, GALLERY, ADMIN, ADMIN_ROTATION, ADMIN_ROAD, CAMPUS_BOUNDS, LIBRARY_ROAD, onLibraryConnection, distanceToRoads, GATE } from './campus-layout';
import { applyLibraryMaterials } from './library-materials';
import { daylightAt, createSkyLight, hoursPerSecond, TIMES, clockLabel, type TimeName } from './daylight';
import { applyAdminMaterials } from './admin-materials';
import { createGrass, createGrassProbe, grassHeight } from './grass';
import { createDownloader, STAGES } from './assets';
import { createFleet, LOOKS, BIKE, BICYCLE_SPEED, BICYCLE_SPRINT, MOUNT_RANGE, type Bike } from './bicycle';
import { createRider, type RideState } from './rider';
import { poseBuffer, reach, setWorldPosition, turnAbout, turnWorld } from './rig';
import { settleArms, armsInFor } from './posture';
import { createCrowd, type Spot } from './npcs';
import { createAudio } from './audio';
import { Capsule } from 'three/addons/math/Capsule.js';
import { FollowCamera, FixedStep, CAMERA_PASSES_THROUGH } from './follow-camera';
import { createTreeStand, type Tree } from './trees';
import { createSurfaces } from './surfaces';
import { createStreetLights } from './streetlights';
import { pushOut, type Post } from './obstacles';
import { createComingSoon } from './comming_soon';

// ===========
import {
  joinCampus,
  sendPlayerMovement,
  leaveCampus,
} from "./multiplayer";

import {
  createRemotePlayers,
  type RemotePlayers,
} from "./remote-player";
// ===============

export const LANDMARKS = {
  gym: { label: 'Sports complex', x: -20, z: 67, yaw: 0 },
  football: { label: 'Football ground', x: 12, z: 135, yaw: Math.PI },
  cricket: { label: 'Cricket ground', x: -157, z: 149, yaw: 2.6 },
  courts: { label: 'Basketball courts', x: -13, z: 242, yaw: Math.PI },
  concert: { label: 'TECNOESIS concert', x: -28, z: 170, yaw: -Math.PI / 2 },
  library: { label: 'APJ Abdul Kalam Library', x: LIBRARY.entrance.x, z: LIBRARY.entrance.z - 5, yaw: 0 },
  gallery: { label: 'Lecture gallery', x: GALLERY.entrance.x, z: GALLERY.entrance.z - 15, yaw: Math.PI },
  admin: { label: 'Administration building', x: ADMIN.entrance.x, z: ADMIN.entrance.z, yaw: ADMIN_ROTATION },
  gate: { label: 'Main Gate', x: GATE.x, z: GATE.z, yaw: 0 }
} as const;
export type Landmark = keyof typeof LANDMARKS;
export type Quality = 'performance' | 'balanced' | 'high';
export type GameState = { ready: boolean; playing: boolean; progress: string; error: string; fps: number; location: string; x: number; z: number; motion: string; percent: number; outerPercent: number; outerReady: boolean; runLock: boolean; riding: boolean; canMount: boolean; y?: number; grounded?: boolean; overview?: boolean; quality?: Quality; draws?: number; triangles?: number; animationTime?: number; crowdCount?: number; sound?: boolean; time?: string; timeMode?: TimeName; speed?: number };
export type Game = { setPlaying: (value: boolean) => void; reset: () => void; dispose: () => void; travel: (id: Landmark) => void; overview: () => void; setQuality: (q: Quality) => void; input: (key: string, pressed: boolean) => void; move: (x: number, y: number) => void; toggleRun: () => void; toggleRide: () => void; setSound: (on: boolean) => void; bell: () => void; setTime: (mode: TimeName) => void; getState: () => GameState; getMultiplayerSnapshot: () => MultiplayerSnapshot; };


// =========
export type MultiplayerSnapshot = {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  animation: string;
};
//=============


type TreeFile = { trees: Tree[]; roads: number[][][] };
/** Ground speed of the Walk and Run clips, measured from the planted foot. Playing
 * them at these speeds keeps the shoes from skating over the ground. */
const WALK_CLIP_SPEED = 1.39, RUN_CLIP_SPEED = 4.8;
const WALK_SPEED = 1.9, RUN_SPEED = 5.5;

// The character ships with Walk, Run and Idle and nothing else, so leaving the
// ground looked like the idle pose sliding upwards. These are local rotations
// laid over each bone's bind orientation, blended in by weight.
const AIR_POSE: Record<string, [number, number, number]> = {
  Hips: [.14, 0, 0], Spine02: [-.10, 0, 0],
  LeftUpLeg: [-.62, .05, 0], RightUpLeg: [-.88, -.05, 0],
  LeftLeg: [.95, 0, 0], RightLeg: [1.30, 0, 0],
  LeftFoot: [-.30, 0, 0], RightFoot: [-.34, 0, 0],
  LeftShoulder: [0, 0, -.10], RightShoulder: [0, 0, .10],
  LeftArm: [-.70, 0, .55], RightArm: [-.70, 0, -.55],
  LeftForeArm: [.75, 0, 0], RightForeArm: [.75, 0, 0],
};

function createStylizedWater(
  scene: THREE.Scene,
  terrain: THREE.Object3D,
  waterY: number
) {
  terrain.updateWorldMatrix(true, true);

  // Fit the water plane to the terrain's world-space bounds.
  const bounds = new THREE.Box3().setFromObject(terrain);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  // Extend the water beyond the island to hide its rectangular edges.
  const margin = Math.max(size.x, size.z) * 0.75;

  const geometry = new THREE.PlaneGeometry(
    Math.max(size.x + 2 * margin, 10),
    Math.max(size.z + 2 * margin, 10)
  );

  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color("#103d52") },
      uShallow: { value: new THREE.Color("#398c91") },
      uHighlight: { value: new THREE.Color("#b7e9d9") }
    },

    vertexShader: `
      varying vec3 vWorldPosition;

      void main() {
        vec4 worldPos =
          modelMatrix * vec4(position, 1.0);

        vWorldPosition = worldPos.xyz;

        gl_Position =
          projectionMatrix * viewMatrix * worldPos;
      }
    `,

    fragmentShader: `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uHighlight;

      varying vec3 vWorldPosition;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise21(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));

        return mix(
          mix(a, b, f.x),
          mix(c, d, f.x),
          f.y
        );
      }

      void main() {
        // World-space coordinates prevent texture swimming.
        vec2 p = vWorldPosition.xz * 0.035;

        float n = noise21(
          p * 2.0 +
          vec2(uTime * 0.06, -uTime * 0.04)
        );

        float w1 = sin(
          p.x * 5.0 + p.y * 2.0 +
          uTime * 0.65 + n * 1.5
        );

        float w2 = sin(
          p.y * 6.0 - p.x * 1.5 -
          uTime * 0.4
        );

        float wave = 0.5 + 0.5 * sin(
          p.x * 2.0 + p.y * 3.0 +
          uTime * 0.25
        );

        float highlights = smoothstep(
          1.25, 1.85, w1 + w2
        );

        vec3 color = mix(
          uDeep,
          uShallow,
          clamp(0.25 + 0.45 * n + 0.2 * wave, 0.0, 1.0)
        );

        color = mix(
          color,
          uHighlight,
          highlights * 0.28
        );

        gl_FragColor = vec4(color, 0.92);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,

    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const waterMesh = new THREE.Mesh(geometry, material);

  waterMesh.name = "Procedural Water";
  waterMesh.position.set(center.x, waterY, center.z);
  waterMesh.renderOrder = 1;

  scene.add(waterMesh);

  return { mesh: waterMesh, material };
}
export async function createGame(host: HTMLDivElement, onState: (s: GameState) => void): Promise<Game> {
  const state: GameState = { ready: false, playing: false, progress: 'Downloading the campus', error: '', fps: 0, location: 'Sports complex', x: -20, z: 67, motion: 'Idle', percent: 0, outerPercent: 0, outerReady: false, runLock: false, riding: false, canMount: false, quality: 'balanced', overview: false, sound: true, time: '16:30', timeMode: 'auto' };
  const audio = createAudio();
  const publish = () => onState({ ...state });
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#bdd7df'); const campusFog = new THREE.Fog('#bdd7df', 240, 700); scene.fog = campusFog;
  const mobile = matchMedia('(pointer:coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.4 : 1.25)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  const canvas = renderer.domElement; host.appendChild(canvas); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Campus: click or drag to look, on-screen pad to move');
  const camera = new THREE.PerspectiveCamera(58, 1, .08, 4000);
  camera.position.set(115, 145, -50); camera.lookAt(-75, 0, 120);
  const hemi = new THREE.HemisphereLight(0xd8efff, 0x68794c, 1.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.4); sun.position.set(220, 265, -480); scene.add(sun);
  // The whole campus casts soft shadows from wherever the sun, or the moon, is.
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  let shadowSpan = mobile ? 64 : 86, shadowSize = mobile ? 1024 : 1536;
  sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(sun.shadow.camera, { left: -shadowSpan, right: shadowSpan, top: shadowSpan, bottom: -shadowSpan, near: 1, far: 360 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.0002;
  scene.add(sun.target);
  // The shadow map follows the student in whole texels of its own grid.
  // Sliding it by fractions of a texel made every shadow edge crawl on the move.
  const sunward = new THREE.Vector3(63, 76, -138).normalize(), sunAcross = new THREE.Vector3(), sunAlong = new THREE.Vector3();
  const setLightDirection = (direction: THREE.Vector3) => {
    sunward.copy(direction);
    sunAcross.crossVectors(new THREE.Vector3(0, 1, 0), sunward).normalize(); sunAlong.crossVectors(sunward, sunAcross);
    // Across one shadow-map texel, flat ground drops away from a low light by
    // the texel's width over the tangent of its height: twice over at 27
    // degrees, four times near sunset. The normal offset has to clear that and
    // the filter's footprint, or paving and roofs break into moire rings.
    const slope = THREE.MathUtils.clamp(Math.hypot(sunward.x, sunward.z) / Math.max(sunward.y, 1e-3), 2, 4);
    sun.shadow.normalBias = 1.65 * 2 * shadowSpan / shadowSize * slope / 2;
  };
  setLightDirection(sunward.clone());
  const aimSun = (at: THREE.Vector3) => {
    const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel;
    sun.target.position.copy(sunAcross).multiplyScalar(snap(at.dot(sunAcross))).addScaledVector(sunAlong, snap(at.dot(sunAlong))).addScaledVector(sunward, at.dot(sunward));
    sun.position.copy(sun.target.position).addScaledVector(sunward, 170); sun.target.updateMatrixWorld();
  };
  // Sky, sky light and sun all follow the same clock; the sky's horizon is the
  // fog's own colour, so distant ground sinks into it seamlessly.
  const sky = createSky(renderer); scene.add(sky.group);
  const skyLight = createSkyLight(renderer);
  // Weathering and joints on the plain-coloured buildings, lamp light at night.
  const surfaces = createSurfaces({ lite: mobile });
  let hours = 16.5;
  const dayState = daylightAt(hours);
  const size = () => { renderer.setSize(host.clientWidth, host.clientHeight); camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(size); observer.observe(host); size();
  const keys = new Set<string>(); let disposed = false, frame = 0; const disposeDaylight = () => { skyLight.dispose(); surfaces.dispose(); };
  const cleanupResources = () => { observer.disconnect(); scene.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) { for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose(); m.dispose(); } } }); disposeDaylight(); renderer.dispose(); renderer.domElement.remove(); };
  try {
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const download = createDownloader(({ campus: campusPercent, outer: outerPercent }) => {
      if (campusPercent !== state.percent || outerPercent !== state.outerPercent) {
        state.percent = campusPercent; state.outerPercent = outerPercent; publish();
      }
    });

    const comingSoon = await createComingSoon(
      loader,
      '/assets/comming_soon.glb',
      '/assets/comming_soon.json'
    );

    scene.add(comingSoon.group);

    // Everything needed to stand on the ground and walk comes first; the
    // library follows in the background while the campus is already playable.
    const [campusBytes, collisionBytes, studentBytes, treeBytes, npcBytes, crowdBytes] =
      await Promise.all(STAGES.campus.map(url => download.get(url)));
    state.progress = 'Building the campus'; publish();
    // A timer, not a frame: a phone that is switched away mid-load gets no
    // animation frames at all, and the build would stall until it came back.
    await new Promise(resolve => setTimeout(resolve, 0));

    const cameraMeshes: THREE.Mesh[] = [], cameraObstacles: THREE.Mesh[] = [];
    const solidForCamera = (o: THREE.Mesh) => { cameraMeshes.push(o); if (!CAMERA_PASSES_THROUGH.test((o.material as THREE.Material).name || '')) cameraObstacles.push(o); };
    const prepare = (root: THREE.Object3D) => {
      root.traverse(o => {
        if (o instanceof THREE.Mesh) {
          computeBoundsTree.call(o.geometry); o.raycast = acceleratedRaycast; solidForCamera(o);
          const m = o.material as THREE.MeshStandardMaterial;
          if (m.map) m.map.anisotropy = Math.min(mobile ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
          if (m.name.includes('full-pitch chalk')) m.color.set('#c5cbb2');
        }
      }); surfaces.apply(root);
    };

    const campus = await loader.parseAsync(campusBytes, '');
    campus.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(campus.scene); campus.scene.updateMatrixWorld(true);
    campus.scene.visible = false;
    prepare(campus.scene);
    const area = await loader.loadAsync('/assets/campus_area.glb');
    area.scene.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(area.scene); area.scene.updateMatrixWorld(true); prepare(area.scene);
    const concert = createConcert(); scene.add(concert.root); state.crowdCount = concert.crowdCount;
    concert.root.updateMatrixWorld(true); concert.root.traverse(o => { if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !(o.material as THREE.Material).transparent) { computeBoundsTree.call(o.geometry); o.raycast = acceleratedRaycast; solidForCamera(o); } });

    const areaCol = await loader.loadAsync('/assets/campus_coll.glb');
    // Added in water plane here
    const water = createStylizedWater(scene, area.scene, -1); // Tune waterY to sit just below ground level
    const colliders = new THREE.Group();
    colliders.add((await loader.parseAsync(collisionBytes, '')).scene, concert.colliders, areaCol.scene);
    const world = new CollisionWorld(colliders);
    const physics = new PlayerPhysics(world); physics.teleport(-20, .6, 67);
    // What can be seen cannot be walked through. The walkable meshes leave out
    // hedges, nets, parked cars and scooters, lamp posts, bins, columns and
    // a few walls, so their own drawn surfaces are solid as well. The player
    // stands on and bumps into them; the ground probes for people, grass and
    // lamps keep to the walkable world.
    const SOLID = /hedge|netting|^Vehicles \||^Two-wheelers \||bins?\b|wheelie|^Columns \||streetlight metal|^Library \| (glass|frame|terracotta|trunk|silver)|^Gallery \| frame|^SC • (Dull galvanized metal|Damp stained terrace concrete|Weathered light-painted frames|Faded jade entrance canopy|Aged ivory exterior plaster|Dark recesses and painted door panels)|^Campus \| green|navy letters|fire pipes|^Railings \||AC fan grille|^Concert \| (truss|deck skirt)/;
    const solidGroup = new THREE.Group();
    const addSolids = (root: THREE.Object3D) => {
      root.updateMatrixWorld(true); root.traverse(o => {
        if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || !SOLID.test((o.material as THREE.Material).name || '')) return;
        const copy = new THREE.Mesh(o.geometry); copy.matrixAutoUpdate = false; copy.matrix.copy(o.matrixWorld); solidGroup.add(copy);
      });
    };
    addSolids(campus.scene); addSolids(concert.root);
    // ---- Ending gate: placed from /assets/ending_gate.json ----
    type Placement = { position: [number, number, number]; rotation?: number | [number, number, number]; scale?: number | [number, number, number] };
    const gateGroup = new THREE.Group(); gateGroup.name = 'Ending gate';
    try {
      const [glbBytes, placementFile] = await Promise.all([
        fetch('/assets/tecnogate_emit.glb').then(r => { if (!r.ok) throw new Error(`tecnogate_emit.glb ${r.status}`); return r.arrayBuffer(); }),
        fetch('/assets/ending_gate.json').then(r => { if (!r.ok) throw new Error(`ending_gate.json ${r.status}`); return r.json(); }),
      ]);
      const gateGltf = await loader.parseAsync(glbBytes, '');
      for (const p of (placementFile.objects ?? []) as Placement[]) {
        const copy = gateGltf.scene.clone(true);
        copy.position.set(p.position[0], p.position[1], p.position[2]);
        if (Array.isArray(p.rotation)) copy.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
        else copy.rotation.y = p.rotation ?? 0;                     // number = yaw in radians
        if (Array.isArray(p.scale)) copy.scale.set(p.scale[0], p.scale[1], p.scale[2]);
        else copy.scale.setScalar(p.scale ?? 1);                  // number = uniform scale
        gateGroup.add(copy);
      }
      gateGroup.updateMatrixWorld(true);
      gateGroup.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(gateGroup);
      prepare(gateGroup);   // BVH raycast, camera collision, anisotropy, surface materials
      // Make every gate mesh solid for the player (addSolids only takes SOLID-regex names).
      gateGroup.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        const c = new THREE.Mesh(o.geometry); c.matrixAutoUpdate = false; c.matrix.copy(o.matrixWorld); solidGroup.add(c);
      });
    } catch (e) { console.error('[Ending gate] failed to load:', e); }
    const solids = new CollisionWorld(solidGroup); physics.extra.push(solids);

    const student = await loader.parseAsync(studentBytes, '');
    const avatar = new THREE.Group(); avatar.add(student.scene); scene.add(avatar);
    student.scene.traverse(o => { if (o instanceof THREE.Mesh) o.frustumCulled = false; });
    surfaces.apply(student.scene, 'lamps');
    const mixer = new THREE.AnimationMixer(student.scene); const actions = Object.fromEntries(student.animations.map(c => [c.name, mixer.clipAction(c)]));
    let action = actions.Idle; action.play(); mixer.update(0); avatar.position.copy(physics.feet);

    // Each clip parks the hips at its own height, so the idle pose left the
    // shoes hanging above the ground. Measure the lowest toe in every clip and
    // drop the model by that much, which also keeps the capsule truly grounded.
    const toes = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot']
      .map(n => student.scene.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    const planted: Record<string, number> = {};
    {
      const probe = new THREE.Vector3();
      for (const [name, clip] of Object.entries(actions)) {
        for (const other of Object.values(actions)) other.stop();
        clip.reset().play();
        let lowest = Infinity; const duration = clip.getClip().duration || 1;
        for (let i = 0; i < 18; i++) {
          mixer.setTime(duration * i / 18); student.scene.updateMatrixWorld(true);
          for (const toe of toes) lowest = Math.min(lowest, toe.getWorldPosition(probe).y - avatar.position.y);
        }
        planted[name] = Number.isFinite(lowest) ? THREE.MathUtils.clamp(.025 - lowest, -.16, .12) : 0;
      }
      for (const other of Object.values(actions)) other.stop();
      action = actions.Idle; action.reset().play(); mixer.setTime(0);
    }
    let plantOffset = planted.Idle ?? 0;

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.43, 20), new THREE.MeshBasicMaterial({ color: 0x15261b, transparent: true, opacity: .24, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

    const treeFile = JSON.parse(new TextDecoder().decode(treeBytes)) as TreeFile;
    const roads = treeFile.roads ?? [];
    // Planting seeds occasionally dropped a trunk on the carriageway. Anything
    // whose trunk sits inside the road corridor is removed here for good.
    const trees = treeFile.trees.filter(t =>
      !onLibraryConnection(t.position[0], t.position[2], t.width * .45 + 6.4)
      && distanceToRoads(t.position[0], t.position[2], roads) > 4.9);
    const stand = createTreeStand(trees, 'Campus trees', !mobile); scene.add(stand.group);
    // Leafy trees cost about a millisecond more than the simple ones on a
    // desktop, so they grow at Balanced too; phones keep them for High.
    const leafyAt = (q: Quality | undefined) => q === 'high' || (q === 'balanced' && !mobile);
    stand.setLeafy(leafyAt(state.quality)); surfaces.apply(stand.group);
    const trunkCollisions = new THREE.Group();
    for (const t of trees) { if (t.height < 3) continue; const o = new THREE.Mesh(new THREE.BoxGeometry(Math.max(.25, t.width * .07), 2.6, Math.max(.25, t.width * .07))); o.position.set(t.position[0], 1.3 + t.position[1], t.position[2]); trunkCollisions.add(o); }
    const treeWorld = new CollisionWorld(trunkCollisions);
    trunkCollisions.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });

    // Living grass is planted by sampling the lawn surfaces downwards and
    // rejecting anything the walkable collision tree already covers, so it
    // never appears on roads, courts, stages, steps or under buildings.
    const lawns = cameraMeshes.filter(o => grassHeight((o.material as THREE.Material).name || '') > 0);
    const probeRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const groundHeight = (x: number, z: number) => { probeRay.origin.set(x, 70, z); const hit = world.rayIntersect(probeRay); return hit ? hit.position.y : null; };
    let grassProbe = createGrassProbe(lawns, groundHeight);
    const grass = createGrass((x, z) => grassProbe(x, z));
    scene.add(grass.group);

    // Bicycles wait in racks by the buildings. Any free one can be ridden;
    // the rider is fitted to it by inverse kinematics every frame.
    const fleet = createFleet(48); scene.add(fleet.group); surfaces.apply(fleet.group, 'lamps');
    const groundAt = (x: number, z: number, from = 12) => { const hit = world.rayIntersect(new THREE.Ray(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0))); return hit ? hit.position.y : 0; };
    const rack = (x: number, z: number, heading: number, count: number, first = 0, spacing = .8) => {
      const across = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      for (let i = 0; i < count; i++) {
        const at = new THREE.Vector3(x, 0, z).addScaledVector(across, (i - (count - 1) / 2) * spacing); at.y = groundAt(at.x, at.z);
        const bike = fleet.add(LOOKS[(first + i) % LOOKS.length], at, heading); bike.lean = .1; bike.steer = .3;
      }
    };
    rack(-22.4, 69.3, .7, 3);
    const rider = createRider(student.scene);

    // ======================
    let remotePlayers: RemotePlayers | null = null;
    let multiplayerRoom: Awaited<ReturnType<typeof joinCampus>> | null = null;
    let syncElapsed = 0;

    try {
      multiplayerRoom = await joinCampus();

      remotePlayers = createRemotePlayers(
        scene,
        multiplayerRoom,
        student.scene,
        student.animations,
        fleet,
      );
    } catch (error) {
      console.error("[Multiplayer] Initialization failed:", error);
    }
    //========================

    // Other students: walkers on the road verges, groups outside the buildings
    // and cyclists keeping left, all drawn from a lighter copy of the student.
    const npcModel = (await loader.parseAsync(npcBytes, '')).scene;
    let studentSkin: THREE.Texture | null = null;
    student.scene.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (!studentSkin && m?.map) studentSkin = m.map; });
    const crowd = createCrowd({
      model: npcModel, clips: student.animations, map: studentSkin, fleet, ground: (x, z, from) => groundAt(x, z, from), planted,
      onBell: (x, z) => { const dx = x - camera.position.x, dz = z - camera.position.z; const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); audio.bellFrom(Math.hypot(dx, dz), (dx * right.x + dz * right.z) / Math.max(1, Math.hypot(dx, dz))); },
      // Someone shoved or knocked flat: a thud, a jolt, and from a bicycle at
      // a sprint the rider goes down too.
      onHit: (kind, x, z, speed) => { if (kind === 'down') { audio.land('hard', .9); shake = Math.max(shake, .25); crowd.alarm(x, avatar.position.y, z); if (state.riding && speed > 9) pendingCrash = speed; } else audio.bump(); }
    });
    scene.add(crowd.group); for (const m of crowd.materials) surfaces.patch(m, 'lamps');
    // The TECNOESIS audience and band: the student posed and baked a dozen
    // ways, one instanced draw for everyone, moving with the music.
    const audience = createAudience({
      geometry: bakeAudienceGeometry((await loader.parseAsync(crowdBytes, '')).scene, student.animations.find(c => c.name === 'Idle')!, planted.Idle ?? 0),
      map: studentSkin, crowd: concert.audience, band: concert.band
    });
    concert.root.add(audience.mesh, audience.guitars); surfaces.patch(audience.material, 'lamps'); surfaces.patch(audience.guitarPaint, 'lamps');
    const allRoads: number[][][] = [...roads, LIBRARY_ROAD.map(p => [p[0], p[1]]), ADMIN_ROAD];
    crowd.addRoutes(roads, roads);
    // Open, level ground near a landmark, off the roads and clear of walls,
    // for a group to stand on or a rack of bicycles to wait on.
    const taken: THREE.Vector2[] = [new THREE.Vector2(-22.4, 69.3)];
    const clearing = (x: number, z: number, near: number, far: number, radius: number) => {
      const base = groundHeight(x, z) ?? 0;
      for (let r = near; r <= far; r += 1.5)for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2 + r * .37, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (distanceToRoads(px, pz, allRoads) < 5.5 || taken.some(t => t.distanceTo(new THREE.Vector2(px, pz)) < radius + 2.5)) continue;
        const y = groundHeight(px, pz); if (y === null || Math.abs(y - base) > .6) continue;
        if ([[radius, 0], [-radius, 0], [0, radius], [0, -radius]].some(([dx, dz]) => { const yy = groundHeight(px + dx, pz + dz); return yy === null || Math.abs(yy - y) > .22; })) continue;
        const probe = new Capsule(new THREE.Vector3(px, y + .35 + radius, pz), new THREE.Vector3(px, y + 1.75, pz), radius);
        if (world.capsuleIntersect(probe) || treeWorld.capsuleIntersect(probe) || solids.capsuleIntersect(probe)) continue;
        taken.push(new THREE.Vector2(px, pz));
        return { x: px, z: pz };
      }
      return null;
    };
    /** A chatting group and, optionally, a rack of bicycles by a landmark. */
    const gather = (x: number, z: number, members: number, bikes: number, first: number) => {
      const spots: Spot[] = [];
      const place = clearing(x, z, 4, 13, 1.1);
      if (place) spots.push({ x: place.x, z: place.z, members, facing: Math.atan2(x - place.x, z - place.z) });
      // Racks need more room than a group; a crowded forecourt pushes them a little further out.
      if (bikes) { const at = clearing(x, z, 6, 16, bikes * .42) ?? clearing(x, z, 16, 28, bikes * .42); if (at) rack(at.x, at.z, Math.atan2(x - at.x, z - at.z), bikes, first); }
      crowd.addSpots(spots);
    };
    gather(-20, 67, 3, 0, 0); gather(-13, 242, 3, 4, 2); gather(-157, 149, 4, 3, 4); gather(12, 135, 2, 0, 0);
    // Street lights stand on the verges, never on a carriageway, a court or a
    // roof, in a wall or a tree, or where a group or a rack already is.
    const surfaceRay = new THREE.Raycaster(); surfaceRay.firstHitOnly = true;
    const surfaceAt = (x: number, z: number) => { surfaceRay.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0)); surfaceRay.far = 120; const hit = surfaceRay.intersectObjects(cameraMeshes, false)[0]; return hit ? ((hit.object as THREE.Mesh).material as THREE.Material).name || '' : ''; };
    const streetLights = createStreetLights({
      ground: groundHeight, blocked: (x, z, y) => {
        if (distanceToRoads(x, z, allRoads) < 4.4 || taken.some(t => Math.hypot(t.x - x, t.y - z) < 3.5)) return true;
        if (/asphalt|road|lane|markings|kerb|water|pond|roof|court|pitch|chalk|track|clay|stage|step|stair/i.test(surfaceAt(x, z))) return true;
        const probe = new Capsule(new THREE.Vector3(x, y + .45, z), new THREE.Vector3(x, y + 3.2, z), .32);
        return !!world.capsuleIntersect(probe) || !!treeWorld.capsuleIntersect(probe) || !!solids.capsuleIntersect(probe);
      }
    });
    scene.add(streetLights.group); surfaces.apply(streetLights.group, 'lamps');
    {
      const glass: THREE.Mesh[] = [];
      campus.scene.traverse(o => { if (o instanceof THREE.Mesh && /streetlight glass/i.test((o.material as THREE.Material).name)) glass.push(o); });
      streetLights.adopt(glass);
    }
    streetLights.plant(roads, 5.3);
    streetLights.addLights(concert.washes.map(p => concert.root.localToWorld(p.clone())));
    // Lamp posts and parked bicycles are solid to walk and ride into.
    let lampPosts: Post[] = streetLights.poles().map(b => ({ x: b.x, y: b.y, z: b.z, r: .14 }));
    const bikePosts: Post[] = [];
    // The mixer only writes a bone when its animated value changes, so a pose
    // laid on top last frame would survive on any bone the clip holds still,
    // and the next frame's lean would stack on it. Every frame starts again
    // from the clean animated pose.
    const skeletonBones: THREE.Object3D[] = []; student.scene.traverse(o => { if ((o as THREE.Bone).isBone) skeletonBones.push(o); });
    const animated = poseBuffer(skeletonBones); animated.save();
    let myBike: Bike | null = null, rideBike: Bike | null = null;
    // Getting on and off: walk round to the bicycle's left, take the bars,
    // swing a leg over and sit; and the same back, after braking to a stop.
    type Transition = { kind: 'approach' | 'mount' | 'dismount'; bike: Bike; t: number; clicked: boolean };
    let transition: Transition | null = null, stopToDismount = false;
    const MOUNT_TIME = 1.05, DISMOUNT_TIME = .9, beside = new THREE.Vector3();
    /** Where to stand to get on: beside the saddle, on the bicycle's left. */
    const besideBike = (bike: Bike, out: THREE.Vector3) => out.set(bike.position.x + (Math.cos(bike.heading) * .52 - Math.sin(bike.heading) * .12) * bike.scale, bike.position.y, bike.position.z + (-Math.sin(bike.heading) * .52 - Math.cos(bike.heading) * .12) * bike.scale);
    // Jumping: a press is remembered for a moment and the ground for a moment
    // after running off it, so no jump is lost to a frame early or late. The
    // knees bend before a standing jump, and on landing by how hard it was.
    let crouching = -1, crouchSquash = 0, landAge = 9, landPeak = 0, fallSpeed = 0, airTime = 0, coyote = 0, jumpBuffer = 0, squash = 0;
    // A bicycle's own speed: pedalling builds it over a second or two,
    // letting go coasts it down slowly and the brakes stop it quickly.
    let bikeSpeed = 0;
    // Thrown off a crashed bicycle: seconds since, or -1; a moment winded
    // after a hard landing; the camera's jolt.
    let crash = -1, stun = 0, shake = 0, pendingCrash = 0;
    const falling: { bike: Bike; lean: number }[] = [];
    /** Tips a bicycle over onto its side, the way it was leaning. */
    const topple = (bike: Bike) => { if (falling.some(f => f.bike === bike)) return; bike.stand = 0; falling.push({ bike, lean: (bike.lean >= 0 ? 1 : -1) * 1.42 }); };
    const tumble = new THREE.Quaternion(), tumbleAxis = new THREE.Vector3(), hipsPivot = new THREE.Vector3(0, .95, 0), pivotTurned = new THREE.Vector3();
    const squashFeet = [new THREE.Vector3(), new THREE.Vector3()], squashTurn = [new THREE.Quaternion(), new THREE.Quaternion()], squashNow = new THREE.Quaternion();
    const bodyForward = new THREE.Vector3(), bodyLeft = new THREE.Vector3(), hipsAt = new THREE.Vector3(), kneePole = new THREE.Vector3(), upright = new THREE.Vector3(0, 1, 0);
    const rideState: RideState = { standing: 0, footDown: 0, turn: 0, ground: 0, mount: 1 };
    const bind = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const name of Object.keys(AIR_POSE)) {
      const bone = student.scene.getObjectByName(name);
      if (bone) bind.set(bone, bone.quaternion.clone());
    }
    const poseStep = new THREE.Euler(), poseSpin = new THREE.Quaternion(), poseTarget = new THREE.Quaternion();
    let ride = 0, air = 0, offGround = 0, rideHeading = 0, coastingNow = false;
    const stepFeet = [student.scene.getObjectByName('LeftFoot')!, student.scene.getObjectByName('RightFoot')!], stepArmed = [true, true], stepPoint = new THREE.Vector3();
    // Each foot's lowest recent height, which settles to whatever the gait is,
    // marks it coming down; the two feet of the clips bottom out differently.
    const stepFloor = [.14, .14];

    let yaw = 0, pitch = .26, distance = mobile ? 6.2 : 5.4, drag = false, hasStarted = false, stickX = 0, stickY = 0;
    // The thumb stick runs only from right against its rim, and a thumb
    // resting near that line must not flicker in and out of a sprint.
    let stickRun = false, steering = 0;
    let prev = performance.now(), acc = 0, frames = 0, lastJump = false, eventTime = 0;
    let shadowPrimed = false, shadowAge = 0, castingLive: boolean | null = null; const shadowCentre = new THREE.Vector3(), shadowAhead = new THREE.Vector3(), shadowAim = new THREE.Vector3();
    const camRay = new THREE.Raycaster(); camRay.firstHitOnly = true;
    const rig = new FollowCamera((origin, ray, far) => { camRay.set(origin, ray); camRay.far = far; const hit = camRay.intersectObjects(cameraObstacles, false)[0]; return hit ? hit.distance : null; });
    const direction = new THREE.Vector3(), zero = new THREE.Vector3(), probePoint = new THREE.Vector3(), apart2 = new THREE.Vector3(), apart3 = new THREE.Vector3(), apart4 = new THREE.Vector3();
    const follow = (dt: number, snap = false) => {
      rig.update(dt, avatar.position, 1.3 + .25 * ride - squash * .45, yaw, pitch, distance, snap);
      camera.position.copy(rig.position); camera.lookAt(rig.target);
      // The view widens with speed, as in a driving game, and jolts on hard
      // landings, crashes and collisions.
      const fov = 58 + THREE.MathUtils.clamp((Math.hypot(physics.velocity.x, physics.velocity.z) - 4.5) / 7, 0, 1) * 8;
      if (Math.abs(camera.fov - fov) > .05) { camera.fov += (fov - camera.fov) * (snap ? 1 : 1 - Math.exp(-dt * 3)); camera.updateProjectionMatrix(); }
      if (shake > .002 && !snap) { camera.position.x += (Math.random() - .5) * shake * .28; camera.position.y += (Math.random() - .5) * shake * .28; camera.position.z += (Math.random() - .5) * shake * .28; shake *= Math.exp(-dt * 7); }
      avatar.visible = camera.position.distanceTo(rig.target) > 1;
    };
    // The student is drawn between the last two physics steps, never at one.
    const stepper = new FixedStep(1 / 120, 12);
    const lastFeet = physics.feet, nextFeet = physics.feet;
    // Kerbs and steps lift the body over a few frames, as legs and tyres take
    // them, rather than in a single jump: the height drawn, eased after the physics.
    let drawnY = Number.NaN;
    const settle = () => { stepper.reset(); lastFeet.copy(physics.feet); nextFeet.copy(lastFeet); avatar.position.copy(lastFeet); drawnY = Number.NaN; };
    const setPlaying = (v: boolean) => { if (!state.ready && v) return; if (!v && document.pointerLockElement === canvas) document.exitPointerLock?.(); if (v) audio.start(); state.playing = v; state.overview = false; scene.fog = campusFog; camera.up.set(0, 1, 0); sky.group.visible = true; keys.clear(); state.runLock = false; stickX = 0; stickY = 0; drag = false; if (v) { hasStarted = true; follow(0, true); canvas.focus(); } publish(); };
    const travel = (id: Landmark) => { const p = LANDMARKS[id]; if (!p) throw new Error('Unknown campus destination'); audio.start(); if (['library', 'gallery', 'admin'].includes(id) && !state.outerReady) return; const floor = world.rayIntersect(new THREE.Ray(new THREE.Vector3(p.x, 10, p.z), new THREE.Vector3(0, -1, 0))); physics.teleport(p.x, (floor ? floor.position.y : 0) + .015, p.z); settle(); yaw = p.yaw; pitch = ['library', 'gallery', 'admin'].includes(id) ? -.16 : id === 'concert' ? -.06 : .26; avatar.rotation.y = yaw + Math.PI; if (state.riding || transition) parkBicycle(); crash = -1; stun = 0; scene.fog = campusFog; camera.up.set(0, 1, 0); sky.group.visible = true; state.location = p.label; state.x = p.x; state.y = avatar.position.y; state.z = p.z; state.grounded = false; state.overview = false; state.playing = true; state.runLock = false; stickX = 0; stickY = 0; hasStarted = true; keys.clear(); drag = false; follow(0, true); publish(); canvas.focus(); };
    const reset = () => travel('gym');
    const overview = () => { if (document.pointerLockElement === canvas) document.exitPointerLock?.(); state.playing = false; state.overview = true; keys.clear(); state.runLock = false; avatar.visible = true; scene.fog = null; sky.group.visible = false; const height = Math.max(650, 1250 / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))); camera.up.set(0, 0, 1); camera.position.set(-495, height, 200); camera.lookAt(-495, 0, 200); publish(); };
    // High draws the leafy trees; the other settings keep the cheap ones.
    const stands = [stand];
    // High draws a larger, finer shadow map; Performance a smaller one.
    const configureShadows = (q: Quality) => {
      const [span, size] = q === 'high' ? [mobile ? 80 : 110, mobile ? 1536 : 2048] : q === 'balanced' ? [mobile ? 64 : 86, mobile ? 1024 : 1536] : [60, 1024];
      if (span === shadowSpan && size === shadowSize) return;
      shadowSpan = span; shadowSize = size;
      sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null;
      Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span }); sun.shadow.camera.updateProjectionMatrix();
      setLightDirection(sunward.clone()); shadowPrimed = false;
    };
    const setQuality = (q: Quality) => { if (!['performance', 'balanced', 'high'].includes(q)) throw new Error('Unknown quality'); state.quality = q; configureShadows(q); surfaces.setLite(q === 'performance' || (mobile && q !== 'high')); grass.setQuality(q); sky.setQuality(q); crowd.setQuality(q); for (const s of stands) { s.setLeafy(leafyAt(q)); surfaces.apply(s.group); } renderer.setPixelRatio(q === 'performance' ? .75 : Math.min(devicePixelRatio, q === 'high' ? 2 : mobile ? 1.4 : 1.25)); size(); publish(); };
    const input = (key: string, pressed: boolean) => {
      if (!state.playing) return; if (pressed) keys.add(key); else keys.delete(key);
      // Reversing releases the sprint lock, the way it does on a game pad.
      if (pressed && (key === 'KeyS' || key === 'ArrowDown') && state.runLock) { state.runLock = false; publish(); }
    };
    // Analogue thumb stick: x is strafe, y is forward, both -1 to 1.
    const move = (x: number, y: number) => {
      if (!state.playing) { stickX = 0; stickY = 0; return; }
      stickX = x; stickY = y;
      if (y < -.35 && state.runLock) { state.runLock = false; publish(); }
    };
    const toggleRun = () => { if (!state.playing) return; state.runLock = !state.runLock; publish(); };
    const parkBicycle = () => {
      state.riding = false; stopToDismount = false;
      if (transition) { transition.bike.rider = null; transition = null; }
      rideState.mount = 1;
      if (!myBike) return;
      const bike = myBike; myBike = null; bike.rider = null;
      // Step off on the left, the side the stand folds down on, and leave the
      // bicycle standing where it stopped.
      const leftSide = new THREE.Vector3(Math.cos(bike.heading), 0, -Math.sin(bike.heading));
      const step = avatar.position.clone().addScaledVector(leftSide, .62);
      physics.teleport(step.x, avatar.position.y + .05, step.z); settle();
      avatar.rotation.set(0, bike.heading, 0);
      bike.position.y = groundAt(bike.position.x, bike.position.z, bike.position.y + 2);
    };
    const setTime = (mode: TimeName) => { state.timeMode = mode; if (mode !== 'auto') hours = TIMES[mode]; state.time = clockLabel(hours); publish(); };
    const setSound = (on: boolean) => { audio.start(); audio.setEnabled(on); state.sound = on; publish(); };
    const bell = () => { audio.start(); audio.bell(); };
    const finishMount = (bike: Bike) => {
      transition = null; myBike = rideBike = bike; state.riding = true; rideState.mount = 1;
      rideHeading = bike.heading - Math.PI; avatar.rotation.set(0, bike.heading, 0);
      // The capsule moves to the middle of the bicycle, between the wheels.
      const centre = bike.position.clone().addScaledVector(new THREE.Vector3(Math.sin(bike.heading), 0, Math.cos(bike.heading)), .1);
      physics.teleport(centre.x, bike.position.y + .02, centre.z); settle();
      publish();
    };
    /** A crash: over the bars in a tumble, the bicycle down on its side. */
    const throwOff = (speed: number) => {
      const bike = myBike; if (!bike) return;
      state.riding = false; myBike = null; rideBike = null; stopToDismount = false; ride = 0; bikeSpeed = 0; rideState.mount = 1;
      bike.rider = null; topple(bike);
      const ahead = new THREE.Vector3(Math.sin(bike.heading), 0, Math.cos(bike.heading));
      physics.velocity.copy(ahead).multiplyScalar(Math.min(speed, 11) * .42); physics.velocity.y = 4.3; physics.grounded = false;
      crash = 0; shake = .55; audio.crash(Math.min(1, speed / 11)); crowd.alarm(avatar.position.x, avatar.position.y, avatar.position.z, 22);
      publish();
    };
    const startDismount = () => {
      stopToDismount = false;
      const bike = myBike; if (!bike) { state.riding = false; publish(); return; }
      // The capsule steps to the bicycle's left at once; the rig still holds
      // the rider on the saddle and brings them off it over the next second.
      state.riding = false; myBike = null; rideBike = bike;
      besideBike(bike, beside); physics.teleport(beside.x, bike.position.y + .02, beside.z); settle();
      avatar.rotation.set(0, bike.heading, 0);
      transition = { kind: 'dismount', bike, t: 0, clicked: false };
      publish();
    };
    const toggleRide = () => {
      if (!state.playing || transition) return;
      if (state.riding) {
        // Off: brake to a stop, left foot down, then swing off.
        if (Math.hypot(physics.velocity.x, physics.velocity.z) > .5) stopToDismount = true;
        else startDismount();
        return;
      }
      const bike = fleet.nearest(avatar.position, MOUNT_RANGE);
      if (!bike) return;
      bike.rider = state; rideBike = bike;
      transition = { kind: 'approach', bike, t: 0, clicked: false };
      state.runLock = false; publish();
    };
    const down = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.closest('select,input,textarea,button')) return; if (e.code === 'Escape') { setPlaying(false); return; } if (e.code === 'KeyR' && state.ready) { reset(); return; } if (e.code === 'KeyF' && state.playing) { toggleRide(); return; } if (e.code === 'KeyB' && state.playing && state.riding) { bell(); return; } if (e.code === 'KeyM') { setSound(!state.sound); return; } if (state.playing && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) { e.preventDefault(); input(e.code, true); } };
    const up = (e: KeyboardEvent) => keys.delete(e.code); const blur = () => { if (state.playing) setPlaying(false); };
    const visibility = () => { if (document.hidden) { blur(); audio.suspend(); } else audio.resume(); };
    // Touch never reports movementX, so the drag delta is measured by hand.
    const touches = new Map<number, { x: number; y: number }>(); let pinch = 0;
    let wasPointerLocked = false;
    const requestLock = () => {
      if (!state.playing || state.overview || document.pointerLockElement === canvas) return;
      try {
        const p = canvas.requestPointerLock?.() as unknown;
        if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => { });
      } catch { }
    };
    const pointerLockChange = () => {
      const isLocked = document.pointerLockElement === canvas;
      if (wasPointerLocked && !isLocked) {
        if (state.playing) setPlaying(false);
      }
      wasPointerLocked = isLocked;
    };
    const mouseMove = (e: MouseEvent) => {
      if (!state.playing || document.pointerLockElement !== canvas) return;
      const mx = THREE.MathUtils.clamp(e.movementX, -100, 100);
      const my = THREE.MathUtils.clamp(e.movementY, -100, 100);
      yaw -= mx * .0025;
      pitch = THREE.MathUtils.clamp(pitch + my * .0022, -.95, 1.08);
    };
    const pointerDown = (e: PointerEvent) => {
      if (!state.playing) return;
      if (e.pointerType === 'mouse') {
        requestLock();
      } else {
        try { canvas.setPointerCapture(e.pointerId); } catch { }
      }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = true;
    };
    const pointerUp = (e: PointerEvent) => { touches.delete(e.pointerId); if (!touches.size) { drag = false; pinch = 0; } };
    const pointerMove = (e: PointerEvent) => {
      if (document.pointerLockElement === canvas) return;
      const last = touches.get(e.pointerId); if (!last || !state.playing) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size > 1) {
        const [a, b] = [...touches.values()]; const spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) distance = THREE.MathUtils.clamp(distance - (spread - pinch) * .02, 2.5, 14);
        pinch = spread; return;
      }
      if (!drag) return;
      yaw -= dx * .0055; pitch = THREE.MathUtils.clamp(pitch + dy * .004, -.95, 1.08);
    };
    const wheel = (e: WheelEvent) => { if (state.playing) { e.preventDefault(); distance = THREE.MathUtils.clamp(distance + e.deltaY * .006, 2.5, 14); } };
    const lost = () => { state.error = 'The 3D display was interrupted. Reload the campus to restore it.'; setPlaying(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur); document.addEventListener('visibilitychange', visibility);
    document.addEventListener('pointerlockchange', pointerLockChange); document.addEventListener('mousemove', mouseMove);
    canvas.addEventListener('click', requestLock); canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('webglcontextlost', lost);

    // The library and the lecture gallery arrive while the campus is already
    // being walked, then the walkable tree is rebuilt to take them in.
    const streamOuter = async () => {
      const [libraryBytes, libraryCollisionBytes, galleryBytes, galleryCollisionBytes, libraryTreeBytes, galleryTreeBytes, adminBytes, adminCollisionBytes, adminTreeBytes, adminLinkBytes, adminLinkCollisionBytes] =
        await Promise.all(STAGES.outer.map(url => download.get(url)));
      if (disposed) return;
      const library = await loader.parseAsync(libraryBytes, '');
      // Glass and metal reflect the scene's own sky light, which follows the hour.
      applyLibraryMaterials(library.scene, null);
      const gallery = await loader.parseAsync(galleryBytes, '');
      const admin = await loader.parseAsync(adminBytes, '');
      applyAdminMaterials(admin.scene, null);
      // The administration is exported already enlarged to its campus scale;
      // only a scale changed since that export is left to apply here.
      const adminFile = JSON.parse(new TextDecoder().decode(adminTreeBytes)) as { trees: Tree[]; bakedScale?: number };
      const adminScale = ADMIN.scale / (adminFile.bakedScale ?? 1);
      const placeAdmin = (root: THREE.Object3D) => { root.position.set(ADMIN.x, 0, ADMIN.z); root.rotation.y = ADMIN_ROTATION; root.scale.setScalar(adminScale); root.updateMatrixWorld(true); return root; };
      placeAdmin(admin.scene);
      const adminLink = await loader.parseAsync(adminLinkBytes, '');
      for (const outer of [library.scene, gallery.scene, admin.scene, adminLink.scene]) {
        outer.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
        scene.add(outer); outer.updateMatrixWorld(true); prepare(outer);
      }
      // Their planting comes as a list, like the campus's, so it grows the
      // same trees at every quality. The trunks are already in the collision.
      const adminTrees = adminFile.trees.map(t => { const p = new THREE.Vector3(...t.position as [number, number, number]).applyMatrix4(admin.scene.matrixWorld); return { ...t, position: p.toArray() }; });
      const planted = [libraryTreeBytes, galleryTreeBytes].flatMap(bytes => JSON.parse(new TextDecoder().decode(bytes)).trees as Tree[]).concat(adminTrees);
      const outerStand = createTreeStand(planted, 'Library, gallery and administration trees', !mobile);
      outerStand.setLeafy(leafyAt(state.quality)); scene.add(outerStand.group); stands.push(outerStand); surfaces.apply(outerStand.group);
      colliders.add((await loader.parseAsync(libraryCollisionBytes, '')).scene,
        (await loader.parseAsync(galleryCollisionBytes, '')).scene,
        placeAdmin((await loader.parseAsync(adminCollisionBytes, '')).scene),
        (await loader.parseAsync(adminLinkCollisionBytes, '')).scene);
      world.rebuild(colliders);
      for (const outer of [library.scene, gallery.scene, admin.scene, adminLink.scene]) addSolids(outer);
      solids.rebuild(solidGroup);
      // The library and administration roads join the walkers' and riders'
      // network, and their forecourts get groups and racks of their own.
      crowd.addRoutes([LIBRARY_ROAD.map(p => [p[0], p[1]]), ADMIN_ROAD], [LIBRARY_ROAD.map(p => [p[0], p[1]]), ADMIN_ROAD]);
      gather(LANDMARKS.library.x, LANDMARKS.library.z, 3, 5, 1);
      gather(LANDMARKS.gallery.x, LANDMARKS.gallery.z, 4, 4, 3);
      gather(ADMIN.entrance.x, ADMIN.entrance.z, 3, 4, 5);
      // The administration's site has street lamps of its own: black heads
      // nine metres up, ninety-six vertices apiece among its other fixtures.
      const fixtures: THREE.Mesh[] = [];
      admin.scene.traverse(o => { if (o instanceof THREE.Mesh && (o.material as THREE.Material).name === 'Fixtures | black') fixtures.push(o); });
      streetLights.adopt(fixtures, { above: 8, vertices: [90, 100], glow: false });
      streetLights.plant([LIBRARY_ROAD.map(p => [p[0], p[1]])], 5.8);
      streetLights.plant([ADMIN_ROAD], 6.6);
      lampPosts = streetLights.poles().map(b => ({ x: b.x, y: b.y, z: b.z, r: .14 }));
      grassProbe = createGrassProbe(cameraMeshes.filter(o => grassHeight((o.material as THREE.Material).name || '') > 0), groundHeight);
      state.outerReady = true; state.outerPercent = 100; publish();
    };

    function animate(now: number) {
      if (disposed) return; frame = requestAnimationFrame(animate); tick(now);
    }
    function tick(now: number) {
      // Clocks can step backwards (a resumed tab, a debugger); never run time in reverse.
      const elapsed = THREE.MathUtils.clamp((now - prev) / 1000, 0, .1); prev = now;
      const held = keys.has('ShiftLeft') || keys.has('ShiftRight');
      // Pushing the stick to the rim runs, exactly as a shooter's stick does,
      // with a gap between starting and stopping so it cannot flicker.
      const stickMag = Math.hypot(stickX, stickY);
      if (stickMag > .96) stickRun = true; else if (stickMag < .8) stickRun = false;
      const running = held || state.runLock || stickRun;
      // Short of the rim, how far the stick is pushed sets the pace.
      const throttle = stickMag > .05 && !stickRun ? THREE.MathUtils.clamp(stickMag / .8, .35, 1) : 1;
      let forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) + stickY;
      // A thumb is never quite still: small sideways drift is ignored.
      const side = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) + (Math.abs(stickX) < .14 ? 0 : stickX);
      // Sprint lock keeps running forward on its own until it is released.
      // Auto-run keeps the throttle on while the stick still steers.
      if (state.runLock && forward > -.02) forward = 1;
      // Braking to get off: no pedalling, and off once stopped.
      if (stopToDismount) { forward = 0; if (Math.hypot(physics.velocity.x, physics.velocity.z) < .3 && rideState.footDown > .7) startDismount(); }
      if (transition) {
        const bike = transition.bike; transition.t += elapsed;
        direction.set(0, 0, 0); forward = 0;
        if (transition.kind === 'approach') {
          // A bicycle that went down in a crash is picked up on the way.
          bike.lean += (.1 - bike.lean) * (1 - Math.exp(-elapsed * 6)); bike.stand += (1 - bike.stand) * (1 - Math.exp(-elapsed * 6));
          const down = falling.findIndex(f => f.bike === bike); if (down >= 0) falling.splice(down, 1);
          // Walk round to the bicycle's left side, then stand square to it.
          besideBike(bike, beside);
          const dx = beside.x - avatar.position.x, dz = beside.z - avatar.position.z, gap = Math.hypot(dx, dz);
          if (gap < .1 || transition.t > 2.2) {
            physics.teleport(beside.x, avatar.position.y + .02, beside.z); settle();
            transition = { kind: 'mount', bike, t: 0, clicked: false }; rideBike = bike;
            Object.assign(rideState, { mount: 0, footDown: 1, standing: 0, turn: 0, ground: bike.position.y });
            rideHeading = bike.heading - Math.PI; bike.crank = 1.05; bike.lean = .1; bike.stand = 1; bikeSpeed = 0;
          } else direction.set(dx / gap, 0, dz / gap).multiplyScalar(Math.min(1, gap / .35));
        } else if (transition.kind === 'mount') {
          rideState.mount = Math.min(1, transition.t / MOUNT_TIME);
          if (rideState.mount >= 1) finishMount(bike);
        } else {
          rideState.mount = Math.max(0, 1 - transition.t / DISMOUNT_TIME);
          if (rideState.mount <= 0) { bike.rider = null; transition = null; }
        }
      } else if (state.riding) {
        // A bicycle is steered, not strafed. Turning rate falls off at a
        // standstill, so it leans into a circle instead of spinning on the spot.
        const actual = Math.hypot(physics.velocity.x, physics.velocity.z);
        // Steering is eased, as bars are: a twitch of the thumb is not a
        // twitch of the whole bicycle.
        steering += (THREE.MathUtils.clamp(side, -1, 1) - steering) * (1 - Math.exp(-elapsed * 7));
        rideHeading -= steering * elapsed * 2.4 * Math.min(1, actual / 3.2);
        // Pedalling builds speed over a second or two; the brakes stop it in
        // about one; let go and it rolls on, slowing gently. Held back from a
        // standstill, the bicycle is walked backwards.
        const cruise = running ? BICYCLE_SPRINT : BICYCLE_SPEED * throttle, braking = forward < -.06 || stopToDismount;
        if (forward > .06) bikeSpeed += (cruise - bikeSpeed) * (1 - Math.exp(-elapsed * (bikeSpeed > cruise ? 3 : running ? 1.1 : 1.5)));
        else if (braking && bikeSpeed > .25) bikeSpeed = Math.max(0, bikeSpeed - elapsed * 9);
        else if (braking && !stopToDismount) bikeSpeed = -1.1;
        else bikeSpeed = Math.max(0, bikeSpeed - elapsed * (.3 + bikeSpeed * .05));
        // A wall or a crowd holds it back however hard it is pedalled.
        if (bikeSpeed > 0) bikeSpeed = Math.min(bikeSpeed, actual + 1.4);
        direction.copy(Math.abs(bikeSpeed) > .02 ? movementVector(Math.sign(bikeSpeed), 0, rideHeading) : zero);
      } else direction.copy(movementVector(forward, side, yaw));
      // Winded after a crash or a long drop: no control for a moment.
      if (stun > 0 || crash >= 0) { stun = Math.max(0, stun - elapsed); direction.set(0, 0, 0); forward = 0; }
      const jump = keys.has('Space');
      if (jump && !lastJump) jumpBuffer = .15;
      lastJump = jump; jumpBuffer = Math.max(0, jumpBuffer - elapsed); coyote = physics.grounded ? 0 : coyote + elapsed;
      const launch = (speedUp: number) => { physics.velocity.y = speedUp; physics.grounded = false; coyote = 1; audio.step(grassProbe(avatar.position.x, avatar.position.z) ? 'grass' : 'hard', .7); };
      if (jumpBuffer > 0 && coyote < .12 && crouching < 0 && state.playing && !state.riding && !transition && stun <= 0 && crash < 0 && physics.velocity.y < 1) {
        jumpBuffer = 0;
        // From a standstill the knees bend first; on the move the push-off is at once.
        if (Math.hypot(physics.velocity.x, physics.velocity.z) < 1.2) crouching = 0;
        else launch(6);
      }
      if (crouching >= 0) { crouching += elapsed; if (crouching >= .1) { crouching = -1; launch(5.8); } }
      // On a bicycle the jump is a hop: enough to clear a kerb.
      if (jumpBuffer > 0 && state.riding && physics.grounded && state.playing) { jumpBuffer = 0; physics.velocity.y = 3.4; physics.grounded = false; audio.step('hard', .5); }
      const speed = state.riding ? Math.abs(bikeSpeed) : transition ? WALK_SPEED * .85 : (running ? RUN_SPEED : WALK_SPEED * throttle);
      // On foot the body has a little weight to it: a run takes a moment to
      // get going and to stop. A bicycle's speed is its own; the frame just
      // follows the wheels.
      const accel = state.riding ? 30 : transition ? 14 : running ? 10 : 15;
      let knock = 0; physics.impact = 0;
      if (state.playing || !hasStarted) {
        const blend = stepper.advance(elapsed, step => {
          lastFeet.copy(nextFeet);
          physics.step(step, state.playing ? direction : zero, speed, accel);
          const hit = treeWorld.capsuleIntersect(physics.capsule); if (hit) physics.capsule.translate(hit.normal.multiplyScalar(hit.depth));
          // Other students, lamp posts and parked bicycles are solid. On a
          // bicycle the front wheel is felt for too, and a knock slows it.
          const feet = physics.capsule.start, body = state.riding ? .42 : physics.capsule.radius;
          let knocked = false;
          for (const along of state.riding && myBike ? [0, .55] : [0]) {
            const fx = feet.x + (along ? Math.sin(myBike!.heading) * along : 0), fz = feet.z + (along ? Math.cos(myBike!.heading) * along : 0), r = along ? .24 : body;
            const people = crowd.separate(probePoint.set(fx, feet.y, fz), r, apart2, { x: physics.velocity.x, z: physics.velocity.z, riding: state.riding });
            if (people.lengthSq() > 0) { physics.capsule.translate(people); knocked = true; }
            for (const [list, out] of [[lampPosts, apart3], [bikePosts, apart4]] as const) {
              const push = pushOut(fx, feet.y - .3, fz, r, list, out);
              if (push.lengthSq() > 0) {
                // How hard it was hit: the speed straight into the post.
                const l = push.length(), closing = -(physics.velocity.x * push.x + physics.velocity.z * push.z) / l;
                if (list === bikePosts && closing > 3.8) {
                  // A parked bicycle run or ridden into goes over, and is only
                  // a knock to whoever hit it.
                  for (const post of bikePosts) if (post.bike && Math.hypot(post.x - fx, post.z - fz) < r + post.r + .06 && (post.bike as Bike).stand > .5) { topple(post.bike as Bike); audio.crash(.35); shake = Math.max(shake, .15); }
                } else knock = Math.max(knock, closing);
                physics.capsule.translate(push); knocked = true;
              }
            }
          }
          if (knocked && state.riding) { physics.velocity.x *= .86; physics.velocity.z *= .86; }
          nextFeet.copy(physics.feet);
        });
        avatar.position.lerpVectors(lastFeet, nextFeet, blend);
        if (physics.grounded && Number.isFinite(drawnY) && Math.abs(avatar.position.y - drawnY) < .45) drawnY += (avatar.position.y - drawnY) * (1 - Math.exp(-elapsed * 22));
        else drawnY = avatar.position.y;
        avatar.position.y = drawnY;
        // Into a wall or a post at speed, or into someone at a sprint: off.
        if (state.riding && myBike) { const hard = Math.max(physics.impact, knock, pendingCrash); if (hard > 6) throwOff(hard); }
        pendingCrash = 0;
        if (avatar.position.y < -60 || avatar.position.x < CAMPUS_BOUNDS.minX || avatar.position.x > CAMPUS_BOUNDS.maxX || avatar.position.z < CAMPUS_BOUNDS.minZ || avatar.position.z > CAMPUS_BOUNDS.maxZ) reset();
      } else settle();
      const pace = Math.hypot(physics.velocity.x, physics.velocity.z);
      const moving = state.playing && direction.lengthSq() > .01 && pace > .12;
      if (state.riding) {
        // The frame points where it is steered, with no lag to slide against.
        avatar.rotation.set(0, rideHeading + Math.PI, 0);
        // Ease the camera round behind the rider unless it is being dragged or mouse locked.
        if (!drag && document.pointerLockElement !== canvas) yaw += Math.atan2(Math.sin(rideHeading - yaw), Math.cos(rideHeading - yaw)) * (1 - Math.exp(-elapsed * 2.4));
      } else if (transition && transition.kind !== 'approach') {
        // Square to the bicycle while getting on or off.
        avatar.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(upright, transition.bike.heading), 1 - Math.exp(-elapsed * 12));
      } else if (moving) {
        const wanted = Math.atan2(direction.x, direction.z);
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wanted);
        avatar.quaternion.slerp(q, 1 - Math.exp(-elapsed * 15));
      }
      // On a bicycle the idle clip only breathes under the riding pose.
      const motion = state.riding ? 'Idle' : moving ? (running ? 'Run' : 'Walk') : 'Idle';
      if (motion !== state.motion) {
        const next = actions[motion];
        // Walk and run share their foot timing, so a change of pace keeps step.
        // A clip that finished fading out is left disabled, so it must be reset first.
        const phase = action.time / action.getClip().duration;
        next.reset();
        if ((motion === 'Walk' || motion === 'Run') && (state.motion === 'Walk' || state.motion === 'Run')) next.time = phase * next.getClip().duration;
        action.fadeOut(.22); action = next; action.setEffectiveWeight(1).fadeIn(.22).play(); state.motion = motion;
      }
      // Each clip plays at the pace actually being moved, so the shoes stay planted.
      action.setEffectiveTimeScale(motion === 'Walk' ? THREE.MathUtils.clamp(pace / WALK_CLIP_SPEED, .55, 1.7) : motion === 'Run' ? THREE.MathUtils.clamp(pace / RUN_CLIP_SPEED, .7, 1.35) : 1);
      animated.restore(); mixer.update(elapsed); animated.save();
      settleArms(rider.bones, student.scene, armsInFor(actions));

      // Riding sits the student on the saddle; leaving the ground tucks the
      // legs. Both blend against whatever the clip just played. Writing the
      // bones outright snapped him into the modelling T-pose the moment the
      // weight rose above zero, which a single bumpy frame was enough to do.
      const onBike = state.riding || transition?.kind === 'mount' || transition?.kind === 'dismount';
      ride += ((onBike ? 1 : 0) - ride) * (1 - Math.exp(-elapsed * 9));
      offGround = physics.grounded ? 0 : offGround + elapsed;
      const wantsAir = !state.riding && state.playing && offGround > .09 ? 1 : 0;
      air += (wantsAir - air) * (1 - Math.exp(-elapsed * (wantsAir ? 18 : 9)));
      if (air > .004) {
        // Legs tuck most at the top of the jump; on the way up they push off
        // and on the way down they reach for the ground.
        const tuck = air * (.45 + .55 * THREE.MathUtils.clamp(1 - Math.abs(physics.velocity.y) / 5.5, 0, 1));
        for (const [posed, rest] of bind) {
          const offset = AIR_POSE[posed.name];
          if (!offset) continue;
          poseStep.set(offset[0], offset[1], offset[2]);
          poseTarget.copy(rest).multiply(poseSpin.setFromEuler(poseStep));
          posed.quaternion.slerp(poseTarget, tuck);
        }
      }
      // Landing: the harder the fall, the deeper the knees give.
      if (!physics.grounded) { airTime += elapsed; fallSpeed = Math.max(fallSpeed, -physics.velocity.y); }
      else {
        if (airTime > .3 && state.riding) { shake = Math.max(shake, Math.min(.4, fallSpeed * .03)); if (fallSpeed > 11) throwOff(fallSpeed * .7); else audio.land('hard', Math.min(1, fallSpeed / 10)); }
        if (airTime > .22 && !state.riding) {
          const impact = THREE.MathUtils.clamp((fallSpeed - 2) / 8, .15, 1); landAge = 0; landPeak = .05 + .13 * impact;
          // From higher than about 2.5 m, or after a crash: a heavy landing
          // that takes a moment to stand up from.
          if (fallSpeed > 9 || crash >= 0) { landPeak = .27; stun = crash >= 0 ? .75 : .4; shake = Math.max(shake, .35); }
          audio.land(grassProbe(avatar.position.x, avatar.position.z) ? 'grass' : 'hard', impact);
        }
        airTime = 0; fallSpeed = 0;
      }
      landAge += elapsed;
      crouchSquash += ((crouching >= 0 ? .11 : 0) - crouchSquash) * (1 - Math.exp(-elapsed * (crouching >= 0 ? 40 : 25)));
      const landing = landAge < .6 ? landPeak * (landAge / .07) * Math.exp(1 - landAge / .07) : 0;
      squash = state.riding ? 0 : Math.max(crouchSquash, landing);
      // Thrown off: one forward tumble about the hips, curled up, then the
      // landing takes it and the rider picks themselves up.
      student.scene.quaternion.identity();
      if (crash >= 0) {
        crash += elapsed;
        const turn = THREE.MathUtils.smoothstep(crash, 0, .62) * Math.PI * 2;
        tumbleAxis.set(1, 0, 0);
        tumble.setFromAxisAngle(tumbleAxis, turn);
        student.scene.quaternion.copy(tumble);
        student.scene.position.copy(hipsPivot).sub(pivotTurned.copy(hipsPivot).applyQuaternion(tumble));
        if (crash > .62 && physics.grounded) crash = -1;
        if (crash > 1.6) crash = -1;
      }
      for (const f of falling) { f.bike.lean += (f.lean - f.bike.lean) * (1 - Math.exp(-elapsed * 9)); f.bike.steer += (.5 - f.bike.steer) * (1 - Math.exp(-elapsed * 6)); }
      if (squash > .003 && ride < .01) {
        // Hips down, feet kept where they stand: knees bend, the body leans
        // over them and the arms go out a little for balance.
        const b = rider.bones;
        student.scene.updateMatrixWorld(true);
        bodyForward.set(0, 0, 1).applyQuaternion(avatar.quaternion); bodyLeft.set(1, 0, 0).applyQuaternion(avatar.quaternion);
        b.LeftFoot.getWorldPosition(squashFeet[0]); b.RightFoot.getWorldPosition(squashFeet[1]);
        b.LeftFoot.getWorldQuaternion(squashTurn[0]); b.RightFoot.getWorldQuaternion(squashTurn[1]);
        setWorldPosition(b.Hips, b.Hips.getWorldPosition(hipsAt).addScaledVector(upright, -squash).addScaledVector(bodyForward, -squash * .3));
        ([[b.LeftUpLeg, b.LeftLeg, b.LeftFoot], [b.RightUpLeg, b.RightLeg, b.RightFoot]] as const).forEach(([upLeg, leg, foot], i) => {
          reach(upLeg, leg, foot, squashFeet[i], upLeg.getWorldPosition(kneePole).addScaledVector(bodyForward, .6));
          foot.getWorldQuaternion(squashNow); turnWorld(foot, squashTurn[i].clone().multiply(squashNow.invert()));
        });
        turnAbout(b.Spine01, bodyLeft, squash * 1.7);
        turnAbout(b.LeftArm, bodyForward, squash * 1.4); turnAbout(b.RightArm, bodyForward, -squash * 1.4);
      }
      // Keep the shoes on the floor: each clip parks the hips differently.
      const wantedPlant = state.riding ? 0 : planted[state.motion] ?? 0;
      plantOffset += (wantedPlant - plantOffset) * (1 - Math.exp(-elapsed * 10));
      if (crash < 0) student.scene.position.set(0, plantOffset * (1 - ride), 0);
      if (myBike) {
        // The bicycle carries the capsule a little ahead of the crank axle.
        const bike = myBike, heading = rideHeading + Math.PI;
        bike.heading = heading; bike.stand = Math.max(0, bike.stand - elapsed * 4);
        bike.position.set(avatar.position.x - Math.sin(heading) * .1, avatar.position.y, avatar.position.z - Math.cos(heading) * .1);
        bike.wheel += (bikeSpeed < 0 ? -pace : pace) * elapsed / BIKE.wheelRadius;
        const pedalling = state.playing && forward > .06 && pace > .2;
        const backwards = bikeSpeed < 0 && pace > .1;
        coastingNow = !pedalling && !backwards && pace > .6;
        const stopped = pace < .35 && !pedalling && !backwards;
        if (pedalling) bike.crank += pace * elapsed / BIKE.development * Math.PI * 2;
        // Rolled backwards, the freewheel turns the cranks back with the wheel.
        else if (backwards) bike.crank -= pace * elapsed / BIKE.development * Math.PI * 2;
        else {
          // Freewheeling levels the cranks; stopping sets the right pedal
          // high and forward, ready to push off again.
          const rest = stopped ? 1.05 : Math.round((bike.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
          const goal = stopped ? bike.crank + Math.atan2(Math.sin(rest - bike.crank), Math.cos(rest - bike.crank)) : rest;
          bike.crank += (goal - bike.crank) * (1 - Math.exp(-elapsed * (stopped ? 3 : 2)));
        }
        rideState.standing += ((pedalling && running && pace > 3 ? 1 : 0) - rideState.standing) * (1 - Math.exp(-elapsed * 4));
        rideState.footDown += ((stopped ? 1 : 0) - rideState.footDown) * (1 - Math.exp(-elapsed * (stopped ? 5 : 9)));
        rideState.turn += (-steering - rideState.turn) * (1 - Math.exp(-elapsed * 5));
        rideState.ground = groundAt(bike.position.x, bike.position.z, bike.position.y + 1.5);
        const lean = -steering * Math.min(1, pace / 6) * .32 + Math.sin(bike.crank) * rideState.standing * .05 + rideState.footDown * .11;
        bike.lean += (lean - bike.lean) * (1 - Math.exp(-elapsed * 6));
        bike.steer += (-steering * (.38 - .28 * Math.min(1, pace / 7)) - bike.steer) * (1 - Math.exp(-elapsed * 8));
      } else if (transition && transition.kind !== 'approach') {
        // The stand flips up as the rider settles on, and down as they step off.
        coastingNow = false;
        const bike = transition.bike, m = rideState.mount ?? 1, mounting = transition.kind === 'mount';
        const up = mounting ? m > .62 : m > .45;
        if (up !== (bike.stand < .5) && !transition.clicked) { transition.clicked = true; audio.stand(!up); }
        bike.stand += ((up ? 0 : 1) - bike.stand) * (1 - Math.exp(-elapsed * 14));
        bike.lean += ((up ? .11 : .1) - bike.lean) * (1 - Math.exp(-elapsed * 6));
        bike.steer += ((up ? 0 : .3) - bike.steer) * (1 - Math.exp(-elapsed * 6));
      } else if (rideBike && rideBike.stand < 1) {
        coastingNow = false;
        const bike = rideBike; bike.stand = Math.min(1, bike.stand + elapsed * 3);
        bike.lean += (.1 - bike.lean) * (1 - Math.exp(-elapsed * 5)); bike.steer += (.3 - bike.steer) * (1 - Math.exp(-elapsed * 5));
      }
      student.scene.rotation.z = 0;
      if (rideBike && ride > .001) rider.apply(rideBike, rideState, ride);
      else if (!state.riding && !transition) rideBike = null;
      fleet.update(); fleet.posts(bikePosts, myBike);
      eventTime += elapsed; concert.update(eventTime); audience.update(eventTime, Math.hypot(camera.position.x - CONCERT.x, camera.position.z - CONCERT.z)); concert.setNight(dayState.lamps); sky.group.position.set(camera.position.x, 0, camera.position.z); sky.update(eventTime);
      // The clock: a day hour in a minute, nights three times faster.
      if (state.timeMode === 'auto' && state.ready) hours = (hours + elapsed * hoursPerSecond(hours)) % 24;
      daylightAt(hours, dayState);
      sun.color.copy(dayState.lightColor); sun.intensity = dayState.lightIntensity * 1.12;
      if (sunward.angleTo(dayState.light) > .003) { setLightDirection(dayState.light); shadowAge = 99; }
      // The sky light now carries most of the ambient; the hemisphere fills in.
      hemi.color.copy(dayState.hemiSky); hemi.groundColor.copy(dayState.hemiGround); hemi.intensity = dayState.hemiIntensity * .47;
      campusFog.color.copy(dayState.horizon); (scene.background as THREE.Color).copy(dayState.horizon);
      renderer.toneMappingExposure = dayState.exposure;
      sky.setPalette(dayState);
      scene.environment = skyLight.update(dayState); scene.environmentIntensity = .72;
      surfaces.setNight(dayState.lamps); streetLights.update(elapsed, dayState.lamps, camera.position, surfaces.uniforms.uLamps.value);
      if (state.playing) follow(elapsed);
      const floor = world.rayIntersect(new THREE.Ray(avatar.position.clone().add(new THREE.Vector3(0, .3, 0)), new THREE.Vector3(0, -1, 0)));
      // The student's contact shadow, stretched under the bicycle when riding.
      // It moves every frame, where a shadow from the sun's map would lag and jump.
      shadow.position.set(avatar.position.x, floor ? floor.position.y + .025 : avatar.position.y + .015, avatar.position.z); shadow.visible = avatar.visible;
      shadow.rotation.set(-Math.PI / 2, 0, avatar.rotation.y);
      const blob = physics.grounded ? 1 : .8; shadow.scale.set(blob * (1 - ride * .18), blob * (1 + ride * .75), 1);
      // The depth texture only exists once the shadow pass has run. Leaving
      // autoUpdate off before the first pass bound an ordinary colour texture
      // to the shadow sampler, so every lit draw call failed and the campus
      // rendered as bare sky. Prime it once, then refresh only near the library.
      // The map is redrawn around the student every so often, and as soon as
      // they have walked a few metres or the light has turned.
      shadowAge += elapsed;
      sun.shadow.autoUpdate = false;
      // On High on a computer the map is redrawn every frame, so people and
      // bicycles cast real shadows that keep up with them. Elsewhere it holds
      // only what stands still, redrawn now and then, and whatever moves has
      // a contact shadow instead: a shadow from an old map lagged metres
      // behind a bicycle and jumped to catch up twice a second.
      const liveShadows = state.quality === 'high' && !mobile;
      if (liveShadows !== castingLive) { castingLive = liveShadows; for (const o of [student.scene]) o.traverse(m => { if (m instanceof THREE.Mesh) m.castShadow = liveShadows; }); fleet.setCastShadows(liveShadows); crowd.setCastShadows(liveShadows); }
      const shadowEvery = liveShadows ? 0 : state.quality === 'balanced' ? .6 : state.quality === 'high' ? .3 : 2;
      // Most of the map lies ahead of the camera, where the eye is, with
      // enough behind the student for their own shadow and the path walked.
      camera.getWorldDirection(shadowAhead); shadowAhead.y = 0;
      if (shadowAhead.lengthSq() < 1e-6) shadowAhead.set(0, 0, 1);
      shadowAim.copy(avatar.position).addScaledVector(shadowAhead.normalize(), shadowSpan * (mobile ? .3 : .5));
      if (!shadowPrimed || shadowAge > shadowEvery || (shadowAge > (mobile ? .25 : .1) && shadowAim.distanceTo(shadowCentre) > (state.quality === 'performance' ? 14 : mobile ? 9 : 6))) {
        aimSun(shadowAim); shadowCentre.copy(shadowAim); sun.shadow.needsUpdate = true; shadowAge = 0; shadowPrimed = true;
      }
      crowd.update(elapsed, avatar.position, avatar.position.y + 1.55, camera, [lampPosts, bikePosts]);
      // Footsteps: a scuff or a tap as each foot comes down, in time with the stride.
      if (!state.riding && physics.grounded && state.playing && pace > .4) {
        for (let i = 0; i < 2; i++) {
          const h = stepFeet[i].getWorldPosition(stepPoint).y - avatar.position.y;
          stepFloor[i] = Math.min(h, stepFloor[i] + elapsed * .04);
          if (stepArmed[i] && h < stepFloor[i] + .012) { stepArmed[i] = false; audio.step(grassProbe(avatar.position.x, avatar.position.z) ? 'grass' : 'hard', Math.min(1, pace / RUN_SPEED)); }
          else if (h > stepFloor[i] + .05) stepArmed[i] = true;
        }
      }
      audio.update(elapsed, { riding: state.riding, speed: pace, coasting: coastingNow, nearGroup: THREE.MathUtils.clamp(1 - (crowd.nearestGroup(avatar.position) - 3) / 12, 0, 1), underTrees: .6, night: dayState.lamps });
      grass.update(elapsed, avatar.position, physics.grounded, !!state.overview);
      for (const s of stands) s.update(eventTime);
      // Adding the water update incrementor here
      water.material.uniforms.uTime.value += elapsed;
      renderer.render(scene, camera); acc += elapsed; frames++;
      // =================
      remotePlayers?.update(elapsed);

      if (multiplayerRoom) {
        syncElapsed += elapsed;

        if (syncElapsed >= 1 / 30) {
          syncElapsed = 0;

          sendPlayerMovement({
            x: avatar.position.x,
            y: avatar.position.y,
            z: avatar.position.z,
            qx: avatar.quaternion.x,
            qy: avatar.quaternion.y,
            qz: avatar.quaternion.z,
            qw: avatar.quaternion.w,
            animation: state.riding ? "Ride" : state.motion,
          });
        }
      }
      // ==================

      if (acc > .35) {
        state.fps = Math.round(frames / acc); state.speed = state.riding ? Math.round(Math.hypot(physics.velocity.x, physics.velocity.z) * 3.6) : 0; state.time = clockLabel(hours); state.x = avatar.position.x; state.y = avatar.position.y; state.z = avatar.position.z; state.grounded = physics.grounded; state.draws = renderer.info.render.calls; state.triangles = renderer.info.render.triangles; state.animationTime = action.time;
        const near = !state.riding && !!fleet.nearest(avatar.position, MOUNT_RANGE);
        if (near !== state.canMount) state.canMount = near;
        state.location = Math.hypot(avatar.position.x - ADMIN.x, avatar.position.z - ADMIN.z) < 115 * ADMIN.scale ? 'Administration building' : distanceToRoads(avatar.position.x, avatar.position.z, [ADMIN_ROAD]) < 15 ? 'NIT Road · Administration' : avatar.position.x < -450 && avatar.position.z > 245 ? 'Lecture gallery' : avatar.position.x < -320 ? 'APJ Abdul Kalam Library' : onLibraryConnection(avatar.position.x, avatar.position.z, 12) ? 'Road to the library' : Math.abs(avatar.position.z - CONCERT.z) < 18 && avatar.position.x > CONCERT.x - 65 && avatar.position.x < CONCERT.x + 8 ? 'TECNOESIS concert' : avatar.position.z < 90 ? 'Sports complex' : avatar.position.x < -82 ? 'Cricket ground' : avatar.position.z > 237 ? 'Basketball courts' : avatar.position.x < -35 ? 'Between the grounds' : 'Football ground';
        publish(); acc = 0; frames = 0;
      }
    }
    state.x = avatar.position.x;
    state.y = avatar.position.y;
    state.z = avatar.position.z;
    state.ready = true; state.progress = 'Ready'; state.percent = 100; publish(); frame = requestAnimationFrame(animate);
    void streamOuter().catch(e => { state.progress = `The outlying buildings could not be loaded: ${e.message || e}`; publish(); });
    return {
      setPlaying, reset, travel, overview, setQuality, input, move, toggleRun, toggleRide, setSound, bell, setTime, getState: () => ({ ...state }),

      //=============
      getMultiplayerSnapshot: () => ({
        x: avatar.position.x,
        y: avatar.position.y,
        z: avatar.position.z,
        qx: avatar.quaternion.x,
        qy: avatar.quaternion.y,
        qz: avatar.quaternion.z,
        qw: avatar.quaternion.w,
        animation: state.riding ? "Ride" : state.motion,
      }),
      // =============

      dispose() {
        disposed = true; audio.dispose(); cancelAnimationFrame(frame); if (document.pointerLockElement === canvas) document.exitPointerLock?.(); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('pointerlockchange', pointerLockChange); document.removeEventListener('mousemove', mouseMove); canvas.removeEventListener('click', requestLock); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerUp); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('webglcontextlost', lost); mixer.stopAllAction();
        (remotePlayers as RemotePlayers | null)?.dispose();
        void leaveCampus();
        world.clear(); treeWorld.clear(); solids.clear(); grass.dispose(); crowd.dispose(); audience.dispose(); fleet.dispose(); streetLights.dispose(); sky.dispose(); for (const s of stands) s.dispose(); draco.dispose(); cleanupResources();
      }
    };
  } catch (error) { cleanupResources(); throw error; }
}
