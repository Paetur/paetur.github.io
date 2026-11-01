(function(){
  'use strict';
  const media=window.matchMedia('(prefers-color-scheme: dark)'),key='event-appearance';
  let preference='system';try{const saved=localStorage.getItem(key);if(['system','light','dark'].includes(saved))preference=saved;}catch(_){}
  function apply(){const theme=preference==='system'?(media.matches?'dark':'light'):preference;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}
  apply();media.addEventListener('change',apply);
  window.addEventListener('storage',e=>{if(e.key===key){preference=['light','dark'].includes(e.newValue)?e.newValue:'system';apply();const select=document.getElementById('themePreference');if(select)select.value=preference;}});
  document.addEventListener('DOMContentLoaded',()=>{
    const host=document.querySelector('.topbar-actions');if(!host)return;
    const wrap=document.createElement('div');wrap.className='theme-control';
    const button=document.createElement('button');button.id='themeToggle';button.type='button';button.className='admin-icon-btn';button.title="Appearance";button.setAttribute('aria-label',"Appearance");button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','themeMenu');
    button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/></svg>';
    const menu=document.createElement('div');menu.id='themeMenu';menu.className='theme-menu hidden';
    const label=document.createElement('label');label.textContent="Appearance";const select=document.createElement('select');select.id='themePreference';select.setAttribute('aria-label',"Appearance preference");
    for(const [value,text] of [['system',"System default"],['light',"Light"],['dark',"Dark"]]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=preference;label.append(select);menu.append(label);
    function close(){menu.classList.add('hidden');button.setAttribute('aria-expanded','false');}
    button.addEventListener('click',()=>{const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);button.setAttribute('aria-expanded',String(opening));if(opening)select.focus();});
    select.addEventListener('change',()=>{preference=select.value;try{localStorage.setItem(key,preference);}catch(_){}apply();});
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))close();});wrap.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();}});
    wrap.append(button,menu);host.prepend(wrap);
  });
}());
