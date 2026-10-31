// Admin design smoke test: serve branch files locally and stub Supabase auth/data.
// No real credentials, guest codes, or production mutations.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.cwd();
const types = {'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8'};
const server = http.createServer((req,res)=>{
  try {
    let u = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(u.endsWith('/'))u += 'index.html';
    const filename=path.resolve(root,'.'+u);
    if(!filename.startsWith(root+path.sep)) {res.writeHead(403);res.end();return;}
    if(!fs.existsSync(filename) || !fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'text/plain'});
    fs.createReadStream(filename).pipe(res);
  }catch(e){res.writeHead(500);res.end(String(e));}
});
const mock = [
"window.__fetchCount=0;",
"const h1='11111111-1111-4111-8111-111111111111',h2='22222222-2222-4222-8222-222222222222',h3='33333333-3333-4333-8333-333333333333';",
"const s1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cat1='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',cat2='cccccccc-cccc-4ccc-8ccc-cccccccccccc';",
"const fixtures={",
" event_settings:[{id:1,event_name:'Pætur & Maria Hentze',event_type:'wedding',event_date:'2027-02-20',default_language:'fo',timezone:'Europe/Berlin',website_url:'https://paetur.github.io/',rsvp_deadline:null,is_published:false}],",
" event_sessions:[{id:s1,session_key:'dinner',name:'Dinner',sort_order:1,is_active:true,requires_rsvp:true}],",
" event_locations:[],",
" households:[{id:h1,household_name:'Example parent',invite_code:null,side:'paetur_hentze',relation_group_id:cat1,parent_id:null,sort_order:1,rsvp_state:'open',language:'fo'},{id:h2,household_name:'Example child',invite_code:'EFGHJKLM',side:'paetur_hentze',relation_group_id:cat1,parent_id:h1,sort_order:2,rsvp_state:'open',language:'fo'},{id:h3,household_name:'Example Maria family',invite_code:'HJKLMNPQ',side:'maria_haass',relation_group_id:cat2,parent_id:null,sort_order:1,rsvp_state:'open',language:'de'}],",
" guests:[{id:'55555555-5555-4555-8555-555555555555',household_id:h2,first_name:'Example',last_name:'Guest',language:'fo',is_child:false,relation:'Cousin',notes:'Invitation note',rsvp_status:'pending'},{id:'77777777-7777-4777-8777-777777777777',household_id:h2,first_name:'Nested',last_name:'Guest',language:'en',is_child:true,rsvp_status:'pending'}],",
" food_categories:[{id:cat1,name:'Main dishes',sort_order:1},{id:cat2,name:'Desserts',sort_order:2}],",
" food_items:[{id:'66666666-6666-4666-8666-666666666666',category:'Main dishes',name_fo:'Sample dish',name_en:'Sample dish',name_de:'Sample dish',sort_order:1,quantity_needed:4,active:true}],",
" relation_groups:[{id:cat1,name:'Family',sort_order:1},{id:cat2,name:'Family',sort_order:1}],",
" guest_session_overrides:[],household_contacts:[],management_audit:[],food_claims:[],rsvp_submissions:[],household_session_defaults:[{household_id:h1,session_id:s1,is_invited:true}],event_content:[]",
"};",
"const client={auth:{getUser:async()=>({data:{user:{email:'test-admin@example.invalid'}}}),refreshSession:async()=>{window.__refreshCount=(window.__refreshCount||0)+1;return {data:{session:{}}};},signOut:async()=>({error:null})},rpc:async(name,args)=>{if(window.__managementRpc){const r=window.__managementRpc(name,args);if(r)return r;}if(name==='admin_update_guest'){window.__lastGuestUpdate=args;const guest=fixtures.guests.find(g=>g.id===args.p_guest_id);if(!guest)return {data:null,error:{message:'No guest'}};Object.assign(guest,{first_name:args.p_first_name,last_name:args.p_last_name,courtesy_title:args.p_courtesy_title,relation:args.p_relation,language:args.p_language,is_child:args.p_is_child,dietary_requirements:args.p_dietary_requirements,notes:args.p_notes});return {data:null,error:null};}return name==='is_admin'?{data:true}:name==='admin_list_members'?{data:[{name:'Example admin',email:'test-admin@example.invalid',user_id:h1}]}:{data:null,error:null};},from(name){return {select(){if(name==='event_settings')window.__fetchCount++;const query={eq(){return query;},order(){return query;},limit(){return query;},then(resolve){return Promise.resolve({data:fixtures[name]||[],error:null}).then(resolve);}};return query;}}}};",
"window.__fixtures=fixtures;window.__calls=[];",
"window.__managementRpc=(name,args)=>{window.__calls.push({name,args});if(window.__failNext){window.__failNext=false;return {error:{message:'Simulated save failure'}};}let data=null;if(name==='admin_save_household'){if(args.p_id)Object.assign(fixtures.households.find(h=>h.id===args.p_id),args.p_values);else{data=crypto.randomUUID();fixtures.households.push({id:data,...args.p_values,invite_code:'TESTABCD',rsvp_state:'open'});}}else if(name==='admin_create_guest'){data=crypto.randomUUID();fixtures.guests.push({id:data,household_id:args.p_household_id,...args.p_values,rsvp_status:'pending'});}else if(name==='admin_move_guest'){fixtures.guests.find(g=>g.id===args.p_guest_id).household_id=args.p_household_id;}else if(name==='admin_set_archived'){fixtures[args.p_entity].find(x=>x.id===args.p_id).archived_at=args.p_archived?new Date().toISOString():null;}else if(name==='admin_save_contact'){if(args.p_id)Object.assign(fixtures.household_contacts.find(c=>c.id===args.p_id),args.p_values);else{data=crypto.randomUUID();fixtures.household_contacts.push({id:data,household_id:args.p_household_id,...args.p_values});}}else if(name==='admin_save_venue'){if(args.p_id)Object.assign(fixtures.event_locations.find(v=>v.id===args.p_id),args.p_values);else{data=crypto.randomUUID();fixtures.event_locations.push({id:data,...args.p_values});}}else if(name==='admin_save_session'){if(args.p_id)Object.assign(fixtures.event_sessions.find(v=>v.id===args.p_id),args.p_values);else{data=crypto.randomUUID();fixtures.event_sessions.push({id:data,...args.p_values});}}else if(name==='admin_save_session_assignments'){window.__lastAssignments=args;for(const a of args.p_assignments){const table=a.guest_id?fixtures.guest_session_overrides:fixtures.household_session_defaults;const key=a.guest_id?'guest_id':'household_id';const id=a.guest_id||args.p_household_id;const i=table.findIndex(x=>x[key]===id&&x.session_id===a.session_id);if(i>=0)table.splice(i,1);if(a.is_invited!==null)table.push({[key]:id,session_id:a.session_id,is_invited:a.is_invited});}}else return null;return {data,error:null};};",
"fixtures.guest_session_responses=[];fixtures.invitation_send_queue=[];fixtures.invitation_deliveries=[];fixtures.invitation_delivery_audit=[];fixtures.rsvp_household_audit=[];fixtures.rsvp_response_audit=[];\nconst priorManagement=window.__managementRpc;window.__managementRpc=(name,a)=>{if(name==='admin_save_household'&&window.__permissionOnce){window.__permissionOnce=false;return {error:{code:'42501',message:'permission denied for function admin_save_household'}};}let data=null;const now=new Date().toISOString();const h=fixtures.households.find(h=>h.id===a?.p_household_id);if(name==='admin_set_food_access'){h.food=a.p_enabled;}else if(name==='admin_correct_rsvp'){let r=fixtures.guest_session_responses.find(r=>r.guest_id===a.p_guest_id&&r.session_id===a.p_session_id);if(r)r.rsvp_status=a.p_status;else fixtures.guest_session_responses.push({guest_id:a.p_guest_id,session_id:a.p_session_id,rsvp_status:a.p_status});}else if(name==='admin_reopen_household_rsvp'){h.rsvp_state='open';h.late_submission_until=null;}else if(name==='admin_authorize_late_rsvp'){h.late_submission_until=a.p_until;}else if(name==='admin_save_delivery'){if(a.p_id){const q=fixtures.invitation_send_queue.find(q=>q.id===a.p_id);Object.assign(q,a.p_values,{revision:q.revision+1,updated_at:now});data=q.id;}else{data=crypto.randomUUID();fixtures.invitation_send_queue.push({id:data,household_id:a.p_household_id,...a.p_values,revision:1,created_at:now,updated_at:now,recipient_snapshot:{contact_name:h.household_name,contact_value:h.household_name}});}}else if(name==='admin_record_delivery_sent'){const q=fixtures.invitation_send_queue.find(q=>q.id===a.p_queue_id);q.status='sent';q.revision++;data=crypto.randomUUID();fixtures.invitation_deliveries.push({id:data,queue_id:q.id,confirmed_at:now,confirmed_by:h1,delivery_note:a.p_note});}else return priorManagement(name,a);window.__calls.push({name,args:a});return {data,error:null};};\n",
"window.supabase={createClient:()=>client};"
].join('\n');
async function openSection(scope,label){const summary=scope.locator('summary').filter({hasText:new RegExp('^'+label+'$')});if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();}
async function run(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/admin/';
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1100,height:750}});
 const errors=[];page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/supabase.min.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:mock}));
 try {
   await page.goto(url,{waitUntil:'load'});
   await page.locator('#adminApp:not(.hidden)').waitFor({timeout:12000});
   await page.locator('#householdRows .hierarchy-section').first().waitFor({state:'attached'});
   assert.equal(await page.locator('[data-tab]').count(),4,'four main text tabs');
   assert.deepEqual(await page.locator('[data-tab]').evaluateAll(nodes=>nodes.map(n=>n.textContent.trim())),['Overview','Households','Food','Manage Invites']);
   assert.deepEqual(await page.locator('.admin-top-actions>button').evaluateAll(nodes=>nodes.map(n=>n.id)),
     ['settingsToggle','editModeButton','refreshButton','logout'],'topbar action icon order');
   assert.equal(await page.locator('#viewWebsite').getAttribute('target'),'_blank','website link opens a new tab');
   assert.equal(await page.locator('#viewWebsite').getAttribute('rel'),'noopener noreferrer','website link is isolated');
   assert.equal(await page.locator('#settingsPage').isVisible(),false,'settings initially closed');
   await page.locator('#settingsToggle').click();
   assert.equal(await page.locator('#settingsPage').isVisible(),true,'full Settings page opens');
   assert.equal(await page.locator('.admin-main-tabs').isVisible(),false,'main tab row hidden on Settings');
   assert.equal(new URL(page.url()).hash,'#settings','Settings has its own browser URL state');
   await page.locator('[data-settings-tab="administrators"]').click();
   assert.equal(await page.locator('#adminList').isVisible(),true,'administrators nested in Settings page');
   await page.locator('#closeSettings').click();
   assert.equal(await page.locator('#settingsPage').isVisible(),false,'Back returns to dashboard');
   assert.equal(await page.locator('.admin-main-tabs').isVisible(),true,'main tabs restored');
   const previewDir=path.join(root,'artifacts');fs.mkdirSync(previewDir,{recursive:true});
   await page.screenshot({path:path.join(previewDir,'admin-overview-light.png'),fullPage:true});
   await page.emulateMedia({colorScheme:await page.locator('html').getAttribute('data-theme')==='dark'?'light':'dark'});
   await page.waitForTimeout(100);
   await page.waitForTimeout(220);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','dark mode enabled');
   assert.equal(await page.locator('#themeToggle').count(),1,'appearance control is available');
   await page.locator('#themeToggle').click();assert.equal(await page.locator('#themePreference').inputValue(),'system');
   await page.locator('#themePreference').selectOption('light');assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   await page.locator('#themePreference').selectOption('dark');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   await page.locator('#themePreference').selectOption('system');await page.locator('#themeToggle').click();
   await page.locator('#settingsToggle').click();
   await page.locator('[data-settings-tab="event"]').click();
   await page.screenshot({path:path.join(previewDir,'admin-settings-dark.png'),fullPage:true});
   assert.equal(await page.locator('#settingName').isVisible(),true,'event settings visible in dark mode');
   await page.locator('#closeSettings').click();
   await page.reload({waitUntil:'load'});
   await page.locator('#adminApp:not(.hidden)').waitFor();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','system dark mode applies after reload');
   await page.emulateMedia({colorScheme:await page.locator('html').getAttribute('data-theme')==='dark'?'light':'dark'});
   await page.waitForTimeout(100);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light','light mode restored');
   await page.locator('[data-tab="households"]').click();
   assert.equal(await page.locator('#householdRows details.hierarchy-section').count(),2,'two sides');
   assert.equal(await page.locator('#householdRows details.hierarchy-group').count(),2,'relationship groups');
   assert.equal(await page.locator('#householdRows details.household-tree-node').count(),3,'every household is expandable');
   assert.ok((await page.locator('#householdRows').textContent()).includes('1 sub-household · 2 guests in sub-households'));
   await page.locator('#collapseHouseholds').click();
   assert.equal(await page.locator('#householdRows details[data-tree-key][open]').count(),0,'all groups collapsed');
   await page.locator('#expandHouseholds').click();
   assert.equal(await page.locator('#householdRows details[data-tree-key]:not([open])').count(),0,'all groups expanded');
   assert.equal(await page.locator('.household-actions .edit-only').first().isVisible(),false,'row editing hidden in view');
   await page.locator('#editModeButton').click();
   assert.equal(await page.locator('#adminApp').getAttribute('data-mode'),'edit');
   await page.locator('.household-actions button[title^="Edit household"]').first().click();
   assert.equal(await page.locator('.household-inline-editor').first().isVisible(),true,'inline edit expands');
   assert.equal(await page.locator('.household-guest-row').count(),2,'guest rows appear inside parent and child households');
   const guestEditorButton=page.locator('.household-guest-row button[title^="Edit guest"]').first();
   await guestEditorButton.click();
   const guestForm=page.locator('.household-guest-entry .guest-edit-form').first();
   assert.equal(await guestForm.isVisible(),true,'individual guest editor is visible');
   await guestForm.locator('input[type="text"]').first().fill('Edited');
   await guestForm.locator('textarea').last().fill('New example note');
   await guestForm.locator('button[type="submit"]').click();
   await page.waitForFunction(() => document.querySelector('.household-guest-row strong')?.textContent.includes('Edited'));
   const saved=await page.evaluate(()=>window.__lastGuestUpdate);
   assert.equal(saved.p_first_name,'Edited','guest first name submitted');
   assert.equal(saved.p_notes,'New example note','guest notes submitted');
   assert.equal(saved.p_relation,'Cousin','existing guest relation retained');
   assert.equal(await page.locator('.household-guest-row').count(),2,'guests remain visible after saving');
   await page.screenshot({path:path.join(root,'artifacts','admin-households-light.png'),fullPage:true});
   await page.emulateMedia({colorScheme:await page.locator('html').getAttribute('data-theme')==='dark'?'light':'dark'});
   await page.waitForTimeout(100);
   await page.waitForTimeout(220);
   const actionBackground=await page.locator('.household-guest-row .admin-row-icon').first().evaluate(el=>getComputedStyle(el).backgroundColor);
   const toolBackground=await page.locator('#expandHouseholds').evaluate(el=>getComputedStyle(el).backgroundColor);
   assert.notEqual(actionBackground,'rgb(255, 255, 255)','guest action icons must not have light backgrounds in dark mode');
   assert.notEqual(toolBackground,'rgb(255, 255, 255)','household controls must not have light backgrounds in dark mode');
   await page.screenshot({path:path.join(root,'artifacts','admin-households-dark.png'),fullPage:true});


   // Create/edit a household, add/move a guest, manage contacts, archive/restore.
   await page.locator('details').filter({has:page.locator('#newHousehold')}).locator('summary').click();
   const newForm=page.locator('#newHousehold form');
   await newForm.getByLabel('Household name',{exact:true}).fill('New test family');
   await newForm.getByLabel('Household email').fill('family@example.invalid');
   await newForm.getByRole('button',{name:'Create household'}).click();
   await page.waitForFunction(()=>window.__fixtures.households.some(h=>h.household_name==='New test family'));
   const createdId=await page.evaluate(()=>window.__fixtures.households.find(h=>h.household_name==='New test family').id);
   const created=page.locator(`[data-tree-key="household:${createdId}"]`);
   await page.locator('#expandHouseholds').click();
   await created.getByRole('button',{name:'Edit household: New test family',exact:true}).click();
   const profile=created.locator('.household-inline-editor .management-form');
   await profile.getByLabel('Household phone').fill('+298 123456');
   await profile.getByLabel('WhatsApp',{exact:true}).fill('+298 654321');
   await profile.getByLabel('Household language').selectOption('de');
   await page.evaluate(()=>window.__permissionOnce=true);
   await profile.getByRole('button',{name:'Save household',exact:true}).click();
   await page.waitForFunction(id=>window.__fixtures.households.find(h=>h.id===id).phone==='+298 123456',createdId);
   assert.equal(await page.evaluate(()=>window.__refreshCount),1,'permission errors refresh the session once before retry');
   await page.locator('#expandHouseholds').click();
   await openSection(created,'Add guest');
   const newGuest=created.locator('.guest-edit-form');
   await newGuest.getByLabel('First name',{exact:true}).fill('New guest');
   await newGuest.getByRole('button',{name:'Save guest'}).click();
   await page.waitForFunction(()=>window.__fixtures.guests.some(g=>g.first_name==='New guest'));
   await page.locator('#expandHouseholds').click();
   await openSection(created,'Contacts');await openSection(created,'Add contact');
   const contact=created.locator('.management-form').filter({has:page.getByRole('button',{name:'Create contact',exact:true})});
   await contact.getByLabel('Contact name',{exact:true}).fill('Family contact');
   await contact.getByLabel('Contact details').fill('contact@example.invalid');
   await contact.getByLabel('Preferred delivery method').selectOption('email');
   await contact.getByRole('button',{name:'Create contact'}).click();
   await page.waitForFunction(()=>window.__fixtures.household_contacts.length===1);
   await page.locator('#expandHouseholds').click();
   await openSection(created,'Contacts');await openSection(created,'Family contact');
   const contactEdit=created.locator('.management-form').filter({has:page.getByRole('button',{name:'Save contact',exact:true})});
   await contactEdit.getByLabel('Contact name',{exact:true}).fill('Updated contact');
   await contactEdit.getByRole('button',{name:'Save contact'}).click();
   await page.waitForFunction(()=>window.__fixtures.household_contacts[0].contact_name==='Updated contact');
   await page.locator('#expandHouseholds').click();
   await created.getByRole('button',{name:'Move guest',exact:true}).first().click();
   await created.getByLabel('Destination household').selectOption('33333333-3333-4333-8333-333333333333');
   await created.locator('.guest-move-panel').getByRole('button',{name:'Move guest',exact:true}).click();
   await page.waitForFunction(()=>window.__fixtures.guests.find(g=>g.first_name==='New guest').household_id==='33333333-3333-4333-8333-333333333333');
   await created.getByRole('button',{name:'Archive household',exact:true}).click();
   await page.waitForFunction(id=>!document.querySelector(`[data-tree-key="household:${id}"]`),createdId);
   await page.locator('#showArchived').check();
   await page.locator('#expandHouseholds').click();
   assert.equal(await created.getByRole('button',{name:'Copy private invitation link'}).count(),0);
   await created.getByRole('button',{name:'Restore household',exact:true}).click();
   await page.waitForFunction(id=>!window.__fixtures.households.find(h=>h.id===id).archived_at,createdId);
   // Server errors retain the edited form and its values.
   await page.locator('#expandHouseholds').click();
   await created.getByRole('button',{name:'Edit household: New test family',exact:true}).click();
   await profile.getByLabel('Household phone').fill('Unsaved phone');
   await page.evaluate(()=>window.__failNext=true);
   await profile.getByRole('button',{name:'Save household',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('#adminMessage').textContent.includes('Simulated save failure'));
   assert.equal(await profile.getByLabel('Household phone').inputValue(),'Unsaved phone');
   assert.equal(await profile.getByRole('button',{name:'Save household'}).isEnabled(),true);
   await page.setViewportSize({width:390,height:844});
   const householdDimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
   assert.ok(householdDimensions.scroll<=householdDimensions.client+3,'household forms fit mobile');
   await page.screenshot({path:path.join(root,'artifacts','household-management-mobile.png'),fullPage:true});



   await page.locator('#settingsToggle').click();
   await page.locator('[data-settings-tab="venues"]').click();
   await openSection(page,'Venues');await openSection(page,'Add venue');
   const newVenue=page.locator('#newVenueForm form');
   await newVenue.getByLabel('Venue name',{exact:true}).fill('Faroe test venue');
   await newVenue.getByLabel('Country code').fill('FO');
   await newVenue.getByLabel('Venue timezone').fill('Atlantic/Faroe');
   await newVenue.getByLabel('Venue address').fill('Synthetic Faroe address');
   await newVenue.getByLabel('Welcome message — English',{exact:true}).fill('Welcome to our Faroese celebration.');
   await newVenue.getByRole('button',{name:'Create venue'}).click();
   await page.waitForFunction(()=>window.__fixtures.event_locations.length===1);
   assert.equal(await page.evaluate(()=>window.__fixtures.event_locations[0].welcome_en),'Welcome to our Faroese celebration.');
   assert.equal(await page.getByText('Welcome messages',{exact:true}).count(),0,'global welcome editor removed');
   await newVenue.getByLabel('Venue name',{exact:true}).fill('Germany test venue');
   await newVenue.getByLabel('Country code').fill('DE');
   await newVenue.getByLabel('Venue timezone').fill('Europe/Berlin');
   await newVenue.getByRole('button',{name:'Create venue'}).click();
   await page.waitForFunction(()=>window.__fixtures.event_locations.length===2);
   const venueIds=await page.evaluate(()=>window.__fixtures.event_locations.map(v=>v.id));
   const savedVenue=page.locator('#venueList > details').first();await savedVenue.locator('summary').first().click();
   await savedVenue.locator('.venue-welcome-editor').screenshot({path:path.join(root,'artifacts','venue-welcome-preview.png')});
   await openSection(page,'Sessions & scheduling');await openSection(page,'Add session');
   const newSession=page.locator('#newSessionEditor form');
   for(const [name,key,id] of [['Faroe celebration','faroe-celebration',venueIds[0]],['German celebration','german-celebration',venueIds[1]]]){
     await newSession.getByLabel('Session name',{exact:true}).fill(name);
     await newSession.getByLabel('Session key').fill(key);
     await newSession.getByLabel('Session venue').selectOption(id);
     await newSession.getByLabel('Starts (venue local time)').fill('2027-02-20T18:00');
     await newSession.getByLabel('Ends (venue local time)').fill('2027-02-20T23:00');
     await newSession.getByRole('button',{name:'Create session'}).click();
     await page.waitForFunction(key=>window.__fixtures.event_sessions.some(s=>s.session_key===key),key);
   }
   assert.equal(await page.evaluate(()=>window.__fixtures.event_sessions.find(s=>s.session_key==='german-celebration').starts_at),'2027-02-20T17:00:00.000Z');
   await page.locator('#closeSettings').click();
   await page.locator('[data-tab="invites"]').click();
   assert.equal(new URL(page.url()).hash,'#invites');
   await page.locator('#inviteRows details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   assert.equal(await page.locator('#householdRows button[title*=Copy]').count(),0,'copy controls only in Manage Invites');
   assert.ok(await page.getByRole('button',{name:'Copy invite code',exact:true}).count()>0);
   await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};});
   await page.getByRole('button',{name:'Copy invite code',exact:true}).first().click();
   assert.match(await page.evaluate(()=>window.__copied),/^[A-HJ-NP-Z2-9]{8}$/);
   await page.getByRole('button',{name:'Copy invitation link',exact:true}).first().click();
   assert.ok((await page.evaluate(()=>window.__copied)).includes('?='));
   assert.equal(await page.locator('#inviteRows').getByText('New test family',{exact:true}).count(),0,'empty households omitted');

   const invitations=page.locator('[data-invite-household="22222222-2222-4222-8222-222222222222"] > .household-expanded > .invite-item');
   await openSection(invitations,'Session invitations');
   await invitations.getByLabel('Faroe celebration · Faroe test venue — household',{exact:true}).selectOption('true');
   await invitations.getByLabel('German celebration · Germany test venue — household',{exact:true}).selectOption('false');
   await invitations.getByLabel('Edited Guest — German celebration',{exact:true}).selectOption('true');
   await invitations.getByRole('button',{name:'Save session invitations'}).click();
   await page.waitForFunction(()=>!!window.__lastAssignments);
   assert.ok(await page.evaluate(()=>window.__lastAssignments.p_assignments.some(a=>a.guest_id&&a.is_invited===true)));
   await page.setViewportSize({width:1250,height:950});
   await page.locator('#inviteRows details').evaluateAll(nodes=>nodes.forEach(n=>n.open=!n.classList.contains('admin-management')));
   await page.screenshot({path:path.join(root,'artifacts','manage-invites-venues.png'),fullPage:true});
   await page.locator('[data-tab="food"]').click();
   assert.equal(await page.locator('.food-category').count(),2,'food grouped by category');
   await page.locator('.food-category').last().locator('summary').click();
   assert.equal(await page.locator('.food-category').last().evaluate(el=>el.open),true,'food group expands');
   const before=await page.evaluate(()=>window.__fetchCount);
   await page.locator('#refreshButton').click();
   await page.waitForFunction(n=>window.__fetchCount>n,before);
   assert.equal(await page.locator('#refreshButton').isDisabled(),false,'refresh completes');
   await page.setViewportSize({width:390,height:844});
   const dims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
   if(dims.scroll>dims.client+3)throw Error('Horizontal overflow on mobile: '+JSON.stringify(dims));
   await page.screenshot({path:path.join(root,'artifacts','admin-mobile-dark.png'),fullPage:true});

   await page.setViewportSize({width:1250,height:950});
   await page.evaluate(()=>window.__fixtures.guests.push({id:'preview-parent-guest',household_id:'11111111-1111-4111-8111-111111111111',first_name:'Parent',last_name:'Guest',rsvp_status:'pending'}));
   await page.locator('#refreshButton').click();await page.waitForFunction(()=>document.querySelector('#adminMessage').textContent.includes('refreshed')||!document.querySelector('#refreshButton').disabled);
   await page.locator('[data-tab="households"]').click();await page.locator('#expandHouseholds').click();
   assert.ok((await page.locator('[data-tree-key="household:11111111-1111-4111-8111-111111111111"] > summary').innerText()).includes('1 guest · 1 sub-household'));
   assert.equal(await page.locator('.admin-heading .eyebrow').count(),0);assert.equal(await page.locator('footer').count(),0);
   await page.locator('#newHousehold').evaluate(el=>el.closest('details').open=false);
   await page.locator('[data-tree-key="side:maria_haass"]').evaluate(el=>el.open=false);
   await page.locator('[data-tree-key="group:paetur_hentze:"]').evaluate(el=>el.open=false);
   await page.locator('#themeToggle').click();
   await page.screenshot({path:path.join(root,'artifacts','households-preview-dark.png'),fullPage:true});await page.locator('#themeToggle').click();
   // End-to-end admin controls against synthetic fixtures only.
   const childId='22222222-2222-4222-8222-222222222222';
   await page.evaluate(id=>{const h=window.__fixtures.households.find(h=>h.id===id);h.rsvp_state='locked';h.food=false;const s=window.__fixtures.event_sessions.find(s=>s.session_key==='faroe-celebration');window.__fixtures.guest_session_responses.push({guest_id:'55555555-5555-4555-8555-555555555555',session_id:s.id,rsvp_status:'attending'});},childId);
   await page.locator('#refreshButton').click();await page.waitForFunction(()=>!document.querySelector('#refreshButton').disabled);await page.locator('#expandHouseholds').click();
   const childNode=page.locator('[data-tree-key="household:'+childId+'"]');
   await openSection(childNode,'RSVP management');
   const rsvp=childNode.locator('details').filter({has:page.getByText('RSVP management',{exact:true})});
   await openSection(rsvp,'Correct response: Edited Guest · Faroe celebration');
   const correction=rsvp.locator('details').filter({has:page.getByText('Correct response: Edited Guest · Faroe celebration',{exact:true})});
   await correction.getByLabel('Corrected response').selectOption('declined');await correction.getByLabel('Reason for RSVP correction').fill('Guest confirmed they cannot attend this session.');await correction.getByRole('button',{name:'Save correction'}).click();
   await page.waitForFunction(()=>window.__fixtures.guest_session_responses.some(r=>r.rsvp_status==='declined'));
   await page.locator('#expandHouseholds').click();await openSection(childNode,'RSVP management');
   assert.ok((await rsvp.locator('.rsvp-current-responses').innerText()).includes('Not attending'));
   await rsvp.getByLabel('Reason for reopening').fill('Household requested to update their plans.');
   await rsvp.screenshot({path:path.join(root,'artifacts','rsvp-controls-preview.png')});
   await rsvp.getByRole('button',{name:'Reopen RSVP'}).click();await page.waitForFunction(id=>window.__fixtures.households.find(h=>h.id===id).rsvp_state==='open',childId);
   await page.locator('#expandHouseholds').click();await openSection(childNode,'RSVP management');await openSection(rsvp,'Allow a late response');
   await rsvp.getByLabel('Allow responses until (Europe/Berlin)',{exact:true}).fill('2027-02-19T18:00');await rsvp.getByLabel('Reason for late response').fill('Allow travel arrangements to be confirmed.');await rsvp.getByRole('button',{name:'Allow late response',exact:true}).click();
   await page.waitForFunction(id=>!!window.__fixtures.households.find(h=>h.id===id).late_submission_until,childId);
   await page.locator('#expandHouseholds').click();await openSection(childNode,'Food access');
   const foodAccess=childNode.locator('details').filter({has:page.getByText('Food access',{exact:true})});
   await foodAccess.getByLabel('Allow this household to contribute food').check();await foodAccess.getByLabel('Reason for food-access change').fill('Household offered to bring a dish.');await foodAccess.getByRole('button',{name:'Save food access'}).click();await page.waitForFunction(id=>window.__fixtures.households.find(h=>h.id===id).food,childId);
   await page.locator('#expandHouseholds').click();await openSection(childNode,'Food access');await foodAccess.screenshot({path:path.join(root,'artifacts','food-access-preview.png')});
   await page.locator('[data-tab="invites"]').click();await page.locator('#inviteRows details.household-tree-node').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   const childInvite=page.locator('[data-invite-household="'+childId+'"]');await openSection(childInvite,'Invitation delivery');await openSection(childInvite,'Prepare delivery');
   const delivery=childInvite.locator('details').filter({has:page.getByText('Invitation delivery',{exact:true})});
   await delivery.getByLabel('Delivery channel').selectOption('manual');await delivery.getByLabel('Message text').fill('You are invited to celebrate with us. Here is your private invitation link.');await delivery.getByLabel('Delivery status').selectOption('draft');await delivery.getByRole('button',{name:'Create delivery draft'}).click();await page.waitForFunction(()=>window.__fixtures.invitation_send_queue.length===1);
   await page.locator('#inviteRows details.household-tree-node').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await openSection(childInvite,'Invitation delivery');
   const record=delivery.locator('[data-delivery-id]');await record.evaluate(el=>el.open=true);await openSection(record,'Edit delivery');await record.getByLabel('Delivery status').selectOption('ready');await record.getByRole('button',{name:'Save delivery changes'}).click();await page.waitForFunction(()=>window.__fixtures.invitation_send_queue[0].status==='ready');
   await page.locator('#inviteRows details.household-tree-node').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await openSection(childInvite,'Invitation delivery');await record.evaluate(el=>el.open=true);
   await record.getByLabel('Sent note',{exact:true}).fill('Handed over the invitation in person.');await record.getByLabel('I sent this message to the displayed recipient').check();await record.getByRole('button',{name:'Record as sent'}).click();await page.waitForFunction(()=>window.__fixtures.invitation_send_queue[0].status==='sent');
   await page.locator('#inviteRows details.household-tree-node').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await openSection(childInvite,'Invitation delivery');await record.evaluate(el=>el.open=true);
   assert.equal(await record.getByRole('button',{name:'Record as sent'}).count(),0);await delivery.screenshot({path:path.join(root,'artifacts','delivery-tracking-preview.png')});
   await openSection(page,'Delivery log');await page.locator('#deliveryStatusFilter').selectOption('sent');assert.ok((await page.locator('#deliveryLog').textContent()).includes('Example child'));
   await page.setViewportSize({width:390,height:844});const controlDims=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(controlDims.scroll<=controlDims.client+3,'delivery controls fit mobile');

   await page.goto(url.replace('/admin/','/'),{waitUntil:'load'});
   assert.equal(await page.locator('footer').count(),0);assert.equal(await page.locator('#unpublishedMessage').count(),0);
   assert.equal(await page.locator('#languageSwitcher').isVisible(),false);assert.equal(await page.locator('#adminLink').isVisible(),true);
   await page.setViewportSize({width:1250,height:850});
   await page.screenshot({path:path.join(root,'artifacts','main-preview-dark.png'),fullPage:true});
   assert.ok((await page.locator('.brand').textContent()).includes('Event Invitation'));
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   await page.emulateMedia({colorScheme:'light'});await page.waitForTimeout(100);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light');

   const guestData={event:{event_name:'Two venue celebration',default_language:'en',timezone:'Atlantic/Faroe'},sessions:[{id:'fo-session',name:'Faroe celebration',location_id:'fo-venue',starts_at:'2027-02-20T18:00:00Z',requires_rsvp:true},{id:'de-session',name:'German celebration',location_id:'de-venue',starts_at:'2027-02-27T17:00:00Z',requires_rsvp:true}],locations:[{id:'fo-venue',name:'Faroe venue',address:'Faroe address',timezone:'Atlantic/Faroe',welcome_en:'A special welcome at our Faroe venue.'},{id:'de-venue',name:'German venue',address:'German address',timezone:'Europe/Berlin'}],content:{}};
   const guestInvitation={household:{name:'Two venue household',language:'en',rsvp_state:'open'},guests:[{id:'one',first_name:'Invited',last_name:'Guest'}],invitations:[{guest_id:'one',session_id:'fo-session',requires_rsvp:true},{guest_id:'one',session_id:'de-session',requires_rsvp:true}]};
   const guestMock=`window.supabase={createClient:()=>({rpc:async()=>({data:${JSON.stringify(guestData)}}),functions:{invoke:async(name,options)=>({data:options.body.action==='get_invitation_v2'?${JSON.stringify(guestInvitation)}:null})}})};`;
   await page.route('**/supabase.min.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:guestMock}));
   await page.emulateMedia({colorScheme:'dark'});
   await page.goto(url.replace('/admin/','/'),{waitUntil:'load'});
   assert.equal(await page.locator('#languageSwitcher').isVisible(),true);assert.equal(await page.locator('#adminLink').isVisible(),false);
   await page.goto(url.replace('/admin/','/?=ABCDEFGH'),{waitUntil:'load'});
   await page.locator('#invitationCard:not(.hidden)').waitFor();
   assert.equal(await page.locator('.session-venue').count(),2);
   assert.equal(await page.locator('#adminLink').isVisible(),false);assert.equal(await page.locator('#languageSwitcher').isVisible(),true);
   assert.ok((await page.locator('.venue-welcome').innerText()).includes('A special welcome'));
   assert.ok((await page.locator('#rsvpRows').innerText()).includes('Atlantic/Faroe'));
   assert.ok((await page.locator('#rsvpRows').innerText()).includes('Europe/Berlin'));
   assert.equal(await page.locator('#rsvpRows input[type=radio]').count(),4);
   await page.screenshot({path:path.join(root,'artifacts','guest-two-venues-dark.png'),fullPage:true});
   await page.route('**/supabase.min.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:"window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null}})}})}"}));
   await page.emulateMedia({colorScheme:'dark'});
   await page.goto(url,{waitUntil:'load'});
   await page.locator('#loginForm').waitFor();
   assert.ok((await page.locator('.brand').textContent()).includes('Administration'));
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
   await page.emulateMedia({colorScheme:'light'});await page.waitForTimeout(100);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   if(errors.length)throw Error('Admin browser script errors: '+errors.join(' | '));
   console.log('PASS: topbar, dark mode persistence, Settings page, expandable households, guest editing, refresh and mobile screenshots');
 }finally{
   await browser.close();
   await new Promise(resolve=>server.close(resolve));
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});

