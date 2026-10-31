// Verify real request headers, rather than only mocked SDK return values.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 let session={access_token:'signed-in-token'},refresh={data:{session:{access_token:'refreshed-token'}}},calls=[],refreshes=0,replies=[];
 const db={auth:{getSession:async()=>({data:{session}}),refreshSession:async()=>{refreshes++;return refresh;}}};
 const context={URL,URLSearchParams,Intl,Date,localStorage:{getItem:()=>null},window:{location:{href:'https://example.invalid/admin/'},RSVP_CONFIG:{supabaseUrl:'https://example.supabase.co',supabaseKey:'sb_publishable_test'},supabase:{createClient:()=>db}},document:{querySelector:()=>({src:'https://example.invalid/js/core.js'})},fetch:async(url,options)=>{calls.push({url,options});const r=replies.shift()||{ok:true,status:200,body:'"saved"'};return {...r,text:async()=>r.body};}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('js/core.js','utf8'),context);const rpc=context.window.RSVP.adminRpc;
 assert.equal((await rpc('admin_save_household',{p_id:null})).data,'saved');
 assert.equal(calls[0].options.headers.Authorization,'Bearer signed-in-token');assert.equal(calls[0].options.headers.apikey,'sb_publishable_test');
 assert.equal(calls[0].url,'https://example.supabase.co/rest/v1/rpc/admin_save_household');
 calls=[];session=null;refresh={data:{session:null},error:{message:'No session'}};
 assert.equal((await rpc('admin_update_guest',{})).error.code,'AUTH_SESSION_MISSING');assert.equal(calls.length,0,'missing sessions never send anonymous writes');
 session={access_token:'sb_publishable_test'};refresh={data:{session:{access_token:'sb_publishable_test'}}};
 assert.equal((await rpc('admin_save_household',{})).error.code,'AUTH_SESSION_MISSING');assert.equal(calls.length,0,'public keys never become admin bearer credentials');
 session={access_token:'old-session'};refresh={data:{session:{access_token:'new-session'}}};refreshes=0;
 replies=[{ok:false,status:401,body:'{"code":"42501","message":"permission denied for function admin_update_guest"}'},{ok:true,status:200,body:'null'}];
 assert.equal((await rpc('admin_update_guest',{})).error,null);assert.equal(refreshes,1);assert.equal(calls[1].options.headers.Authorization,'Bearer new-session');
 calls=[];refreshes=0;replies=[{ok:false,status:400,body:'{"message":"Household name required"}'}];
 assert.equal((await rpc('admin_save_household',{})).error.message,'Household name required');assert.equal(refreshes,0);assert.equal(calls.length,1,'business validation is never retried');
 calls=[];refreshes=0;replies=Array(2).fill({ok:false,status:403,body:'{"code":"42501","message":"permission denied for function admin_save_household"}'});
 assert.equal((await rpc('admin_save_household',{})).error.code,'42501');assert.equal(refreshes,1);assert.equal(calls.length,2,'permission retry is bounded');
 calls=[];assert.ok((await rpc('../get_invitation_v2')).error);assert.equal(calls.length,0);
 console.log('PASS: explicit admin bearer credentials, missing-session blocking, refresh recovery and bounded retries');
})().catch(e=>{console.error(e);process.exit(1);});
