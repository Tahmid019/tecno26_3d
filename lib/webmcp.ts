import type { Game, Landmark } from './game';
type Tool={name:string;description:string;inputSchema:object;annotations?:{readOnlyHint:boolean};execute:(input:unknown)=>unknown};
type Context={registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>};
export function registerCampusTools(game:Game){
  const context=(document as Document&{modelContext?:Context}).modelContext;
  if(!context?.registerTool)return ()=>{};
  const lifecycle=new AbortController();
  const tools:Tool[]=[
    {name:'get_campus_state',description:'Read the player position, motion, ground contact, current view, and frame rate.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>game.getState()},
    {name:'travel_to_campus_landmark',description:'Move the student to a named campus destination, including the concert and library, and start the same third-person exploration as the GO TO buttons.',inputSchema:{type:'object',properties:{destination:{type:'string',enum:['gym','football','cricket','courts','concert','library']}},required:['destination'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{const id=(input as {destination?:string})?.destination;if(!id||!['gym','football','cricket','courts','concert','library'].includes(id))throw new Error('Choose gym, football, cricket, courts, concert, or library.');game.travel(id as Landmark);await new Promise(requestAnimationFrame);return game.getState();}},
  ];
  for(const tool of tools){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(e=>console.warn('Campus tools unavailable',e));}catch(e){console.warn('Campus tools unavailable',e);}}
  return ()=>lifecycle.abort();
}
