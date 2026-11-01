// Geometry regression for native disclosures; uses only synthetic administration data.
const {chromium,webkit}=require('playwright');
const {mock}=require('./helpers/admin-fixture.cjs');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer((req,res)=>{
 let pathname=new URL(req.url,'http://localhost').pathname;if(pathname.endsWith('/'))pathname+='index.html';const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'text/plain')+';charset=utf-8');res.end(fs.readFileSync(file));
});
async function compact(locator,label){
 await locator.locator(':scope > summary').click();
 assert.equal(await locator.evaluate(n=>n.open),false,label+' closes');
 const size=await locator.evaluate(n=>({height:n.getBoundingClientRect().height,summary:n.querySelector(':scope > summary').getBoundingClientRect().height}));
 assert.ok(size.height<=size.summary+3,label+' retains hidden content space: '+JSON.stringify(size));
 assert.ok(size.height>=28,label+' retains a usable summary');
 await locator.locator(':scope > summary').click();
 assert.equal(await locator.evaluate(n=>n.open),true,label+' reopens');
 const open=await locator.evaluate(n=>({height:n.getBoundingClientRect().height,summary:n.querySelector(':scope > summary').getBoundingClientRect().height}));
 assert.ok(open.height>open.summary+3,label+' expanded content remains visible');
}
async function run(type){
 const browser=await type.launch({headless:true});
 try{
  for(const width of [1250,390])for(const theme of ['light','dark']){
   const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(theme=>localStorage.setItem('event-appearance',theme),theme);
   await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:mock}));
   await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
   await page.waitForFunction(()=>document.querySelectorAll('#householdRows .hierarchy-section').length>0);
   await page.locator('[data-tab="households"]').click();await page.locator('#expandHouseholds').click();
   const side=page.locator('#householdRows > .hierarchy-section').first();
   const group=side.locator('.hierarchy-group').first();
   const household=group.locator('.household-tree-node').first();
   for(const title of ['Household details','RSVP management','Food access']){
    const disclosure=household.locator(':scope > .household-expanded > details').filter({has:page.locator('summary').filter({hasText:new RegExp('^'+title+'$')})}).first();
    await disclosure.evaluate(n=>n.open=true);await compact(disclosure,title);
   }
   await compact(household,'Household tree row');
   await compact(group,'Relation group');
   await compact(side,'Side group');
   await page.locator('[data-tab="food"]').click();
   const category=page.locator('.food-category.tree-disclosure').first();
   await category.evaluate(n=>n.open=true);await compact(category,'Food category');
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS '+type.name()+': compact collapsed disclosures and visible expanded content at desktop/mobile widths in light/dark themes');
 }finally{await browser.close();}
}
(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await run(chromium);await run(webkit);}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
