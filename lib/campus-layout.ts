// Shared model axes: x grows west, z grows north. Library stays east of cricket.
import adminPlacement from './admin-placement.json' with { type: 'json' };
export const LIBRARY = {x:-370,z:200,entrance:{x:-405,z:263},front:{x:0,z:1}};
export const ADMIN_ROTATION = adminPlacement.rotationDegrees * Math.PI / 180;
/**
 * Input uses the supplied Blender file's local XY plan, in its own metres; the
 * campus draws that plan `scale` times as large. Output uses campus XZ.
 */
export function adminPoint(x:number,y:number){
  const s=adminPlacement.scale;
  return {x:adminPlacement.x+(Math.cos(ADMIN_ROTATION)*x-Math.sin(ADMIN_ROTATION)*y)*s,
    z:adminPlacement.z-(Math.sin(ADMIN_ROTATION)*x+Math.cos(ADMIN_ROTATION)*y)*s};
}
export const ADMIN = {...adminPlacement, entrance:adminPoint(...adminPlacement.entranceLocal as [number,number]),
  front:{x:Math.sin(ADMIN_ROTATION),z:Math.cos(ADMIN_ROTATION)}};
export const ADMIN_ROAD = adminPlacement.road;
export const GATE={x:-1032,z:286.5};
// Room past the enlarged administration plot to follow its front street a way.
// export const CAMPUS_BOUNDS = {minX:-1180,maxX:105,minZ:-90,maxZ:580};
export const CAMPUS_BOUNDS = { minX: -1180, maxX: 750, minZ: -380, maxZ: 580 };
// One road runs from the campus junction past the library to the gallery.
export const LIBRARY_ROAD = [[-240,236],[-266,254],[-292,270],[-340,270],
  [-398.8,270],[-411.2,270],[-435,270],[-508,268]] as const;
// The lecture gallery faces south onto NIT Road. Six drone fixes put its
// centre 122 m north and 126 m east of the library's; it stands 10 m south of
// that, drawn at 1.5 times the reconstruction, so its entrance steps (the
// `entrance` point) end 21 m from the road's centre line rather than 38.
export const GALLERY = {x:-508,z:310,entrance:{x:-508,z:289},front:{x:0,z:-1}};
export function onLibraryConnection(x:number,z:number,clearance=6){
  return LIBRARY_ROAD.slice(1).some((b,i)=>{
    const a=LIBRARY_ROAD[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz)<clearance;
  });
}

/** Nearest distance from a point to any campus road centre line, in metres. */
export function distanceToRoads(x:number,z:number,roads:number[][][]){
  let best=Infinity;
  for(const path of roads){
    for(let i=1;i<path.length;i++){
      const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1];
      const length=dx*dx+dz*dz;
      const t=length?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/length)):0;
      best=Math.min(best,Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz));
      if(best<.01)return best;
    }
  }
  return best;
}
