(function(){
  'use strict';
 const T=(text,params)=>window.RSVP_I18N?.t(text,params)||text;
  const R=window.RSVP,$=R.byId;
  let step=1,mode='existing',connected=false,verified=false;
  let connectionVersion=0;
  function invalidateConnection(){
    connected=false;
    verified=false;
    return ++connectionVersion;
  }
  const stateMessage=(m,t='info')=>R.showStatus('setupStatus',m,t);
  function displayStep(next){
    if(next>2&&!connected){stateMessage(T("interface.messages.test_your_supabase_connection_before_continuing"),'warning');return;}
    if(next>4&&!verified){stateMessage(T("interface.messages.administrator_verification_required"),'warning');return;}
    if(next===4&&!verified){stateMessage(T("interface.messages.sign_in_as_an_administrator_first"),'warning');return;}
    step=Math.max(1,Math.min(4,next));
    document.querySelectorAll('[data-step-panel]').forEach(p=>p.classList.toggle('hidden',Number(p.dataset.stepPanel)!==step));
    document.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('active',Number(b.dataset.step)===step));
    stateMessage('');window.scrollTo({top:0,behavior:'smooth'});
  }
  async function testConnection(e){
    e.preventDefault();const button=e.submitter||e.target.querySelector('button[type="submit"]');button.disabled=true;
    const version=invalidateConnection();
    try{
      const cfg=R.savePreview($('setupUrl').value,$('setupKey').value);
      const db=R.getClient();
      const {error}=await db.rpc('get_public_event');
      if(version!==connectionVersion)return;
      if(error)throw new Error(T("interface.messages.database_connection_or_schema_validation_failed")+R.safeError(error));
      const probe=await R.guestRpc('get_invitation_v2',{p_code:'AAAAAAAA'});
      if(version!==connectionVersion)return;
      if(probe.error)throw new Error(T("interface.messages.guest_edge_function_is_unavailable_deploy_the_guest_gateway_funct")+R.safeError(probe.error));
      connected=true;stateMessage(T("interface.messages.connected_to_host_the_protected_guest_gateway_responded",{host:new URL(cfg.supabaseUrl).hostname}),'success');
      setTimeout(()=>{if(version===connectionVersion&&step===2)displayStep(3);},1100);
    }catch(err){if(version===connectionVersion)stateMessage(R.safeError(err),'error');}
    finally{button.disabled=false;}
  }
  function makeBootstrap(){
    const email=$('bootstrapEmail').value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){stateMessage(T("interface.messages.enter_a_valid_administrator_email"),'warning');return;}
    const safe=email.replace(/'/g,"''");
    $('bootstrapSql').value=`-- Run ONLY in your own Supabase SQL Editor after creating and verifying this Auth user.\nINSERT INTO public.admins (user_id, name)\nSELECT id, 'Primary Administrator'\nFROM auth.users\nWHERE lower(email) = lower('${safe}')\n  AND email_confirmed_at IS NOT NULL\n  AND NOT EXISTS (SELECT 1 FROM public.admins)\nON CONFLICT (user_id) DO NOTHING;\n-- Check: SELECT count(*) FROM public.admins;`;
    stateMessage(T("interface.messages.first_admin_sql_generated_this_must_be_executed_in_the_private_su"),'success');
  }
  async function verifyAdmin(e){
    e.preventDefault();const b=e.submitter||e.target.querySelector('button[type="submit"]');b.disabled=true;
    const version=connectionVersion;
    if(!connected){b.disabled=false;return;}
    verified=false;
    try{
      const db=R.getClient();
      const {error}=await db.auth.signInWithPassword({email:$('setupAdminEmail').value.trim(),password:$('setupAdminPassword').value});
      if(error)throw error;
      if(version!==connectionVersion)return;
      const access=await db.rpc('is_admin');
      if(version!==connectionVersion)return;
      if(access.error)throw access.error;
      if(access.data!==true)throw new Error(T("interface.messages.this_account_does_not_have_administrator_access_run_the_first_adm"));
      verified=true;$('setupAdminPassword').value='';displayStep(4);
    }catch(err){if(version===connectionVersion)stateMessage(R.safeError(err),'error');}
    finally{b.disabled=false;}
  }
  function setup(){
    const cfg=R.config();
    $('setupUrl').value=cfg.supabaseUrl||'https://xbiklypjpnumhuohujwo.supabase.co';
    $('setupKey').value=cfg.supabaseKey||'';
    document.querySelectorAll('input[name="dbMode"]').forEach(b=>b.addEventListener('change',()=>{mode=b.value;if(mode==='new'&&$('setupUrl').value==='https://xbiklypjpnumhuohujwo.supabase.co')$('setupUrl').value='';else if(mode==='existing'&&!$('setupUrl').value)$('setupUrl').value='https://xbiklypjpnumhuohujwo.supabase.co';$('newDatabaseInstructions').classList.toggle('hidden',mode!=='new');invalidateConnection();}));
    document.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>displayStep(step+1)));
    document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>displayStep(step-1)));
    document.querySelectorAll('.steps button').forEach(b=>b.addEventListener('click',()=>displayStep(Number(b.dataset.step))));
    $('connectForm').addEventListener('submit',testConnection);
    $('connectForm').addEventListener('input',()=>{invalidateConnection();stateMessage('');});
    $('makeBootstrap').addEventListener('click',makeBootstrap);
    $('copyBootstrap').addEventListener('click',()=>{
      if(!$('bootstrapSql').value){stateMessage(T("interface.messages.generate_sql_first"),'warning');return;}
      navigator.clipboard.writeText($('bootstrapSql').value).then(()=>stateMessage(T("interface.messages.sql_copied"),'success')).catch(()=>stateMessage(T("interface.messages.unable_to_copy_sql_select_it_manually"),'warning'));
    });
    $('setupLoginForm').addEventListener('submit',verifyAdmin);
    $('downloadConfig').addEventListener('click',()=>R.dl('config.js',R.configSource()));
    $('copyConfig').addEventListener('click',()=>navigator.clipboard.writeText(R.configSource()).then(()=>stateMessage(T("interface.messages.configuration_copied"),'success')).catch(()=>stateMessage(T("interface.messages.clipboard_access_denied_download_the_file_instead"),'warning')));
    displayStep(1);
  }
  document.addEventListener('DOMContentLoaded',()=>{window.RSVP_I18N.load().then(setup).catch(e=>stateMessage(R.safeError(e),'error'));});
}());
