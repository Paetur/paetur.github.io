// Real pinned Supabase SDK + Chromium/WebKit, with synthetic Auth and RPC servers.
const {chromium,webkit}=require('playwright'),http=require('node:http'),fs=require('node:fs'),assert=require('node:assert/strict');
const core=fs.readFileSync('js/core.js','utf8');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/js/core.js'?'application/javascript':'text/html');res.end(req.url==='/js/core.js'?core:`<!doctype html><script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.10/dist/umd/supabase.min.js" defer></script><script>window.RSVP_CONFIG={supabaseUrl:'https://admin-auth-test.supabase.co',supabaseKey:'sb_publishable_test'};</script><script src="/js/core.js" data-app-core defer></script>`);});
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid'};
function jwt(tag){return [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),tag})).toString('base64url'),'synthetic-test-signature'].join('.');}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
   const browser=await engine.launch({headless:true});try{
     const page=await browser.newPage();let rpcCount=0,refreshCount=0,rejectNext=false;const original=jwt('original'),renewed=jwt('renewed'),headers=[];
     await page.route('https://admin-auth-test.supabase.co/**',async route=>{
       const request=route.request(),url=new URL(request.url());const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Content-Type':'application/json'};
       if(request.method()==='OPTIONS')return route.fulfill({status:200,headers:cors,body:'{}'});
       if(url.pathname==='/auth/v1/token'){const refresh=url.searchParams.get('grant_type')==='refresh_token';if(refresh)refreshCount++;return route.fulfill({status:200,headers:cors,body:JSON.stringify({access_token:refresh?renewed:original,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,user})});}
       if(url.pathname==='/auth/v1/user')return route.fulfill({status:200,headers:cors,body:JSON.stringify(user)});
       if(url.pathname==='/rest/v1/rpc/admin_save_household'){
         rpcCount++;headers.push(request.headers().authorization);
         if(rejectNext){rejectNext=false;return route.fulfill({status:401,headers:cors,body:JSON.stringify({code:'42501',message:'permission denied for function admin_save_household'})});}
         return route.fulfill({status:200,headers:cors,body:'"synthetic-saved"'});
       }
       throw Error('Unexpected synthetic request: '+url.pathname);
     });
     await page.goto('http://127.0.0.1:'+server.address().port+'/',{waitUntil:'load'});
     const missing=await page.evaluate(()=>window.RSVP.adminRpc('admin_save_household',{}));assert.equal(missing.error.code,'AUTH_SESSION_MISSING');assert.equal(rpcCount,0);
     const login=await page.evaluate(()=>window.RSVP.getClient().auth.signInWithPassword({email:'synthetic@example.invalid',password:'synthetic-only'}));assert.equal(login.error,null);
     const saved=await page.evaluate(()=>window.RSVP.adminRpc('admin_save_household',{p_id:null,p_values:{household_name:'Synthetic'}}));assert.equal(saved.data,'synthetic-saved');assert.equal(headers[0],'Bearer '+original);
     rejectNext=true;const recovered=await page.evaluate(()=>window.RSVP.adminRpc('admin_save_household',{}));assert.equal(recovered.data,'synthetic-saved');assert.equal(refreshCount,1);assert.equal(headers.at(-1),'Bearer '+renewed);
     assert.ok(headers.every(h=>h&&!h.includes('sb_publishable')));console.log('PASS: '+name+' real SDK login, explicit admin authorization and refresh recovery');
   }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
