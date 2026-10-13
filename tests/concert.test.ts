import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Group,Mesh,BoxGeometry,Vector3,Ray} from 'three';
import {createConcert,CONCERT} from '../lib/concert.ts';
import {CollisionWorld,PlayerPhysics} from '../lib/physics.ts';
test('concert faces the football entrance with aligned colliders and a clear audience aisle',()=>{
  const event=createConcert();assert.equal(event.crowdCount,120);assert.deepEqual(event.root.position.toArray(),[34,.085,170]);
  const entrance=new Vector3(-49.5,.085,170);
  const facing=new Vector3(0,0,1).applyQuaternion(event.root.quaternion);
  assert.ok(facing.dot(entrance.sub(event.root.position).normalize())>.9999,'stage front must face the entrance');
  assert.deepEqual(event.colliders.quaternion.toArray(),event.root.quaternion.toArray());
  const g=new Group();const ground=new Mesh(new BoxGeometry(120,.1,160));ground.position.set(12,.035,170);g.add(ground,event.colliders);const world=new CollisionWorld(g);
  const deck=world.rayIntersect(new Ray(new Vector3(CONCERT.x,5,CONCERT.z),new Vector3(0,-1,0)));assert.ok(deck);assert.ok(Math.abs(deck.position.y-1.185)<.01);
  const player=new PlayerPhysics(world);player.teleport(-12,.1,170);for(let i=0;i<120*12;i++)player.step(1/120,new Vector3(1,0,0),2.25);assert.ok(player.feet.x>14,`aisle blocked at ${player.feet.x}`);assert.ok(player.grounded);
  event.update(1);event.update(2);assert.equal(event.crowdCount,120);
});
