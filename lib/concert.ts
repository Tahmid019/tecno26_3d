import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Spot, Role } from './audience.ts';

// +X is west and +Z is north. Face the shared-road football entrance
// at (-49.5, 170), with the stage centered on its sightline across the field.
export const CONCERT = { x:34, z:170, yaw:-Math.PI/2, width:22, depth:10, audienceCount:120 };
export function createConcert() {
  const root=new T.Group();root.name='TECNOESIS | Football ground concert';root.position.set(CONCERT.x,.085,CONCERT.z);
  root.rotation.y=CONCERT.yaw;
  const colliders=new T.Group();colliders.position.copy(root.position);colliders.rotation.copy(root.rotation);
  const buckets=new Map<T.Material,T.BufferGeometry[]>();
  // Named so the camera boom can tell a truss it may pass through from the deck.
  const mat=(color:string,name:string,metalness=0)=>Object.assign(new T.MeshStandardMaterial({color,roughness:metalness?.35:.85,metalness}),{name:'Concert | '+name});
  const black=mat('#11151d','rigging black'),deck=mat('#262334','stage deck'),silver=mat('#b7c8d2','truss silver',.8),curtain=mat('#17182c','backdrop curtain'),purple=mat('#38233d','deck skirt'),steel=mat('#363d48','steel',.5),gold=mat('#d8ac53','cymbal gold',.65);
  const cyan=new T.MeshBasicMaterial({color:'#61edff'}),pink=new T.MeshBasicMaterial({color:'#ed6dff'}),white=new T.MeshBasicMaterial({color:'#eefaff'});
  const add=(g:T.BufferGeometry,m:T.Material,pos:number[],scale=[1,1,1],rotation=new T.Euler())=>{const matrix=new T.Matrix4().compose(new T.Vector3(...pos),new T.Quaternion().setFromEuler(rotation),new T.Vector3(...scale));g.applyMatrix4(matrix);const a=buckets.get(m)||[];a.push(g);buckets.set(m,a);};
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:T.Material,solid=false)=>{add(new T.BoxGeometry(w,h,d),m,[x,y,z]);if(solid){const o=new T.Mesh(new T.BoxGeometry(w,h,d));o.position.set(x,y,z);colliders.add(o);}};
  const rod=(a:number[],b:number[],radius:number,m:T.Material)=>{const v1=new T.Vector3(...a),v2=new T.Vector3(...b),delta=v2.clone().sub(v1);const g=new T.CylinderGeometry(radius,radius,delta.length(),6);g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),delta.normalize()));g.translate(...v1.add(v2).multiplyScalar(.5).toArray());const list=buckets.get(m)||[];list.push(g);buckets.set(m,list);};
  const truss=(a:number[],b:number[])=>{const start=new T.Vector3(...a),end=new T.Vector3(...b),axis=end.clone().sub(start).normalize();const across=Math.abs(axis.y)>.9?new T.Vector3(1,0,0):new T.Vector3(0,1,0);const other=new T.Vector3().crossVectors(axis,across);const corners=[[-1,-1],[-1,1],[1,1],[1,-1]].map(([u,v])=>across.clone().multiplyScalar(u*.24).addScaledVector(other,v*.24));for(const c of corners)rod(start.clone().add(c).toArray(),end.clone().add(c).toArray(),.035,silver);const n=Math.ceil(start.distanceTo(end)/.8);for(let i=0;i<n;i++){const p=start.clone().lerp(end,i/n),q=start.clone().lerp(end,(i+1)/n);for(let j=0;j<4;j++){rod(p.clone().add(corners[j]).toArray(),q.clone().add(corners[(j+1)%4]).toArray(),.022,silver);rod(p.clone().add(corners[j]).toArray(),p.clone().add(corners[(j+1)%4]).toArray(),.026,silver);}}};
  box(0,.55,0,22,1.1,10,deck,true);box(0,.59,5.025,22,.96,.06,purple);
  box(0,8.65,0,23,.16,11,black);
  box(0,4.55,-4.75,21,6.9,.16,curtain,true);
  for(const x of [-11,11])for(const z of [-5,5]){truss([x,.1,z],[x,8.5,z]);box(x,.16,z,1,.25,1,steel,true);}
  for(const z of [-5,5])truss([-11,8.5,z],[11,8.5,z]);
  for(const x of [-11,11])truss([x,8.5,-5],[x,8.5,5]);
  truss([-10.5,7,-3],[10.5,7,-3]);
  // Broad stairs at the side give the student a walkable route onto the stage.
  for(let i=0;i<6;i++)box(12.9-i*.35,.09+i*.09,2.8,.42,.18+i*.18,3,steel,true);
  // LED wall and front sign use locally drawn lettering, not the reference photo.
  const screen=new T.MeshBasicMaterial({color:'#75d9ff',map:signTexture(false),toneMapped:false});
  box(0,4.25,-4.60,14.8,4.7,.13,black);
  add(new T.PlaneGeometry(14.4,4.35),screen,[0,4.25,-4.50]);
  add(new T.PlaneGeometry(14.8,1.35),new T.MeshBasicMaterial({map:signTexture(true),color:'#ffffff',toneMapped:false}),[0,8.23,5.3]);
  // Hanging line arrays, subwoofers, monitors and small grille details.
  for(const side of [-1,1]){
    for(let i=0;i<7;i++){const y=7.25-i*.47;box(side*9.15,y,3.9,1.13,.43,.8,black);box(side*9.15,y,4.315,.96,.31,.025,steel);}
    rod([side*9.15,7.45,3.9],[side*9.15,8.5,3.9],.035,steel);
    for(let i=0;i<2;i++){box(side*(8.8+i*1.3),.77,5.65,1.2,1.4,1.3,black,true);for(const dy of [-.32,.32])add(new T.CylinderGeometry(.23,.23,.025,16),steel,[side*(8.8+i*1.3),.77+dy,6.315],[1,1,1],new T.Euler(Math.PI/2,0,0));}
    box(side*5,1.32,4.1,1.35,.42,.7,black);
  }
  const lightDots:T.Mesh[]=[];const beams:T.Mesh[]=[];
  for(let i=0;i<12;i++){
    const x=-9+i*18/11;box(x,7.6,4.85,.28,.36,.38,black);
    const dot=new T.Mesh(new T.SphereGeometry(.11,8,6),i%2?cyan:pink);dot.position.set(x,7.43,5.03);root.add(dot);lightDots.push(dot);
    if(i%3===0){const beam=new T.Mesh(new T.ConeGeometry(1.65,7.4,16,1,true),new T.MeshBasicMaterial({color:i%2?'#66ddff':'#cf6aff',transparent:true,opacity:.055,blending:T.AdditiveBlending,side:T.DoubleSide,depthWrite:false}));beam.position.set(x,3.65,4);beam.rotation.z=(i-5)*.025;root.add(beam);beams.push(beam);}
  }
  // Bass drum, toms, cymbals, microphones, keyboard and two guitars.
  add(new T.CylinderGeometry(.58,.58,.6,20),mat('#164061','drum shell',.5),[0,1.72,-.7],[1,1,1],new T.Euler(Math.PI/2,0,0));
  add(new T.CylinderGeometry(.54,.54,.02,20),black,[0,1.72,-.385],[1,1,1],new T.Euler(Math.PI/2,0,0));
  for(const x of [-.65,.65]){add(new T.CylinderGeometry(.3,.3,.35,14),steel,[x,2.17,-1]);add(new T.CylinderGeometry(.29,.29,.015,14),white,[x,2.355,-1]);}
  for(const [x,z] of [[-1.3,-1.5],[1.2,-1.3],[.95,.05]]){rod([x,1.12,z],[x,2.5,z],.018,silver);add(new T.CylinderGeometry(.37,.37,.025,20),gold,[x,2.5,z]);for(const a of [0,2.1,4.2])rod([x,1.3,z],[x+Math.cos(a)*.3,1.12,z+Math.sin(a)*.3],.018,silver);}
  box(-4,2.07,0,2,.15,.65,black);box(-4,2.15,.22,1.8,.04,.18,white);rod([-4.6,1.1,0],[-3.4,2,0],.03,steel);rod([-3.4,1.1,0],[-4.6,2,0],.03,steel);
  for(const x of [-6,0,5]){rod([x,1.12,2.5],[x,2.62,2.5],.025,steel);rod([x,2.62,2.5],[x,2.7,2.15],.025,black);for(const a of [0,2.1,4.2])rod([x,1.25,2.5],[x+Math.cos(a)*.27,1.12,2.5+Math.sin(a)*.27],.018,steel);}
  // Crowd control rails have a clear central entrance and side access.
  for(const x of [-8,8]){rod([x-5,.98,9],[x+5,.98,9],.03,silver);rod([x-5,.3,9],[x+5,.3,9],.025,silver);for(let j=0;j<=20;j++)rod([x-5+j*.5,.08,9],[x-5+j*.5,.98,9],.02,silver);const guard=new T.Mesh(new T.BoxGeometry(10,.95,.08));guard.position.set(x,.5,9);colliders.add(guard);}
  for(const [material,geometries] of buckets){const flat=geometries.map(g=>g.index?g.toNonIndexed():g);const merged=mergeGeometries(flat,false);if(merged){const mesh=new T.Mesh(merged,material);mesh.name='Concert static structure';root.add(mesh);}for(const g of new Set([...geometries,...flat]))g.dispose();}
  const audience=audienceSpots(),band=bandSpots();
  for(const p of audience){const o=new T.Mesh(new T.BoxGeometry(.48,1.65,.4));o.position.set(p.x,.84,p.z);colliders.add(o);}
  // The lights on the front truss, for the stage wash at night (in the root's frame).
  const washes=[-8,0,8].map(x=>new T.Vector3(x,7.4,5.2));
  let night=0;
  return {root,colliders,audience,band,washes,crowdCount:audience.length,
    /** Beams show up against the dark; by day they are barely there. */
    setNight(level:number){night=level;},
    update(time:number){for(let i=0;i<beams.length;i++){(beams[i].material as T.MeshBasicMaterial).opacity=(.043+.017*(1+Math.sin(time*.7+i)))*(1+night*2.2);beams[i].rotation.z=Math.sin(time*.35+i)*.11;}for(let i=0;i<lightDots.length;i++)lightDots[i].scale.setScalar(.88+.12*Math.sin(time*1.2+i)+night*.5);}};
}

function signTexture(header:boolean){
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=1536;canvas.height=header?160:512;const c=canvas.getContext('2d')!;
  const gradient=c.createLinearGradient(0,0,1536,canvas.height);gradient.addColorStop(0,'#03111e');gradient.addColorStop(.55,'#083d67');gradient.addColorStop(1,'#281447');c.fillStyle=gradient;c.fillRect(0,0,1536,canvas.height);
  c.strokeStyle='#43cce655';c.lineWidth=3;for(let i=-12;i<16;i++){c.beginPath();c.moveTo(i*160,0);c.lineTo(i*160+400,canvas.height);c.stroke();}
  c.textAlign='center';c.textBaseline='middle';c.font=`italic 900 ${header?105:138}px Arial`;c.shadowColor='#54dfff';c.shadowBlur=18;c.fillStyle='#e9fcff';c.fillText('TECNOESIS',768,header?79:225);c.shadowBlur=0;
  if(!header){c.font='500 28px Arial';c.fillStyle='#a2dff7';c.fillText('LIVE AT NIT SILCHAR',768,336);c.fillStyle='#e071ef';c.fillRect(558,390,420,4);}
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;return texture;
}

/**
 * Where the audience stands: packed near the barrier and thinning out towards
 * the back, friends in little knots, a clear aisle down the middle.
 */
export function audienceSpots(count=120): Spot[] {
  let seed=21463;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const spots:Spot[]=[];
  for(let tries=0;spots.length<count&&tries<40000;tries++){
    // Every fourth person comes with a friend or two close by.
    const near=spots.length&&random()<.3?spots[Math.floor(random()*spots.length)]:null;
    const x=near?near.x+(random()-.5)*1.8:(random()<.5?-1:1)*(1.7+random()*10);
    const z=near?near.z+(random()-.5)*1.6:10.6+Math.pow(random(),1.7)*31;
    if(Math.abs(x)<1.6||Math.abs(x)>12||z<10.4||z>42||spots.some(o=>Math.hypot(o.x-x,o.z-z)<.74))continue;
    // The front few rows are the loudest.
    spots.push({x,z,y:0,scale:.91+random()*.15,phase:random()*6.28,cheer:random()>(z<20?.45:.7)});
  }
  return spots;
}
/** The band on the deck: two guitars, the singer, keys and drums. */
export function bandSpots(): { spot: Spot; role: Role }[] {
  const at=(x:number,z:number,role:Role,phase:number)=>({spot:{x,z,y:1.1,scale:1,phase,cheer:false},role});
  return [at(-5.8,1.5,'guitar',.4),at(0,2.05,'singer',1.7),at(5,1.3,'guitar',2.9),at(-4,-.75,'keys',3.6),at(0,-2.15,'drums',5.1)];
}
