(function(){
  'use strict';
  const languages=['fo','en','de'],key='rsvp-interface-language',catalog=window.RSVP_TRANSLATIONS||{};
  const overrides=Object.create(null),textNodes=[],attributes=[];
  let language='en',preference=false;
  try{const saved=localStorage.getItem(key);if(languages.includes(saved)){language=saved;preference=true;}}catch(_){}
  const placeholders=s=>[...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(m=>m[1]).sort().join(',');
  function validOverride(source,value){return typeof value==='string'&&value.length<=12000&&placeholders(source)===placeholders(value);}
  for(const [source,values] of Object.entries(window.RSVP_INTERFACE_OVERRIDES||{})){
    if(!Object.hasOwn(catalog,source)||!values||typeof values!=='object')continue;
    overrides[source]=Object.fromEntries(Object.entries(values).filter(([lang,value])=>languages.includes(lang)&&validOverride(source,value)&&value.trim()));
  }
  function t(source,params={},lang=language){
    let value=overrides[source]?.[lang]||catalog[source]?.[lang]||source;
    return value.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(match,name)=>Object.hasOwn(params,name)?String(params[name]):match);
  }
  function paint(){
    document.documentElement.lang=language;
    for(const [node,source,before,after] of textNodes)if(node.isConnected)node.nodeValue=before+t(source)+after;
    for(const [node,name,source] of attributes)if(node.isConnected)node.setAttribute(name,t(source));
    const select=document.getElementById('interfaceLanguage');if(select){select.value=language;select.setAttribute('aria-label',t('Interface language'));}
  }
  function setLanguage(next,save=true){
    if(!languages.includes(next))return;
    language=next;if(save){preference=true;try{localStorage.setItem(key,next);}catch(_){}}
    paint();
  }
  function applyWording(source,lang,value){
    if(!Object.hasOwn(catalog,source)||!languages.includes(lang)||!validOverride(source,value))throw Error(t('Keep the same placeholders as the original phrase.'));
    if(!overrides[source])overrides[source]={};
    if(value.trim())overrides[source][lang]=value;else delete overrides[source][lang];
    paint();
  }
  window.RSVP_I18N={t,setLanguage,get language(){return language;},hasPreference:()=>preference,
    locale:()=>({fo:'fo-FO',en:'en-GB',de:'de-DE'}[language]),catalog,applyWording,
    wording:(source,lang)=>overrides[source]?.[lang]||'',
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
      for(const [value,label] of [['fo','FO'],['en','EN'],['de','DE']]){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
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
