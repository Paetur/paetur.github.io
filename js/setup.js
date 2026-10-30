(function(){
  'use strict';
  const R=window.RSVP,$=R.byId;
  let step=1,mode='existing',connected=false,verified=false;
  const stateMessage=(m,t='info')=>R.showStatus('setupStatus',m,t);
  function displayStep(next){
    if(next>2&&!connected){stateMessage('Test your Supabase connection before continuing.','warning');return;}
    if(next>4&&!verified){stateMessage('Administrator verification required.','warning');return;}
    if(next===4&&!verified){stateMessage('Sign in as an administrator first.','warning');return;}
    step=Math.max(1,Math.min(4,next));
    document.querySelectorAll('[data-step-panel]').forEach(p=>p.classList.toggle('hidden',Number(p.dataset.stepPanel)!==step));
    document.querySelectorAll('[data-step]').forEach(b=>b.classList.toggle('active',Number(b.dataset.step)===step));
    stateMessage('');window.scrollTo({top:0,behavior:'smooth'});
  }
  async function testConnection(e){
    e.preventDefault();const button=e.submitter||e.target.querySelector('button[type="submit"]');button.disabled=true;
    try{
      const cfg=R.savePreview($('setupUrl').value,$('setupKey').value);
      const db=R.getClient();
      const {error}=await db.rpc('get_public_event');
      if(error)throw new Error('Database connection or schema validation failed: '+R.safeError(error));
      const probe=await db.rpc('get_invitation_v2',{p_code:'00000000'});
      if(probe.error)throw new Error('Required invitation function is missing: '+R.safeError(probe.error));
      connected=true;stateMessage('Connected to '+new URL(cfg.supabaseUrl).hostname+'. The required public RPCs were found.','success');
      setTimeout(()=>displayStep(3),1100);
    }catch(err){stateMessage(R.safeError(err),'error');}
    finally{button.disabled=false;}
  }
  function makeBootstrap(){
    const email=$('bootstrapEmail').value.trim();
    if(!/^\S+@\S+\.\S+$/.test(email)){stateMessage('Enter a valid administrator email.','warning');return;}
    const safe=email.replace(/'/g,"''");
    $('bootstrapSql').value=`-- Run ONLY in your own Supabase SQL Editor after creating and verifying this Auth user.\nINSERT INTO public.admins (user_id, name)\nSELECT id, 'Primary Administrator'\nFROM auth.users\nWHERE lower(email) = lower('${safe}')\n  AND email_confirmed_at IS NOT NULL\n  AND NOT EXISTS (SELECT 1 FROM public.admins)\nON CONFLICT (user_id) DO NOTHING;\n-- Check: SELECT count(*) FROM public.admins;`;
    stateMessage('First-admin SQL generated. This must be executed in the private Supabase SQL Editor, not in the browser.','success');
  }
  async function verifyAdmin(e){
    e.preventDefault();const b=e.submitter||e.target.querySelector('button[type="submit"]');b.disabled=true;
    try{
      const db=R.getClient();
      const {error}=await db.auth.signInWithPassword({email:$('setupAdminEmail').value.trim(),password:$('setupAdminPassword').value});
      if(error)throw error;
      const access=await db.rpc('is_admin');
      if(access.error)throw access.error;
      if(access.data!==true)throw new Error('This account does not have administrator access. Run the first-admin SQL or ask an existing admin to grant access.');
      verified=true;$('setupAdminPassword').value='';displayStep(4);
    }catch(err){stateMessage(R.safeError(err),'error');}
    finally{b.disabled=false;}
  }
  function setup(){
    const cfg=R.config();
    $('setupUrl').value=cfg.supabaseUrl||'https://xbiklypjpnumhuohujwo.supabase.co';
    $('setupKey').value=cfg.supabaseKey||'';
    document.querySelectorAll('input[name="dbMode"]').forEach(b=>b.addEventListener('change',()=>{mode=b.value;if(mode==='new'&&$('setupUrl').value==='https://xbiklypjpnumhuohujwo.supabase.co')$('setupUrl').value='';else if(mode==='existing'&&!$('setupUrl').value)$('setupUrl').value='https://xbiklypjpnumhuohujwo.supabase.co';$('newDatabaseInstructions').classList.toggle('hidden',mode!=='new');connected=false;verified=false;}));
    document.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>displayStep(step+1)));
    document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>displayStep(step-1)));
    document.querySelectorAll('.steps button').forEach(b=>b.addEventListener('click',()=>displayStep(Number(b.dataset.step))));
    $('connectForm').addEventListener('submit',testConnection);
    $('makeBootstrap').addEventListener('click',makeBootstrap);
    $('copyBootstrap').addEventListener('click',()=>{
      if(!$('bootstrapSql').value){stateMessage('Generate SQL first.','warning');return;}
      navigator.clipboard.writeText($('bootstrapSql').value).then(()=>stateMessage('SQL copied.','success')).catch(()=>stateMessage('Unable to copy SQL. Select it manually.','warning'));
    });
    $('setupLoginForm').addEventListener('submit',verifyAdmin);
    $('downloadConfig').addEventListener('click',()=>R.dl('config.js',R.configSource()));
    $('copyConfig').addEventListener('click',()=>navigator.clipboard.writeText(R.configSource()).then(()=>stateMessage('Configuration copied.','success')).catch(()=>stateMessage('Clipboard access denied. Download the file instead.','warning')));
    displayStep(1);
  }
  document.addEventListener('DOMContentLoaded',()=>{try{setup();}catch(e){stateMessage(R.safeError(e),'error');}});
}());
