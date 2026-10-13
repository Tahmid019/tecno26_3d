import {LIBRARY_ROAD,ADMIN_ROAD,adminPoint} from '@/lib/campus-layout';
const px=(x:number)=>12+(105-x)*.236;
const py=(z:number)=>10+(490-z)*.236;
const line=(points:readonly (readonly number[])[])=>points.map(([x,z])=>`${px(x)},${py(z)}`).join(' ');
const adminOutline=[[-32,-16],[18,-16],[22,31],[-32,31]].map(([x,y])=>{const p=adminPoint(x,y);return [p.x,p.z];});
export function CampusMap({x,z}:{x:number;z:number}){
  return <svg viewBox="0 0 310 158" role="img" aria-label="Campus map: administration east of the gallery and library, north up">
    <rect width="310" height="158" rx="12" fill="#122e28"/>
    <g fill="none" stroke="#678176" strokeWidth="2">
      <polyline points={line([[55,-60],[55,60],[-69,70],[-69,317],[22,319],[105,315]])}/>
      <polyline points={line([[-69,317],[-168,280],[-240,236],[-252,185],[-260,-26],[-219,-66],[55,-60]])}/>
      <polyline points={line(LIBRARY_ROAD)} stroke="#b4b69a"/>
      <polyline points={line(ADMIN_ROAD)} stroke="#b4b69a"/>
      <polyline points={line([[39.5,65],[39.5,-39.5],[-30,-39.5]].map(([a,b])=>{const p=adminPoint(a,b);return [p.x,p.z];}))} stroke="#b4b69a"/>
    </g>
    <rect x={px(29)} y={py(60)} width="15" height="26" fill="#819389"/>
    <rect x={px(64)} y={py(224)} width="20" height="27" fill="#385e41" stroke="#6e8b68"/>
    <ellipse cx={px(-166)} cy={py(164)} rx="16" ry="18" fill="#385e41" stroke="#6e8b68"/>
    <rect x={px(-163)} y={py(175)} width="2" height="6" fill="#bea06c"/>
    <rect x={px(15)} y={py(261)} width="8" height="6" fill="#428890"/>
    <rect x={px(-390)} y={py(218)} width="9" height="11" fill="#a48467"/>
    <ellipse cx={px(-356)} cy={py(197)} rx="5" ry="6" fill="#b5c3c5"/>
    <path d={`M${px(-405)} ${py(270)}V${py(223)}`} stroke="#d8d7bd" strokeWidth="2"/>
    <rect x={px(-480)} y={py(345)} width="16" height="17" rx="4" fill="#b46a50"/>
    <polygon points={line(adminOutline)} fill="#ddc9a1" stroke="#f1e3c6" strokeWidth=".7"/>
    <g fill="#cfddd4" fontSize="7"><text x="15" y="119">SPORTS</text><text x="62" y="108">CRICKET</text>
      <text x="109" y="90">LIBRARY</text><text x="135" y="39">GALLERY</text><text x="238" y="34">ADMIN</text><text x="282" y="17">N ↑</text></g>
    <circle cx={px(x)} cy={py(z)} r="3.7" fill="#dafa67" stroke="#18332d" strokeWidth="1.2"/>
  </svg>;
}
