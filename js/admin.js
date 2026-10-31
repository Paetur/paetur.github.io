(function(){
 'use strict';
 const R=window.RSVP,$=R.byId;
 let db=null,user=null,store={settings:null,sessions:[],locations:[],households:[],guests:[],food:[],claims:[],submissions:[],defaults:[],content:[],admins:[],relationGroups:[],foodCategories:[],contacts:[],overrides:[],responses:[],queue:[],deliveries:[]};
 let activeTab='dashboard',lastMainTab='dashboard',activeSettingsTab='event',editMode=false;
 const expandedGroups=new Map();
 const qs=(s)=>document.querySelector(s);
 let statusTimer=null;
 function show(msg,type='info'){
   clearTimeout(statusTimer);R.showStatus('adminMessage',msg,type);if(!msg)return;
   const now=new Date();const time=R.dom('time',{class:'status-time',title:now.toISOString()},new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now));time.dateTime=now.toISOString();
   $('adminMessage').prepend(time,document.createTextNode(' · '));
   statusTimer=setTimeout(()=>R.showStatus('adminMessage',''),5000);
 }

 const fmt=(value)=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value)):'—';
 function stamp(datetime){if(!datetime)return '';const d=new Date(datetime),parts=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);return parts;}
 function row(parent,tag,attrs={},text){const n=R.dom(tag,attrs,text);parent.append(n);return n;}
 function makeTable(headers,values){const table=R.dom('table',{class:'data-table'});const thead=row(table,'thead'),tr=row(thead,'tr');headers.forEach(h=>row(tr,'th',{},h));const tbody=row(table,'tbody');values.forEach(cols=>{const tr=row(tbody,'tr');cols.forEach(v=>{const td=row(tr,'td');if(v instanceof Node)td.append(v);else td.textContent=String(v??'');});});return table;}
 function stat(label,value){const div=R.dom('div',{class:'stat-card'});div.append(R.dom('b',{},value),R.dom('span',{},label));return div;}
 function sessionName(id){return store.sessions.find(s=>s.id===id)?.name||'Session';}
 function settingsTab(name){activeSettingsTab=name;document.querySelectorAll('[data-settings-tab]').forEach(b=>{const active=b.dataset.settingsTab===name;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});document.querySelectorAll('[data-settings-panel]').forEach(n=>n.classList.toggle('hidden',n.dataset.settingsPanel!==name));if(name==='logs')loadLogs(true);}
 function tab(name,updateUrl=true){
   if(!['dashboard','households','invites','food','settings'].includes(name))name='dashboard';
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
 function mode(isEditing){editMode=isEditing;$('adminApp').dataset.mode=isEditing?'edit':'view';const b=$('editModeButton');b.classList.toggle('active',isEditing);b.setAttribute('aria-pressed',String(isEditing));b.title=isEditing?'Switch to View mode':'Switch to Edit mode';b.setAttribute('aria-label',b.title);$('adminModeLabel').textContent=isEditing?'Edit mode · Changes are saved to the event database':'View mode · Manage invitations, food and event details';for(const id of ['eventSettingsForm']){const form=$(id);for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=!isEditing;}}
 async function fetchTable(name,columns='*',order){let q=db.from(name).select(columns);if(order)q=q.order(order);const {data,error}=await q;if(error)throw new Error(`${name}: ${R.safeError(error)}`);return data||[];}
 async function reload(){
   show('Loading event data…');
   try{
     const keys=['settings','sessions','locations','households','guests','food','claims','submissions','defaults','content','relationGroups','foodCategories','contacts','overrides','responses','queue','deliveries'];
     const jobs=[fetchTable('event_settings'),fetchTable('event_sessions'),fetchTable('event_locations'),fetchTable('households','id,household_name,invite_code,language,side,relation_group_id,email,phone,food,food_confirmed,rsvp_state,rsvp_submitted_at,late_submission_until,sort_order,parent_id,notes,archived_at,whatsapp,postal_address,preferred_contact_method'),fetchTable('guests','id,household_id,first_name,last_name,courtesy_title,relation,language,is_child,rsvp_status,dietary_requirements,notes,archived_at'),fetchTable('food_items'),fetchTable('food_claims'),fetchTable('rsvp_submissions','id,household_id,submitted_at'),fetchTable('household_session_defaults'),fetchTable('event_content'),fetchTable('relation_groups'),fetchTable('food_categories'),fetchTable('household_contacts'),fetchTable('guest_session_overrides'),fetchTable('guest_session_responses'),fetchTable('invitation_send_queue'),fetchTable('invitation_deliveries')];
     const values=await Promise.all(jobs);keys.forEach((key,i)=>store[key]=values[i]);store.settings=store.settings[0]||null;
     const {data:admins,error:adminsError}=await R.adminRpc('admin_list_members');
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
   $('newHousehold').replaceChildren(householdForm({language:'fo',side:'paetur_hentze'}));renderHouseholds();renderInvites();renderDeliveryLog();renderFood();renderAdmins();renderSettings();renderSessions();
 }
 function ordered(list, label){
   return [...list].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||
     String(a[label]||'').toLowerCase().localeCompare(String(b[label]||'').toLowerCase())||a.id.localeCompare(b.id));
 }
 function iconAction(kind,title,onClick,disabled=false,extraClass=''){
   const glyph={up:'↑',down:'↓'}[kind]||'';
   const button=R.dom('button',{class:'admin-row-icon '+extraClass,type:'button',title},glyph);
   const drawings={
     move:['M4 7h15','m15 3 4 4-4 4','M20 17H5','m9 13-4 4 4 4'],
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
   document.querySelectorAll('#householdRows details[data-tree-key]').forEach(d=>{
     d.open=yes;
     if(d.dataset.treeKey)expandedGroups.set(d.dataset.treeKey,yes);
   });
 }
  async function rpcAction(name,params,success){
   const {error}=await R.adminRpc(name,params);
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
     save.disabled=true;form.setAttribute('aria-busy','true');
     try{
       const fields=Object.fromEntries(Object.entries(payload).filter(([k])=>k!=='p_guest_id').map(([k,v])=>[k.slice(2),v]));
       const {error}=guest.id?await R.adminRpc('admin_update_guest',payload):await R.adminRpc('admin_create_guest',{p_household_id:guest.household_id,p_values:fields});
       if(error)throw error;
       const refreshed=await reload();
       if(refreshed)show('Guest details saved.','success');
     }catch(error){show(R.safeError(error),'error');}
     finally{save.disabled=false;form.removeAttribute('aria-busy');}
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
     const responses=store.responses.filter(r=>r.guest_id===g.id);const responseSummary=responses.length?responses.filter(r=>r.rsvp_status==='attending').length+' attending · '+responses.filter(r=>r.rsvp_status==='declined').length+' declined':'pending';
     const meta=[g.archived_at?'Archived':null,g.is_child?'Child':null,g.relation,'RSVP '+responseSummary].filter(Boolean).join(' · ');
     info.append(R.dom('small',{class:'muted'},meta));header.append(info);
     const editor=buildGuestEditor(g);
     header.append(iconAction('edit','Edit guest: '+name,()=>editor.classList.toggle('hidden'),!!g.archived_at||!!store.households.find(h=>h.id===g.household_id)?.archived_at,'edit-only'));
     entry.append(header,editor);
     const management=guestManagement(g);header.append(management.actions);entry.append(management.form);list.append(entry);
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
   input.setAttribute('aria-label',label);input.required=required;if(!options)input.maxLength=max;
   wrap.append(input);form.append(wrap);return input;
 }
 function saveForm(form,label,save){
   const button=R.dom('button',{class:'btn',type:'submit'},label);form.append(button);
   form.addEventListener('submit',async e=>{
     e.preventDefault();e.stopPropagation();if(!editMode)return;
     button.disabled=true;form.setAttribute('aria-busy','true');
     try{if(await save()===false)return;if(await reload())show('Changes saved.','success');}
     catch(error){show(R.safeError(error),'error');}
     finally{button.disabled=false;form.removeAttribute('aria-busy');}
   });return form;
 }
 async function managementRpc(name,args){const {data,error}=await R.adminRpc(name,args);if(error)throw error;return data;}
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
   const whatsapp=field(f,'WhatsApp',h.whatsapp,null,'tel',false,80);
   const address=field(f,'Postal address',h.postal_address,null,'textarea',false,1000);
   const method=field(f,'Preferred contact method',h.preferred_contact_method,[['','Unspecified'],['whatsapp','WhatsApp'],['sms','SMS'],['email','Email'],['postal','Postal'],['manual','Manual']]);
   const notes=field(f,'Household notes',h.notes,null,'textarea');
   f.append(R.dom('p',{class:'micro span-2'},h.id?'Grouping changes with child households require moving the children first.':'Empty households have no invitation code. Add a guest, then use Manage Invites. Assign sessions in Settings.'));
   return saveForm(f,h.id?'Save household':'Create household',()=>managementRpc('admin_save_household',{p_id:h.id||null,p_values:{household_name:name.value.trim(),side:side.value,relation_group_id:group.value||null,language:lang.value,parent_id:parent.value||null,email:email.value.trim(),phone:phone.value.trim(),whatsapp:whatsapp.value.trim(),postal_address:address.value.trim(),preferred_contact_method:method.value||null,notes:notes.value.trim()}}));
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
   const box=R.dom('div',{class:'guest-management edit-only'});const panel=R.dom('div',{class:'guest-move-panel edit-only hidden'});
   if(!g.archived_at){
     const f=managementForm();const move=iconAction('move','Move guest',()=>{const opening=panel.classList.contains('hidden');panel.classList.toggle('hidden',!opening);move.setAttribute('aria-expanded',String(opening));if(opening)target.focus();},false,'edit-only');move.setAttribute('aria-expanded','false');box.append(move);
     const target=field(f,'Destination household','',[['','Choose household'],...ordered(store.households,'household_name').filter(h=>h.id!==g.household_id&&!h.archived_at&&h.rsvp_state==='open').map(h=>[h.id,h.household_name])], 'text',true);
     f.append(R.dom('p',{class:'micro span-2'},'Current session invitations are preserved as individual overrides. Moves involving RSVP history are blocked.'));
     saveForm(f,'Move guest',async()=>{if(!confirm('Move this guest and preserve their current session invitations?'))return false;await managementRpc('admin_move_guest',{p_guest_id:g.id,p_household_id:target.value});});panel.append(f);
   }box.append(archiveButton('guests',g));return {actions:box,form:panel};
 }
 function contactSection(h){
   const section=disclosure('Contacts','contact-section');
   const contacts=store.contacts.filter(c=>c.household_id===h.id&&($('showArchived').checked||!c.archived_at));
   const list=R.dom('div',{class:'contact-list'});
   const types={email:'Email',phone:'Phone',postal:'Postal address',other:'Other'};
   const methods={whatsapp:'WhatsApp',sms:'SMS',email:'Email',postal:'Postal',manual:'Manual'};
   for(const c of contacts){
     const card=R.dom('article',{class:'contact-card'});const header=R.dom('div',{class:'contact-card-header'});const info=R.dom('div',{class:'contact-card-info'});
     const name=c.contact_name||types[c.contact_type]||'Contact';info.append(R.dom('strong',{},name),R.dom('span',{class:'contact-card-value'},c.contact_value));
     const meta=R.dom('div',{class:'contact-card-meta'});meta.append(R.dom('span',{},[types[c.contact_type]||c.contact_type,methods[c.preferred_method],c.language_code?.toUpperCase()].filter(Boolean).join(' · ')));
     if(c.is_primary)meta.append(R.dom('span',{class:'tag'},'Primary'));if(c.archived_at)meta.append(R.dom('span',{class:'tag'},'Archived'));info.append(meta);header.append(info);
     const editor=R.dom('div',{class:'contact-editor edit-only hidden'});editor.id='contact-editor-'+c.id;
     if(!h.archived_at){const actions=R.dom('div',{class:'contact-card-actions edit-only'});
       if(!c.archived_at){
         const edit=iconAction('edit','Edit contact: '+name,()=>{const opening=editor.classList.contains('hidden');if(opening){editor.replaceChildren(contactForm(h,c,()=>{editor.classList.add('hidden');edit.setAttribute('aria-expanded','false');edit.focus();}));}editor.classList.toggle('hidden',!opening);edit.setAttribute('aria-expanded',String(opening));if(opening)editor.querySelector('input')?.focus();},false,'edit-only');
         edit.setAttribute('aria-expanded','false');edit.setAttribute('aria-controls',editor.id);actions.append(edit);
       }
       actions.append(archiveButton('household_contacts',c));header.append(actions);
     }
     card.append(header,editor);list.append(card);
   }
   if(contacts.length)section.append(list);else section.append(R.dom('p',{class:'micro contact-empty'},'No contacts added yet.'));
   if(!h.archived_at){const add=disclosure('Add contact','edit-only contact-add');add.append(contactForm(h,{}));section.append(add);}return section;
 }
 function contactForm(h,c,onCancel=null){
   const f=managementForm();f.classList.add('contact-form');const name=field(f,'Contact name',c.contact_name,null,'text',false,140);
   const type=field(f,'Contact type',c.contact_type||'email',[['email','Email'],['phone','Phone'],['postal','Postal address'],['other','Other']]);
   const value=field(f,'Contact details',c.contact_value,null,'text',true,1000);value.closest('label').classList.add('span-2');
   const lang=field(f,'Contact language',c.language_code,[['','Household default'],...languages]);
   const method=field(f,'Preferred delivery method',c.preferred_method,[['','Unspecified'],['whatsapp','WhatsApp'],['sms','SMS'],['email','Email'],['postal','Postal'],['manual','Manual']]);
   const primary=field(f,'Primary contact for this type',c.is_primary,null,'checkbox');primary.closest('label').classList.add('span-2','contact-primary');primary.closest('label').prepend(primary);
   saveForm(f,c.id?'Save contact':'Create contact',()=>managementRpc('admin_save_contact',{p_id:c.id||null,p_household_id:h.id,p_values:{contact_name:name.value.trim(),contact_type:type.value,contact_value:value.value.trim(),language_code:lang.value||null,preferred_method:method.value||null,is_primary:primary.checked}}));
   const actions=R.dom('div',{class:'span-2 contact-form-actions'});actions.append(f.querySelector('button[type=submit]'));
   if(onCancel){const cancel=R.dom('button',{type:'button',class:'btn secondary'},'Cancel');cancel.addEventListener('click',onCancel);actions.append(cancel);}f.append(actions);return f;
 }
 const logCategories={households:'Households',guests:'Guests',contacts:'Contacts',rsvp:'RSVP',invitations:'Invitations',login:'Login',venues:'Venues',sessions:'Sessions',food:'Food access',administrators:'Administrators'};
 const logActions={add:'Added',insert:'Added',update:'Updated',delete:'Deleted',move:'Moved',archive:'Archived',restore:'Restored',assign:'Assigned',invitations_changed:'Invitation assignments changed',submitted:'Household submitted',reopened:'RSVP reopened',late_submission_authorized:'Late response allowed',response_submitted:'Guest response submitted',response_corrected:'Guest response corrected',created:'Delivery created',draft:'Draft saved',ready:'Ready to send',sent:'Recorded sent',failed:'Failed delivery',cancelled:'Cancelled',opened:'Invitation opened',login:'Sign-in session',logout:'Signed out',logout_requested:'Sign-out requested',remove:'Access removed',rename:'Renamed',token_refreshed:'Token refreshed'};
 let logEntries=[],logCursor=null,logGeneration=0,logsLoaded=false;
 function logDateBoundary(value,next=false){if(!value)return null;let date=value;if(next){const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);date=d.toISOString().slice(0,10);}return R.zonedInstant(date+'T00:00',store.settings?.timezone||'Atlantic/Faroe');}
 function formatLogValue(value){return value==null?'—':typeof value==='object'?JSON.stringify(value,null,2):String(value);}
 function renderLogs(){
   const box=$('logRows');box.replaceChildren();
   for(const e of logEntries){
     const d=R.dom('details',{class:'log-entry'});const summary=R.dom('summary');const date=new Date(e.occurred_at);const time=R.dom('time',{title:date.toISOString()},new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'medium'}).format(date));time.dateTime=date.toISOString();
     const subject=R.dom('span',{class:'log-subject'});subject.append(R.dom('strong',{},e.subject),R.dom('small',{class:'muted'},e.household_name||''));
     const kind=R.dom('span');kind.append(R.dom('span',{class:'tag'},logCategories[e.category]||e.category),R.dom('small',{},logActions[e.action]||e.action.replaceAll('_',' ')));
     summary.append(time,subject,kind,R.dom('span',{class:'log-actor'},e.actor));d.append(summary);
     const content=R.dom('div',{class:'log-details'});content.append(R.dom('p',{class:'micro'},'Reference: '+e.event_key+' · '+date.toISOString()));
     const details=e.details||{};
     if(details.before&&typeof details.before==='object'&&details.after&&typeof details.after==='object'){
       const keys=[...new Set([...Object.keys(details.before),...Object.keys(details.after)])].filter(k=>JSON.stringify(details.before[k])!==JSON.stringify(details.after[k]));
       content.append(makeTable(['Field','Before','After'],keys.map(k=>[k,formatLogValue(details.before[k]),formatLogValue(details.after[k])])));
     }else{for(const [key,value] of Object.entries(details)){if(value==null)continue;const row=R.dom('div',{class:'log-detail-value'});row.append(R.dom('strong',{},key.replaceAll('_',' ')),R.dom('pre',{},formatLogValue(value)));content.append(row);}}
     d.append(content);box.append(d);
   }
   if(!logEntries.length)box.append(R.dom('p',{class:'muted'},'No log entries match these filters.'));
   $('logCount').textContent=logEntries.length+' entries shown · Newest first';
 }
 async function loadLogs(reset=true){
   const generation=++logGeneration;$('logMore').disabled=true;$('logApply').disabled=true;$('logStatus').textContent='Loading logs…';
   try{
     const filters={p_search:$('logSearch').value.trim(),p_category:$('logCategory').value,p_action:$('logAction').value,p_from:logDateBoundary($('logFrom').value),p_to:logDateBoundary($('logTo').value,true),p_before_at:reset?null:logCursor?.occurred_at||null,p_before_key:reset?null:logCursor?.event_key||null,p_limit:50};
     const {data,error}=await R.adminRpc('admin_query_logs',filters);if(error)throw error;if(generation!==logGeneration)return;
     const incoming=data?.entries||[];logEntries=reset?incoming:[...logEntries,...incoming];logCursor=logEntries.at(-1)||null;logsLoaded=true;renderLogs();
     const selected=$('logAction').value;$('logAction').replaceChildren(R.dom('option',{value:''},'All actions'));for(const action of data?.actions||[])$('logAction').append(R.dom('option',{value:action},logActions[action]||action.replaceAll('_',' ')));$('logAction').value=selected;
     $('logMore').classList.toggle('hidden',!data?.has_more);$('logStatus').textContent='';
   }catch(error){if(generation!==logGeneration)return;$('logStatus').textContent=R.safeError(error);if(reset){logEntries=[];renderLogs();}$('logMore').classList.add('hidden');}
   finally{if(generation===logGeneration){$('logMore').disabled=false;$('logApply').disabled=false;}}
 }

 function adminTime(value){return value?R.formatDate(value,'en',store.settings?.timezone||'Atlantic/Faroe'):'—';}
 function actorName(id){return store.admins.find(a=>a.user_id===id)?.name||'Administrator';}
 function foodAccessSection(h){
   const d=disclosure('Food access','feature-section');const claims=store.claims.filter(c=>c.household_id===h.id);
   d.append(R.dom('p',{class:'small'},`${h.food?'Enabled':'Disabled'} · ${claims.length} food commitment${claims.length===1?'':'s'}${h.food_confirmed?' · Confirmed':''}`));
   if(h.archived_at)return d;
   const f=managementForm();const enabled=field(f,'Allow this household to contribute food',!!h.food,null,'checkbox');
   const reason=field(f,'Reason for food-access change','',null,'textarea',true,2000);
   f.append(R.dom('p',{class:'micro span-2'},'Disabling access is blocked while food commitments or a confirmed selection exist. Existing selections are never removed by this control.'));
   d.append(saveForm(f,'Save food access',()=>managementRpc('admin_set_food_access',{p_household_id:h.id,p_enabled:enabled.checked,p_expected:!!h.food,p_reason:reason.value.trim()})));return d;
 }
 function rsvpSection(h){
   const d=disclosure('RSVP management','feature-section');const zone=store.settings?.timezone||'Atlantic/Faroe';
   d.append(R.dom('p',{class:'small'},`${h.rsvp_state==='locked'?'Locked after submission':'Open for responses'}${h.rsvp_submitted_at?' · Last submission '+adminTime(h.rsvp_submitted_at):''}`));
   d.append(R.dom('p',{class:'micro'},`Event deadline: ${adminTime(store.settings?.rsvp_deadline)} · Late-response permission: ${adminTime(h.late_submission_until)} · ${zone}`));
   const rows=[];
   for(const g of store.guests.filter(g=>g.household_id===h.id&&!g.archived_at))for(const s of ordered(store.sessions,'name').filter(s=>s.is_active&&s.requires_rsvp)){
     const override=store.overrides.find(o=>o.guest_id===g.id&&o.session_id===s.id);const invited=override?override.is_invited:store.defaults.find(x=>x.household_id===h.id&&x.session_id===s.id)?.is_invited;if(!invited)continue;
     const current=store.responses.find(r=>r.guest_id===g.id&&r.session_id===s.id)?.rsvp_status||'pending';
     const name=[g.first_name,g.last_name].filter(Boolean).join(' ');rows.push([name,s.name,({attending:'Attending',declined:'Not attending',pending:'Pending'}[current]||current)]);
     if(!h.archived_at){const editor=disclosure('Correct response: '+name+' · '+s.name,'edit-only');const f=managementForm();const status=field(f,'Corrected response',current==='pending'?'':current,[['','Choose response'],['attending','Attending'],['declined','Not attending']], 'text',true);const reason=field(f,'Reason for RSVP correction','',null,'textarea',true,2000);
       f.append(R.dom('p',{class:'micro span-2'},'This updates the current response and records the reason. The original submission and household lock are preserved.'));
       editor.append(saveForm(f,'Save correction',()=>managementRpc('admin_correct_rsvp',{p_guest_id:g.id,p_session_id:s.id,p_status:status.value,p_reason:reason.value.trim()})));d.append(editor);}
   }
   const table=makeTable(['Guest','Session','Current response'],rows);table.classList.add('rsvp-current-responses');d.insertBefore(table,d.children[2]||null);
   if(!rows.length)d.append(R.dom('p',{class:'micro'},'No active RSVP sessions are assigned to this household.'));
   if(!h.archived_at){
     if(h.rsvp_state==='locked'){const f=managementForm();const reason=field(f,'Reason for reopening','',null,'textarea',true,2000);f.append(R.dom('p',{class:'micro span-2'},'Reopening lets the household submit again. Previous submissions remain in history. If the event deadline has passed, grant a late-response window after reopening.'));d.append(saveForm(f,'Reopen RSVP',async()=>{if(!confirm('Reopen this household’s RSVP while preserving its submission history?'))return false;return managementRpc('admin_reopen_household_rsvp',{p_household_id:h.id,p_reason:reason.value.trim()});}));}
     else{const late=disclosure('Allow a late response','edit-only');const f=managementForm();const until=field(f,'Allow responses until ('+zone+')',R.zonedInput(h.late_submission_until,zone),null,'datetime-local',true);const reason=field(f,'Reason for late response','',null,'textarea',true,2000);late.append(saveForm(f,'Allow late response',()=>managementRpc('admin_authorize_late_rsvp',{p_household_id:h.id,p_until:R.zonedInstant(until.value,zone),p_reason:reason.value.trim()})));d.append(late);}
   }
   return d;
 }
 function deliveryEditor(h,q={}){
   const f=managementForm();const channel=field(f,'Delivery channel',q.channel||h.preferred_contact_method||'manual',[['manual','Manual / in person'],['email','Email'],['whatsapp','WhatsApp'],['sms','SMS'],['postal','Postal']]);
   const contact=field(f,'Delivery recipient',q.contact_id||'',[['','Household contact details'],...store.contacts.filter(c=>c.household_id===h.id&&!c.archived_at).map(c=>[c.id,(c.contact_name||c.contact_type)+' · '+c.contact_value])]);
   const recipient=R.dom('p',{class:'micro span-2'});function showRecipient(){const c=store.contacts.find(c=>c.id===contact.value);const value=c?.contact_value||({email:h.email,sms:h.phone,whatsapp:h.whatsapp,postal:h.postal_address,manual:h.household_name}[channel.value]);recipient.textContent='Recipient: '+(value||'Missing — add contact details before marking ready.');}showRecipient();channel.addEventListener('change',showRecipient);contact.addEventListener('change',showRecipient);f.append(recipient);
   const subject=field(f,'Message subject',q.message_subject||store.settings?.event_name,null,'text',false,300);
   const body=field(f,'Message text',q.message_body||R.invitationURL(h.invite_code),null,'textarea',true,10000);body.closest('label').classList.add('span-2');
   const status=field(f,'Delivery status',q.status||'draft',[['draft','Draft'],['ready','Ready to send'],...(q.id?[['failed','Failed attempt'],['cancelled','Cancelled']]:[])]);
   const reason=field(f,'Delivery change note','',null,'textarea',false,2000);status.addEventListener('change',()=>reason.required=['failed','cancelled'].includes(status.value));
   f.append(R.dom('p',{class:'micro span-2'},'Saving a draft or marking it ready does not send a message. Review the recipient and text, send it yourself, then record it as sent.'));
   return saveForm(f,q.id?'Save delivery changes':'Create delivery draft',()=>managementRpc('admin_save_delivery',{p_id:q.id||null,p_household_id:h.id,p_expected_revision:q.revision??null,p_values:{channel:channel.value,contact_id:contact.value||null,message_subject:subject.value.trim(),message_body:body.value,status:status.value,reason:reason.value.trim()}}));
 }
 function deliveryRecord(h,q,editable=true){
   const d=disclosure(q.channel.toUpperCase()+' · '+q.status+' · '+adminTime(q.updated_at));d.dataset.deliveryId=q.id;
   const recipient=q.recipient_snapshot||{};d.append(R.dom('p',{class:'small'},'To: '+[recipient.contact_name,recipient.contact_value].filter(Boolean).join(' · ')),R.dom('p',{class:'micro'},q.message_subject||''),R.dom('pre',{class:'delivery-message'},q.message_body));
   const copy=R.dom('button',{type:'button',class:'small-tool'},'Copy message');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(q.message_body);show('Message copied.','success');}catch(error){show(R.safeError(error),'error');}});d.append(copy);
   const sent=store.deliveries.find(x=>x.queue_id===q.id);if(sent)d.append(R.dom('p',{class:'notice success'},'Manually recorded as sent · '+adminTime(sent.confirmed_at)+' · '+actorName(sent.confirmed_by)+(sent.delivery_note?' · '+sent.delivery_note:'')));
   if(editable&&!['sent','cancelled'].includes(q.status)){
     const edit=disclosure('Edit delivery','edit-only');edit.append(deliveryEditor(h,q));d.append(edit);
     if(q.status==='ready'){const f=managementForm();const note=field(f,'Sent note','',null,'textarea',false,2000);const ack=field(f,'I sent this message to the displayed recipient',false,null,'checkbox',true);d.append(saveForm(f,'Record as sent',async()=>{if(!ack.checked)return false;return managementRpc('admin_record_delivery_sent',{p_queue_id:q.id,p_expected_revision:q.revision,p_note:note.value.trim()});}));}
   }
   return d;
 }
 function deliverySection(h){
   const d=disclosure('Invitation delivery','feature-section');const records=store.queue.filter(q=>q.household_id===h.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
   d.append(R.dom('p',{class:'micro'},records.length?records.filter(q=>q.status==='sent').length+' recorded sent · '+records.filter(q=>['draft','ready','failed'].includes(q.status)).length+' pending':'No delivery recorded yet.'));
   const create=disclosure('Prepare delivery','edit-only');create.append(deliveryEditor(h));d.append(create);records.forEach(q=>d.append(deliveryRecord(h,q)));return d;
 }
 function renderDeliveryLog(){
   const box=$('deliveryLog');box.replaceChildren();const filter=$('deliveryStatusFilter').value;
   const records=store.queue.filter(q=>!filter||q.status===filter).sort((a,b)=>b.created_at.localeCompare(a.created_at));
   $('deliveryCounts').textContent=store.queue.filter(q=>q.status==='ready').length+' ready · '+store.queue.filter(q=>q.status==='sent').length+' recorded sent · '+store.queue.filter(q=>q.status==='failed').length+' failed';
   for(const q of records){const h=store.households.find(h=>h.id===q.household_id);if(!h)continue;const wrapper=disclosure(h.household_name+(h.archived_at?' · Archived':''));wrapper.append(deliveryRecord(h,q,false));box.append(wrapper);}if(!records.length)box.append(R.dom('p',{class:'micro'},'No deliveries match this status.'));
 }

 function householdSummary(h,guests){
   const active=guests.filter(g=>!g.archived_at).length;
   const descendants=store.households.filter(x=>!x.archived_at&&isDescendantOf(x.id,h.id));
   const nestedGuests=store.guests.filter(g=>!g.archived_at&&descendants.some(x=>x.id===g.household_id)).length;
   return [active?`${active} guest${active===1?'':'s'}`:null,descendants.length||!active?`${descendants.length} sub-household${descendants.length===1?'':'s'} · ${nestedGuests} guests in sub-households`:null,h.language?.toUpperCase(),h.archived_at?'Archived':active?'RSVP '+h.rsvp_state:'Grouping household'].filter(Boolean).join(' · ');
 }
 function renderInvites(){
   const box=$('inviteRows');box.replaceChildren();const search=$('inviteSearch').value.trim().toLowerCase();
   const all=ordered(store.households,'household_name').filter(h=>!h.archived_at);
   const eligible=new Set(all.filter(h=>h.invite_code&&store.guests.some(g=>g.household_id===h.id&&!g.archived_at)).map(h=>h.id));
   const visible=new Set(all.filter(h=>eligible.has(h.id)&&(h.household_name.toLowerCase().includes(search)||all.some(a=>isDescendantOf(h.id,a.id)&&a.household_name.toLowerCase().includes(search)))).map(h=>h.id));
   for(const id of [...visible]){let h=all.find(x=>x.id===id);const seen=new Set();while(h?.parent_id&&!seen.has(h.id)){seen.add(h.id);visible.add(h.parent_id);h=all.find(x=>x.id===h.parent_id);}}
   function group(title,key,cls){const d=R.dom('details',{class:cls+' tree-disclosure'});setDisclosure(d,'invites:'+key,true,!!search);const heading=R.dom('summary',{class:cls==='hierarchy-section'?'tree-side':'tree-group'},title);d.append(heading);const body=R.dom('div',{class:'tree-children'});d.append(body);return {d,body};}
   for(const side of [...new Set(all.map(h=>h.side||'unassigned'))].sort()){
     const members=all.filter(h=>(h.side||'unassigned')===side&&visible.has(h.id));if(!members.length)continue;
     const section=group(side.split('_').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' '),'side:'+side,'hierarchy-section');box.append(section.d);
     for(const gid of [...new Set(members.map(h=>h.relation_group_id||''))]){
       const households=members.filter(h=>(h.relation_group_id||'')===gid);const relation=group(householdGroupName(households[0]),side+':'+gid,'hierarchy-group');section.body.append(relation.d);
       const visited=new Set();
       function draw(h,parent){
         if(visited.has(h.id))return;visited.add(h.id);
         const node=R.dom('details',{class:'household-tree-node'});node.dataset.inviteHousehold=h.id;setDisclosure(node,'invites:household:'+h.id,false,!!search);
         const summary=R.dom('summary',{class:'household-node'});const info=R.dom('div',{class:'household-node-name'});info.append(R.dom('strong',{},h.household_name),R.dom('small',{class:'muted'},householdSummary(h,store.guests.filter(g=>g.household_id===h.id))));summary.append(info);node.append(summary);
         const body=R.dom('div',{class:'household-expanded'});node.append(body);parent.append(node);
         if(eligible.has(h.id)){
           const item=R.dom('div',{class:'invite-item'});const row=R.dom('div',{class:'invite-row'});row.append(R.dom('code',{},h.invite_code));const actions=R.dom('div',{class:'invite-actions'});
           for(const [label,value] of [['Copy invite code',h.invite_code],['Copy invitation link',R.invitationURL(h.invite_code)]]){const button=R.dom('button',{type:'button',class:'small-tool'},label);button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(value);show(label==='Copy invite code'?'Invitation code copied.':'Invitation link copied.','success');}catch(error){show(R.safeError(error),'error');}});actions.append(button);}
           row.append(actions);item.append(row,sessionAssignmentForm(h),deliverySection(h));body.append(item);
         }
         const children=households.filter(x=>x.parent_id===h.id);if(children.length){const nested=R.dom('div',{class:'tree-children'});body.append(nested);children.forEach(child=>draw(child,nested));}
       }
       households.filter(h=>!households.some(x=>x.id===h.parent_id)).forEach(h=>draw(h,relation.body));households.forEach(h=>draw(h,relation.body));
     }
   }
   if(!box.children.length)box.append(R.dom('p',{class:'muted'},'No matching invitations. Empty and archived households have no active invitation.'));
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
         info.append(R.dom('small',{class:'muted'},householdSummary(h,guests)));
         primary.append(info);
         const actions=R.dom('div',{class:'household-actions'});
         const editor=disclosure('Household details');editor.classList.add('household-inline-editor');
         const summary=R.dom('dl',{class:'household-profile-summary view-only'});
         for(const [label,value] of [['Language',h.language],['Email',h.email],['Phone',h.phone],['WhatsApp',h.whatsapp],['Postal address',h.postal_address],['Preferred contact',h.preferred_contact_method],['Notes',h.notes]]){summary.append(R.dom('dt',{},label),R.dom('dd',{},value||'—'));}editor.append(summary);
         actions.append(iconAction('edit','Edit household: '+(h.household_name||'household'),()=>{
           node.open=true;editor.open=!editor.open;if(editor.open)editor.querySelector('input')?.focus();
         },!!h.archived_at,'edit-only'));
         actions.append(archiveButton('households',h));
         const siblings=ordered(members.filter(m=>m.parent_id===h.parent_id),'household_name');
         const pos=siblings.findIndex(m=>m.id===h.id);
         editor.append(btn('↑','Move household up',()=>rpcAction('admin_move_household',{p_household_id:h.id,p_direction:-1},'Household order saved.'),pos<=0));
         editor.append(btn('↓','Move household down',()=>rpcAction('admin_move_household',{p_household_id:h.id,p_direction:1},'Household order saved.'),pos>=siblings.length-1));
         editor.append(householdForm(h));
         primary.append(actions);card.append(primary);
         const expanded=R.dom('div',{class:'household-expanded'});
         expanded.append(editor,buildGuestList(guests));
         if(!h.archived_at){const add=disclosure('Add guest','edit-only');const form=buildGuestEditor({household_id:h.id});form.classList.remove('hidden');add.append(form);expanded.append(add);}
         expanded.append(rsvpSection(h),foodAccessSection(h),contactSection(h));
         if(nested){
           const childList=R.dom('div',{class:'tree-children'});
           childList.append(R.dom('div',{class:'guest-list-heading'},'Child households'));
           children.forEach(child=>draw(child,childList,depth+1));
           expanded.append(childList);
         }
         node.append(card,expanded);
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
     save.disabled=true;form.setAttribute('aria-busy','true');
     try{const {error}=await db.from('food_items').update(record).eq('id',item.id);if(error)throw error;await reload();show('Food item updated.','success');}
     catch(error){show(R.safeError(error),'error');}finally{save.disabled=false;form.removeAttribute('aria-busy');}
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
       remove.disabled=true;const {error}=await R.adminRpc('admin_remove_member',{p_user_id:a.user_id});
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
 function venueForm(v){
   const f=managementForm();const name=field(f,'Venue name',v.name,null,'text',true,140);
   const country=field(f,'Country code',v.country_code,null,'text',false,2);country.placeholder='FO or DE';
   const address=field(f,'Venue address',v.address,null,'textarea',false,1000);
   const timezone=field(f,'Venue timezone',v.timezone||store.settings?.timezone||'Atlantic/Faroe',null,'text',true,100);
   timezone.placeholder='Atlantic/Faroe or Europe/Berlin';
   const map=field(f,'Map link (HTTPS)',v.map_url,null,'url',false,2000);
   const notes=field(f,'Guest venue notes',v.notes,null,'textarea');
   const welcome=Object.fromEntries(['fo','en','de'].map(lang=>[lang,field(f,'Welcome message — '+({fo:'Faroese',en:'English',de:'German'}[lang]),v['welcome_'+lang],null,'textarea',false,4000)]));
   const welcomeBox=R.dom('fieldset',{class:'span-2 venue-welcome-editor'});welcomeBox.append(R.dom('legend',{},'Welcome messages for this venue'));
   for(const control of Object.values(welcome))welcomeBox.append(control.closest('label'));f.append(welcomeBox);
   const archived=field(f,'Archived venue',!!v.archived_at,null,'checkbox');
   return saveForm(f,v.id?'Save venue':'Create venue',()=>managementRpc('admin_save_venue',{p_id:v.id||null,p_values:{name:name.value.trim(),country_code:country.value.trim().toUpperCase()||null,address:address.value.trim(),timezone:timezone.value.trim(),map_url:map.value.trim(),notes:notes.value.trim(),...Object.fromEntries(Object.entries(welcome).map(([lang,control])=>['welcome_'+lang,control.value.trim()])),archived:archived.checked}}));
 }
 function sessionForm(s){
   const f=managementForm();const name=field(f,'Session name',s.name,null,'text',true,140);
   const key=field(f,'Session key',s.session_key,null,'text',true,80);key.pattern='[a-z0-9_-]+';
   const venue=field(f,'Session venue',s.location_id,[['','No venue'],...ordered(store.locations,'name').filter(v=>!v.archived_at).map(v=>[v.id,v.name+(v.country_code?' · '+v.country_code:'')])]);
   const zone=()=>store.locations.find(v=>v.id===venue.value)?.timezone||store.settings?.timezone||'UTC';
   const starts=field(f,'Starts (venue local time)',R.zonedInput(s.starts_at,zone()),null,'datetime-local');
   const ends=field(f,'Ends (venue local time)',R.zonedInput(s.ends_at,zone()),null,'datetime-local');
   const hint=R.dom('p',{class:'micro span-2'});const updateHint=()=>{hint.textContent='Times are entered in '+zone()+'. Changing venue keeps the typed local time; review before saving.';};updateHint();venue.addEventListener('change',updateHint);f.append(hint);
   const rsvp=field(f,'RSVP required',s.requires_rsvp!==false,null,'checkbox');
   const active=field(f,'Active session',s.is_active!==false,null,'checkbox');
   const order=field(f,'Display order',s.sort_order||0,null,'number');order.min='0';order.step='1';
   return saveForm(f,s.id?'Save session':'Create session',()=>managementRpc('admin_save_session',{p_id:s.id||null,p_values:{name:name.value.trim(),session_key:key.value.trim(),location_id:venue.value||null,starts_at:R.zonedInstant(starts.value,zone()),ends_at:R.zonedInstant(ends.value,zone()),requires_rsvp:rsvp.checked,is_active:active.checked,sort_order:Number(order.value)}}));
 }
 function sessionAssignmentForm(h){
   const d=disclosure('Session invitations');
   d.append(R.dom('p',{class:'micro'},'Household defaults apply to each guest unless an individual exception is selected. Language does not determine invitations.'));
   const f=managementForm();const fields=[];const guests=store.guests.filter(g=>g.household_id===h.id&&!g.archived_at);
   const locked=h.rsvp_state!=='open'||store.submissions.some(x=>x.household_id===h.id);
   for(const s of ordered(store.sessions,'name')){
     const venue=store.locations.find(v=>v.id===s.location_id);const title=s.name+(venue?' · '+venue.name:'')+(s.is_active?'':' (inactive)');
     const invited=!!store.defaults.find(x=>x.household_id===h.id&&x.session_id===s.id)?.is_invited;
     const household=field(f,title+' — household',String(invited),[['false','Not invited'],['true','Invited']]);fields.push({session_id:s.id,guest_id:null,control:household});
     for(const g of guests){
       const existing=store.overrides.find(x=>x.guest_id===g.id&&x.session_id===s.id);
       const control=field(f,[g.first_name,g.last_name].filter(Boolean).join(' ')+' — '+s.name,existing?String(existing.is_invited):'inherit',[['inherit','Follow household'],['true','Invited'],['false','Not invited']]);
       fields.push({session_id:s.id,guest_id:g.id,control});
     }
     const summary=R.dom('p',{class:'micro view-only'},title+': '+(invited?'Household invited':'Household not invited'));d.append(summary);
     for(const g of guests){const o=store.overrides.find(x=>x.guest_id===g.id&&x.session_id===s.id);if(o)d.append(R.dom('p',{class:'micro view-only'},g.first_name+': '+(o.is_invited?'Invited':'Not invited')));}
   }
   if(locked){d.append(R.dom('p',{class:'notice'},'Invitations are protected because this household has RSVP history.'));return d;}
   saveForm(f,'Save session invitations',()=>managementRpc('admin_save_session_assignments',{p_household_id:h.id,p_assignments:fields.map(x=>({session_id:x.session_id,guest_id:x.guest_id,is_invited:x.control.value==='inherit'?null:x.control.value==='true'}))}));
   if(fields.length)d.append(f);else d.append(R.dom('p',{},'Create sessions in Settings first.'));return d;
 }
 function renderSessions(){
   const venues=$('venueList');venues.replaceChildren();
   for(const v of ordered(store.locations,'name')){const d=disclosure(v.name+(v.archived_at?' · Archived':''));d.append(R.dom('p',{},[v.address,v.country_code,v.timezone].filter(Boolean).join(' · ')),venueForm(v));venues.append(d);}
   $('newVenueForm').replaceChildren(venueForm({}));
   const div=$('sessionsList');div.replaceChildren();
   for(const s of ordered(store.sessions,'name')){
     const v=store.locations.find(v=>v.id===s.location_id);const d=disclosure(s.name+(s.is_active?'':' · Inactive'));
     d.append(R.dom('p',{class:'micro'},[v?.name,s.starts_at?R.formatDate(s.starts_at,'en',v?.timezone||store.settings?.timezone):'Unscheduled',v?.timezone,s.requires_rsvp?'RSVP required':'Information only'].filter(Boolean).join(' · ')),sessionForm(s));div.append(d);
   }
   $('newSessionEditor').replaceChildren(sessionForm({sort_order:store.sessions.length+1}));
 }
 async function checkAccess(){
   const {data:access,error}=await R.adminRpc('is_admin');
   if(error)throw error;
   if(access!==true)throw new Error('Your account does not have administrator access. Ask an existing administrator to grant it first.');
   $('loginPanel').classList.add('hidden');$('adminApp').classList.remove('hidden');$('adminTopActions').classList.remove('hidden');$('loggedInAs').textContent=user.email||'';
   const fragment=location.hash.slice(1);activeTab=['dashboard','households','invites','food','settings'].includes(fragment)?fragment:'dashboard';
   tab(activeTab,false);mode(false);await reload();const logged=await R.adminRpc('admin_record_session',{p_action:'login'});if(logged.error)show('Signed in, but session logging is unavailable.','warning');
 }
 async function init(){
   window.addEventListener('popstate',()=>{
     const fragment=location.hash.slice(1);
     tab(['dashboard','households','invites','food','settings'].includes(fragment)?fragment:'dashboard',false);
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
   $('logout').addEventListener('click',async()=>{const logged=await R.adminRpc('admin_record_session',{p_action:'logout_requested'});if(logged.error)show('Session logging is unavailable.','warning');const result=await db.auth.signOut();if(result.error)show(R.safeError(result.error),'error');else location.reload();});
   document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
   document.querySelectorAll('[data-settings-tab]').forEach(b=>b.addEventListener('click',()=>settingsTab(b.dataset.settingsTab)));
   $('settingsToggle').addEventListener('click',()=>toggleSettings());
   $('logFilters').addEventListener('submit',e=>{e.preventDefault();loadLogs(true);});
   $('logCategory').addEventListener('change',()=>{$('logAction').value='';loadLogs(true);});
   $('logAction').addEventListener('change',()=>loadLogs(true));
   $('logReset').addEventListener('click',()=>{$('logFilters').reset();loadLogs(true);});
   $('logMore').addEventListener('click',()=>loadLogs(false));
   $('closeSettings').addEventListener('click',()=>tab(lastMainTab));
   $('editModeButton').addEventListener('click',()=>mode(!editMode));
   $('refreshButton').addEventListener('click',async()=>{
     const button=$('refreshButton');button.disabled=true;button.classList.add('is-refreshing');
     try{if(await reload()){if(activeTab==='settings'&&activeSettingsTab==='logs')await loadLogs(true);show('Event data refreshed.','success');}}
     finally{button.classList.remove('is-refreshing');button.disabled=false;}
   });
   $('expandHouseholds').addEventListener('click',()=>expandHouseholdTree(true));
   $('collapseHouseholds').addEventListener('click',()=>expandHouseholdTree(false));
   $('householdSearch').addEventListener('input',renderHouseholds);
   $('inviteSearch').addEventListener('input',renderInvites);$('deliveryStatusFilter').addEventListener('change',renderDeliveryLog);
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
     const {error}=await R.adminRpc('admin_add_existing_user',{p_email:$('newAdminEmail').value.trim(),p_name:$('newAdminName').value.trim()});
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

 }
 document.addEventListener('DOMContentLoaded',()=>{init().catch(e=>show(R.safeError(e),'error'));});
}());
