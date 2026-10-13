import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Vector3,Ray} from 'three';
import {CollisionWorld,PlayerPhysics} from '../lib/physics.ts';
import {LIBRARY,LIBRARY_ROAD,onLibraryConnection} from '../lib/campus-layout.ts';
async function load(name:string){const b=readFileSync(`public/assets/${name}.glb`);return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}

test('library export keeps dark granite and a separate, budgeted bronze statue',()=>{
  const bytes=readFileSync('public/assets/library.glb');
  const model=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const granite=model.materials.find((m:{name:string})=>m.name==='Library | plinth');
  assert.ok(granite.pbrMetallicRoughness.baseColorFactor.slice(0,3).every((c:number)=>c<.15),'Procedural material export must retain dark granite');
  const node=model.nodes.find((n:{name:string})=>n.name.startsWith('Kalam statue'));
  assert.ok(node,'The sculpted statue must survive the library export');
  assert.ok(node.translation[1]>2&&node.scale[0]>2,'Statue stands scaled on the plinth top');
  const statue=model.meshes[node.mesh];
  const bronze=model.materials[statue.primitives[0].material];
  assert.equal(bronze.name,'Library | statue cast bronze');
  assert.ok(bronze.pbrMetallicRoughness.metallicFactor>.5,'Cast bronze stays metallic');
  assert.ok(statue.primitives[0].attributes.COLOR_0!==undefined,'Crevice shading travels as vertex colour');
  const triangles=statue.primitives.reduce((total:number,p:{indices:number})=>total+model.accessors[p.indices].count/3,0);
  assert.ok(triangles<70000,`Statue must stay within the browser budget, got ${triangles}`);
  // The colour attribute belongs to the statue alone; joining it onto the
  // building would add an unused channel to a quarter of a million vertices.
  const building=model.nodes.find((n:{name:string})=>!n.name.startsWith('Kalam statue'));
  assert.ok(model.meshes[building.mesh].primitives.every((p:{attributes:Record<string,number>})=>p.attributes.COLOR_0===undefined));
});
test('library is east of cricket with a north-facing entrance and a continuous direct road',async()=>{
  assert.ok(LIBRARY.x < -166);assert.ok(LIBRARY.entrance.z>LIBRARY.z);assert.deepEqual(LIBRARY.front,{x:0,z:1});
  const base=await load('collision');base.add(await load('library-collision'));const world=new CollisionWorld(base);
  for(let i=0;i<LIBRARY_ROAD.length-1;i++){
    const a=LIBRARY_ROAD[i],b=LIBRARY_ROAD[i+1];const direction=new Vector3(b[0]-a[0],0,b[1]-a[1]);const distance=direction.length();direction.normalize();
    const player=new PlayerPhysics(world);player.teleport(a[0],.5,a[1]);
    for(let j=0;j<120;j++)player.step(1/120,new Vector3(),0);
    for(let j=0;j<Math.floor(distance/5.5*120);j++)player.step(1/120,direction,5.5);
    assert.ok(player.grounded,`Road segment ${i} has no floor`);
    assert.ok(Math.hypot(player.feet.x-b[0],player.feet.z-b[1])<.5,`Road segment ${i} blocked at ${player.feet.toArray()}`);
    assert.ok(onLibraryConnection((a[0]+b[0])/2,(a[1]+b[1])/2));
  }
  for(const [x,z] of [[-405,258],[-399,243],[-405,230]]){
    const p=new PlayerPhysics(world);p.teleport(x,1,z);for(let i=0;i<240;i++)p.step(1/120,new Vector3(),0);assert.ok(p.grounded,`Courtyard floor missing ${x},${z}`);
  }
  const ray=world.rayIntersect(new Ray(new Vector3(-405,1.8,263),new Vector3(0,0,-1)));
  assert.ok(ray&&ray.position.z<247,'Open gate must not block the approach');
});
