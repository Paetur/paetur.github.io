(function(){
  'use strict';
  let languages=[{language_code:'fo',display_name:'Føroyskt'},{language_code:'en',display_name:'English'},{language_code:'de',display_name:'Deutsch'}];
  let defaultLanguage='en',fallbackLanguage='en',remote=Object.create(null),loaded=null;
  const validCode=code=>typeof code==='string'&&/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)&&code.length<=16;
  const enabled=code=>languages.some(l=>l.language_code===code);
  const key='rsvp-interface-language',catalog=window.RSVP_TRANSLATIONS||{};
  const overrides=Object.create(null),textNodes=[],attributes=[];
  let language='en',preference=false;
  try{const saved=localStorage.getItem(key);if(validCode(saved)){language=saved;preference=true;}}catch(_){}
  const placeholders=s=>[...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(m=>m[1]).sort().join(',');
  function validOverride(source,value){return typeof value==='string'&&value.length<=12000&&placeholders(source)===placeholders(value);}
  for(const [source,values] of Object.entries(window.RSVP_INTERFACE_OVERRIDES||{})){
    if(!Object.hasOwn(catalog,source)||!values||typeof values!=='object')continue;
    overrides[source]=Object.fromEntries(Object.entries(values).filter(([lang,value])=>validCode(lang)&&validOverride(source,value)&&value.trim()));
  }
  function t(source,params={},lang=language){
    let value=source;for(const code of [...new Set([lang,fallbackLanguage,'en'])]){const candidate=overrides[source]?.[code]||remote[source]?.[code]||catalog[source]?.[code]||(code==='en'?source:null);if(candidate){value=candidate;break;}}
    return value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(match,name)=>Object.hasOwn(params,name)?String(params[name]):match);
  }
  function paint(){
    document.documentElement.lang=language;
    for(const [node,source,before,after] of textNodes)if(node.isConnected)node.nodeValue=before+t(source)+after;
    for(const [node,name,source] of attributes)if(node.isConnected)node.setAttribute(name,t(source));
    const select=document.getElementById('interfaceLanguage');if(select){select.value=language;select.setAttribute('aria-label',t('Interface language'));}
  }
  function setLanguage(next,save=true){
    if(!enabled(next))next=defaultLanguage;
    language=next;if(save){preference=true;try{localStorage.setItem(key,next);}catch(_){}}
    paint();
  }
  function applyWording(source,lang,value){
    if(!Object.hasOwn(catalog,source)||!enabled(lang)||!validOverride(source,value))throw Error(t('Keep the same placeholders as the original phrase.'));
    if(!overrides[source])overrides[source]={};
    if(value.trim())overrides[source][lang]=value;else delete overrides[source][lang];
    paint();
  }
  function updateSelectors(){
    const select=document.getElementById('interfaceLanguage');
    if(select){select.replaceChildren(...languages.map(l=>{const option=document.createElement('option');option.value=l.language_code;option.textContent=l.display_name;return option;}));select.value=language;}
    const buttons=document.getElementById('languageSwitcher');
    if(buttons){buttons.replaceChildren(...languages.map(l=>{const button=document.createElement('button');button.type='button';button.dataset.language=l.language_code;button.textContent=l.language_code.toUpperCase();button.title=l.display_name;button.setAttribute('aria-pressed',String(l.language_code===language));button.classList.toggle('selected',l.language_code===language);return button;}));}
  }
  function configure(data){
    if(!data||!Array.isArray(data.languages)||!data.languages.length)return;
    const next=data.languages.filter(l=>validCode(l.language_code)&&l.enabled!==false&&typeof l.display_name==='string').sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.language_code.localeCompare(b.language_code));if(!next.length)return;
    languages=next;defaultLanguage=enabled(data.default_language)?data.default_language:languages[0].language_code;fallbackLanguage=enabled(data.fallback_language)?data.fallback_language:'en';remote=Object.create(null);
    for(const c of data.translations||[]){if(!c.content_key?.startsWith('ui:'))continue;const source=c.content_key.slice(3);if(!Object.hasOwn(catalog,source)||!enabled(c.language_code)||!validOverride(source,c.content_value))continue;if(!remote[source])remote[source]=Object.create(null);remote[source][c.language_code]=c.content_value;}
    if(!enabled(language)||!preference)language=defaultLanguage;
    updateSelectors();paint();
  }
  function load(){
    if(loaded)return loaded;
    loaded=(async()=>{try{const db=window.RSVP?.getClient();if(!db)return;const {data,error}=await db.rpc('get_language_configuration');if(!error)configure(data);}catch(_){/* Existing deployments keep bundled languages until upgraded. */}})();return loaded;
  }
  window.RSVP_I18N={t,setLanguage,get language(){return language;},hasPreference:()=>preference,
    locale:()=>{try{const code={fo:'fo-FO',en:'en-GB',de:'de-DE'}[language]||language;return Intl.DateTimeFormat.supportedLocalesOf(code).length?code:'en-GB';}catch(_){return 'en-GB';}},catalog,applyWording,
    get languages(){return languages;},get defaultLanguage(){return defaultLanguage;},get fallbackLanguage(){return fallbackLanguage;},enabled,configure,load,
    resolve:(values,lang=language)=>[...new Set([lang,fallbackLanguage,'en'])].map(code=>values?.[code]).find(value=>typeof value==='string'&&value.trim())||'',
    wording:(source,lang)=>overrides[source]?.[lang]||remote[source]?.[lang]||'',
    source:()=> '// Public interface wording. Plain text only.\nwindow.RSVP_INTERFACE_OVERRIDES = '+JSON.stringify(overrides,null,2)+';\n'};
  document.addEventListener('DOMContentLoaded',()=>{
    // Capture only the original static document, before application data is rendered.
    const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;if(node.parentElement.closest('script,style,textarea,pre,code'))continue;
      const source=node.nodeValue.trim();if(!Object.hasOwn(catalog,source))continue;
      const before=node.nodeValue.match(/^\s*/)[0],after=node.nodeValue.match(/\s*$/)[0];textNodes.push([node,source,before,after]);
    }
    document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(node=>{
      for(const name of ['title','aria-label','placeholder']){const source=node.getAttribute(name);if(Object.hasOwn(catalog,source))attributes.push([node,name,source]);}
    });
    const host=document.querySelector('.topbar-actions');
    if(host&&!document.getElementById('languageSwitcher')){
      const select=document.createElement('select');select.id='interfaceLanguage';select.className='interface-language';
      for(const l of languages){const option=document.createElement('option');option.value=l.language_code;option.textContent=l.display_name;select.append(option);}
      let dirty=false;
      document.addEventListener('input',e=>{if(e.target.closest('form')&&!['search'].includes(e.target.type))dirty=true;});
      select.addEventListener('change',()=>{
        if(dirty&&!window.confirm(t('Changing language reloads this page. Unsaved changes will be lost. Continue?'))){select.value=language;return;}
        setLanguage(select.value);location.reload();
      });host.prepend(select);
    }
    paint();
  });
}());
