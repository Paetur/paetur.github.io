(function () {
  'use strict';
  const coreScript = document.querySelector('script[data-app-core]');
  const siteRoot = new URL('../', coreScript ? coreScript.src : window.location.href);
  const CLIENT_STORAGE_KEY = 'rsvp-manager-setup-preview-v1';
  const codePattern = /^[A-HJ-NP-Z2-9]{8}$/;
  let client = null;
  function config() {
    const saved = localStorage.getItem(CLIENT_STORAGE_KEY);
    let override = {};
    try { override = saved ? JSON.parse(saved) : {}; } catch (_) { /* ignore malformed preview */ }
    const deployed = window.RSVP_CONFIG || {};
    return deployed.supabaseUrl && deployed.supabaseKey ? deployed : override;
  }
  function normalizeUrl(url) {
    const parsed = new URL(String(url || '').trim());
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) {
      throw new Error('Supabase URL must use HTTPS (except localhost).');
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Use only the Supabase project URL, with no credentials or query string.');
    return parsed.origin;
  }
  function validateKey(key) {
    const clean = String(key || '').trim();
    if (!clean || clean.includes(' ') || clean.startsWith('sb_secret_')) throw new Error('Use only a publishable or anon key, never a secret key.');
    if (clean.split('.').length === 3) {
      try {
        const part = clean.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
        const claims = JSON.parse(atob(part));
        if (claims.role && claims.role !== 'anon') throw new Error('This JWT is not an anon key.');
      } catch (e) { if (e.message.includes('not an anon key')) throw e; throw new Error('The supplied JWT key is malformed.'); }
    } else if (!clean.startsWith('sb_publishable_')) throw new Error('Expected a publishable key or legacy anon JWT.');
    return clean;
  }
  function savePreview(url,key) {
    const validated = {supabaseUrl:normalizeUrl(url),supabaseKey:validateKey(key)};
    localStorage.setItem(CLIENT_STORAGE_KEY,JSON.stringify(validated));
    client=null;
    return validated;
  }
  function getClient() {
    if (client) return client;
    const cfg=config();
    if (!cfg.supabaseUrl || !cfg.supabaseKey) return null;
    if (!window.supabase || typeof window.supabase.createClient!=='function') throw new Error('Supabase JavaScript library did not load. Check the network connection.');
    client=window.supabase.createClient(normalizeUrl(cfg.supabaseUrl),validateKey(cfg.supabaseKey),{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    return client;
  }
  async function adminRpc(name,args={}) {
    if(!/^(admin_[a-z_]+|is_admin)$/.test(name))return {data:null,error:{message:'Invalid administrator action'}};
    const db=getClient();if(!db)return {data:null,error:{message:'Database not configured'}};
    const expired=()=>({data:null,error:{code:'AUTH_SESSION_MISSING',message:'Your sign-in has expired. Sign in again before saving. Your edits have not been submitted.'}});
    let sessionResult=await db.auth.getSession();
    let session=sessionResult.data?.session;
    if(sessionResult.error||!session?.access_token){sessionResult=await db.auth.refreshSession();session=sessionResult.data?.session;}
    if(sessionResult.error||!session?.access_token||session.access_token.startsWith('sb_'))return expired();
    const cfg=config();
    async function send(token){
      const response=await fetch(normalizeUrl(cfg.supabaseUrl)+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:validateKey(cfg.supabaseKey),Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args)});
      const body=await response.text();let value=null;try{value=body?JSON.parse(body):null;}catch(_){return {data:null,error:{message:'The server returned an unreadable response.'},status:response.status};}
      return response.ok?{data:value,error:null,status:response.status}:{data:null,error:typeof value==='object'&&value?value:{message:'Administrator request failed.'},status:response.status};
    }
    let result=await send(session.access_token);
    if(result.status===401||(result.error?.code==='42501'&&/permission denied for function/i.test(result.error.message||''))){
      const refreshed=await db.auth.refreshSession();const token=refreshed.data?.session?.access_token;
      if(refreshed.error||!token||token.startsWith('sb_'))return expired();
      result=await send(token);
    }
    return {data:result.data,error:result.error};
  }
  async function guestRpc(action,args) {
    const client=getClient();
    if(!client)return {data:null,error:new Error('Database not configured')};
    const {data,error}=await client.functions.invoke('guest-gateway',{body:{action,args}});
    return {data,error};
  }
  function invitationURL(code) { const url=new URL('./',siteRoot);url.search='?='+encodeURIComponent(code);return url.href; }
  function getInviteCode() {
    const raw=window.location.search.slice(1).trim();
    const params=new URLSearchParams(raw);
    const candidate=params.get('invite') || params.get('code') || params.get('') || (raw.includes('=') ? '' : raw);
    const code=String(candidate || '').trim().toUpperCase();
    return codePattern.test(code)?code:null;
  }
  function dom(tag,attrs={},text) {
    const node=document.createElement(tag);
    for(const [name,value] of Object.entries(attrs)) {
      if(name==='class') node.className=value;
      else if(name==='type'||name==='value'||name==='max'||name==='min'||name==='name'||name==='id'||name==='placeholder') node.setAttribute(name,value);
      else if(name==='disabled') node.disabled=!!value;
      else if(name==='title') node.title=value;
    }
    if(text!==undefined) node.textContent=String(text);
    return node;
  }
  function byId(id) { return document.getElementById(id); }
  function showStatus(target,message,type='info') {
    const node=typeof target==='string'?byId(target):target;
    if (!node) return;
    node.textContent=String(message||'');node.classList.toggle('hidden',!message);
    node.classList.remove('error','warning','success');
    if(type!=='info') node.classList.add(type);
  }
  function formatDate(date,lang='en',tz) {
    if(!date) return '';
    // YYYY-MM-DD must not shift a calendar day when the browser's timezone differs.
    if(/^\d{4}-\d\d-\d\d$/.test(date)){
      const [y,m,d]=date.split('-').map(Number);
      return new Intl.DateTimeFormat({fo:'fo-FO',en:'en-GB',de:'de-DE'}[lang]||'en-GB',{dateStyle:'long',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));
    }
    return new Intl.DateTimeFormat({fo:'fo-FO',en:'en-GB',de:'de-DE'}[lang]||'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:tz||'UTC'}).format(new Date(date));
  }

  function zonedInput(value,timezone){
    if(!value)return '';
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
    const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function zonedInstant(value,timezone){
    if(!value)return null;
    if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))throw Error('Enter a complete date and time.');
    const wall=Date.parse(value+'Z');if(!Number.isFinite(wall))throw Error('Invalid date and time.');
    const offsets=new Set([-36,0,36].map(hours=>{const t=wall+hours*3600000;return Date.parse(zonedInput(t,timezone)+'Z')-t;}));
    const matches=[...offsets].map(offset=>wall-offset).filter(t=>zonedInput(t,timezone)===value);
    if(matches.length!==1)throw Error('This local time is ambiguous or does not exist because clocks change. Choose a time outside the clock change.');
    return new Date(matches[0]).toISOString();
  }

  function safeError(error) {return error && typeof error.message==='string' ? error.message : 'Something went wrong.';}
  function dl(filename,contents) {
    const blob=new Blob([contents],{type:'text/javascript;charset=utf-8'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
  }
  function configSource() {
    const cfg=config();
    return '// Event Invitation public browser configuration. NEVER add a secret/service_role key.\n'+
      'window.RSVP_CONFIG = Object.freeze('+JSON.stringify({supabaseUrl:cfg.supabaseUrl,supabaseKey:cfg.supabaseKey},null,2)+');\n';
  }
  window.RSVP={config,getClient,adminRpc,guestRpc,normalizeUrl,validateKey,savePreview,invitationURL,getInviteCode,codePattern,siteRoot,dom,byId,showStatus,formatDate,zonedInput,zonedInstant,safeError,dl,configSource};
}());

