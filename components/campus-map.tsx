import {LIBRARY_ROAD} from '@/lib/campus-layout';
const px=(x:number)=>(105-x)*.40;
const py=(z:number)=>(330-z)*.58;
const line=(points:readonly (readonly number[])[])=>points.map(([x,z])=>`${px(x)},${py(z)}`).join(' ');
export function CampusMap({x,z}:{x:number;z:number}){
  return <svg viewBox="0 0 250 265" role="img" aria-label="Campus map: library east of cricket, entrance faces north">
    <rect width="250" height="265" rx="12" fill="#122e28"/>
    <polyline points={line([[55,-60],[55,60],[-69,70],[-69,317],[22,319],[105,315]])} fill="none" stroke="#678176" strokeWidth="3"/>
    <polyline points={line([[-69,317],[-168,280],[-240,236],[-252,185],[-260,-26],[-219,-66],[55,-60]])} fill="none" stroke="#678176" strokeWidth="3"/>
    <polyline points={line(LIBRARY_ROAD)} fill="none" stroke="#b4b69a" strokeWidth="3"/>
    <rect x={px(29)} y={py(60)} width="24" height="63" fill="#819389"/>
    <rect x={px(64)} y={py(224)} width="41" height="62" fill="#385e41" stroke="#6e8b68"/>
    <ellipse cx={px(-166)} cy={py(164)} rx="29" ry="44" fill="#385e41" stroke="#6e8b68"/>
    <rect x={px(-163)} y={py(175)} width="3" height="13" fill="#bea06c"/>
    <rect x={px(15)} y={py(261)} width="15" height="12" fill="#428890"/>
    <path d={`M${px(-425)} ${py(218)}h29v28h-29z`} fill="#a48467"/>
    <ellipse cx={px(-356)} cy={py(197)} rx="10" ry="14" fill="#b5c3c5"/>
    <path d={`M${px(-405)} ${py(270)}V${py(223)}`} stroke="#d8d7bd" strokeWidth="2"/>
    <text x="17" y="55" style={{fontSize:8}}>COURTS</text><text x="11" y="130" style={{fontSize:8}}>FOOTBALL</text>
    <text x="94" y="149" style={{fontSize:8}}>CRICKET</text><text x="189" y="57" style={{fontSize:8}}>LIBRARY</text>
    <text x="18" y="244" style={{fontSize:8}}>GYM</text><text x="224" y="20">N ↑</text>
    <circle cx={px(x)} cy={py(z)} r="4.5" fill="#dafa67" stroke="#18332d" strokeWidth="1.5"/>
  </svg>;
}
