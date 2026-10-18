import {KEY,LOCK,LIMITS,MAX_BACKUP_BYTES,BACKUP_SIZE_LABEL,emptyState,beginDraft,capture,transition,removeThread,exportBackup,importBackup,readRecord,writeRecord,eraseRecord,sampleState} from './model.js';
const $=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const now=()=>new Date().toISOString();
const token=()=>crypto.randomUUID();
const dateLabel=value=>new Intl.DateTimeFormat('en',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
let state=emptyState(),expectedToken=null,remember=false,editorOpen=false,conflict=false,saveError='',saving=false;
let generation=0,changeVersion=0,savedVersion=0,saveQueue=Promise.resolve(),toastTimer,confirmAction=null,needsUnloadWarning=false;
const canLock=Boolean(navigator.locks?.request);
try{const record=readRecord(window.localStorage);if(record){state=record.state;expectedToken=record.token;remember=canLock;editorOpen=Boolean(state.draft);if(!canLock)saveError='This browser cannot coordinate safe saving between tabs. Export a backup; editing still works without saving.';}}
catch{saveError='The browser copy could not be read. Your work in this tab will remain separate until you export it or resolve the browser copy.';conflict=true;}
function announce(message,error=false){$('announcer').textContent=message;$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function confirm(title,description,label,action){confirmAction=action;$('dialog-title').textContent=title;$('dialog-description').textContent=description;$('dialog-confirm').textContent=label;$('confirm-dialog').showModal();}
$('dialog-cancel').addEventListener('click',()=>{confirmAction=null;$('confirm-dialog').close();});
$('confirm-dialog').addEventListener('cancel',()=>{confirmAction=null;});
$('dialog-confirm').addEventListener('click',()=>{const action=confirmAction;confirmAction=null;$('confirm-dialog').close();action?.();});
function renderStorage(){
  $('remember').checked=remember;$('remember').disabled=!canLock||conflict;
  $('saving-badge').textContent=conflict?'Paused':saving?'Saving':remember&&!saveError?'On':'Off';
  $('save-status').textContent=saveError||(saving?'Saving your latest changes…':remember?'Workspace and unfinished draft saved in this browser.':'Only in this tab. Reloading or closing loses unsaved work; export a backup to keep it.');
  if(!canLock&&!saveError)$('save-status').textContent='This browser cannot coordinate safe saving between tabs. Use a current browser with Web Locks, or export backups while working without saving.';
  $('erase-browser').hidden=!remember&&!conflict&&!expectedToken&&!saveError;
  $('conflict').hidden=!conflict;
  if(conflict)$('conflict-message').textContent=saveError||'Saving is paused. Your work in this tab is still here; export it before replacing anything.';
}
function pauseSaving(message){generation++;remember=false;saving=false;conflict=true;saveError=message;needsUnloadWarning=true;renderStorage();}
function queueSave(){
  changeVersion++;
  needsUnloadWarning=true;
  if(!remember||conflict){renderStorage();return;}
  const epoch=generation;saving=true;renderStorage();
  saveQueue=saveQueue.then(()=>navigator.locks.request(LOCK,()=>{
    if(epoch!==generation||!remember||conflict)return;
    expectedToken=writeRecord(window.localStorage,state,expectedToken,token());savedVersion=changeVersion;
  })).then(()=>{if(epoch===generation&&remember&&!conflict){saving=savedVersion<changeVersion;saveError='';needsUnloadWarning=saving;renderStorage();}}).catch(error=>{
    if(epoch===generation)pauseSaving(error.name==='ConflictError'?error.message:'Your latest changes could not be saved. Keep this tab open and export a backup. A previous browser copy may still exist.');
  });
}
window.addEventListener('storage',event=>{
  if(event.key!==KEY&&event.key!==null)return;
  let changed=true;try{changed=(readRecord(window.localStorage)?.token||null)!==expectedToken;}catch{}
  if(changed)pauseSaving('Another tab changed or erased the browser copy. Saving here is paused so this tab cannot overwrite or restore it. Export this tab’s work before choosing a version.');
});
window.addEventListener('beforeunload',event=>{if(needsUnloadWarning&&(state.threads.length||state.draft)){event.preventDefault();event.returnValue='';}});
function persistChange(){queueSave();renderStorage();}
function renderList(){
  $('thread-count').textContent=String(state.threads.length);$('draft-shortcut').hidden=!state.draft;
  const list=$('thread-list');list.replaceChildren();
  if(!state.threads.length)list.append(make('p','thread-empty','Your return cards will wait here.'));
  for(const thread of state.threads){const button=make('button','thread-item');button.type='button';button.setAttribute('aria-current',String(thread.id===state.selected&&!editorOpen));button.dataset.thread=thread.id;button.append(make('strong',null,thread.title),make('span',null,({paused:'Ready to return',active:'In progress',blocked:'Waiting on something',completed:'Completed'})[thread.status]));button.addEventListener('click',()=>{state={...state,selected:thread.id};editorOpen=false;persistChange();render();$('card-title').focus();});list.append(button);}
}
function showField(section,content,value){$(section).hidden=!value.trim();$(content).textContent=value;}
function renderCard(){
  const thread=state.threads.find(t=>t.id===state.selected);
  $('empty').hidden=Boolean(thread)||editorOpen;$('return-view').hidden=!thread||editorOpen;$('editor-view').hidden=!editorOpen;
  if(!thread||editorOpen)return;
  $('card-title').textContent=thread.title;$('card-title').tabIndex=-1;
  $('state-label').textContent=({paused:'Ready to return',active:'In progress',blocked:'Waiting on something',completed:'Completed'})[thread.status];$('state-label').dataset.state=thread.status;
  $('card-time').textContent=`Updated ${dateLabel(thread.updatedAt)}`;
  $('card-next').textContent=thread.next;$('next-label').textContent=thread.status==='active'?'Your current next step':thread.status==='completed'?'The last step you recorded':'When you return, start here';
  showField('anchor-section','card-anchor',thread.anchor);showField('decision-section','card-decision',thread.decision);showField('context-section','card-context',thread.context);showField('blocker-section','card-blocker',thread.blocker);showField('alternative-section','card-alternative',thread.alternative);
  const links=$('card-links');links.replaceChildren();$('links-section').hidden=!thread.links.length;
  for(const link of thread.links){const li=make('li');const a=make('a',null,link.label||link.url);a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);links.append(li);}
  const resume=$('resume-button');resume.hidden=false;
  resume.textContent=thread.status==='active'?'Leave my next return card ↳':thread.status==='blocked'?'Review this blocked plan →':thread.status==='completed'?'Reopen this thread ↳':'Resume this step →';
  $('edit-button').textContent=thread.status==='blocked'?'Keep blocked; choose another':'My plan changed';$('edit-button').hidden=thread.status==='completed';
  $('finish-button').hidden=thread.status==='completed';
  $('card-footer-text').textContent=thread.status==='completed'?'Marked complete by you. You can reopen it.':thread.status==='blocked'?'A blocker stays open until you change your plan.':thread.status==='active'?'When you pause, leave a fresh point of return.':'Returning keeps this thread open.';
  $('history-count').textContent=String(thread.history.length);$('history-section').hidden=!thread.history.length;
  const history=$('history-list');history.replaceChildren();
  for(const previous of thread.history){const card=make('section','history-item');const stamp=make('time',null,dateLabel(previous.at));stamp.dateTime=previous.at;card.append(stamp,make('h3',null,previous.next));for(const [name,value] of [['Place',previous.anchor],['Decision',previous.decision],['Context',previous.context],['Blocker',previous.blocker],['Alternative',previous.alternative]])if(value)card.append(make('p',null,`${name}: ${value}`));if(previous.links.length){const list=make('ul','resource-list');for(const ref of previous.links){const li=make('li');const a=make('a',null,ref.label||ref.url);a.href=ref.url;a.target='_blank';a.rel='noopener noreferrer';li.append(a);list.append(li);}card.append(list);}history.append(card);}
}
function renderEditor(){
  if(!editorOpen||!state.draft)return;
  $('editor-title').textContent=state.draft.id?'Keep your next point of return.':'Leave a return card.';
  for(const key of Object.keys(LIMITS))$(key).value=state.draft.fields[key];$('links-text').value=state.draft.linksText;
  $('context-details').open=Boolean(state.draft.fields.decision||state.draft.fields.context||state.draft.fields.blocker||state.draft.fields.alternative||state.draft.linksText);
  $('form-error').hidden=true;
}
function render(){renderList();renderCard();renderStorage();$('sample-notice').hidden=!state.example;}
function openDraft(threadId=null){
  if(state.draft){editorOpen=true;render();renderEditor();$('title').focus();announce('Your unfinished draft is here. Keep it or discard it before starting another.');return;}
  try{state=beginDraft(state,threadId);editorOpen=true;persistChange();render();renderEditor();$('title').focus();}catch(error){announce(error.message,true);}
}
['new-thread','empty-new'].forEach(id=>$(id).addEventListener('click',()=>openDraft()));
$('draft-shortcut').addEventListener('click',()=>{editorOpen=true;render();renderEditor();$('title').focus();});
$('close-editor').addEventListener('click',()=>{editorOpen=false;render();$('draft-shortcut').focus();announce('Draft kept. Continue it from the sidebar.');});
$('discard-draft').addEventListener('click',()=>confirm('Discard this draft?','Your captured return cards will stay. This removes the unfinished changes from this workspace and its next browser save.','Discard draft',()=>{state={...state,draft:null};editorOpen=false;persistChange();render();$('new-thread').focus();announce('Draft discarded.');}));
document.querySelectorAll('[data-field]').forEach(input=>input.addEventListener('input',()=>{if(!state.draft)return;state={...state,draft:{...state.draft,fields:{...state.draft.fields,[input.dataset.field]:input.value}}};persistChange();}));
$('links-text').addEventListener('input',event=>{if(!state.draft)return;state={...state,draft:{...state.draft,linksText:event.target.value}};persistChange();});
$('card-form').addEventListener('submit',event=>{
  event.preventDefault();try{state=capture(state,token(),now());editorOpen=false;persistChange();render();$('card-title').focus();announce('Return card captured. '+(remember?'Browser saving is on.':'Keep this tab open or export a backup.'));}
  catch(error){$('form-error').textContent=error.message;$('form-error').hidden=false;announce(error.message,true);if(!state.draft.fields.title.trim())$('title').focus();else if(!state.draft.fields.next.trim())$('next').focus();else{$('context-details').open=true;$('links-text').focus();}}
});
$('resume-button').addEventListener('click',()=>{const thread=state.threads.find(t=>t.id===state.selected);if(!thread)return;if(['active','blocked'].includes(thread.status)){openDraft(thread.id);return;}try{state=transition(state,thread.id,thread.status==='completed'?'reopen':'resume',now());persistChange();render();$('resume-button').focus();announce(thread.status==='completed'?'Thread reopened.':'You are back. This thread stays open.');}catch(error){announce(error.message,true);}});
$('edit-button').addEventListener('click',()=>{const thread=state.threads.find(t=>t.id===state.selected);if(thread?.status==='blocked'){document.querySelector('.thread-item:not([aria-current="true"])')?.focus();announce('This thread is still blocked. Choose another thread, or review the plan when its dependency changes.');}else openDraft(state.selected);});
$('finish-button').addEventListener('click',()=>confirm('Finish this thread?','This marks the thread complete without deleting its return card. You can reopen it later.','Mark complete',()=>{state=transition(state,state.selected,'finish',now());persistChange();render();$('resume-button').focus();announce('Marked complete. You can reopen this thread.');}));
$('remove-button').addEventListener('click',()=>confirm('Remove this thread?','This removes its return card and previous checkpoints, including an associated draft. Export a backup first if you want to keep them.','Remove thread',()=>{state=removeThread(state,state.selected);editorOpen=false;persistChange();render();$('new-thread').focus();announce('Thread removed. Other threads are unchanged.');}));
function replaceWorkspace(next,message){state=next;editorOpen=Boolean(state.draft);persistChange();render();renderEditor();announce(message);(editorOpen?$('title'):state.selected?$('card-title'):$('empty-new')).focus();}
function confirmWorkspace(next,title,description,label){if(state.threads.length||state.draft)confirm(title,description,label,()=>replaceWorkspace(next,'Workspace replaced.'));else replaceWorkspace(next,'Workspace ready.');}
function loadSample(){confirmWorkspace(sampleState(new URL('./practice.html#question-3b',location.href).href,now()),'Replace with synthetic practice?','This replaces your workspace and unfinished draft. Export a backup first. If browser saving is on, the sample will replace the saved workspace too.','Load synthetic example');}
['sample-button','empty-sample'].forEach(id=>$(id).addEventListener('click',loadSample));
$('clear-button').addEventListener('click',()=>confirmWorkspace(emptyState(),'Start an empty workspace?','This removes all current threads and the unfinished draft. If browser saving is on, the empty workspace replaces it. Export a backup first if you need it.','Start empty'));
$('backup-button').addEventListener('click',()=>{try{const data=exportBackup(state,now());const blob=new Blob([data],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=make('a');a.href=url;a.download=`threadback-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);announce('Backup download requested. It includes your threads and unfinished draft; keep the file private.');}catch(error){announce(error.message,true);}});
$('import-file').addEventListener('change',async event=>{const input=event.target;const file=input.files?.[0];input.value='';if(!file)return;try{if(file.size>MAX_BACKUP_BYTES)throw new Error(`Choose a backup no larger than ${BACKUP_SIZE_LABEL}.`);const next=importBackup(await file.text());confirmWorkspace(next,'Replace with this backup?',`Validated backup: ${next.threads.length} thread(s)${next.draft?' and an unfinished draft':''}. This replaces your current workspace${remember?' and saved browser copy':''}. Export your current version first if needed.`,'Use this backup');}catch(error){announce(error.message,true);}});
$('storage-button').addEventListener('click',()=>{$('storage-panel').hidden=!$('storage-panel').hidden;if(!$('storage-panel').hidden)$('remember').focus();});
$('close-storage').addEventListener('click',()=>{$('storage-panel').hidden=true;$('storage-button').focus();});
$('remember').addEventListener('change',event=>{if(event.target.checked){remember=true;saveError='';queueSave();}else{remember=true;renderStorage();confirmErase();}});
function confirmErase(){confirm('Erase the browser copy?','This removes Threadback’s saved workspace. Your current tab stays open with its work. Other Threadback tabs will pause saving; exported files remain separate.','Erase browser copy',async()=>{
  const observed=(()=>{try{return window.localStorage.getItem(KEY);}catch{return undefined;}})();
  if(observed===undefined){announce('This browser did not allow access to its storage. Use site-data settings to erase its copy.',true);return;}
  generation++;remember=false;saving=false;
  try{if(!canLock)throw new Error('Use browser site-data settings to erase the copy; this browser cannot coordinate tabs safely.');await navigator.locks.request(LOCK,()=>{if(window.localStorage.getItem(KEY)!==observed)throw new Error('The copy changed while waiting. It was not erased; review it first.');window.localStorage.removeItem(KEY);});expectedToken=null;conflict=false;saveError='';needsUnloadWarning=Boolean(state.threads.length||state.draft);renderStorage();announce('Browser copy erased. Your work remains in this tab.');}
  catch(error){pauseSaving(error.message);announce(error.message,true);}
});}
$('erase-browser').addEventListener('click',confirmErase);
$('stay-local').addEventListener('click',()=>{try{expectedToken=readRecord(window.localStorage)?.token||null;conflict=false;saveError='';remember=false;generation++;renderStorage();announce('Your work stays here. Saving is off; export a backup to keep it.');}catch{announce('The browser copy is unreadable. Export this tab’s work, then use Browser saving to erase the unreadable copy.',true);$('storage-panel').hidden=false;renderStorage();}});
$('load-browser').addEventListener('click',()=>confirm('Load the current browser copy?','This replaces this tab’s threads and unfinished draft. Export them first if you want to keep both versions.','Load browser copy',async()=>{
  try{const record=readRecord(window.localStorage);if(!record)throw new Error('There is no saved browser copy. Your current work is unchanged.');generation++;state=record.state;expectedToken=record.token;remember=canLock;conflict=false;saveError='';saving=false;needsUnloadWarning=false;editorOpen=Boolean(state.draft);render();renderEditor();announce('Browser copy loaded.');}catch(error){announce(error.message,true);}
}));
render();renderEditor();
