import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Group, Mesh, BoxGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CollisionWorld, PlayerPhysics, movementVector } from '../lib/physics.ts';
import { distanceToRoads } from '../lib/campus-layout.ts';

const zero=new Vector3();
const tick=(p:PlayerPhysics,seconds:number,direction=zero,speed=0)=>{for(let i=0;i<seconds*120;i++)p.step(1/120,direction,speed);};
function fixture(){const g=new Group();const ground=new Mesh(new BoxGeometry(40,1,40));ground.position.y=-.5;g.add(ground);const wall=new Mesh(new BoxGeometry(8,5,.2));wall.position.set(0,2.5,-3);g.add(wall);return new CollisionWorld(g);}
test('ground contact, wall collision, and stopping after input release',()=>{const p=new PlayerPhysics(fixture());p.teleport(0,1,0);tick(p,1);assert.ok(p.grounded);assert.ok(Math.abs(p.feet.y)<.01);tick(p,3,new Vector3(0,0,-1),5.5);assert.ok(p.feet.z> -2.61 && p.feet.z< -2.55,`wall z=${p.feet.z}`);const z=p.feet.z;tick(p,1);assert.ok(Math.abs(p.feet.z-z)<.02);});
test('jump lands back on the floor and cannot jump in mid-air',()=>{const p=new PlayerPhysics(fixture());p.teleport(0,0,0);tick(p,.1);p.jump();tick(p,.2);assert.ok(p.feet.y>.65);const velocity=p.velocity.y;p.jump();assert.equal(p.velocity.y,velocity);tick(p,1);assert.ok(p.grounded);assert.ok(Math.abs(p.feet.y)<.01);});
test('camera relative directions stay normalized, including diagonals',()=>{assert.equal(movementVector(1,1,.4).length().toFixed(7),'1.0000000');assert.equal(movementVector(0,0,0).length(),0);assert.deepEqual(movementVector(1,0,0).toArray(),[0,0,-1]);});
test('ordinary curb is traversable while tall walls remain solid',()=>{const g=new Group();const floor=new Mesh(new BoxGeometry(20,1,20));floor.position.y=-.5;g.add(floor);const curb=new Mesh(new BoxGeometry(10,.2,3));curb.position.set(0,.1,-3);g.add(curb);const p=new PlayerPhysics(new CollisionWorld(g));p.teleport(0,0,0);tick(p,1.1,new Vector3(0,0,-1),2.25);assert.ok(p.feet.z< -1.7);assert.ok(p.feet.y>.18&&p.feet.y<.23);});
test('all actual campus spawn points have a stable floor and the cricket strip is raised correctly',async()=>{const buf=readFileSync('public/assets/collision.glb');const model=await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength),'');const world=new CollisionWorld(model.scene);for(const [x,z,y] of [[-20,67,-.05],[12,135,.085],[-157,149,.065],[-13,242,-.05],[-166,164,.114]]){const p=new PlayerPhysics(world);p.teleport(x,1,z);tick(p,2);assert.ok(p.grounded,`ungrounded at ${x},${z}`);assert.ok(Math.abs(p.feet.y-y)<.02,`floor at ${x},${z}: ${p.feet.y}`);}const p=new PlayerPhysics(world);p.teleport(0,1,65);tick(p,8,new Vector3(0,0,-1),5.5);assert.ok(p.feet.z>49,`crossed gym wall: ${p.feet.z}`);});
test('packed character has one mesh, four compatible clips, and no horizontal root drift',()=>{const b=readFileSync('public/assets/student.glb');const n=b.readUInt32LE(12);const d=JSON.parse(b.subarray(20,20+n).toString());const bin=b.subarray(28+n);assert.equal(d.meshes.length,1);assert.deepEqual(d.animations.map((a:{name:string})=>a.name),['Walk','Run','Idle','Ride']);for(const a of d.animations){const ch=a.channels.find((c:{target:{node:number;path:string}})=>d.nodes[c.target.node].name==='Hips'&&c.target.path==='translation');const acc=d.accessors[a.samplers[ch.sampler].output];const view=d.bufferViews[acc.bufferView];const offset=(view.byteOffset||0)+(acc.byteOffset||0);for(let i=0;i<acc.count;i++){assert.equal(bin.readFloatLE(offset+i*12),0);assert.equal(bin.readFloatLE(offset+i*12+8),0);}}});

test('standing on the real campus is grounded, and the jump leaves it and lands', async () => {
  const buffer = readFileSync('public/assets/collision.glb');
  const model = await new GLTFLoader().parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const world = new CollisionWorld(model.scene);
  const player = new PlayerPhysics(world);
  player.teleport(-20, 1, 67);
  tick(player, 2);
  assert.ok(player.grounded, 'the student must be standing on the ground, not hovering above it');
  const resting = player.feet.y;
  player.jump();
  assert.ok(!player.grounded);
  let peak = resting;
  for (let i = 0; i < 120; i++) { tick(player, 1 / 120); peak = Math.max(peak, player.feet.y); }
  assert.ok(peak - resting > .7, `jump should clear at least 70 cm, reached ${(peak - resting).toFixed(2)}`);
  tick(player, 2);
  assert.ok(player.grounded, 'the student must land again');
  assert.ok(Math.abs(player.feet.y - resting) < .02, `landed at ${player.feet.y} instead of ${resting}`);
});

test('no tree is planted in a carriageway', () => {
  const asset = JSON.parse(readFileSync('public/assets/trees.json', 'utf8'));
  assert.ok(Array.isArray(asset.roads) && asset.roads.length, 'road centre lines ship with the trees');
  const planted = asset.trees.filter((t: {position: number[]}) =>
    distanceToRoads(t.position[0], t.position[2], asset.roads) > 4.9);
  assert.ok(planted.length > 250, `too much vegetation removed: ${planted.length}`);
  for (const tree of planted) {
    const clearance = distanceToRoads(tree.position[0], tree.position[2], asset.roads);
    assert.ok(clearance > 4.9, `trunk ${clearance.toFixed(2)} m from a road centre line`);
  }
});
