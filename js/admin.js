(function(){
 'use strict';
 const R=window.RSVP,$=R.byId;
 let db=null,user=null,store={settings:null,sessions:[],locations:[],households:[],guests:[],food:[],claims:[],submissions:[],defaults:[],content:[],admins:[],relationGroups:[],foodCategories:[],contacts:[]};
 let activeTab='dashboard',lastMainTab='dashboard',activeSettingsTab='event',editMode=false;
 const expandedGroups=new Map();
 const qs=(s)=>document.querySelector(s);
 const show=(msg,type='info')=>R.showStatus('adminMessage',msg,type);
 const fmt=(value)=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value)):'—';
 function stamp(datetime){if(!datetime)return '';const d=new Date(datetime),parts=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);return parts;}
 function row(parent,tag,attrs={},text){const n=R.dom(tag,attrs,text);parent.append(n);return n;}
 function makeTable(headers,values){const table=R.dom('table',{class:'data-table'});const thead=row(table,'thead'),tr=row(thead,'tr');headers.forEach(h=>row(tr,'th',{},h));const tbody=row(table,'tbody');values.forEach(cols=>{const tr=row(tbody,'tr');cols.forEach(v=>{const td=row(tr,'td');if(v instanceof Node)td.append(v);else td.textContent=String(v??'');});});return table;}
 function stat(label,value){const div=R.dom('div',{class:'stat-card'});div.append(R.dom('b',{},value),R.dom('span',{},label));return div;}
 function sessionName(id){return store.sessions.find(s=>s.id===id)?.name||'Session';}
 function settingsTab(name){activeSettingsTab=name;document.querySelectorAll('[data-settings-tab]').forEach(b=>{const active=b.dataset.settingsTab===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});document.querySelectorAll('[data-settings-panel]').forEach(n=>n.classList.toggle('hidden',n.dataset.settingsPanel!==name));}
 function tab(name,updateUrl=true){
   if(!['dashboard','households','food','settings'].includes(name))name='dashboard';
   activeTab=name;if(name!=='settings')lastMainTab=name;
   document.querySelectorAll('[data-tab]').forEach(b=>{
     const active=b.dataset.tab===name;b.classList.toggle('active',active);
     b.setAttribute('aria-selected',String(active));
   });
   document.querySelectorAll('[data-panel]').forEach(n=>n.classList.toggle('hidden',n.dataset.panel!==name));
   $('adminApp').classList.toggle('showing-settings',name==='settings');
   $('settingsToggle').classList.toggle('active',name==='settings');
   $('settingsToggle').setAttribute('aria-pressed',String(name==='settings'));
   if(name==='settings')settingsTab(activeSettingsTab);
   if(updateUrl){
     const hash=name==='dashboard'?'':'#'+name;
     const next=location.pathname+location.search+hash;
     if(location.pathname+location.search+location.hash!==next)history.pushState({adminSection:name},'',next);
   }
 }
 function toggleSettings(){tab(activeTab==='settings'?lastMainTab:'settings');}
 function setTheme(value,persist=true){
   const dark=value==='dark';
   document.documentElement.dataset.theme=dark?'dark':'light';
   const button=$('themeToggle');
   button.classList.toggle('active',dark);
   button.setAttribute('aria-pressed',String(dark));
   const label=dark?'Switch to light mode':'Switch to dark mode';
   button.title=label;button.setAttribute('aria-label',label);
   if(persist)try{localStorage.setItem('rsvp-admin-theme',dark?'dark':'light');}catch(_){}
 }
 function mode(isEditing){editMode=isEditing;$('adminApp').dataset.mode=isEditing?'edit':'view';const b=$('editModeButton');b.classList.toggle('active',isEditing);b.setAttribute('aria-pressed',String(isEditing));b.title=isEditing?'Switch to View mode':'Switch to Edit mode';b.setAttribute('aria-label',b.title);$('adminModeLabel').textContent=isEditing?'Edit mode · Changes are saved to the event database':'View mode · Manage invitations, food and event details';for(const id of ['eventSettingsForm','welcomeForm']){const form=$(id);for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=!isEditing;}}
 async function fetchTable(name,columns='*',order){let q=db.from(name).select(columns);if(order)q=q.order(order);const {data,error}=await q;if(error)throw new Error(`${name}: ${R.safeError(error)}`);return data||[];}
 async function reload(){
   show('Loading event data…');
   try{
     const keys=['settings','sessions','locations','households','guests','food','claims','submissions','defaults','content','relationGroups','foodCategories','contacts'];
     const jobs=[fetchTable('event_settings'),fetchTable('event_sessions'),fetchTable('event_locations'),fetchTable('households','id,household_name,invite_code,language,side,relation_group_id,email,phone,food,food_confirmed,rsvp_state,sort_order,parent_id,notes,archived_at'),fetchTable('guests','id,household_id,first_name,last_name,courtesy_title,relation,language,is_child,rsvp_status,dietary_requirements,notes,archived_at'),fetchTable('food_items'),fetchTable('food_claims'),fetchTable('rsvp_submissions','id,household_id,submitted_at'),fetchTable('household_session_defaults'),fetchTable('event_content'),fetchTable('relation_groups'),fetchTable('food_categories'),fetchTable('household_contacts')];
     const values=await Promise.all(jobs);keys.forEach((key,i)=>store[key]=values[i]);store.settings=store.settings[0]||null;
     const {data:admins,error:adminsError}=await db.rpc('admin_list_members');
     store.admins=adminsError?[]:(admins||[]);
     if(adminsError)show('Admin management API unavailable: '+R.safeError(adminsError),'warning');else show('');
     renderAll();return true;
   }catch(e){show(R.safeError(e),'error');return false;}
 }
 function renderAll(){
   $('adminEventTitle').textContent=store.settings?.event_name||'Event dashboard';
   const invitedCount=store.guests.filter(g=>!g.archived_at&&!store.households.find(h=>h.id===g.household_id)?.archived_at).length;
   $('statsGrid').replaceChildren(stat('Households',store.households.filter(h=>!h.archived_at).length),stat('Guests',invitedCount),stat('New RSVP submissions',store.submissions.length),stat('Food items',store.food.length));
   const deployed=window.RSVP_CONFIG||{};
   let websiteConfigured=false;
   try{websiteConfigured=Boolean(deployed.supabaseUrl&&deployed.supabaseKey&&R.normalizeUrl(deployed.supabaseUrl)===R.normalizeUrl(R.config().supabaseUrl)&&R.validateKey(deployed.supabaseKey));}catch(_){websiteConfigured=false;}
   const checks=[['Admin account connected',true],['Event name and date entered',!!(store.settings?.event_name&&store.settings?.event_date)],['At least one session created',store.sessions.some(s=>s.is_active)],['Invitations assigned',store.defaults.some(d=>d.is_invited)],['Website connection in deployed config.js',websiteConfigured],['Website address saved in event settings',!!store.settings?.website_url],['Event published',!!store.settings?.is_published]];
   $('launchChecklist').replaceChildren(...checks.map(([label,yes])=>{const li=R.dom('li');li.append(R.dom('span',{class:yes?'yes':'no'},yes?'✓':'○'),document.createTextNode(label));return li;}));
   $('newHousehold').replaceChildren(householdForm({language:'fo',side:'paetur_hentze'}));renderHouseholds();renderFood();renderAdmins();renderSettings();renderSessions();renderContent();
 }
 function ordered(list, label){
   return [...list].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||
     String(a[label]||'').toLowerCase().localeCompare(String(b[label]||'').toLowerCase())||a.id.localeCompare(b.id));
 }
 function iconAction(kind,title,onClick,disabled=false,extraClass=''){
   const glyph={up:'↑',down:'↓'}[kind]||'';
   const button=R.dom('button',{class:'admin-row-icon '+extraClass,type:'button',title},glyph);
   const drawings={
     edit:['m16 5 3 3','M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4Z'],
     delete:['M3 6h18','M8 6V4h8v2','M5 6l1 14h12l1-14','M10 10v6','M14 10v6'],
     copy:['M8 3h11a2 2 0 0 1 2 2v11','M16 8H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Z'],
     add:['M12 5v14','M5 12h14'],
     archive:['M3 3h18v4H3z','M5 7v14h14V7','M10 11h4'],
     restore:['M4 10a8 8 0 1 1 1 8','M4 4v6h6']
   };
   const key=kind==='rename'?'edit':kind;
   if(drawings[key]){
     const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
     svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
     for(const d of drawings[key]){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);svg.append(path);}
     button.append(svg);
   }
   button.setAttribute('aria-label',title);
   button.disabled=!!disabled;
   if(onClick)button.addEventListener('click',async event=>{
     event.preventDefault();event.stopPropagation();
     button.disabled=true;
     try{await onClick();}catch(error){show(R.safeError(error),'error');}
     finally{button.disabled=!!disabled;}
   });
   return button;
 }
 function btn(text,title,onClick,disabled=false){
   const kind={'↑':'up','↓':'down','Copy link':'copy','Edit':'edit','Rename':'rename','Register category':'add'}[text]||'edit';
   return iconAction(kind,title,onClick,disabled,(text==='Copy link'?'':'edit-only'));
 }
 function setDisclosure(details,key,defaultOpen=false,forceOpen=false){
   details.open=forceOpen||(expandedGroups.has(key)?expandedGroups.get(key):defaultOpen);
   details.addEventListener('toggle',()=>{if(!forceOpen)expandedGroups.set(key,details.open);});
   return details;
 }
 function expandHouseholdTree(yes){
   document.querySelectorAll('#householdRows details').forEach(d=>{
     d.open=yes;
     if(d.dataset.treeKey)expandedGroups.set(d.dataset.treeKey,yes);
   });
 }
  async function rpcAction(name,params,success){
   const {error}=await db.rpc(name,params);
   if(error)throw error;
   await reload();
   if(success)show(success,'success');
 }
 function householdGroupName(h){return store.relationGroups.find(r=>r.id===h.relation_group_id)?.name||'Ungrouped';}
 function sameGroup(a,b){return a.side===b.side&&a.relation_group_id===b.relation_group_id;}
 function isDescendantOf(candidateId,ancestorId){
   const byId=new Map(store.households.map(h=>[h.id,h]));
   let current=byId.get(candidateId);const seen=new Set();
   while(current?.parent_id&&!seen.has(current.id)){
     if(current.parent_id===ancestorId)return true;
     seen.add(current.id);current=byId.get(current.parent_id);
   }
   return false;
 }
 function buildGuestEditor(guest){
   const form=R.dom('form',{class:'guest-edit-form edit-only hidden'});
   const fields=R.dom('div',{class:'guest-edit-fields'});
   function labeledInput(label,value,maxLength,required=false,multiline=false){
     const wrap=R.dom('label',{class:'guest-edit-field'});
     wrap.append(R.dom('span',{},label));
     const input=R.dom(multiline?'textarea':'input',multiline?{}:{type:'text'});
     input.value=value||'';input.maxLength=maxLength;if(required)input.required=true;
     wrap.append(input);fields.append(wrap);return input;
   }
   function labeledSelect(label,value,options){
     const wrap=R.dom('label',{class:'guest-edit-field'});
     wrap.append(R.dom('span',{},label));
     const select=R.dom('select');
     for(const [key,display] of options)select.append(R.dom('option',{value:key},display));
     select.value=value||'';wrap.append(select);fields.append(wrap);return select;
   }
   const first=labeledInput('First name',guest.first_name,120,true);
   const last=labeledInput('Last name',guest.last_name,120);
   const title=labeledSelect('Title',guest.courtesy_title,[
     ['','None'],['Mr.','Mr.'],['Ms.','Ms.'],['Son','Son'],['Daughter','Daughter']]);
   const relation=labeledInput('Relation',guest.relation,160);
   const language=labeledSelect('Language',guest.language,[
     ['','Household default'],['fo','Faroese'],['en','English'],['de','German']]);
   const childWrap=R.dom('label',{class:'guest-child-field'});
   const child=R.dom('input',{type:'checkbox'});child.checked=!!guest.is_child;
   childWrap.append(child,R.dom('span',{},'Child guest'));fields.append(childWrap);
   const dietary=labeledInput('Dietary requirements',guest.dietary_requirements,1000,false,true);
   const notes=labeledInput('Notes',guest.notes,2000,false,true);
   form.append(fields,R.dom('p',{class:'micro'},guest.id?'RSVP status and household assignment are not changed by editing guest details.':'New guests inherit this household’s session invitations.'));
   const buttons=R.dom('div',{class:'guest-edit-actions'});
   const save=R.dom('button',{type:'submit',class:'btn'},'Save guest');
   const cancel=R.dom('button',{type:'button',class:'btn secondary'},'Cancel');
   cancel.addEventListener('click',()=>form.classList.add('hidden'));
   buttons.append(save,cancel);form.append(buttons);
   form.addEventListener('submit',async event=>{
     event.preventDefault();event.stopPropagation();
     const firstName=first.value.trim();
     if(!firstName){first.focus();show('First name is required.','warning');return;}
     const payload={
       p_guest_id:guest.id,p_first_name:firstName,p_last_name:last.value.trim()||null,
       p_courtesy_title:title.value||null,p_relation:relation.value.trim()||null,
       p_language:language.value||null,p_is_child:child.checked,
       p_dietary_requirements:dietary.value.trim()||null,p_notes:notes.value.trim()||null
     };
     save.disabled=true;
     try{
       const fields=Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='p_guest_id').map(([k,v])=>[k.slice(2),v]));
       const {error}=guest.id?await db.rpc('admin_update_guest',payload):await db.rpc('admin_create_guest',{p_household_id:guest.household_id,p_values:fields});
       if(error)throw error;
       const refreshed=await reload();
       if(refreshed)show('Guest details saved.','success');
     }catch(error){show(R.safeError(error),'error');}
     finally{save.disabled=false;}
   });
   return form;
 }
 function buildGuestList(guests){
   const list=R.dom('div',{class:'household-guest-list'});
   list.append(R.dom('div',{class:'guest-list-heading'},'Individual guests'));
   const sorted=[...guests].sort((a,b)=>String(a.first_name||'').localeCompare(String(b.first_name||''))||
     String(a.last_name||'').localeCompare(String(b.last_name||'')));
   for(const g of sorted.filter(g=>$('showArchived').checked||!g.archived_at)){
     const entry=R.dom('div',{class:'household-guest-entry'});
     const header=R.dom('div',{class:'household-guest-row'});
     const info=R.dom('div',{class:'household-guest-info'});
     const name=[g.courtesy_title,g.first_name,g.last_name].filter(Boolean).join(' ');
     info.append(R.dom('strong',{},name||'Unnamed guest'));
     const meta=[g.archived_at?'Archived':null,g.is_child?'Child':null,g.relation,'RSVP '+(g.rsvp_status||'pending')].filter(Boolean).join(' · ');
     info.append(R.dom('small',{class:'muted'},meta));header.append(info);
     const editor=buildGuestEditor(g);
     header.append(iconAction('edit','Edit guest: '+name,()=>editor.classList.toggle('hidden'),!!g.archived_at||!!store.households.find(h=>h.id===g.household_id)?.archived_at,'edit-only'));
     entry.append(header,editor);
     entry.append(guestManagement(g));list.append(entry);
   }
   if(!sorted.length)list.append(R.dom('p',{class:'micro'},'No guests assigned to this household.'));
   return list;
 }

 function disclosure(title,extra=''){
   const d=R.dom('details',{class:'admin-management '+extra});d.append(R.dom('summary',{},title));return d;
 }
 function managementForm(){return R.dom('form',{class:'form-grid management-form edit-only'});}
 function field(form,label,value,options=null,type='text',required=false,max=2000){
   const wrap=R.dom('label');wrap.append(R.dom('span',{},label));
   const input=R.dom(options?'select':type==='textarea'?'textarea':'input',options||type==='textarea'?{}:{type});
   if(options)for(const [v,t] of options)input.append(R.dom('option',{value:v},t));
   if(type==='checkbox')input.checked=!!value;else input.value=value??'';
   input.required=required;if(!options)input.maxLength=max;
   wrap.append(input);form.append(wrap);return input;
 }
 function saveForm(form,label,save){
   const button=R.dom('button',{class:'btn',type:'submit'},label);form.append(button);
   form.addEventListener('submit',async e=>{
     e.preventDefault();e.stopPropagation();if(!editMode)return;
     button.disabled=true;
     try{await save();if(await reload())show('Changes saved.','success');}
     catch(error){show(R.safeError(error),'error');}
     finally{button.disabled=false;}
   });return form;
 }
 async function managementRpc(name,args){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
 const languages=[['fo','Faroese'],['en','English'],['de','German']];
 function householdForm(h){
   const f=managementForm();
   const name=field(f,'Household name',h.household_name,null,'text',true,140);
   const side=field(f,'Side',h.side,[['paetur_hentze','Pætur Hentze'],['maria_haass','Maria Haass']]);
   const group=field(f,'Relation group',h.relation_group_id,[['','Ungrouped'],...ordered(store.relationGroups,'name').map(g=>[g.id,g.name])]);
   const lang=field(f,'Household language',h.language||'fo',languages);
   const parent=field(f,'Parent household',h.parent_id,[['','None (top level)']]);
   function parents(){
     const selected=parent.value||h.parent_id||'';parent.replaceChildren(R.dom('option',{value:''},'None (top level)'));
     for(const x of ordered(store.households,'household_name').filter(x=>x.id!==h.id&&!x.archived_at&&x.side===side.value&&(x.relation_group_id||'')===group.value&&!isDescendantOf(x.id,h.id)))parent.append(R.dom('option',{value:x.id},x.household_name));
     parent.value=[...parent.options].some(o=>o.value===selected)?selected:'';
   }
   parents();side.addEventListener('change',parents);group.addEventListener('change',parents);
   const email=field(f,'Household email',h.email,null,'email',false,320);
   const phone=field(f,'Household phone',h.phone,null,'tel',false,80);
   const notes=field(f,'Household notes',h.notes,null,'textarea');
   f.append(R.dom('p',{class:'micro span-2'},h.id?'Grouping changes with child households require moving the children first.':'A private invitation code is generated automatically. Assign sessions in Settings after creating the household.'));
   return saveForm(f,h.id?'Save household':'Create household',()=>managementRpc('admin_save_household',{p_id:h.id||null,p_values:{household_name:name.value.trim(),side:side.value,relation_group_id:group.value||null,language:lang.value,parent_id:parent.value||null,email:email.value.trim(),phone:phone.value.trim(),notes:notes.value.trim()}}));
 }
 function archiveButton(entity,record){
   const restoring=!!record.archived_at;
   return iconAction(restoring?'restore':'archive',(restoring?'Restore ':'Archive ')+(entity==='households'?'household':entity==='guests'?'guest':'contact'),async()=>{
     if(!editMode)return;
     const message=restoring?'Restore this record?':entity==='households'?'Archive this household and disable its invitation link? Records and history are preserved.':'Archive this record? It can be restored later.';
     if(!confirm(message))return;
     await managementRpc('admin_set_archived',{p_entity:entity,p_id:record.id,p_archived:!restoring});await reload();show(restoring?'Record restored.':'Record archived.','success');
   },false,'edit-only');
 }
 function guestManagement(g){
   const box=R.dom('div',{class:'guest-management edit-only'});box.append(archiveButton('guests',g));
   if(!g.archived_at){
     const d=disclosure('Move guest');const f=managementForm();
     const target=field(f,'Destination household','',[['','Choose household'],...ordered(store.households,'household_name').filter(h=>h.id!==g.household_id&&!h.archived_at&&h.rsvp_state==='open').map(h=>[h.id,h.household_name])], 'text',true);
     f.append(R.dom('p',{class:'micro span-2'},'Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.'));
     saveForm(f,'Move guest',async()=>{if(!confirm('Move this guest and preserve their current session invitations?'))return;await managementRpc('admin_move_guest',{p_guest_id:g.id,p_household_id:target.value});});d.append(f);box.append(d);
   }return box;
 }
 function contactSection(h){
   const section=disclosure('Contacts');
   for(const c of store.contacts.filter(c=>c.household_id===h.id&&($('showArchived').checked||!c.archived_at))){
     const d=disclosure((c.contact_name||c.contact_type)+(c.archived_at?' · Archived':'')+(c.is_primary?' · Primary':''));
     d.append(R.dom('p',{},c.contact_value),R.dom('p',{class:'micro'},[c.language_code,c.preferred_method].filter(Boolean).join(' · ')));
     if(!h.archived_at){d.append(archiveButton('household_contacts',c));if(!c.archived_at)d.append(contactForm(h,c));}section.append(d);
   }
   if(!h.archived_at){const add=disclosure('Add contact','edit-only');add.append(contactForm(h,{}));section.append(add);}return section;
 }
 function contactForm(h,c){
   const f=managementForm();const name=field(f,'Contact name',c.contact_name,null,'text',false,140);
   const type=field(f,'Contact type',c.contact_type||'email',[['email','Email'],['phone','Phone'],['postal','Postal'],['other','Other']]);
   const value=field(f,'Contact details',c.contact_value,null,'text',true,1000);
   const lang=field(f,'Contact language',c.language_code,[['','Household default'],...languages]);
   const method=field(f,'Preferred delivery method',c.preferred_method,[['','Unspecified'],['whatsapp','WhatsApp'],['sms','SMS'],['email','Email'],['postal','Postal'],['manual','Manual']]);
   const primary=field(f,'Primary contact for this type',c.is_primary,null,'checkbox');
   return saveForm(f,c.id?'Save contact':'Create contact',()=>managementRpc('admin_save_contact',{p_id:c.id||null,p_household_id:h.id,p_values:{contact_name:name.value.trim(),contact_type:type.value,contact_value:value.value.trim(),language_code:lang.value||null,preferred_method:method.value||null,is_primary:primary.checked}}));
 }
 function historySection(h){
   const d=disclosure('Change history');const body=R.dom('div',{class:'management-history'});d.append(body);
   let loaded=false;
   d.addEventListener('toggle',async()=>{
     if(!d.open||loaded)return;loaded=true;body.textContent='Loading history…';
     try{
       const {data,error}=await db.from('management_audit').select('*').eq('household_id',h.id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100);if(error)throw error;
       body.replaceChildren();
       for(const item of data||[]){
         const entry=disclosure(`${new Date(item.created_at).toLocaleString()} · ${item.entity_type} · ${item.action}`);
         entry.append(R.dom('p',{class:'micro'},'Administrator: '+(store.admins.find(a=>a.user_id===item.actor_user_id)?.name||item.actor_user_id)));
         const keys=[...new Set([...Object.keys(item.before_value||{}),...Object.keys(item.after_value||{})])].filter(k=>JSON.stringify(item.before_value?.[k])!==JSON.stringify(item.after_value?.[k]));
         entry.append(makeTable(['Field','Before','After'],keys.map(k=>[k,String(item.before_value?.[k]??'—'),String(item.after_value?.[k]??'—')])));body.append(entry);
       }
       if(!data?.length)body.textContent='No recorded changes. History starts when management auditing is installed.';
       else body.append(R.dom('p',{class:'micro'},'Showing the latest 100 changes.'));
     }catch(error){loaded=false;body.textContent=R.safeError(error);}
   });return d;
 }

 function renderHouseholds(){
   const box=$('householdRows');box.replaceChildren();
   const search=$('householdSearch').value.trim().toLowerCase();
   const all=store.households.filter(h=>$('showArchived').checked||!h.archived_at);
   const byId=new Map(all.map(h=>[h.id,h]));
   const matched=new Set(all.filter(h=>{
     const guests=store.guests.filter(g=>g.household_id===h.id);
     return [h.household_name,h.language,...guests.map(g=>[g.first_name,g.last_name].join(' '))]
       .join(' ').toLowerCase().includes(search);
   }).map(h=>h.id));
   const visible=new Set(matched);
   if(search)for(const id of matched){
     let h=byId.get(id);const seen=new Set();
     while(h?.parent_id&&!seen.has(h.id)){seen.add(h.id);visible.add(h.parent_id);h=byId.get(h.parent_id);}
   }
   for(const side of [...new Set(all.map(h=>h.side||'unassigned'))].sort()){
     const sideMembers=all.filter(h=>(h.side||'unassigned')===side);
     if(!sideMembers.some(h=>visible.has(h.id)))continue;
     const label=side.split('_').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' ');
     const sideBox=R.dom('details',{class:'hierarchy-section tree-disclosure'});
     sideBox.dataset.treeKey='side:'+side;
     setDisclosure(sideBox,sideBox.dataset.treeKey,true,!!search);
     const heading=R.dom('summary',{class:'tree-side'});
     heading.append(R.dom('span',{},label),R.dom('small',{class:'tree-count'},sideMembers.length+' households'));
     sideBox.append(heading);
     const sideBody=R.dom('div',{class:'tree-children'});
     const groups=[...new Set(sideMembers.map(h=>h.relation_group_id||''))];
     groups.sort((a,b)=>{
       const ar=store.relationGroups.find(r=>r.id===a),br=store.relationGroups.find(r=>r.id===b);
       return (ar?.sort_order||0)-(br?.sort_order||0)||(ar?.name||'').localeCompare(br?.name||'');
     });
     for(const groupId of groups){
       const members=sideMembers.filter(h=>(h.relation_group_id||'')===groupId);
       const visibleMembers=members.filter(h=>visible.has(h.id));
       if(!visibleMembers.length)continue;
       const groupBox=R.dom('details',{class:'hierarchy-group tree-disclosure'});
       groupBox.dataset.treeKey='group:'+side+':'+groupId;
       setDisclosure(groupBox,groupBox.dataset.treeKey,true,!!search);
       const groupTitle=R.dom('summary',{class:'tree-group'});
       groupTitle.append(R.dom('span',{},householdGroupName(members[0])),
         R.dom('small',{class:'tree-count'},members.length+' households'));
       groupBox.append(groupTitle);
       const groupBody=R.dom('div',{class:'tree-children'});
       const visited=new Set();
       function draw(h,container,depth){
         if(visited.has(h.id)||!visible.has(h.id))return;
         visited.add(h.id);
         const children=ordered(members.filter(m=>m.parent_id===h.id&&m.id!==h.id),'household_name');
         const nested=children.some(c=>visible.has(c.id));
         // Every household can expand to show and edit its individual guests.
         const node=R.dom('details',{class:'household-tree-node'});
         node.dataset.treeKey='household:'+h.id;
         setDisclosure(node,node.dataset.treeKey,false,!!search);
         const card=R.dom('summary',{class:'household-node'});
         const primary=R.dom('div',{class:'household-node-main'});
         const info=R.dom('div',{class:'household-node-name'});
         info.append(R.dom('strong',{},h.household_name||'Unnamed household'));
         const guests=store.guests.filter(g=>g.household_id===h.id);
         info.append(R.dom('small',{class:'muted'},`${guests.filter(g=>!g.archived_at).length} active guests · ${h.language?.toUpperCase()||'—'} · ${h.archived_at?'Archived':'RSVP '+(h.rsvp_state||'open')}`));
         primary.append(info);
         const actions=R.dom('div',{class:'household-actions'});
         actions.append(iconAction('copy','Copy private invitation link',async()=>{
           await navigator.clipboard.writeText(R.invitationURL(h.invite_code));
           show('Private invitation link copied.','success');
         },!!h.archived_at));
         const editor=R.dom('div',{class:'household-inline-editor hidden edit-only'});
         actions.append(iconAction('edit','Edit household hierarchy: '+(h.household_name||'household'),()=>{
           editor.classList.toggle('hidden');
         },!!h.archived_at,'edit-only'));
         actions.append(archiveButton('households',h));
         const siblings=ordered(members.filter(m=>m.parent_id===h.parent_id),'household_name');
         const pos=siblings.findIndex(m=>m.id===h.id);
         editor.append(btn('↑','Move household up',()=>rpcAction('admin_move_household',{p_household_id:h.id,p_direction:-1},'Household order saved.'),pos<=0));
         editor.append(btn('↓','Move household down',()=>rpcAction('admin_move_household',{p_household_id:h.id,p_direction:1},'Household order saved.'),pos>=siblings.length-1));
         const label=R.dom('label',{class:'parent-picker'});
         label.append(R.dom('span',{},'Parent'));
         const select=R.dom('select');
         select.setAttribute('aria-label','Parent for '+(h.household_name||'household'));
         select.append(R.dom('option',{value:''},'None (top level)'));
         ordered(members.filter(m=>m.id!==h.id&&!m.archived_at&&!isDescendantOf(m.id,h.id)),'household_name').forEach(parent=>
           select.append(R.dom('option',{value:parent.id},parent.household_name||'Unnamed')));
         select.value=h.parent_id||'';
         select.addEventListener('change',async()=>{
           const next=select.value||null;select.disabled=true;
           try{await rpcAction('admin_set_household_parent',{p_household_id:h.id,p_parent_id:next},'Household parent updated.');}
           catch(error){select.value=h.parent_id||'';show(R.safeError(error),'error');}
           finally{select.disabled=false;}
         });
         label.append(select);editor.append(label);
         editor.append(householdForm(h));
         primary.append(actions);card.append(primary);
         const expanded=R.dom('div',{class:'household-expanded'});
         expanded.append(buildGuestList(guests));
         if(!h.archived_at){const add=disclosure('Add guest','edit-only');const form=buildGuestEditor({household_id:h.id});form.classList.remove('hidden');add.append(form);expanded.append(add);}
         expanded.append(contactSection(h),historySection(h));
         if(nested){
           const childList=R.dom('div',{class:'tree-children'});
           childList.append(R.dom('div',{class:'guest-list-heading'},'Child households'));
           children.forEach(child=>draw(child,childList,depth+1));
           expanded.append(childList);
         }
         node.append(card,editor,expanded);
         container.append(node);
       }
       ordered(members.filter(h=>!h.parent_id||!members.some(p=>p.id===h.parent_id)),'household_name').forEach(h=>draw(h,groupBody,0));
       visibleMembers.filter(h=>!visited.has(h.id)).forEach(h=>draw(h,groupBody,0));
       groupBox.append(groupBody);sideBody.append(groupBox);
     }
     sideBox.append(sideBody);box.append(sideBox);
   }
   if(!box.children.length)box.append(R.dom('p',{class:'muted'},'No matching households.'));
 }
  function claimedQuantity(item){return store.claims.filter(c=>c.food_item_id===item.id).reduce((n,c)=>n+c.quantity,0);}
 function foodCategoriesSorted(){return ordered(store.foodCategories,'name');}
 function foodItemName(item){return item.name_en||item.name_fo||item.name_de||'Unnamed item';}
 function foodCategoryOptions(select,current){
   foodCategoriesSorted().forEach(category=>select.append(R.dom('option',{value:category.name},category.name)));
   if(current&&!store.foodCategories.some(c=>c.name===current))select.append(R.dom('option',{value:current},current+' (unregistered)'));
   select.value=current||'';
 }
 function buildFoodEditor(item){
   const form=R.dom('form',{class:'food-edit-form hidden'});
   const fields=[['Faroese name','name_fo'],['English name','name_en'],['German name','name_de'],['Faroese description','description_fo'],['English description','description_en'],['German description','description_de']];
   for(const [labelText,key] of fields){const label=R.dom('label');label.append(R.dom('span',{},labelText));const input=R.dom(key.startsWith('description')?'textarea':'input',{name:key});input.value=item[key]||'';if(key==='name_fo')input.required=true;label.append(input);form.append(label);}
   const quantityLabel=R.dom('label');quantityLabel.append(R.dom('span',{},'Quantity needed'));const quantity=R.dom('input',{type:'number',min:'0',name:'quantity_needed'});quantity.value=String(item.quantity_needed);quantity.required=true;quantityLabel.append(quantity);form.append(quantityLabel);
   const activeLabel=R.dom('label',{class:'checkbox-label'});const active=R.dom('input',{type:'checkbox'});active.checked=item.active;activeLabel.append(active,R.dom('span',{},'Available for guests'));form.append(activeLabel);
   const footer=R.dom('div',{class:'food-edit-buttons'});
   const save=R.dom('button',{type:'submit',class:'btn'},'Save food item');
   const cancel=R.dom('button',{type:'button',class:'btn secondary'},'Cancel');cancel.addEventListener('click',()=>form.classList.add('hidden'));
   footer.append(save,cancel);form.append(footer);
   form.addEventListener('submit',async ev=>{
     ev.preventDefault();const required=Number(quantity.value),claim=claimedQuantity(item);
     if(!Number.isInteger(required)||required<claim||(!active.checked&&claim>0)){
       show(`Quantity cannot fall below ${claim} claimed; claimed items cannot be hidden.`,'error');return;
     }
     const record={quantity_needed:required,active:active.checked};
     for(const [,key] of fields)record[key]=form.elements.namedItem(key).value.trim()||null;
     if(!record.name_fo){show('Faroese name is required.','error');return;}
     save.disabled=true;
     try{const {error}=await db.from('food_items').update(record).eq('id',item.id);if(error)throw error;await reload();show('Food item updated.','success');}
     catch(error){show(R.safeError(error),'error');}finally{save.disabled=false;}
   });
   return form;
 }
 function renderFood(){
   const box=$('adminFoodList');box.replaceChildren();
   const categorySelect=$('newFoodCategory');categorySelect.replaceChildren();
   foodCategoryOptions(categorySelect,foodCategoriesSorted()[0]?.name||'');
   const search=$('foodSearch')?.value.trim().toLowerCase()||'';
   const categories=foodCategoriesSorted(),known=new Set(categories.map(c=>c.name));
   const unregistered=[...new Set(store.food.map(f=>f.category||'').filter(c=>!known.has(c)))].sort();
   const list=[...categories.map(c=>({name:c.name,id:c.id,registered:true})),
     ...unregistered.map(name=>({name,id:null,registered:false}))];
   for(const [index,category] of list.entries()){
     const items=ordered(store.food.filter(f=>(f.category||'')===category.name),'name_fo');
     const visible=items.filter(f=>!search||[f.name_fo,f.name_en,f.name_de,f.category]
       .join(' ').toLowerCase().includes(search));
     if(search&&!visible.length)continue;
     const section=R.dom('details',{class:'food-category tree-disclosure'});
     section.dataset.treeKey='food:'+category.name;
     setDisclosure(section,section.dataset.treeKey,index===0,!!search);
     const heading=R.dom('summary',{class:'food-category-heading'});
     const title=R.dom('span',{class:'food-category-title'},category.name||'Uncategorized');
     heading.append(title,R.dom('small',{class:'tree-count'},items.length+' items'));
     const controls=R.dom('span',{class:'food-heading-actions'});
     if(category.registered){
       const pos=categories.findIndex(c=>c.id===category.id);
       controls.append(btn('↑','Move category up',()=>rpcAction('admin_move_food_category',
         {p_category_id:category.id,p_direction:-1},'Category order saved.'),pos<=0));
       controls.append(btn('↓','Move category down',()=>rpcAction('admin_move_food_category',
         {p_category_id:category.id,p_direction:1},'Category order saved.'),pos>=categories.length-1));
       controls.append(btn('Rename','Rename food category',async()=>{
         const next=prompt('New category name',category.name)?.trim();
         if(!next||next===category.name)return;
         await rpcAction('admin_rename_food_category',
           {p_category_id:category.id,p_name:next},'Category renamed and linked food items updated.');
       }));
     }else{
       controls.append(R.dom('span',{class:'tag pending'},'Not registered'));
       if(category.name)controls.append(btn('Register category','Register existing category',async()=>{
         const {error}=await db.from('food_categories').insert({name:category.name,sort_order:categories.length});
         if(error)throw error;
         await reload();show('Category registered.','success');
       }));
     }
     heading.append(controls);section.append(heading);
     const itemList=R.dom('div',{class:'food-category-items'});
     for(const f of visible){
       const claim=claimedQuantity(f),pos=items.findIndex(x=>x.id===f.id);
       const wrapper=R.dom('div',{class:'food-manage-item'});
       const main=R.dom('div',{class:'food-manage-main'});
       const info=R.dom('div',{class:'food-item-info'});
       info.append(R.dom('strong',{},foodItemName(f)),
         R.dom('small',{class:'muted'},`Needed ${f.quantity_needed} · Claimed ${claim} · Available ${Math.max(0,f.quantity_needed-claim)}${f.active?'':' · Inactive'}`));
       const buttons=R.dom('div',{class:'food-item-actions'});
       buttons.append(btn('↑','Move food item up',()=>rpcAction('admin_move_food_item',
         {p_food_item_id:f.id,p_direction:-1},'Food order saved.'),pos<=0));
       buttons.append(btn('↓','Move food item down',()=>rpcAction('admin_move_food_item',
         {p_food_item_id:f.id,p_direction:1},'Food order saved.'),pos===items.length-1));
       const edit=buildFoodEditor(f);
       buttons.append(btn('Edit','Edit food item',()=>edit.classList.toggle('hidden')));
       buttons.append(iconAction('delete','Archive food item (preserve existing claims)',async()=>{
         if(!confirm('Archive '+foodItemName(f)+'? Existing claims are preserved; you can reactivate it using Edit.'))return;
         const {error}=await db.from('food_items').update({active:false}).eq('id',f.id);
         if(error)throw error;
         await reload();show('Food item archived.','success');
       },!f.active,'edit-only'));
       const changeLabel=R.dom('label',{class:'food-category-picker edit-only'});
       changeLabel.append(R.dom('span',{},'Category'));
       const change=R.dom('select');foodCategoryOptions(change,f.category||'');
       change.setAttribute('aria-label','Category for '+foodItemName(f));
       change.addEventListener('change',async()=>{
         change.disabled=true;
         try{await rpcAction('admin_set_food_category',
           {p_food_item_id:f.id,p_category:change.value},'Food category updated.');}
         catch(error){change.value=f.category||'';show(R.safeError(error),'error');}
         finally{change.disabled=false;}
       });
       changeLabel.append(change);buttons.append(changeLabel);
       main.append(info,buttons);wrapper.append(main,edit);itemList.append(wrapper);
     }
     section.append(itemList);box.append(section);
   }
   if(!box.children.length)box.append(R.dom('p',{class:'muted'},'No matching food items.'));
 }
  function renderAdmins(){
   const div=$('adminList');div.replaceChildren();$('authUsersLink').href=store.settings?`https://supabase.com/dashboard/project/${new URL(R.config().supabaseUrl).hostname.split('.')[0]}/auth/users`:'https://supabase.com/dashboard/projects';
   if(!store.admins.length){div.append(R.dom('p',{class:'muted'},'Administrator list unavailable. Apply migration 006 if needed.'));return;}
   store.admins.forEach(a=>{
     const wrap=R.dom('div',{class:'admin-member'}),left=R.dom('div');left.append(R.dom('div',{class:'name'},a.name),R.dom('div',{class:'email'},a.email));
     const remove=iconAction('delete','Revoke administrator access for '+a.email,null,false,'edit-only danger');
     remove.disabled=store.admins.length<=1;
     remove.title=store.admins.length<=1?'You cannot remove the last administrator.':'Revoke administrator access';remove.setAttribute('aria-label',remove.title);
     remove.addEventListener('click',async()=>{
       if(!confirm(`Revoke administrator access for ${a.email}?`))return;
       remove.disabled=true;const {error}=await db.rpc('admin_remove_member',{p_user_id:a.user_id});
       if(error)show(R.safeError(error),'error');else {show('Administrator access revoked.','success');await reload();}
       remove.disabled=false;
     });
     wrap.append(left,remove);div.append(wrap);
   });
 }
 function renderSettings(){
   const e=store.settings||{};
   $('settingName').value=e.event_name||'';$('settingType').value=e.event_type||'other';$('settingDate').value=e.event_date||'';
   $('settingLanguage').value=e.default_language||'en';$('settingTimezone').value=e.timezone||'UTC';
   $('settingUrl').value=e.website_url||'';$('settingDeadline').value=stamp(e.rsvp_deadline);
   $('publicationState').textContent=e.is_published?'Event is published: invited guests can access RSVP. You can unpublish it below.':'Event is unpublished: guest-facing event details and food remain hidden until you publish.';
   $('publicationState').classList.toggle('success',!!e.is_published);$('publicationState').classList.toggle('warning',!e.is_published);
   $('publishEventButton').disabled=!!e.is_published;
   $('unpublishEventButton').disabled=!e.is_published;
 }
 function renderSessions(){
   const div=$('sessionsList');div.replaceChildren();
   for(const s of store.sessions.sort((a,b)=>a.sort_order-b.sort_order)){
     const assigned=store.defaults.filter(d=>d.session_id===s.id&&d.is_invited).length;
     const wrap=R.dom('div',{class:'session-row'}),left=R.dom('div');
     left.append(R.dom('strong',{},s.name),R.dom('small',{},`${s.session_key} · ${assigned} households invited · ${s.requires_rsvp?'RSVP required':'No RSVP'}${s.starts_at?' · '+R.formatDate(s.starts_at,'en',store.settings?.timezone):''}`));
     const addAll=R.dom('button',{class:'btn secondary edit-only',type:'button'},'Invite all households');
     addAll.disabled=assigned>=store.households.length;
     addAll.addEventListener('click',async()=>{
       if(!confirm(`Invite all ${store.households.length} existing households to ${s.name}?`))return;
       const data=store.households.map(h=>({household_id:h.id,session_id:s.id,is_invited:true}));
       addAll.disabled=true;
       const {error}=await db.from('household_session_defaults').upsert(data,{onConflict:'household_id,session_id'});
       if(error)show(R.safeError(error),'error');else{show('Household invitations assigned.','success');await reload();}
       addAll.disabled=false;
     });
     wrap.append(left,addAll);div.append(wrap);
   }
   if(!store.sessions.length)div.append(R.dom('p',{class:'muted'},'No sessions configured yet.'));
 }
 function renderContent(){
   for(const lang of ['fo','en','de']){
     $("welcome"+lang[0].toUpperCase()+lang.slice(1)).value=store.content.find(c=>c.content_key==='welcome'&&c.language_code===lang)?.content_value||'';
   }
 }
 async function checkAccess(){
   const {data:access,error}=await db.rpc('is_admin');
   if(error)throw error;
   if(access!==true)throw new Error('Your account does not have administrator access. Ask an existing administrator to grant it first.');
   $('loginPanel').classList.add('hidden');$('adminApp').classList.remove('hidden');$('adminTopActions').classList.remove('hidden');$('loggedInAs').textContent=user.email||'';
   const fragment=location.hash.slice(1);activeTab=['dashboard','households','food','settings'].includes(fragment)?fragment:'dashboard';
   tab(activeTab,false);mode(false);await reload();
 }
 async function init(){
   let savedTheme='light';try{savedTheme=localStorage.getItem('rsvp-admin-theme')||'light';}catch(_){}
   setTheme(savedTheme,false);
   $('themeToggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
   window.addEventListener('popstate',()=>{
     const fragment=location.hash.slice(1);
     tab(['dashboard','households','food','settings'].includes(fragment)?fragment:'dashboard',false);
   });
   db=R.getClient();
   if(!db){$('loginPanel').classList.remove('hidden');show('Database not connected. Complete the setup wizard first.','warning');$('loginForm').querySelector('button').disabled=true;return;}
   const {data:{user:current}}=await db.auth.getUser();if(current){user=current;try{await checkAccess();}catch(e){show(R.safeError(e),'error');}}
   $('loginForm').addEventListener('submit',async e=>{
     e.preventDefault();show('');const button=e.target.querySelector('button');button.disabled=true;
     try{
       const {data,error}=await db.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});
       if(error)throw error;user=data.user;await checkAccess();
     }catch(err){show(R.safeError(err),'error');}
     button.disabled=false;
   });
   $('logout').addEventListener('click',async()=>{await db.auth.signOut();location.reload();});
   document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
   document.querySelectorAll('[data-settings-tab]').forEach(b=>b.addEventListener('click',()=>settingsTab(b.dataset.settingsTab)));
   $('settingsToggle').addEventListener('click',()=>toggleSettings());
   $('closeSettings').addEventListener('click',()=>tab(lastMainTab));
   $('editModeButton').addEventListener('click',()=>mode(!editMode));
   $('refreshButton').addEventListener('click',async()=>{
     const button=$('refreshButton');button.disabled=true;button.classList.add('is-refreshing');
     try{if(await reload())show('Event data refreshed.','success');}
     finally{button.classList.remove('is-refreshing');button.disabled=false;}
   });
   $('expandHouseholds').addEventListener('click',()=>expandHouseholdTree(true));
   $('collapseHouseholds').addEventListener('click',()=>expandHouseholdTree(false));
   $('householdSearch').addEventListener('input',renderHouseholds);
   $('showArchived').addEventListener('change',renderHouseholds);
   $('foodSearch').addEventListener('input',renderFood);
   $('addCategoryForm').addEventListener('submit',async e=>{
     e.preventDefault();const input=$('categoryName'),name=input.value.trim();if(!name)return;const button=e.target.querySelector('button');button.disabled=true;
     try{const {error}=await db.from('food_categories').insert({name,sort_order:store.foodCategories.length});if(error)throw error;input.value='';await reload();show('Food category added.','success');}
     catch(error){show(R.safeError(error),'error');}finally{button.disabled=false;}
   });
   $('addFoodForm').addEventListener('submit',async e=>{
     e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
     const category=$('newFoodCategory').value;const count=Number($('newFoodQuantity').value);
     if(!Number.isInteger(count)||count<0){show('Enter a non-negative quantity.','error');button.disabled=false;return;}
     const items=store.food.filter(f=>f.category===category);
     const record={category,name_fo:$('newFoodFo').value.trim(),name_en:$('newFoodEn').value.trim()||null,name_de:$('newFoodDe').value.trim()||null,quantity_needed:count,active:true,sort_order:Math.max(0,...items.map(f=>f.sort_order||0))+1};
     try{const {error}=await db.from('food_items').insert(record);if(error)throw error;e.target.reset();await reload();show('Food item added.','success');}
     catch(error){show(R.safeError(error),'error');}finally{button.disabled=false;}
   });
   $('addAdminForm').addEventListener('submit',async e=>{
     e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
     const {error}=await db.rpc('admin_add_existing_user',{p_email:$('newAdminEmail').value.trim(),p_name:$('newAdminName').value.trim()});
     if(error)show(R.safeError(error),'error');else{e.target.reset();show('Administrator added.','success');await reload();}
     button.disabled=false;
   });
   $('eventSettingsForm').addEventListener('submit',async e=>{
     e.preventDefault();const deadline=$('settingDeadline').value;
     if(deadline&&!Number.isFinite(new Date(deadline).valueOf())){show('Invalid RSVP deadline.','error');return;}
     const settings={event_name:$('settingName').value.trim(),event_type:$('settingType').value.trim(),event_date:$('settingDate').value||null,default_language:$('settingLanguage').value,timezone:$('settingTimezone').value.trim(),website_url:$('settingUrl').value.trim()||null,rsvp_deadline:deadline?new Date(deadline).toISOString():null,updated_at:new Date().toISOString()};
     const {error}=await db.from('event_settings').upsert({id:1,...settings},{onConflict:'id'});
     if(error)show(R.safeError(error),'error');else{show('Event settings saved.','success');await reload();}
   });
   $('publishEventButton').addEventListener('click',async()=>{
     if(!editMode){show('Switch to Edit mode first.','warning');return;}
     if(!$('publishAck').checked){show('Confirm the release acknowledgement before publishing.','warning');return;}
     const ready=store.settings?.event_name&&store.settings?.event_date&&store.settings?.website_url&&store.sessions.some(x=>x.is_active)&&store.defaults.some(x=>x.is_invited);
     if(!ready){show('Complete the event name, date, website URL, active session and invitations before publishing.','error');return;}
     if(!confirm('Publish this event now? Invite-code holders may access guest RSVP and food details. Proceed only after security and guest-flow testing.'))return;
     const button=$('publishEventButton');button.disabled=true;
     const {error}=await db.from('event_settings').update({is_published:true,updated_at:new Date().toISOString()}).eq('id',1);
     if(error)show(R.safeError(error),'error');else{show('Event published.','success');$('publishAck').checked=false;await reload();}
     button.disabled=false;
   });
   $('unpublishEventButton').addEventListener('click',async()=>{
     if(!editMode){show('Switch to Edit mode first.','warning');return;}
     if(!confirm('Unpublish this event? Guest access to published event details will stop.'))return;
     const button=$('unpublishEventButton');button.disabled=true;
     const {error}=await db.from('event_settings').update({is_published:false,updated_at:new Date().toISOString()}).eq('id',1);
     if(error)show(R.safeError(error),'error');else{show('Event unpublished.','success');await reload();}
     button.disabled=false;
   });
   $('newSessionForm').addEventListener('submit',async e=>{
     e.preventDefault();const data={session_key:$('newSessionKey').value.toLowerCase().trim(),name:$('newSessionName').value.trim(),requires_rsvp:true,is_active:true,sort_order:store.sessions.length+1};
     if(!/^[a-z0-9_-]+$/.test(data.session_key)){show('Session key may contain only lowercase letters, numbers, - and _.','error');return;}
     const {error}=await db.from('event_sessions').insert(data);
     if(error)show(R.safeError(error),'error');else{e.target.reset();show('New session created. Assign households before launch.','success');await reload();}
   });
   $('welcomeForm').addEventListener('submit',async e=>{
     e.preventDefault();const values=['fo','en','de'].map(lang=>({content_key:'welcome',language_code:lang,content_value:$("welcome"+lang[0].toUpperCase()+lang.slice(1)).value.trim()})).filter(r=>r.content_value);
     const {error}=await db.from('event_content').upsert(values,{onConflict:'content_key,language_code'});
     if(error)show(R.safeError(error),'error');else{show('Translations saved.','success');await reload();}
   });
 }
 document.addEventListener('DOMContentLoaded',()=>{init().catch(e=>show(R.safeError(e),'error'));});
}());
