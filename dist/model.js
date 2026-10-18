export const KEY='threadback.workspace.v1';
export const LOCK='threadback.workspace.write';
export const LIMITS={title:80,anchor:180,decision:500,next:240,context:700,blocker:240,alternative:240};
// Covers 20 threads × 6 field sets, the draft and JSON overhead, even when every
// permitted UTF-16 code unit needs a six-byte JSON escape. UI and model share it.
export const MAX_BACKUP_BYTES=4*1024*1024;
export const BACKUP_SIZE_LABEL='4 MiB';
export const STATES=['active','paused','blocked','completed'];
const fail=message=>{throw new Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const time=value=>{
  if(typeof value!=='string')return false;
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if(!match)return false;
  const parsed=new Date(value);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString()===`${match[1]}.${(match[2]||'').padEnd(3,'0')}Z`;
};
const backupBytes=text=>new TextEncoder().encode(text).byteLength;
export const emptyFields=()=>({...Object.fromEntries(Object.keys(LIMITS).map(key=>[key,''])),links:[]});
export const emptyState=()=>({threads:[],selected:null,draft:null,example:false});
export function safeURL(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function validateFields(input,{required=false}={}){
  if(!object(input))fail('The return card has an invalid format.');
  const result={};
  for(const [key,max] of Object.entries(LIMITS)){
    if(typeof input[key]!=='string'||input[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[key]))fail(`Check the ${key} field (maximum ${max} characters).`);
    result[key]=input[key];
  }
  if(!Array.isArray(input.links)||input.links.length>3)fail('Use up to three context links.');
  result.links=input.links.map(link=>{if(!object(link)||typeof link.label!=='string'||link.label.length>80||typeof link.url!=='string'||link.url.length>1000||!safeURL(link.url))fail('Context links must be complete http or https addresses, without a password.');return {label:link.label,url:link.url};});
  if(required&&(!result.title.trim()||!result.next.trim()))fail('Give this thread a title and one concrete next action.');
  return result;
}
function fieldsOf(input){return Object.fromEntries([...Object.keys(LIMITS),'links'].map(key=>[key,input[key]]));}
export function validateState(input){
  if(!object(input)||!Array.isArray(input.threads)||input.threads.length>20||typeof input.example!=='boolean')fail('This backup must contain a valid workspace with at most 20 threads.');
  const seen=new Set();
  const threads=input.threads.map(thread=>{
    if(!object(thread)||!id(thread.id)||seen.has(thread.id)||!STATES.includes(thread.status)||!time(thread.createdAt)||!time(thread.updatedAt))fail('A thread has an invalid identity, date or status.');
    seen.add(thread.id);
    const fields=validateFields(thread,{required:true});
    if(!Array.isArray(thread.history)||thread.history.length>5)fail('A thread has an invalid checkpoint history.');
    const history=thread.history.map(checkpoint=>{if(!object(checkpoint)||!time(checkpoint.at)||!STATES.includes(checkpoint.status))fail('A checkpoint has an invalid date or status.');return {...validateFields(checkpoint,{required:true}),at:checkpoint.at,status:checkpoint.status};});
    return {id:thread.id,...fields,status:thread.status,createdAt:thread.createdAt,updatedAt:thread.updatedAt,history};
  });
  if(input.selected!==null&&!seen.has(input.selected))fail('The selected thread is missing.');
  let draft=null;
  if(input.draft!==null){if(!object(input.draft)||(input.draft.id!==null&&!seen.has(input.draft.id))||!object(input.draft.fields)||typeof input.draft.linksText!=='string'||input.draft.linksText.length>3500)fail('The saved draft is invalid.');draft={id:input.draft.id,fields:validateFields(input.draft.fields),linksText:input.draft.linksText};}
  return {threads,selected:input.selected,draft,example:input.example};
}
export function linksToText(links){return links.map(link=>`${link.label?link.label+' | ':''}${link.url}`).join('\n');}
export function parseLinks(text){
  if(typeof text!=='string'||text.length>3500)fail('The context links are too long.');
  const lines=text.split('\n').map(line=>line.trim()).filter(Boolean);
  if(lines.length>3)fail('Keep up to three useful links.');
  return lines.map(line=>{const separator=line.indexOf(' | ');const label=separator>=0?line.slice(0,separator).trim():'';const url=separator>=0?line.slice(separator+3).trim():line;if(!safeURL(url)||url.length>1000||label.length>80)fail('Use one full http or https link per line. An optional label goes before “ | ”.');return {label,url};});
}
export function beginDraft(state,threadId=null){
  const thread=threadId?state.threads.find(t=>t.id===threadId):null;
  if(threadId&&!thread)fail('That thread is no longer available.');
  if(!thread&&state.threads.length>=20)fail('This workspace holds 20 threads. Export a backup before removing one.');
  return {...state,draft:{id:threadId,fields:thread?structuredClone(fieldsOf(thread)):emptyFields(),linksText:thread?linksToText(thread.links):''}};
}
export function capture(state,newId,now){
  if(!state.draft||!id(newId)||!time(now))fail('The return card could not be captured.');
  const fields=validateFields({...state.draft.fields,links:parseLinks(state.draft.linksText)},{required:true});
  const existing=state.threads.find(t=>t.id===state.draft.id);
  const status=fields.blocker.trim()?'blocked':'paused';
  let thread;
  if(existing){const checkpoint={...structuredClone(fieldsOf(existing)),at:existing.updatedAt,status:existing.status};thread={...existing,...fields,status,updatedAt:now,history:[checkpoint,...existing.history].slice(0,5)};}
  else{if(state.threads.length>=20||state.threads.some(t=>t.id===newId))fail('A new thread could not be added.');thread={id:newId,...fields,status,createdAt:now,updatedAt:now,history:[]};}
  return {...state,threads:existing?state.threads.map(t=>t.id===thread.id?thread:t):[thread,...state.threads],selected:thread.id,draft:null};
}
export function transition(state,threadId,action,now){
  const thread=state.threads.find(t=>t.id===threadId);if(!thread||!time(now))fail('That thread is not available.');
  const allowed={resume:['paused'],finish:['paused','active','blocked'],reopen:['completed']};
  if(!allowed[action]?.includes(thread.status))fail('Review this return card before continuing.');
  const status=action==='finish'?'completed':action==='reopen'?(thread.blocker.trim()?'blocked':'paused'):'active';
  return {...state,threads:state.threads.map(t=>t.id===threadId?{...t,status,updatedAt:now}:t)};
}
export function removeThread(state,threadId){const threads=state.threads.filter(t=>t.id!==threadId);return {...state,threads,selected:state.selected===threadId?(threads[0]?.id||null):state.selected,draft:state.draft?.id===threadId?null:state.draft};}
export function exportBackup(state,now){if(!time(now))fail('A valid export time is required.');const text=JSON.stringify({format:'threadback-backup',version:1,exportedAt:now,state:validateState(state)},null,2);if(backupBytes(text)>MAX_BACKUP_BYTES)fail(`The backup exceeds ${BACKUP_SIZE_LABEL}; your work has not changed.`);return text;}
export function importBackup(text){if(typeof text!=='string'||backupBytes(text)>MAX_BACKUP_BYTES)fail(`Choose a Threadback JSON backup no larger than ${BACKUP_SIZE_LABEL}.`);let data;try{data=JSON.parse(text);}catch{fail('This file is not valid JSON. Your current work is unchanged.');}if(!object(data)||data.format!=='threadback-backup'||data.version!==1||!time(data.exportedAt))fail('This is not a supported Threadback backup.');return validateState(data.state);}
export function readRecord(storage){const raw=storage.getItem(KEY);if(raw===null)return null;let data;try{data=JSON.parse(raw);}catch{fail('The browser copy is unreadable. Your work in this tab is safe to export.');}if(!object(data)||data.version!==1||!id(data.token))fail('The browser copy has an unsupported format.');return {token:data.token,state:validateState(data.state)};}
export class ConflictError extends Error {constructor(){super('The browser copy changed in another tab. Saving is paused; your work is still here.');this.name='ConflictError';}}
// Call writes inside the same Web Lock in every browser tab. Expected revisions also detect erased copies.
export function writeRecord(storage,state,expectedToken,newToken){
  const current=readRecord(storage);if((current?.token||null)!==expectedToken)throw new ConflictError();
  if(!id(newToken))fail('Could not create a storage revision.');
  storage.setItem(KEY,JSON.stringify({version:1,token:newToken,state:validateState(state)}));return newToken;
}
export function eraseRecord(storage,expectedToken){const current=readRecord(storage);if((current?.token||null)!==expectedToken)throw new ConflictError();storage.removeItem(KEY);}
export function sampleState(practiceURL,now){
  const fields={title:'Statistics practice · Question 3',anchor:'Practice sheet · section B · question 3b',decision:'Sample A has one unusually large value. I will compare the medians before making a claim.',next:'Calculate Sample B’s median, then compare it with Sample A.',context:'Use the numbers in the practice sheet. Write a sentence explaining what the comparison does and does not show.',blocker:'',alternative:'',links:[{label:'Open the synthetic practice sheet',url:practiceURL}]};
  const blocked={...emptyFields(),title:'Group report · methods section',anchor:'Report outline · Methods · paragraph 2',next:'Describe the final dataset and its limitations.',decision:'The structure is ready; the data description must match the file we actually receive.',blocker:'Waiting for the group’s final dataset.',alternative:'Draft a list of fields to check when the dataset arrives.',context:'Synthetic scenario. No real group, course or dataset is involved.'};
  return validateState({threads:[{id:'sample-statistics',...fields,status:'paused',createdAt:now,updatedAt:now,history:[]},{id:'sample-blocked',...blocked,status:'blocked',createdAt:now,updatedAt:now,history:[]}],selected:'sample-statistics',draft:null,example:true});
}
