import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Group,Vector3,Ray} from 'three';
import {CollisionWorld,PlayerPhysics} from '../lib/physics.ts';
import {ADMIN,ADMIN_ROTATION,ADMIN_ROAD,GALLERY,adminPoint,distanceToRoads} from '../lib/campus-layout.ts';

type Planting={trees:{name:string;position:number[]}[];bakedScale?:number};
const exported=JSON.parse(readFileSync('public/assets/admin-trees.json','utf8')) as Planting;
async function load(name:string){const b=readFileSync(`public/assets/${name}.glb`);return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
async function fixture(){
  const group=new Group();group.add(await load('collision'),await load('gallery-collision'),await load('library-collision'),await load('admin-link-collision'));
  // Placed as the game places it: the export is already drawn at its campus scale.
  const admin=await load('admin-collision');admin.position.set(ADMIN.x,0,ADMIN.z);admin.rotation.y=ADMIN_ROTATION;
  admin.scale.setScalar(ADMIN.scale/(exported.bakedScale??1));group.add(admin);
  return new CollisionWorld(group);
}
const floorAt=(world:CollisionWorld,x:number,z:number)=>world.rayIntersect(new Ray(new Vector3(x,40,z),new Vector3(0,-1,0)));
test('administration export is drawn at the placement scale',()=>{
  assert.equal(exported.bakedScale,ADMIN.scale,'Re-run prepare_admin.py after changing the placement scale');
  assert.ok(ADMIN.scale>1.2&&ADMIN.scale<1.3,'The building is drawn a quarter larger than the supplied model');
});
test('administration road has paved coverage across every segment and joins its source street',async()=>{
  const world=await fixture();
  assert.ok(Math.abs((GALLERY.x-ADMIN.x)-410)<5,'Keep administration about 410m east of gallery');
  assert.ok(ADMIN.front.x<0&&ADMIN.front.z>0,'Main entrance faces northeast');
  for(let segment=1;segment<ADMIN_ROAD.length;segment++){
    const a=ADMIN_ROAD[segment-1],b=ADMIN_ROAD[segment];
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/length,nz=(b[0]-a[0])/length;
    for(let s=1;s<40;s++)for(const offset of [-2.8,0,2.8]){
      const x=a[0]+(b[0]-a[0])*s/40+nx*offset,z=a[1]+(b[1]-a[1])*s/40+nz*offset;
      const hit=world.rayIntersect(new Ray(new Vector3(x,1,z),new Vector3(0,-1,0)));
      assert.ok(hit&&hit.position.y>.02,`Paving gap on segment ${segment} offset ${offset} at ${x},${z}`);
    }
  }
  const start=adminPoint(39.5,70),finish=adminPoint(39.5,55);
  const player=new PlayerPhysics(world);player.teleport(start.x,.15,start.z);
  for(let i=0;i<120;i++)player.step(1/120,new Vector3(),0);
  const direction=new Vector3(finish.x-start.x,0,finish.z-start.z).normalize();
  for(let i=0;i<8*120;i++)player.step(1/120,direction,2.25);
  assert.ok(player.grounded&&player.feet.distanceTo(new Vector3(start.x,player.feet.y,start.z))>16,'Walk across connecting road seam');
  world.clear();
});
test('the front street carries on past both ends of the plot',async()=>{
  const world=await fixture();
  for(const x of [-150,-100,100,150]){
    const p=adminPoint(x,-39.5),hit=floorAt(world,p.x,p.z);
    assert.ok(hit&&hit.position.y>.02&&hit.position.y<.1,`No carriageway at source x ${x}: ${hit?hit.position.y:'nothing'}`);
  }
  world.clear();
});
test('admin spawn and rotated ramp are grounded and walk up to the raised courtyard',async()=>{
  const world=await fixture();
  const podium=3*ADMIN.scale;
  const start=adminPoint(-2.8,-39.5),finish=adminPoint(-2.8,-4.5);
  const player=new PlayerPhysics(world);player.teleport(start.x,.1,start.z);
  for(let i=0;i<120;i++)player.step(1/120,new Vector3(),0);
  const direction=new Vector3(finish.x-start.x,0,finish.z-start.z).normalize();
  for(let i=0;i<30*120&&Math.hypot(player.feet.x-finish.x,player.feet.z-finish.z)>.3;i++)player.step(1/120,direction,2.25);
  assert.ok(player.grounded,'Ramp must keep the player on the ground');
  assert.ok(Math.abs(player.feet.y-podium)<.03,`Expected the raised podium at ${podium}m, got ${player.feet.y}`);
  assert.ok(Math.hypot(player.feet.x-finish.x,player.feet.z-finish.z)<.5,`Ramp passage must not be blocked: ${player.feet.toArray()} expected ${finish.x},${finish.z}`);
  const spawn=new PlayerPhysics(world);spawn.teleport(ADMIN.entrance.x,1,ADMIN.entrance.z);
  for(let i=0;i<120;i++)spawn.step(1/120,new Vector3(),0);
  assert.ok(spawn.grounded&&spawn.feet.y>=0,'Destination spawn has a stable floor');world.clear();
});
test('the courtyard between the blocks is clear to walk across',async()=>{
  const world=await fixture();
  // Where the supplied model parked an MPV and a sedan, source metres.
  for(const [x,y] of [[-4.2,7.2],[-7.2,.6],[-2,4]]){
    const p=adminPoint(x,y),hit=floorAt(world,p.x,p.z);
    assert.ok(hit&&Math.abs(hit.position.y-3*ADMIN.scale)<.05,`Courtyard at ${x},${y} is not bare podium: ${hit?hit.position.y:'nothing'}`);
  }
  world.clear();
});
test('no administration tree stands on a carriageway',()=>{
  const scale=exported.bakedScale??1;
  for(const tree of exported.trees){
    // Back to the supplied model's plan: x across the front, y towards the back.
    const x=tree.position[0]/scale,y=-tree.position[2]/scale;
    // Carriageways: the front street spans y -43..-36, the side road x 36..43.
    assert.ok(!(y>-43.5&&y<-35.5),`${tree.name} stands on the front street`);
    assert.ok(!(x>35.5&&x<43.5&&y>-36),`${tree.name} stands on the side road`);
    const world=adminPoint(x,y);
    assert.ok(distanceToRoads(world.x,world.z,[ADMIN_ROAD])>5,`${tree.name} stands on NIT Road`);
  }
});
