// Shared model axes: x grows west, z grows north. Library stays east of cricket.
export const LIBRARY = {x:-370,z:200,entrance:{x:-405,z:263},front:{x:0,z:1}};
export const LIBRARY_ROAD = [[-240,236],[-266,254],[-292,270],[-340,270],[-435,270]] as const;
// The lecture gallery: six drone fixes put its centre 122 m north and 126 m
// east of the library's, and its entrance faces south onto NIT Road.
export const GALLERY = {x:-508,z:320,entrance:{x:-508,z:280},front:{x:0,z:-1}};
/** The gallery's own approach, which meets the library road's east end. */
export const GALLERY_ROAD = [[-506,268],[-482,269],[-456,269],[-426,270]];
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
