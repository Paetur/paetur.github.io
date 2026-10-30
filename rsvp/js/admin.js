(function(){
 'use strict';
 const R=window.RSVP,$=R.byId;
 let db=null,user=null,store={settings:null,sessions:[],locations:[],households:[],guests:[],food:[],claims:[],submissions:[],defaults:[],content:[],admins:[]};
 let activeTab='dashboard';
 const qs=(s)=>document.querySelector(s);
 const show=(msg,type='info')=>R.showStatus('adminMessage',msg,type);
 const fmt=(value)=>value?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value)):'—';
 function stamp(datetime){if(!datetime)return '';const d=new Date(datetime),parts=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);return parts;}
 function row(parent,tag,attrs={},text){const n=R.dom(tag,attrs,text);parent.append(n);return n;}
 function makeTable(headers,values){const table=R.dom('table',{class:'data-table'});const thead=row(table,'thead'),tr=row(thead,'tr');headers.forEach(h=>row(tr,'th',{},h));const tbody=row(table,'tbody');values.forEach(cols=>{const tr=row(tbody,'tr');cols.forEach(v=>{const td=row(tr,'td');if(v instanceof Node)td.append(v);else td.textContent=String(v??'');});});return table;}
 function stat(label,value){const div=R.dom('div',{class:'stat-card'});div.append(R.dom('b',{},value),R.dom('span',{},label));return div;}
 function sessionName(id){return store.sessions.find(s=>s.id===id)?.name||'Session';}
 function tab(name){activeTab=name;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));document.querySelectorAll('[data-panel]').forEach(n=>n.classList.toggle('hidden',n.dataset.panel!==name));}
 async function fetchTable(name,columns='*',order){let q=db.from(name).select(columns);if(order)q=q.order(order);const {data,error}=await q;if(error)throw new Error(`${name}: ${R.safeError(error)}`);return data||[];}
 async function reload(){
   show('Loading event data…');
   try{
     const keys=['settings','sessions','locations','households','guests','food','claims','submissions','defaults','content'];
     const jobs=[fetchTable('event_settings'),fetchTable('event_sessions'),fetchTable('event_locations'),fetchTable('households','id,household_name,invite_code,language,side,email,phone,food,food_confirmed,rsvp_state,sort_order,parent_id'),fetchTable('guests','id,household_id,first_name,last_name,is_child,rsvp_status,language'),fetchTable('food_items'),fetchTable('food_claims'),fetchTable('rsvp_submissions','id,household_id,submitted_at'),fetchTable('household_session_defaults'),fetchTable('event_content')];
     const values=await Promise.all(jobs);keys.forEach((key,i)=>store[key]=values[i]);store.settings=store.settings[0]||null;
     const {data:admins,error:adminsError}=await db.rpc('admin_list_members');
     store.admins=adminsError?[]:(admins||[]);
     if(adminsError)show('Admin management API unavailable: '+R.safeError(adminsError),'warning');else show('');
     renderAll();
   }catch(e){show(R.safeError(e),'error');}
 }
 function renderAll(){
   $('adminEventTitle').textContent=store.settings?.event_name||'Event dashboard';
   const invitedCount=store.guests.length;
   $('statsGrid').replaceChildren(stat('Households',store.households.length),stat('Guests',invitedCount),stat('New RSVP submissions',store.submissions.length),stat('Food items',store.food.length));
   const checks=[['Admin account connected',true],['Event name and date entered',!!(store.settings?.event_name&&store.settings?.event_date)],['At least one session created',store.sessions.some(s=>s.is_active)],['Invitations assigned',store.defaults.some(d=>d.is_invited)],['Website configuration committed',!!store.settings?.website_url],['Event published',!!store.settings?.is_published]];
   $('launchChecklist').replaceChildren(...checks.map(([label,yes])=>{const li=R.dom('li');li.append(R.dom('span',{class:yes?'yes':'no'},yes?'✓':'○'),document.createTextNode(label));return li;}));
   renderHouseholds();renderFood();renderAdmins();renderSettings();renderSessions();renderContent();
 }
 function renderHouseholds(){
   const search=$('householdSearch').value.trim().toLowerCase();
   const filtered=store.households.filter(h=>{
     const guests=store.guests.filter(g=>g.household_id===h.id);
     const hay=[h.household_name,h.language,h.invite_code,...guests.map(g=>[g.first_name,g.last_name].join(' '))].join(' ').toLowerCase();
     return hay.includes(search);
   }).sort((a,b)=>(a.household_name||'').localeCompare(b.household_name||''));
   const values=filtered.map(h=>{
     const link=R.dom('button',{class:'text-button',type:'button'},'Copy invite link');link.addEventListener('click',async()=>{
       const url=R.invitationURL(h.invite_code);
       try{await navigator.clipboard.writeText(url);show('Invitation link copied. Treat it as private.','success');}
       catch(_){show('Copy failed: '+url,'warning');}
     });
     const guests=store.guests.filter(g=>g.household_id===h.id);
     const guestList=R.dom('div');guests.forEach((g,i)=>row(guestList,'div',{class:'inline-muted'},[g.first_name,g.last_name].filter(Boolean).join(' ')||`Guest ${i+1}`));
     return [h.household_name||'—',guestList,h.language||'—',h.rsvp_state||'open',h.food?'Yes':'No',link];
   });
   $('householdRows').replaceChildren(makeTable(['Household','Guests','Language','RSVP','Food','Private link'],values));
 }
 function renderFood(){
   const values=store.food.map(f=>{
     const claimed=store.claims.filter(c=>c.food_item_id===f.id).reduce((a,c)=>a+c.quantity,0);
     return [f.name_en||f.name_fo||'—',f.category||'—',String(f.quantity_needed),String(claimed),String(Math.max(0,f.quantity_needed-claimed))];
   });
   $('adminFoodList').replaceChildren(makeTable(['Item','Category','Required','Claimed','Remaining'],values));
 }
 function renderAdmins(){
   const div=$('adminList');div.replaceChildren();$('authUsersLink').href=store.settings?`https://supabase.com/dashboard/project/${new URL(R.config().supabaseUrl).hostname.split('.')[0]}/auth/users`:'https://supabase.com/dashboard/projects';
   if(!store.admins.length){div.append(R.dom('p',{class:'muted'},'Administrator list unavailable. Apply migration 006 if needed.'));return;}
   store.admins.forEach(a=>{
     const wrap=R.dom('div',{class:'admin-member'}),left=R.dom('div');left.append(R.dom('div',{class:'name'},a.name),R.dom('div',{class:'email'},a.email));
     const remove=R.dom('button',{class:'text-button danger',type:'button'},'Revoke');
     remove.disabled=store.admins.length<=1;
     remove.title=store.admins.length<=1?'You cannot remove the last administrator.':'Remove this administrator';
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
   $('publicationState').textContent=e.is_published?'The event is currently published. Editing or unpublishing may affect guests.':'Event is unpublished. Publication is intentionally controlled outside this starter until testing is complete.';
 }
 function renderSessions(){
   const div=$('sessionsList');div.replaceChildren();
   for(const s of store.sessions.sort((a,b)=>a.sort_order-b.sort_order)){
     const assigned=store.defaults.filter(d=>d.session_id===s.id&&d.is_invited).length;
     const wrap=R.dom('div',{class:'session-row'}),left=R.dom('div');
     left.append(R.dom('strong',{},s.name),R.dom('small',{},`${s.session_key} · ${assigned} households invited · ${s.requires_rsvp?'RSVP required':'No RSVP'}${s.starts_at?' · '+R.formatDate(s.starts_at,'en',store.settings?.timezone):''}`));
     const addAll=R.dom('button',{class:'btn secondary',type:'button'},'Invite all households');
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
   $('loginPanel').classList.add('hidden');$('adminApp').classList.remove('hidden');$('logout').classList.remove('hidden');$('loggedInAs').textContent=user.email||'';
   tab(activeTab);await reload();
 }
 async function init(){
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
   $('refreshButton').addEventListener('click',reload);$('householdSearch').addEventListener('input',renderHouseholds);
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
