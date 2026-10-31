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
" households:[{id:h1,household_name:'Example parent',invite_code:'ABCDEFGH',side:'paetur_hentze',relation_group_id:cat1,parent_id:null,sort_order:1,rsvp_state:'open',language:'fo'},{id:h2,household_name:'Example child',invite_code:'EFGHJKLM',side:'paetur_hentze',relation_group_id:cat1,parent_id:h1,sort_order:2,rsvp_state:'open',language:'fo'},{id:h3,household_name:'Example Maria family',invite_code:'HJKLMNPQ',side:'maria_haass',relation_group_id:cat2,parent_id:null,sort_order:1,rsvp_state:'open',language:'de'}],",
" guests:[{id:'55555555-5555-4555-8555-555555555555',household_id:h1,first_name:'Example',last_name:'Guest',language:'fo',is_child:false,relation:'Cousin',notes:'Invitation note',rsvp_status:'pending'},{id:'77777777-7777-4777-8777-777777777777',household_id:h2,first_name:'Nested',last_name:'Guest',language:'en',is_child:true,rsvp_status:'pending'}],",
" food_categories:[{id:cat1,name:'Main dishes',sort_order:1},{id:cat2,name:'Desserts',sort_order:2}],",
" food_items:[{id:'66666666-6666-4666-8666-666666666666',category:'Main dishes',name_fo:'Sample dish',name_en:'Sample dish',name_de:'Sample dish',sort_order:1,quantity_needed:4,active:true}],",
" relation_groups:[{id:cat1,name:'Family',sort_order:1},{id:cat2,name:'Family',sort_order:1}],",
" household_contacts:[],management_audit:[],food_claims:[],rsvp_submissions:[],household_session_defaults:[{household_id:h1,session_id:s1,is_invited:true}],event_content:[]",
"};",
"const client={auth:{getUser:async()=>({data:{user:{email:'test-admin@example.invalid'}}}),signOut:async()=>({error:null})},rpc:async(name,args)=>{if(window.__managementRpc){const r=window.__managementRpc(name,args);if(r)return r;}if(name==='admin_update_guest'){window.__lastGuestUpdate=args;const guest=fixtures.guests.find(g=>g.id===args.p_guest_id);if(!guest)return {data:null,error:{message:'No guest'}};Object.assign(guest,{first_name:args.p_first_name,last_name:args.p_last_name,courtesy_title:args.p_courtesy_title,relation:args.p_relation,language:args.p_language,is_child:args.p_is_child,dietary_requirements:args.p_dietary_requirements,notes:args.p_notes});return {data:null,error:null};}return name==='is_admin'?{data:true}:name==='admin_list_members'?{data:[{name:'Example admin',email:'test-admin@example.invalid',user_id:h1}]}:{data:null,error:null};},from(name){return {select(){if(name==='event_settings')window.__fetchCount++;const query={eq(){return query;},order(){return query;},limit(){return query;},then(resolve){return Promise.resolve({data:fixtures[name]||[],error:null}).then(resolve);}};return query;}}}};",
"window.__fixtures=fixtures;window.__calls=[];",
"window.__managementRpc=(name,args)=>{window.__calls.push({name,args});if(window.__failNext){window.__failNext=false;return {error:{message:'Simulated save failure'}};}let data=null;if(name==='admin_save_household'){if(args.p_id)Object.assign(fixtures.households.find(h=>h.id===args.p_id),args.p_values);else{data=crypto.randomUUID();fixtures.households.push({id:data,...args.p_values,invite_code:'TESTABCD',rsvp_state:'open'});}}else if(name==='admin_create_guest'){data=crypto.randomUUID();fixtures.guests.push({id:data,household_id:args.p_household_id,...args.p_values,rsvp_status:'pending'});}else if(name==='admin_move_guest'){fixtures.guests.find(g=>g.id===args.p_guest_id).household_id=args.p_household_id;}else if(name==='admin_set_archived'){fixtures[args.p_entity].find(x=>x.id===args.p_id).archived_at=args.p_archived?new Date().toISOString():null;}else if(name==='admin_save_contact'){if(args.p_id)Object.assign(fixtures.household_contacts.find(c=>c.id===args.p_id),args.p_values);else{data=crypto.randomUUID();fixtures.household_contacts.push({id:data,household_id:args.p_household_id,...args.p_values});}}else return null;return {data,error:null};};",
"window.supabase={createClient:()=>client};"
].join('\n');
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
   assert.equal(await page.locator('[data-tab]').count(),3,'only three main text tabs');
   assert.deepEqual(await page.locator('[data-tab]').evaluateAll(nodes=>nodes.map(n=>n.textContent.trim())),['Overview','Households','Food']);
   assert.deepEqual(await page.locator('.admin-top-actions>button').evaluateAll(nodes=>nodes.map(n=>n.id)),
     ['settingsToggle','editModeButton','refreshButton','themeToggle','logout'],'topbar action icon order');
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
   await page.locator('#themeToggle').click();
   await page.waitForTimeout(220);
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','dark mode enabled');
   assert.equal(await page.evaluate(()=>localStorage.getItem('rsvp-admin-theme')),'dark','theme preference saved');
   await page.locator('#settingsToggle').click();
   await page.locator('[data-settings-tab="event"]').click();
   await page.screenshot({path:path.join(previewDir,'admin-settings-dark.png'),fullPage:true});
   assert.equal(await page.locator('#settingName').isVisible(),true,'event settings visible in dark mode');
   await page.locator('#closeSettings').click();
   await page.reload({waitUntil:'load'});
   await page.locator('#adminApp:not(.hidden)').waitFor();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','dark mode persisted across reloads');
   await page.locator('#themeToggle').click();
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light','light mode restored');
   await page.locator('[data-tab="households"]').click();
   assert.equal(await page.locator('#householdRows details.hierarchy-section').count(),2,'two sides');
   assert.equal(await page.locator('#householdRows details.hierarchy-group').count(),2,'relationship groups');
   assert.equal(await page.locator('#householdRows details.household-tree-node').count(),3,'every household is expandable');
   await page.locator('#collapseHouseholds').click();
   assert.equal(await page.locator('#householdRows details[open]').count(),0,'all groups collapsed');
   await page.locator('#expandHouseholds').click();
   assert.equal(await page.locator('#householdRows details:not([open])').count(),0,'all groups expanded');
   assert.equal(await page.locator('.household-actions .edit-only').first().isVisible(),false,'row editing hidden in view');
   await page.locator('#editModeButton').click();
   assert.equal(await page.locator('#adminApp').getAttribute('data-mode'),'edit');
   await page.locator('.household-actions button[title^="Edit household hierarchy"]').first().click();
   assert.equal(await page.locator('.household-inline-editor').first().isVisible(),true,'inline edit expands');
   assert.equal(await page.locator('.household-guest-row').count(),2,'guest rows appear inside parent and child households');
   const guestEditorButton=page.locator('.household-guest-row button[title^="Edit guest"]').first();
   await guestEditorButton.click();
   const guestForm=page.locator('.guest-edit-form').first();
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
   await page.locator('#themeToggle').click();
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
   await created.getByRole('button',{name:'Edit household hierarchy: New test family',exact:true}).click();
   const profile=created.locator('.household-inline-editor .management-form');
   await profile.getByLabel('Household phone').fill('+298 123456');
   await profile.getByRole('button',{name:'Save household',exact:true}).click();
   await page.waitForFunction(id=>window.__fixtures.households.find(h=>h.id===id).phone==='+298 123456',createdId);
   await page.locator('#expandHouseholds').click();
   const newGuest=created.locator('.guest-edit-form');
   await newGuest.getByLabel('First name',{exact:true}).fill('New guest');
   await newGuest.getByRole('button',{name:'Save guest'}).click();
   await page.waitForFunction(()=>window.__fixtures.guests.some(g=>g.first_name==='New guest'));
   await page.locator('#expandHouseholds').click();
   const contact=created.locator('.management-form').filter({has:page.getByRole('button',{name:'Create contact',exact:true})});
   await contact.getByLabel('Contact name',{exact:true}).fill('Family contact');
   await contact.getByLabel('Contact details').fill('contact@example.invalid');
   await contact.getByLabel('Preferred delivery method').selectOption('email');
   await contact.getByRole('button',{name:'Create contact'}).click();
   await page.waitForFunction(()=>window.__fixtures.household_contacts.length===1);
   await page.locator('#expandHouseholds').click();
   const contactEdit=created.locator('.management-form').filter({has:page.getByRole('button',{name:'Save contact',exact:true})});
   await contactEdit.getByLabel('Contact name',{exact:true}).fill('Updated contact');
   await contactEdit.getByRole('button',{name:'Save contact'}).click();
   await page.waitForFunction(()=>window.__fixtures.household_contacts[0].contact_name==='Updated contact');
   await page.locator('#expandHouseholds').click();
   await created.getByLabel('Destination household').selectOption('33333333-3333-4333-8333-333333333333');
   await created.getByRole('button',{name:'Move guest',exact:true}).click();
   await page.waitForFunction(()=>window.__fixtures.guests.find(g=>g.first_name==='New guest').household_id==='33333333-3333-4333-8333-333333333333');
   await created.getByRole('button',{name:'Archive household',exact:true}).click();
   await page.waitForFunction(id=>!document.querySelector(`[data-tree-key="household:${id}"]`),createdId);
   await page.locator('#showArchived').check();
   await page.locator('#expandHouseholds').click();
   assert.equal(await created.getByRole('button',{name:'Copy private invitation link'}).isDisabled(),true);
   await created.getByRole('button',{name:'Restore household',exact:true}).click();
   await page.waitForFunction(id=>!window.__fixtures.households.find(h=>h.id===id).archived_at,createdId);
   // Server errors retain the edited form and its values.
   await page.locator('#expandHouseholds').click();
   await created.getByRole('button',{name:'Edit household hierarchy: New test family',exact:true}).click();
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
   if(errors.length)throw Error('Admin browser script errors: '+errors.join(' | '));
   console.log('PASS: topbar, dark mode persistence, Settings page, expandable households, guest editing, refresh and mobile screenshots');
 }finally{
   await browser.close();
   await new Promise(resolve=>server.close(resolve));
 }
}
run().catch(e=>{console.error(e);process.exitCode=1;server.close();});

