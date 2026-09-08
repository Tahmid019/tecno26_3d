import * as T from 'three';
export function createSky(){
  const group=new T.Group();group.name='Blue sky, sun and drifting cumulus';
  const sky=new T.Mesh(new T.SphereGeometry(980,32,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,vertexShader:'varying vec3 vDirection;void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 vDirection;void main(){float h=pow(max(0.0,vDirection.y),0.6);vec3 col=mix(vec3(0.74,0.86,0.91),vec3(0.12,0.40,0.72),h);gl_FragColor=vec4(col,1.0);#include <colorspace_fragment>\n}'.replace(';#include',';\n#include')}));sky.renderOrder=-10;group.add(sky);
  const sun=new T.Mesh(new T.SphereGeometry(15,24,16),new T.MeshBasicMaterial({color:'#fff4c5',fog:false,toneMapped:false}));sun.position.set(220,265,-480);group.add(sun);
  const halo=new T.Sprite(new T.SpriteMaterial({map:glow(),color:'#ffe9ac',transparent:true,opacity:.52,depthWrite:false,fog:false,blending:T.AdditiveBlending}));halo.position.copy(sun.position);halo.scale.set(110,110,1);group.add(halo);
  const clouds=new T.InstancedMesh(new T.SphereGeometry(1,10,7),new T.MeshStandardMaterial({color:'#fcffff',roughness:1,fog:false}),180);clouds.name='Drifting cumulus clouds';const dummy=new T.Object3D();
  let seed=9321;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<36;i++){const angle=i*2.39996,radius=160+random()*550,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,y=130+random()*95,width=18+random()*30;for(let j=0;j<5;j++){dummy.position.set(x+(j-2)*width*.43,y+(j%2)*width*.13,z+Math.sin(j)*width*.32);dummy.scale.set(width*(.65+random()*.3),width*(.21+random()*.15),width*.5);dummy.updateMatrix();clouds.setMatrixAt(i*5+j,dummy.matrix);}}group.add(clouds);
  return {group,update(time:number){clouds.position.x=Math.sin(time*.005)*22;}};
}
function glow(){if(typeof document==='undefined')return null;const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;const g=ctx.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(255,255,225,1)');g.addColorStop(.26,'rgba(255,241,185,.6)');g.addColorStop(1,'rgba(255,230,160,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);return new T.CanvasTexture(c);}
