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
async function run(type){
 const browser=await type.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:820,height:1180}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const seed=mock+`\nconst h=fixtures.households.find(h=>!h.archived_at&&h.invite_code);window.__deliveryHousehold=h;fixtures.invitation_send_queue=['email','sms','whatsapp'].map((channel,i)=>({id:'device-'+i,household_id:h.id,channel,status:'ready',revision:1,created_at:'2026-11-01T12:00:00Z',updated_at:'2026-11-01T12:00:00Z',invitation_code_snapshot:h.invite_code,recipient_snapshot:{contact_value:channel==='email'?'test@example.invalid':'+298 123456'},message_subject:'Invitation',message_body:'Hey Føroyskt & Deutsch?'}));fixtures.invitation_send_queue.push({...fixtures.invitation_send_queue[0],id:'sent-original',status:'sent'},{...fixtures.invitation_send_queue[0],id:'stale',invitation_code_snapshot:'RETIRED'});`;
  const hierarchy=`\nfor(const [id,name,order] of [['tree-a','Zulu first',1],['tree-b','Alpha second',2]]){fixtures.households.push({...h,id,household_name:name,parent_id:h.id,sort_order:order});fixtures.guests.push({id:'guest-'+id,household_id:id,first_name:name});}`;
  await page.addInitScript(()=>localStorage.setItem('rsvp-interface-language','en'));
  await page.route('**/supabase.min.js',r=>r.fulfill({contentType:'text/javascript',body:seed+hierarchy}));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin/');
  await page.waitForFunction(()=>document.querySelectorAll('#inviteRows [data-invite-household]').length>0);
  await page.locator('[data-tab="invites"]').click();await page.locator('#editModeButton').click();
  await page.locator('#inviteRows details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
  const rows=await page.locator('#inviteRows [data-invite-household]').evaluateAll(nodes=>nodes.map(n=>n.dataset.inviteHousehold));
  assert.ok(rows.indexOf('tree-a')<rows.indexOf('tree-b'),'saved sibling order wins over alphabetic order');
  assert.equal(await page.locator('.invite-nested-rows [data-invite-household="tree-a"]').count(),1,'child indentation retained');
  assert.ok((await page.locator('[data-invite-household="tree-a"]').boundingBox()).height<65,'households retain one compact row');
  const householdId=await page.evaluate(()=>window.__deliveryHousehold.id);
  await page.locator('[data-invite-household="'+householdId+'"]').getByRole('button',{name:/^Invitation delivery/}).click();
  await page.locator('#inviteRows details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
  const record=id=>page.locator('#inviteRows [data-delivery-id="'+id+'"]');
  assert.ok((await record('device-0').getByRole('link',{name:'Open email',exact:true}).getAttribute('href')).startsWith('mailto:'));
  assert.equal(await record('device-1').getByRole('link',{name:'Open Messages',exact:true}).getAttribute('href'),'sms:+298123456');
  assert.ok((await record('device-2').getByRole('link',{name:'Open WhatsApp',exact:true}).getAttribute('href')).startsWith('https://wa.me/298123456?text='));
  assert.equal(await record('stale').getByRole('link').count(),0);
  await record('device-0').getByRole('link',{name:'Open email',exact:true}).evaluate(n=>{n.addEventListener('click',e=>e.preventDefault());n.click();});
  assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.name==='admin_record_delivery_sent').length),0);
  const reminder=record('sent-original').locator('details').filter({has:page.locator('summary',{hasText:'Prepare reminder'})});
  assert.ok((await reminder.locator('textarea').first().inputValue()).includes(await page.evaluate(()=>window.__deliveryHousehold.invite_code))); 
  await reminder.getByRole('button',{name:'Create delivery draft',exact:true}).click();
  await page.waitForFunction(()=>window.__calls.some(c=>c.name==='admin_save_delivery'));
  const call=await page.evaluate(()=>window.__calls.find(c=>c.name==='admin_save_delivery'));
  assert.equal(call.args.p_id,null);assert.equal(call.args.p_values.status,'draft');
  assert.equal(await page.evaluate(()=>fixtures.invitation_send_queue.find(q=>q.id==='sent-original').status),'sent');
  await page.getByRole('button',{name:'Back to households',exact:true}).click();
  assert.equal(await page.locator('.invite-detail-panel').count(),0);
  assert.ok(await page.locator('#inviteRows [data-invite-household]').count());
  assert.deepEqual(errors,[]);console.log(type.name()+': iPad compose links, stale-code blocking, explicit sending and separate reminder draft passed.');
 }finally{await browser.close();}
}
server.listen(0,'127.0.0.1',async()=>{try{await run(chromium);await run(webkit);}catch(e){console.error(e);process.exitCode=1;}finally{server.close();}});
