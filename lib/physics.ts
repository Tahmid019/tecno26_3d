import { Vector3, Ray, Box3, Object3D, Triangle, DoubleSide, Line3 } from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh';

// A BVH stores each triangle once. The large, thin campus surfaces caused
// exponential triangle duplication in the previous recursive octree.
export class CollisionWorld {
  geometry!:ReturnType<StaticGeometryGenerator['generate']>;
  bvh!:MeshBVH;
  constructor(group:Object3D){this.rebuild(group);}
  /** The library streams in after the campus is already walkable. */
  rebuild(group:Object3D){
    group.updateWorldMatrix(true,true);
    const generator=new StaticGeometryGenerator(group);generator.attributes=['position'];
    const geometry=generator.generate();geometry.clearGroups();
    this.geometry?.dispose();
    this.geometry=geometry;
    this.bvh=new MeshBVH(geometry,{targetLeafSize:12});
  }
  capsuleIntersect(capsule:Capsule){
    const trial=capsule.clone();const bounds=new Box3().makeEmpty().expandByPoint(trial.start).expandByPoint(trial.end).expandByScalar(trial.radius);
    let collided=false;const segment=new Line3();const onTriangle=new Vector3(),onCapsule=new Vector3();
    this.bvh.shapecast({intersectsBounds:box=>box.intersectsBox(bounds),intersectsTriangle:triangle=>{
      segment.set(trial.start,trial.end);
      const distance=triangle.closestPointToSegment(segment,onTriangle,onCapsule);
      if(distance<trial.radius-1e-8){
        const normal=onCapsule.clone().sub(onTriangle);
        if(distance>1e-7)normal.divideScalar(distance);else triangle.getNormal(normal);
        trial.translate(normal.multiplyScalar(trial.radius-distance));collided=true;
      }
      return false;
    }});
    if(!collided)return false;
    const normal=trial.start.clone().sub(capsule.start);const depth=normal.length();
    return {normal:normal.normalize(),depth};
  }
  rayIntersect(ray:Ray){
    const hit=this.bvh.raycastFirst(ray,DoubleSide);if(!hit||!hit.face)return false;
    const p=this.geometry.getAttribute('position');const triangle=new Triangle(new Vector3().fromBufferAttribute(p,hit.face.a),new Vector3().fromBufferAttribute(p,hit.face.b),new Vector3().fromBufferAttribute(p,hit.face.c));
    return {distance:hit.distance,position:hit.point,triangle};
  }
  clear(){this.geometry.dispose();}
}

export class PlayerPhysics {
  readonly capsule = new Capsule(new Vector3(), new Vector3(), .3);
  readonly velocity = new Vector3();
  grounded = false;
  /**
   * Further solid worlds, walked on and pushed against like the main one:
   * hedges, nets, parked cars and scooters, lamp posts and the like, which
   * the people on campus and the ground probes must not see.
   */
  readonly extra: CollisionWorld[] = [];
  /** The hardest a wall stopped the body since this was last reset, in m/s. */
  impact = 0;
  private readonly ray = new Ray();
  private readonly delta = new Vector3();
  constructor(readonly world: CollisionWorld) { this.teleport(-20, 1, 70); }
  /** The deepest overlap with any of the worlds. */
  private hit(capsule: Capsule) {
    let best = this.world.capsuleIntersect(capsule);
    for (const world of this.extra) {
      const hit = world.capsuleIntersect(capsule);
      if (hit && (!best || hit.depth > best.depth)) best = hit;
    }
    return best;
  }
  /** The nearest floor under a ray in any of the worlds. */
  private floor(ray: Ray) {
    let best = this.world.rayIntersect(ray);
    for (const world of this.extra) {
      const hit = world.rayIntersect(ray);
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best;
  }
  teleport(x:number, y:number, z:number) {
    this.capsule.start.set(x,y+.3,z);this.capsule.end.set(x,y+1.43,z);
    this.velocity.set(0,0,0);this.grounded=false;
  }
  get feet() { return this.capsule.start.clone().add(new Vector3(0,-.3,0)); }
  jump() { if(this.grounded){this.velocity.y=6;this.grounded=false;} }
  /**
   * `accel` is how quickly the body reaches the speed it is pushed to, per
   * second: on foot it is near enough at once, a bicycle takes a moment.
   */
  step(dt:number, direction:Vector3, speed:number, accel?:number) {
    const damp=1-Math.exp(-dt*(this.grounded?accel??18:Math.min(accel??6,6)));
    this.velocity.x+=(direction.x*speed-this.velocity.x)*damp;
    this.velocity.z+=(direction.z*speed-this.velocity.z)*damp;
    this.velocity.y-=18*dt;
    const old=this.capsule.clone();const wasGrounded=this.grounded;
    this.delta.copy(this.velocity).multiplyScalar(dt);this.capsule.translate(this.delta);
    this.grounded=false;
    for(let i=0;i<3;i++) {
      const hit=this.hit(this.capsule);
      if(!hit || hit.depth<1e-7)break;
      // Step onto ordinary curbs/stairs without pushing through a wall.
      if(wasGrounded && Math.abs(hit.normal.y)<.45 && direction.lengthSq()>.01){
        const trial=old.clone();trial.translate(new Vector3(this.delta.x,.36,this.delta.z));
        const obstruction=this.hit(trial);
        // Look for the tread just past the riser, not under the capsule's
        // centre: pressed against a riser the centre is a whole radius back,
        // still over the lower step, so anything taller than the capsule could
        // roll over (about 0.25 m) was taken for a wall.
        const into=new Vector3(-hit.normal.x,0,-hit.normal.z);
        if(into.lengthSq()>1e-8)into.setLength(this.capsule.radius+.06);
        this.ray.set(trial.start.clone().add(into).add(new Vector3(0,-.29,0)),new Vector3(0,-1,0));
        const floor=this.floor(this.ray);
        if((!obstruction||obstruction.depth<.015)&&floor&&floor.distance<.39&&Math.abs(floor.triangle.getNormal(new Vector3()).y)>.6){
          trial.translate(new Vector3(0,-floor.distance+.01,0));
          const fits=this.hit(trial);
          if(!fits||fits.depth<.015){this.capsule.copy(trial);this.velocity.y=0;this.grounded=true;break;}
        }
      }
      this.capsule.translate(hit.normal.clone().multiplyScalar(hit.depth+1e-5));
      if(hit.normal.y>.5){this.grounded=true;this.velocity.y=Math.max(0,this.velocity.y);}
      else {const inward=this.velocity.dot(hit.normal);if(inward<0){this.velocity.addScaledVector(hit.normal,-inward);if(Math.abs(hit.normal.y)<.5)this.impact=Math.max(this.impact,-inward);}}
    }
  }
}

export function movementVector(forward:number,side:number,yaw:number) {
  return new Vector3(-Math.sin(yaw)*forward+Math.cos(yaw)*side,0,-Math.cos(yaw)*forward-Math.sin(yaw)*side).normalize();
}
