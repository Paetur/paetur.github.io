// Local-only multilingual browser checks. All application data and saves are synthetic.
const {chromium,webkit}=require('playwright');
const {mock}=require('./helpers/admin-fixture.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const root=process.cwd();
const context={window:{}};vm.runInNewContext(fs.readFileSync('js/translations.js','utf8'),context);
const catalog=context.window.RSVP_TRANSLATIONS;
const tokens=s=>[...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(x=>x[1]).sort().join(',');
for(const [source,translations]of Object.entries(catalog))for(const lang of ['fo','de']){
 assert.ok(translations[lang]?.trim(),`${lang}: ${source}`);assert.equal(tokens(source),tokens(translations[lang]),`Placeholders ${lang}: ${source}`);
}
const server=http.createServer((req,res)=>{
 let pathname=new URL(req.url,'http://localhost').pathname;if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'text/plain')+';charset=utf-8');res.end(fs.readFileSync(file));
});
const extra=`
const originalFrom=client.from;client.from=function(name){const query=originalFrom.call(this,name);query.upsert=async(rows,options)=>{if(name!=='event_content')throw Error('Unexpected mutation '+name);window.__contentSave={rows,options};fixtures.event_content=rows;return {error:null};};return query;};
fixtures.households[0].household_name='Food';fixtures.guests[0].first_name='Settings';
client.functions={invoke:async(name,request)=>{const action=request.body.action;if(action==='get_invitation_v2')return {data:{household:{name:'Food',language:'fo',rsvp_state:'open'},guests:[{id:'g',first_name:'Settings'}],invitations:[{guest_id:'g',session_id:s1,requires_rsvp:true}]}};if(action==='get_household_food')return {data:{items:[{id:'dish',name_en:'Food',quantity_needed:5,claimed_total:0}],claims:[]}};return {error:null};}};
const originalRpc=client.rpc;client.rpc=async(name,args)=>name.startsWith('get_public_event')?{data:{event:{event_name:'Settings',default_language:'fo',event_date:'2027-02-20',timezone:'Europe/Berlin'},content:{de:'Unser Fest',fo:'Okkara veitsla'},sessions:[{id:s1,name:'Food'}]}}:originalRpc(name,args);
`;
async function run(browserType){
 const browser=await browserType.launch({headless:true});
 try{
  for(const lang of ['en','fo','de']){
   const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(lang=>localStorage.setItem('rsvp-interface-language',lang),lang);
   await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock+'\n'+extra}));
   const base='http://127.0.0.1:'+server.address().port;
   await page.goto(base+'/admin/');await page.locator('#adminApp:not(.hidden)').waitFor();
   await page.waitForFunction(()=>document.querySelector('#statsGrid').children.length===4);
   assert.equal(await page.locator('html').getAttribute('lang'),lang);
   assert.equal(await page.locator('[data-tab="households"]').textContent(),lang==='en'?'Households':catalog.Households[lang]);
   await page.locator('#settingsToggle').click();await page.locator('#editModeButton').click();
   assert.equal(await page.locator('#eventContentForm button').textContent(),lang==='en'?'Save welcome messages':catalog['Save welcome messages'][lang]);
   for(const l of ['fo','en','de'])await page.locator('#welcome_'+l).fill('Message '+l);
   await page.locator('#eventContentForm button').click();await page.waitForFunction(()=>window.__contentSave);
   assert.equal(await page.evaluate(()=>window.__contentSave.rows.length),3);assert.equal(await page.evaluate(()=>window.__fixtures.event_settings[0].is_published),false);
   assert.equal(await page.evaluate(()=>window.__contentSave.options.onConflict),'content_key,language_code');
   await page.locator('#wordingPhrase').selectOption('Households');await page.locator('#wordingValue').fill('<img src=x onerror=alert(1)>');
   await page.locator('#interfaceWordingForm button[type="submit"]').click();
   assert.equal(await page.locator('#wordingPreview img').count(),0);assert.equal(await page.locator('#wordingPreview').textContent(),'<img src=x onerror=alert(1)>');
   const source=await page.evaluate(()=>window.RSVP_I18N.source());const custom={window:{}};vm.runInNewContext(source,custom);assert.equal(custom.window.RSVP_INTERFACE_OVERRIDES.Households[lang],'<img src=x onerror=alert(1)>');
   assert.equal(await page.evaluate(()=>{try{window.RSVP_I18N.applyWording('Quantity for {item}','de','Menge');return false;}catch{return true;}}),true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Mobile admin overflow');
   await page.goto(base+'/setup.html');assert.equal(await page.locator('h1').textContent(),lang==='en'?'Make this event yours.':catalog['Make this event yours.'][lang]);
   await page.goto(base+'/?ABCDEFGH');await page.locator('#invitationCard:not(.hidden)').waitFor();
   assert.equal(await page.locator('#eventTitle').textContent(),'Settings');assert.equal(await page.locator('#householdName').textContent(),'Food');
   await page.locator('input[value="attending"]').check();await page.locator('#languageSwitcher [data-language="de"]').click();
   assert.equal(await page.locator('html').getAttribute('lang'),'de');assert.equal(await page.locator('input[value="attending"]').isChecked(),true);
   assert.equal(await page.locator('#welcomeMessage').textContent(),'Unser Fest');
   assert.equal(await page.locator('#inviteCode').getAttribute('placeholder'),catalog['Invitation code'].de);
   assert.equal(await page.locator('.food-controls button').textContent(),catalog.Save.de);
   assert.equal(await page.locator('.food-controls input').getAttribute('aria-label'),'Menge für Food');
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS '+browserType.name()+': FO/EN/DE admin, setup, guest, welcome saves, safe custom text, placeholders, mobile layout and retained RSVP answers');
 }finally{await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await run(chromium);await run(webkit);}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
