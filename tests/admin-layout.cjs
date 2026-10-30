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
" households:[{id:h1,household_name:'Example parent',invite_code:'ABCDEFGH',side:'paetur',relation_group_id:cat1,parent_id:null,sort_order:1,rsvp_state:'open',language:'fo'},{id:h2,household_name:'Example child',invite_code:'EFGHJKLM',side:'paetur',relation_group_id:cat1,parent_id:h1,sort_order:2,rsvp_state:'open',language:'fo'},{id:h3,household_name:'Example Maria family',invite_code:'HJKLMNPQ',side:'maria',relation_group_id:cat2,parent_id:null,sort_order:1,rsvp_state:'open',language:'de'}],",
" guests:[{id:'55555555-5555-4555-8555-555555555555',household_id:h1,first_name:'Example',last_name:'Guest',language:'fo',is_child:false,relation:'Cousin',notes:'Invitation note',rsvp_status:'pending'},{id:'77777777-7777-4777-8777-777777777777',household_id:h2,first_name:'Nested',last_name:'Guest',language:'en',is_child:true,rsvp_status:'pending'}],",
" food_categories:[{id:cat1,name:'Main dishes',sort_order:1},{id:cat2,name:'Desserts',sort_order:2}],",
" food_items:[{id:'66666666-6666-4666-8666-666666666666',category:'Main dishes',name_fo:'Sample dish',name_en:'Sample dish',name_de:'Sample dish',sort_order:1,quantity_needed:4,active:true}],",
" relation_groups:[{id:cat1,name:'Family',sort_order:1},{id:cat2,name:'Family',sort_order:1}],",
" food_claims:[],rsvp_submissions:[],household_session_defaults:[{household_id:h1,session_id:s1,is_invited:true}],event_content:[]",
"};",
"const client={auth:{getUser:async()=>({data:{user:{email:'test-admin@example.invalid'}}}),signOut:async()=>({error:null})},rpc:async(name,args)=>{if(name==='admin_update_guest'){window.__lastGuestUpdate=args;const guest=fixtures.guests.find(g=>g.id===args.p_guest_id);if(!guest)return {data:null,error:{message:'No guest'}};Object.assign(guest,{first_name:args.p_first_name,last_name:args.p_last_name,courtesy_title:args.p_courtesy_title,relation:args.p_relation,language:args.p_language,is_child:args.p_is_child,dietary_requirements:args.p_dietary_requirements,notes:args.p_notes});return {data:null,error:null};}return name==='is_admin'?{data:true}:name==='admin_list_members'?{data:[{name:'Example admin',email:'test-admin@example.invalid',user_id:h1}]}:{data:null,error:null};},from(name){return {select(){if(name==='event_settings')window.__fetchCount++;return Promise.resolve({data:fixtures[name]||[],error:null});}}}};",
"window.supabase={createClient:()=>client};"
].join('\n');
async function run(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/admin/';
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1100,height:750}});
 const errors=[];
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
   await page.screenshot({path:path.join(root,'artifacts','admin-households-dark.png'),fullPage:true});

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
