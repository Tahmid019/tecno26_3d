import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { PlayerPhysics, movementVector, CollisionWorld } from './physics';
import { createConcert, CONCERT } from './concert';
import { createSky } from './sky';
import { LIBRARY, GALLERY, ADMIN, ADMIN_ROTATION, ADMIN_ROAD, CAMPUS_BOUNDS, onLibraryConnection, distanceToRoads } from './campus-layout';
import { applyLibraryMaterials, daylightEnvironment } from './library-materials';
import { applyAdminMaterials } from './admin-materials';
import { createGrass, createGrassProbe, grassHeight } from './grass';
import { createDownloader, STAGES } from './assets';
import { createBicycle, BICYCLE_SPEED, BICYCLE_SPRINT, MOUNT_RANGE } from './bicycle';
import { FollowCamera, FixedStep, CAMERA_PASSES_THROUGH } from './follow-camera';
import { createTreeStand, type Tree } from './trees';

import {
  joinCampus,
  sendPlayerMovement,
  leaveCampus,
} from "./multiplayer";
import {
  createRemotePlayers,
  type RemotePlayers,
} from "./remote-player";

export const LANDMARKS = {
  gym: { label:'Sports complex', x:-20, z:67, yaw:0 },
  football: { label:'Football ground', x:12, z:135, yaw:Math.PI },
  cricket: { label:'Cricket ground', x:-157, z:149, yaw:2.6 },
  courts: { label:'Basketball courts', x:-13, z:242, yaw:Math.PI },
  concert: { label:'TECNOESIS concert', x:-28, z:170, yaw:-Math.PI/2 },
  library: { label:'APJ Abdul Kalam Library', x:LIBRARY.entrance.x, z:LIBRARY.entrance.z-5, yaw:0 },
  gallery: { label:'Lecture gallery', x:GALLERY.entrance.x, z:GALLERY.entrance.z-15, yaw:Math.PI },
  admin: { label:'Administration building', x:ADMIN.entrance.x, z:ADMIN.entrance.z, yaw:ADMIN_ROTATION },
} as const;
export type Landmark = keyof typeof LANDMARKS;
export type Quality = 'performance' | 'balanced' | 'high';
export type GameState = { ready:boolean; playing:boolean; progress:string; error:string; fps:number; location:string; x:number; z:number; motion:string; percent:number; outerPercent:number; outerReady:boolean; runLock:boolean; riding:boolean; canMount:boolean; y?:number; grounded?:boolean; overview?:boolean; quality?:Quality; draws?:number; triangles?:number; animationTime?:number; crowdCount?:number };


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

export type Game = {
  setPlaying: (value: boolean) => void;
  reset: () => void;
  dispose: () => void;
  travel: (id: Landmark) => void;
  overview: () => void;
  setQuality: (q: Quality) => void;
  input: (key: string, pressed: boolean) => void;
  move: (x: number, y: number) => void;
  toggleRun: () => void;
  toggleRide: () => void;
  getState: () => GameState;
  getMultiplayerSnapshot: () => MultiplayerSnapshot;
};



type TreeFile = {trees:Tree[];roads:number[][][]};

// The character ships with Walk, Run and Idle and nothing else, so leaving the
// ground looked like the idle pose sliding upwards. These are local rotations
// laid over each bone's bind orientation, blended in by weight.
const AIR_POSE:Record<string,[number,number,number]> = {
  Hips:[.14,0,0], Spine02:[-.10,0,0],
  LeftUpLeg:[-.62,.05,0], RightUpLeg:[-.88,-.05,0],
  LeftLeg:[.95,0,0], RightLeg:[1.30,0,0],
  LeftFoot:[-.30,0,0], RightFoot:[-.34,0,0],
  LeftShoulder:[0,0,-.10], RightShoulder:[0,0,.10],
  LeftArm:[-.70,0,.55], RightArm:[-.70,0,-.55],
  LeftForeArm:[.75,0,0], RightForeArm:[.75,0,0],
};
export async function createGame(host:HTMLDivElement, onState:(s:GameState)=>void):Promise<Game> {
  const state:GameState={ready:false,playing:false,progress:'Downloading the campus',error:'',fps:0,location:'Sports complex',x:-20,z:67,motion:'Idle',percent:0,outerPercent:0,outerReady:false,runLock:false,riding:false,canMount:false,quality:'balanced',overview:false};
  const publish=()=>onState({...state});
  const scene=new THREE.Scene();scene.background=new THREE.Color('#bdd7df');const campusFog=new THREE.Fog('#bdd7df',240,700);scene.fog=campusFog;
  const mobile=matchMedia('(pointer:coarse)').matches;
  const renderer=new THREE.WebGLRenderer({antialias:!mobile,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.4:1.25));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  host.appendChild(renderer.domElement);renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Campus: drag to look, on-screen pad to move');
  const camera=new THREE.PerspectiveCamera(58,1,.08,4000);
  camera.position.set(115,145,-50);camera.lookAt(-75,0,120);
  scene.add(new THREE.HemisphereLight(0xd8efff,0x68794c,1.7));
  const sun=new THREE.DirectionalLight(0xfff0d2,2.4);sun.position.set(220,265,-480);scene.add(sun);
  // Library geometry casts soft daylight shadows across its steps and gardens.
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  const shadowSpan=mobile?64:86,shadowSize=mobile?1024:1536;
  sun.castShadow=true;sun.shadow.mapSize.set(shadowSize,shadowSize);
  Object.assign(sun.shadow.camera,{left:-shadowSpan,right:shadowSpan,top:shadowSpan,bottom:-shadowSpan,near:1,far:360});
  sun.shadow.camera.updateProjectionMatrix();
  // The sun stands 27 degrees up, so across one shadow-map texel a flat
  // forecourt drops away by twice the texel's width. The normal offset has to
  // clear the whole filter footprint, one and a half texels for the default
  // radius, or paving and roofs break into bands of moire rings that look like
  // the ground fighting the building.
  sun.shadow.normalBias=1.65*2*shadowSpan/shadowSize;sun.shadow.bias=-.0002;
  scene.add(sun.target);
  // The shadow map follows the student in whole texels of its own grid.
  // Sliding it by fractions of a texel made every shadow edge crawl on the move.
  const SUN_OFFSET=new THREE.Vector3(63,76,-138),sunward=SUN_OFFSET.clone().normalize();
  const sunAcross=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),sunward).normalize(),sunAlong=new THREE.Vector3().crossVectors(sunward,sunAcross);
  const aimSun=(at:THREE.Vector3)=>{
    const texel=(sun.shadow.camera.right-sun.shadow.camera.left)/sun.shadow.mapSize.x;
    const snap=(v:number)=>Math.round(v/texel)*texel;
    sun.target.position.copy(sunAcross).multiplyScalar(snap(at.dot(sunAcross))).addScaledVector(sunAlong,snap(at.dot(sunAlong))).addScaledVector(sunward,at.dot(sunward));
    sun.position.copy(sun.target.position).add(SUN_OFFSET);sun.target.updateMatrixWorld();
  };
  const sky=createSky();scene.add(sky.group);
  const size=()=>{renderer.setSize(host.clientWidth,host.clientHeight);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(size);observer.observe(host);size();
  const keys=new Set<string>();let disposed=false,frame=0;let disposeDaylight=()=>{};
  const cleanupResources=()=>{observer.disconnect();scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const value of Object.values(m))if(value instanceof THREE.Texture)value.dispose();m.dispose();}}});disposeDaylight();renderer.dispose();renderer.domElement.remove();};
  try {
    const draco=new DRACOLoader().setDecoderPath('/draco/');
    const loader=new GLTFLoader().setDRACOLoader(draco);
    const download=createDownloader(({campus:campusPercent,outer:outerPercent})=>{
      if(campusPercent!==state.percent||outerPercent!==state.outerPercent){
        state.percent=campusPercent;state.outerPercent=outerPercent;publish();
      }
    });

    // Everything needed to stand on the ground and walk comes first; the
    // library follows in the background while the campus is already playable.
    const [campusBytes,collisionBytes,studentBytes,treeBytes]=
      await Promise.all(STAGES.campus.map(url=>download.get(url)));
    state.progress='Building the campus';publish();
    // A timer, not a frame: a phone that is switched away mid-load gets no
    // animation frames at all, and the build would stall until it came back.
    await new Promise(resolve=>setTimeout(resolve,0));

    const cameraMeshes:THREE.Mesh[]=[],cameraObstacles:THREE.Mesh[]=[];
    const solidForCamera=(o:THREE.Mesh)=>{cameraMeshes.push(o);if(!CAMERA_PASSES_THROUGH.test((o.material as THREE.Material).name||''))cameraObstacles.push(o);};
    const prepare=(root:THREE.Object3D)=>{root.traverse(o=>{if(o instanceof THREE.Mesh){
      computeBoundsTree.call(o.geometry);o.raycast=acceleratedRaycast;solidForCamera(o);
      const m=o.material as THREE.MeshStandardMaterial;
      if(m.map)m.map.anisotropy=Math.min(mobile?4:8,renderer.capabilities.getMaxAnisotropy());
      if(m.name.includes('full-pitch chalk'))m.color.set('#c5cbb2');
      if(!m.name.startsWith('Library | ')&&/turf|earth|grass|asphalt|clay|ochre|plaster|paver/i.test(m.name)&&!m.map)addSurfaceGrain(m);
    }});};

    const campus=await loader.parseAsync(campusBytes,'');
    scene.add(campus.scene);campus.scene.updateMatrixWorld(true);
    prepare(campus.scene);
    const concert=createConcert();scene.add(concert.root);state.crowdCount=concert.crowdCount;
    concert.root.updateMatrixWorld(true);concert.root.traverse(o=>{if(o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && !(o.material as THREE.Material).transparent){computeBoundsTree.call(o.geometry);o.raycast=acceleratedRaycast;solidForCamera(o);}});

    const colliders=new THREE.Group();
    colliders.add((await loader.parseAsync(collisionBytes,'')).scene,concert.colliders);
    const world=new CollisionWorld(colliders);
    const physics=new PlayerPhysics(world);physics.teleport(-20,.6,67);

    const student=await loader.parseAsync(studentBytes,'');
    // let remotePlayers: RemotePlayers | null = null;
    // let multiplayerRoom: Awaited<ReturnType<typeof joinCampus>> | null = null;
    // let syncElapsed = 0;

    // try {
    //   multiplayerRoom = await joinCampus();

    //   remotePlayers = createRemotePlayers(
    //     scene,
    //     multiplayerRoom,
    //     student.scene,
    //     student.animations,
    //   );
    // } catch (error) {
    //   console.error("[Multiplayer] Initialization failed:", error);
    // }
    const avatar=new THREE.Group();avatar.add(student.scene);scene.add(avatar);
    student.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.frustumCulled=false;o.castShadow=true;}});
    const mixer=new THREE.AnimationMixer(student.scene);const actions=Object.fromEntries(student.animations.map(c=>[c.name,mixer.clipAction(c)]));
    let action=actions.Idle;action.play();mixer.update(0);avatar.position.copy(physics.feet);

    // Each clip parks the hips at its own height, so the idle pose left the
    // shoes hanging above the ground. Measure the lowest toe in every clip and
    // drop the model by that much, which also keeps the capsule truly grounded.
    const toes=['LeftToeBase','RightToeBase','LeftFoot','RightFoot']
      .map(n=>student.scene.getObjectByName(n)).filter(Boolean) as THREE.Object3D[];
    const planted:Record<string,number>={};
    {
      const probe=new THREE.Vector3();
      for(const [name,clip] of Object.entries(actions)){
        for(const other of Object.values(actions))other.stop();
        clip.reset().play();
        let lowest=Infinity;const duration=clip.getClip().duration||1;
        for(let i=0;i<18;i++){
          mixer.setTime(duration*i/18);student.scene.updateMatrixWorld(true);
          for(const toe of toes)lowest=Math.min(lowest,toe.getWorldPosition(probe).y-avatar.position.y);
        }
        planted[name]=Number.isFinite(lowest)?THREE.MathUtils.clamp(.025-lowest,-.16,.12):0;
      }
      for(const other of Object.values(actions))other.stop();
      action=actions.Idle;action.reset().play();mixer.setTime(0);
    }
    let plantOffset=planted.Idle??0;

    const shadow=new THREE.Mesh(new THREE.CircleGeometry(.43,20),new THREE.MeshBasicMaterial({color:0x15261b,transparent:true,opacity:.24,depthWrite:false}));shadow.rotation.x=-Math.PI/2;scene.add(shadow);

    const treeFile=JSON.parse(new TextDecoder().decode(treeBytes)) as TreeFile;
    const roads=treeFile.roads??[];
    // Planting seeds occasionally dropped a trunk on the carriageway. Anything
    // whose trunk sits inside the road corridor is removed here for good.
    const trees=treeFile.trees.filter(t=>
      !onLibraryConnection(t.position[0],t.position[2],t.width*.45+6.4)
      && distanceToRoads(t.position[0],t.position[2],roads)>4.9);
    const stand=createTreeStand(trees,'Campus trees',!mobile);scene.add(stand.group);
    const trunkCollisions=new THREE.Group();
    for(const t of trees){if(t.height<3)continue;const o=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.25,t.width*.07),2.6,Math.max(.25,t.width*.07)));o.position.set(t.position[0],1.3+t.position[1],t.position[2]);trunkCollisions.add(o);}
    const treeWorld=new CollisionWorld(trunkCollisions);
    trunkCollisions.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});

    // Living grass is planted by sampling the lawn surfaces downwards and
    // rejecting anything the walkable collision tree already covers, so it
    // never appears on roads, courts, stages, steps or under buildings.
    const lawns=cameraMeshes.filter(o=>grassHeight((o.material as THREE.Material).name||'')>0);
    const probeRay=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
    const groundHeight=(x:number,z:number)=>{probeRay.origin.set(x,70,z);const hit=world.rayIntersect(probeRay);return hit?hit.position.y:null;};
    let grassProbe=createGrassProbe(lawns,groundHeight);
    const grass=createGrass((x,z)=>grassProbe(x,z));
    scene.add(grass.group);

    // The bicycle is built around the cycling clip rather than the other way
    // round: sample where the hands, hips and feet actually travel, then put
    // the bars, saddle and cranks exactly there. Nothing has to be bent.
    const bone=(name:string)=>student.scene.getObjectByName(name);
    const [leftFoot,rightFoot]=[bone('LeftFoot'),bone('RightFoot')];
    const {fit,crankFoot,lift:rideLift}=(()=>{
      const hands=[bone('LeftHand'),bone('RightHand')].filter(Boolean) as THREE.Object3D[];
      const feet=[leftFoot,rightFoot].filter(Boolean) as THREE.Object3D[];
      const hips=bone('Hips');
      const point=new THREE.Vector3(),hand=new THREE.Vector3(),hip=new THREE.Vector3(),centre=new THREE.Vector3();
      const circle:THREE.Vector3[]=[];let width=0,pedalSide=feet[0];let sideX=0;
      for(const other of Object.values(actions))other.stop();
      actions.Ride.reset().play();
      const duration=actions.Ride.getClip().duration||1;
      const rounds=24;
      for(let i=0;i<rounds;i++){
        mixer.setTime(duration*i/rounds);student.scene.updateMatrixWorld(true);
        for(const hold of hands){avatar.worldToLocal(hold.getWorldPosition(point));hand.add(point);width+=Math.abs(point.x);}
        if(hips){avatar.worldToLocal(hips.getWorldPosition(point));hip.add(point);}
        for(const foot of feet){avatar.worldToLocal(foot.getWorldPosition(point));circle.push(point.clone());centre.add(point);}
        if(feet[0]){avatar.worldToLocal(feet[0].getWorldPosition(point));sideX+=point.x;}
      }
      hand.divideScalar(rounds*Math.max(1,hands.length));width/=rounds*Math.max(1,hands.length);
      hip.divideScalar(rounds);centre.divideScalar(Math.max(1,circle.length));
      let radius=0;for(const p of circle)radius+=Math.hypot(p.y-centre.y,p.z-centre.z);
      radius/=Math.max(1,circle.length);
      // The crank arms start pointing down, so the phase is read from whichever
      // foot is on the negative side of the frame.
      if(sideX>0)pedalSide=feet[1]??feet[0];
      for(const other of Object.values(actions))other.stop();
      actions.Idle.reset().play();mixer.setTime(0);
      // The clip cycles its feet close to the floor, lower than a real bottom
      // bracket. Lift the whole rig so the pedals clear the ground instead.
      const crankRadius=THREE.MathUtils.clamp(radius,.12,.22);
      const lift=Math.max(0,.10-(centre.y-crankRadius));
      return {crankFoot:pedalSide,lift,fit:{crank:{y:centre.y+lift,z:centre.z},crankRadius,
        bar:{x:THREE.MathUtils.clamp(width,.18,.34),y:hand.y+lift,z:hand.z},
        saddle:{y:hip.y+lift,z:hip.z}}};
    })();
    // The bicycle waits beside the sports complex where the walk begins.
    const bicycle=createBicycle(fit);

    
      // ===========================

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
          fit,
        );
      } catch (error) {
        console.error("[Multiplayer] Initialization failed:", error);
      }


      // ============

    scene.add(bicycle.group);

    const parkFloor=world.rayIntersect(new THREE.Ray(new THREE.Vector3(-22.1,10,68.7),new THREE.Vector3(0,-1,0)));
    bicycle.group.position.set(-22.1,parkFloor?parkFloor.position.y:0,68.7);
    bicycle.group.rotation.y=.7;
    const bind=new Map<THREE.Object3D,THREE.Quaternion>();
    for(const name of Object.keys(AIR_POSE)){
      const bone=student.scene.getObjectByName(name);
      if(bone)bind.set(bone,bone.quaternion.clone());
    }
    const poseStep=new THREE.Euler(),poseSpin=new THREE.Quaternion(),poseTarget=new THREE.Quaternion();
    const crankPoint=new THREE.Vector3();
    let ride=0,air=0,offGround=0,rideHeading=0;

    let yaw=0,pitch=.26,distance=mobile?6.2:5.4,drag=false,hasStarted=false,stickX=0,stickY=0;
    let prev=performance.now(),acc=0,frames=0,lastJump=false,eventTime=0;
    let shadowPrimed=false;
    const camRay=new THREE.Raycaster();camRay.firstHitOnly=true;
    const rig=new FollowCamera((origin,ray,far)=>{camRay.set(origin,ray);camRay.far=far;const hit=camRay.intersectObjects(cameraObstacles,false)[0];return hit?hit.distance:null;});
    const direction=new THREE.Vector3(),zero=new THREE.Vector3();
    const follow=(dt:number,snap=false)=>{
      rig.update(dt,avatar.position,state.riding?1.55:1.3,yaw,pitch,distance,snap);
      camera.position.copy(rig.position);camera.lookAt(rig.target);
      avatar.visible=camera.position.distanceTo(rig.target)>1;
    };
    // The student is drawn between the last two physics steps, never at one.
    const stepper=new FixedStep(1/120,12);
    const lastFeet=physics.feet,nextFeet=physics.feet;
    const settle=()=>{stepper.reset();lastFeet.copy(physics.feet);nextFeet.copy(lastFeet);avatar.position.copy(lastFeet);};
    const setPlaying=(v:boolean)=>{if(!state.ready&&v)return;state.playing=v;state.overview=false;scene.fog=campusFog;camera.up.set(0,1,0);sky.group.visible=true;keys.clear();state.runLock=false;stickX=0;stickY=0;drag=false;if(v){hasStarted=true;follow(0,true);renderer.domElement.focus();}publish();};
    const travel=(id:Landmark)=>{const p=LANDMARKS[id];if(!p)throw new Error('Unknown campus destination');if(['library','gallery','admin'].includes(id)&&!state.outerReady)return;const floor=world.rayIntersect(new THREE.Ray(new THREE.Vector3(p.x,10,p.z),new THREE.Vector3(0,-1,0)));physics.teleport(p.x,(floor?floor.position.y:0)+.015,p.z);settle();yaw=p.yaw;pitch=['library','gallery','admin'].includes(id)?-.16:id==='concert'?-.06:.26;avatar.rotation.y=yaw+Math.PI;if(state.riding)parkBicycle();scene.fog=campusFog;camera.up.set(0,1,0);sky.group.visible=true;state.location=p.label;state.x=p.x;state.y=avatar.position.y;state.z=p.z;state.grounded=false;state.overview=false;state.playing=true;state.runLock=false;stickX=0;stickY=0;hasStarted=true;keys.clear();drag=false;follow(0,true);publish();renderer.domElement.focus();};
    const reset=()=>travel('gym');
    const overview=()=>{state.playing=false;state.overview=true;keys.clear();state.runLock=false;avatar.visible=true;scene.fog=null;sky.group.visible=false;const height=Math.max(650,1250/camera.aspect)/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));camera.up.set(0,0,1);camera.position.set(-495,height,200);camera.lookAt(-495,0,200);publish();};
    // High draws the leafy trees; the other settings keep the cheap ones.
    const stands=[stand];
    const setQuality=(q:Quality)=>{if(!['performance','balanced','high'].includes(q))throw new Error('Unknown quality');state.quality=q;grass.setQuality(q);for(const s of stands)s.setLeafy(q==='high');renderer.setPixelRatio(q==='performance'?.75:Math.min(devicePixelRatio,q==='high'?2:mobile?1.4:1.25));size();publish();};
    const input=(key:string,pressed:boolean)=>{if(!state.playing)return;if(pressed)keys.add(key);else keys.delete(key);
      // Reversing releases the sprint lock, the way it does on a game pad.
      if(pressed&&(key==='KeyS'||key==='ArrowDown')&&state.runLock){state.runLock=false;publish();}};
    // Analogue thumb stick: x is strafe, y is forward, both -1 to 1.
    const move=(x:number,y:number)=>{
      if(!state.playing){stickX=0;stickY=0;return;}
      stickX=x;stickY=y;
      if(y<-.35&&state.runLock){state.runLock=false;publish();}
    };
    const toggleRun=()=>{if(!state.playing)return;state.runLock=!state.runLock;publish();};
    const parkBicycle=()=>{
      state.riding=false;student.scene.rotation.z=0;
      const side=new THREE.Vector3(Math.cos(avatar.rotation.y),0,-Math.sin(avatar.rotation.y)).multiplyScalar(1.1);
      const floor=world.rayIntersect(new THREE.Ray(avatar.position.clone().add(side).setY(avatar.position.y+3),new THREE.Vector3(0,-1,0)));
      bicycle.group.position.copy(avatar.position).add(side);
      if(floor)bicycle.group.position.y=floor.position.y;
      bicycle.group.rotation.y=avatar.rotation.y;
    };
    const toggleRide=()=>{
      if(!state.playing)return;
      if(state.riding){parkBicycle();publish();return;}
      if(avatar.position.distanceTo(bicycle.group.position)>MOUNT_RANGE)return;
      state.riding=true;ride=0;rideHeading=avatar.rotation.y-Math.PI;publish();
    };
    const down=(e:KeyboardEvent)=>{if((e.target as HTMLElement)?.closest('select,input,textarea,button'))return;if(e.code==='Escape'){setPlaying(false);return;}if(e.code==='KeyR'&&state.ready){reset();return;}if(e.code==='KeyF'&&state.playing){toggleRide();return;}if(state.playing&&['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();input(e.code,true);}};
    const up=(e:KeyboardEvent)=>keys.delete(e.code);const blur=()=>{if(state.playing)setPlaying(false);};
    const visibility=()=>{if(document.hidden)blur();};
    // Touch never reports movementX, so the drag delta is measured by hand.
    const touches=new Map<number,{x:number;y:number}>();let pinch=0;
    const pointerDown=(e:PointerEvent)=>{if(!state.playing)return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});drag=true;renderer.domElement.setPointerCapture(e.pointerId);};
    const pointerUp=(e:PointerEvent)=>{touches.delete(e.pointerId);if(!touches.size){drag=false;pinch=0;}};
    const pointerMove=(e:PointerEvent)=>{
      const last=touches.get(e.pointerId);if(!last||!state.playing)return;
      const dx=e.clientX-last.x,dy=e.clientY-last.y;
      touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(touches.size>1){
        const [a,b]=[...touches.values()];const spread=Math.hypot(a.x-b.x,a.y-b.y);
        if(pinch)distance=THREE.MathUtils.clamp(distance-(spread-pinch)*.02,2.5,14);
        pinch=spread;return;
      }
      if(!drag)return;
      yaw-=dx*.0055;pitch=THREE.MathUtils.clamp(pitch+dy*.004,-.95,1.08);
    };
    const wheel=(e:WheelEvent)=>{if(state.playing){e.preventDefault();distance=THREE.MathUtils.clamp(distance+e.deltaY*.006,2.5,14);}};
    const lost=()=>{state.error='The 3D display was interrupted. Reload the campus to restore it.';setPlaying(false);};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    const canvas=renderer.domElement;canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointercancel',pointerUp);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('webglcontextlost',lost);

    // The library and the lecture gallery arrive while the campus is already
    // being walked, then the walkable tree is rebuilt to take them in.
    const streamOuter=async()=>{
      const [libraryBytes,libraryCollisionBytes,galleryBytes,galleryCollisionBytes,libraryTreeBytes,galleryTreeBytes,adminBytes,adminCollisionBytes,adminTreeBytes,adminLinkBytes,adminLinkCollisionBytes]=
        await Promise.all(STAGES.outer.map(url=>download.get(url)));
      if(disposed)return;
      const daylight=daylightEnvironment(renderer);disposeDaylight=()=>daylight.dispose();
      const library=await loader.parseAsync(libraryBytes,'');
      applyLibraryMaterials(library.scene,daylight.texture);
      const gallery=await loader.parseAsync(galleryBytes,'');
      const admin=await loader.parseAsync(adminBytes,'');
      applyAdminMaterials(admin.scene,daylight.texture);
      // The administration is exported already enlarged to its campus scale;
      // only a scale changed since that export is left to apply here.
      const adminFile=JSON.parse(new TextDecoder().decode(adminTreeBytes)) as {trees:Tree[];bakedScale?:number};
      const adminScale=ADMIN.scale/(adminFile.bakedScale??1);
      const placeAdmin=(root:THREE.Object3D)=>{root.position.set(ADMIN.x,0,ADMIN.z);root.rotation.y=ADMIN_ROTATION;root.scale.setScalar(adminScale);root.updateMatrixWorld(true);return root;};
      placeAdmin(admin.scene);
      const adminLink=await loader.parseAsync(adminLinkBytes,'');
      for(const outer of [library.scene,gallery.scene,admin.scene,adminLink.scene]){
        outer.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
        scene.add(outer);outer.updateMatrixWorld(true);prepare(outer);
      }
      // Their planting comes as a list, like the campus's, so it grows the
      // same trees at every quality. The trunks are already in the collision.
      const adminTrees=adminFile.trees.map(t=>{const p=new THREE.Vector3(...t.position as [number,number,number]).applyMatrix4(admin.scene.matrixWorld);return {...t,position:p.toArray()};});
      const planted=[libraryTreeBytes,galleryTreeBytes].flatMap(bytes=>JSON.parse(new TextDecoder().decode(bytes)).trees as Tree[]).concat(adminTrees);
      const outerStand=createTreeStand(planted,'Library, gallery and administration trees',!mobile);
      outerStand.setLeafy(state.quality==='high');scene.add(outerStand.group);stands.push(outerStand);
      colliders.add((await loader.parseAsync(libraryCollisionBytes,'')).scene,
        (await loader.parseAsync(galleryCollisionBytes,'')).scene,
        placeAdmin((await loader.parseAsync(adminCollisionBytes,'')).scene),
        (await loader.parseAsync(adminLinkCollisionBytes,'')).scene);
      world.rebuild(colliders);
      grassProbe=createGrassProbe(cameraMeshes.filter(o=>grassHeight((o.material as THREE.Material).name||'')>0),groundHeight);
      state.outerReady=true;state.outerPercent=100;publish();
    };

    function animate(now:number){
      if(disposed)return;frame=requestAnimationFrame(animate);const elapsed=Math.min((now-prev)/1000,.1);prev=now;
      const held=keys.has('ShiftLeft')||keys.has('ShiftRight');
      // Pushing the stick to the rim runs, exactly as a shooter's stick does.
      const running=held||state.runLock||Math.hypot(stickX,stickY)>.86;
      let forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))+stickY;
      const side=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+stickX;
      // Sprint lock keeps running forward on its own until it is released.
      // Auto-run keeps the throttle on while the stick still steers.
      if(state.runLock&&forward>-.02)forward=1;
      if(state.riding){
        // A bicycle is steered, not strafed. Turning rate falls off at a
        // standstill, so it leans into a circle instead of spinning on the spot.
        rideHeading-=side*elapsed*2.4*Math.min(1,Math.hypot(physics.velocity.x,physics.velocity.z)/3.2);
        direction.copy(Math.abs(forward)>.06?movementVector(Math.sign(forward),0,rideHeading):zero);
      }else direction.copy(movementVector(forward,side,yaw));
      const jump=keys.has('Space');if(jump&&!lastJump&&state.playing&&!state.riding)physics.jump();lastJump=jump;
      const speed=state.riding?(running?BICYCLE_SPRINT:BICYCLE_SPEED):(running?5.5:2.25);
      if(state.playing||!hasStarted){
        const blend=stepper.advance(elapsed,step=>{
          lastFeet.copy(nextFeet);
          physics.step(step,state.playing?direction:zero,speed);
          const hit=treeWorld.capsuleIntersect(physics.capsule);if(hit)physics.capsule.translate(hit.normal.multiplyScalar(hit.depth));
          nextFeet.copy(physics.feet);
        });
        avatar.position.lerpVectors(lastFeet,nextFeet,blend);
        if(avatar.position.y < -5 || avatar.position.x < CAMPUS_BOUNDS.minX || avatar.position.x > CAMPUS_BOUNDS.maxX || avatar.position.z < CAMPUS_BOUNDS.minZ || avatar.position.z > CAMPUS_BOUNDS.maxZ)reset();
      }else settle();
      const pace=Math.hypot(physics.velocity.x,physics.velocity.z);
      const moving=state.playing&&direction.lengthSq()>.01&&pace>.12;
      let turn=0;
      if(state.riding){
        // The frame points where it is steered, with no lag to slide against.
        avatar.rotation.set(0,rideHeading+Math.PI,0);
        turn=side;
        // Ease the camera round behind the rider unless it is being dragged.
        if(!drag)yaw+=Math.atan2(Math.sin(rideHeading-yaw),Math.cos(rideHeading-yaw))*(1-Math.exp(-elapsed*2.4));
      }else if(moving){
        const wanted=Math.atan2(direction.x,direction.z);
        const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),wanted);
        avatar.quaternion.slerp(q,1-Math.exp(-elapsed*15));
      }
      const motion=state.riding?'Ride':moving?(running?'Run':'Walk'):'Idle';
      if(motion!==state.motion){action.fadeOut(.2);action=actions[motion];action.reset().setEffectiveWeight(1).fadeIn(.2).play();state.motion=motion;}
      // The legs turn at the speed actually being ridden.
      action.setEffectiveTimeScale(state.riding?THREE.MathUtils.clamp(pace/5,.12,2.2):1);
      mixer.update(elapsed);

      // Riding sits the student on the saddle; leaving the ground tucks the
      // legs. Both blend against whatever the clip just played. Writing the
      // bones outright snapped him into the modelling T-pose the moment the
      // weight rose above zero, which a single bumpy frame was enough to do.
      ride+=((state.riding?1:0)-ride)*(1-Math.exp(-elapsed*9));
      offGround=physics.grounded?0:offGround+elapsed;
      const wantsAir=!state.riding&&state.playing&&offGround>.09?1:0;
      air+=(wantsAir-air)*(1-Math.exp(-elapsed*(wantsAir?18:9)));
      if(air>.004){
        for(const [posed,rest] of bind){
          const offset=AIR_POSE[posed.name];
          if(!offset)continue;
          poseStep.set(offset[0],offset[1],offset[2]);
          poseTarget.copy(rest).multiply(poseSpin.setFromEuler(poseStep));
          posed.quaternion.slerp(poseTarget,air);
        }
      }
      // Keep the shoes on the floor: each clip parks the hips differently.
      const wantedPlant=state.riding?0:planted[state.motion]??0;
      plantOffset+=(wantedPlant-plantOffset)*(1-Math.exp(-elapsed*10));
      student.scene.position.y=plantOffset+ride*rideLift;
      if(ride>.004){
        bicycle.group.position.copy(avatar.position);
        bicycle.group.rotation.y=avatar.rotation.y;
      }
      const lean=bicycle.update(elapsed,state.riding?pace:0,state.riding?turn:0);
      student.scene.rotation.z=ride>.004?lean:0;
      if(ride>.004&&crankFoot){
        // Read the crank angle off the rider's own foot so the pedals can
        // never drift out of step with the legs.
        avatar.worldToLocal(crankFoot.getWorldPosition(crankPoint));crankPoint.y+=rideLift;
        bicycle.setCranks(-Math.PI/2-Math.atan2(crankPoint.y-fit.crank.y,crankPoint.z-fit.crank.z));
      }

      eventTime+=elapsed;concert.update(eventTime);sky.group.position.set(camera.position.x,0,camera.position.z);sky.update(eventTime);
      if(state.playing)follow(elapsed);
      const floor=world.rayIntersect(new THREE.Ray(avatar.position.clone().add(new THREE.Vector3(0,.3,0)),new THREE.Vector3(0,-1,0)));
      shadow.position.set(avatar.position.x,floor?floor.position.y+.025:avatar.position.y+.015,avatar.position.z);shadow.visible=avatar.visible;shadow.scale.setScalar(state.riding?1.5:physics.grounded?1:.8);
      // The depth texture only exists once the shadow pass has run. Leaving
      // autoUpdate off before the first pass bound an ordinary colour texture
      // to the shadow sampler, so every lit draw call failed and the campus
      // rendered as bare sky. Prime it once, then refresh only near the library.
      const wantsShadows=avatar.position.x<-290&&state.quality!=='performance';
      sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=wantsShadows||!shadowPrimed;shadowPrimed=true;
      if(wantsShadows)aimSun(avatar.position);
      grass.update(elapsed,avatar.position,physics.grounded,!!state.overview);
      for(const s of stands)s.update(eventTime);
    remotePlayers?.update(elapsed);

    if (multiplayerRoom) {
      syncElapsed += elapsed;

      if (syncElapsed >= 1 / 30) {
        syncElapsed = 0;

        const snapshot = {
          x: avatar.position.x,
          y: avatar.position.y,
          z: avatar.position.z,
          qx: avatar.quaternion.x,
          qy: avatar.quaternion.y,
          qz: avatar.quaternion.z,
          qw: avatar.quaternion.w,
          animation: state.motion,
        };

        sendPlayerMovement(snapshot);
      }
    }

      renderer.render(scene,camera);acc+=elapsed;frames++;
      if(acc>.35){state.fps=Math.round(frames/acc);state.x=avatar.position.x;state.y=avatar.position.y;state.z=avatar.position.z;state.grounded=physics.grounded;state.draws=renderer.info.render.calls;state.triangles=renderer.info.render.triangles;state.animationTime=action.time;
        const near=!state.riding&&avatar.position.distanceTo(bicycle.group.position)<=MOUNT_RANGE;
        if(near!==state.canMount)state.canMount=near;
        state.location=Math.hypot(avatar.position.x-ADMIN.x,avatar.position.z-ADMIN.z)<115*ADMIN.scale?'Administration building':distanceToRoads(avatar.position.x,avatar.position.z,[ADMIN_ROAD])<15?'NIT Road · Administration':avatar.position.x<-450&&avatar.position.z>245?'Lecture gallery':avatar.position.x<-320?'APJ Abdul Kalam Library':onLibraryConnection(avatar.position.x,avatar.position.z,12)?'Road to the library':Math.abs(avatar.position.z-CONCERT.z)<18&&avatar.position.x>CONCERT.x-65&&avatar.position.x<CONCERT.x+8?'TECNOESIS concert':avatar.position.z<90?'Sports complex':avatar.position.x < -82?'Cricket ground':avatar.position.z>237?'Basketball courts':avatar.position.x<-35?'Between the grounds':'Football ground';
        publish();acc=0;frames=0;}
    }
    state.ready=true;state.progress='Ready';state.percent=100;publish();frame=requestAnimationFrame(animate);
    void streamOuter().catch(e=>{state.progress=`The outlying buildings could not be loaded: ${e.message||e}`;publish();});

    return {
      setPlaying,
      reset,
      travel,
      overview,
      setQuality,
      input,
      move,
      toggleRun,
      toggleRide,

      getState: () => ({ ...state }),

      getMultiplayerSnapshot: () => ({
        x: avatar.position.x,
        y: avatar.position.y,
        z: avatar.position.z,
        qx: avatar.quaternion.x,
        qy: avatar.quaternion.y,
        qz: avatar.quaternion.z,
        qw: avatar.quaternion.w,
        animation: state.motion,
      }),

      dispose() {
        disposed = true;
        cancelAnimationFrame(frame);

        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
        window.removeEventListener('blur', blur);
        document.removeEventListener('visibilitychange', visibility);

        canvas.removeEventListener('pointerdown', pointerDown);
        canvas.removeEventListener('pointerup', pointerUp);
        canvas.removeEventListener('pointercancel', pointerUp);
        canvas.removeEventListener('pointermove', pointerMove);
        canvas.removeEventListener('wheel', wheel);
        canvas.removeEventListener('webglcontextlost', lost);

        mixer.stopAllAction();
        world.clear();
        treeWorld.clear();
        grass.dispose();
        bicycle.dispose();

        for (const s of stands) s.dispose();

        draco.dispose();
        remotePlayers?.dispose();
        void leaveCampus();
        cleanupResources();
      },
    };

  } catch(error){cleanupResources();throw error;}
}

function addSurfaceGrain(material:THREE.MeshStandardMaterial){
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vWorldGrain;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvWorldGrain = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader='varying vec3 vWorldGrain;\nfloat hashGrain(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat noiseGrain(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hashGrain(i),hashGrain(i+vec2(1,0)),f.x),mix(hashGrain(i+vec2(0,1)),hashGrain(i+vec2(1,1)),f.x),f.y);}\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat grain=noiseGrain(vWorldGrain.xz*.18)*.7+noiseGrain(vWorldGrain.xz*8.0)*.3;diffuseColor.rgb *= .80 + grain*.35;');
  };material.customProgramCacheKey=()=> 'campus-grain-v1';
}
