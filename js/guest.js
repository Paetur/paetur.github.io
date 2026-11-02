(function(){
  'use strict';
  const R=window.RSVP;
  const dict={"invitation":"EVENT INVITATION","welcome":"We look forward to celebrating with you.","enter":"Open your invitation","codeHelp":"Enter the eight-character code from your invitation.","open":"Open","dear":"Dear guests","who":"Please let us know who will attend.","attending":"Attending","declined":"Not attending","submit":"Submit RSVP","locked":"Your response has been received and locked.","thanks":"Thank you! Your response is recorded.","missing":"No invitation was found for that code.","choose":"Choose a response for every invited guest and session.","offline":"Could not reach the database.","notPublished":"This event has not been published yet.","food":"What can you bring?","foodHelp":"Pick an item you would like to bring. Selected items are reserved for your household.","confirmFood":"Confirm my selections","foodDone":"Thank you! Your food selection is confirmed.","saveFood":"Save","foodSaved":"Food selection saved.","available":"Available","all":"All invited guests are listed."};
  let language=window.RSVP_I18N.language,eventData=null,invitation=null,code=null,foodState=null,pendingRequestId=null;
  const $=R.byId;
  function t(k){return window.RSVP_I18N.t(dict[k]||k,{},language);}
  function status(s,type='info'){R.showStatus('guestStatus',s,type);}
  function setLanguage(lang,save=false){ language=window.RSVP_I18N.enabled(lang)?lang:window.RSVP_I18N.defaultLanguage;window.RSVP_I18N.setLanguage(language,save);
    document.querySelectorAll('[data-language]').forEach(b=>{b.classList.toggle('selected',b.dataset.language===language);b.setAttribute('aria-pressed',String(b.dataset.language===language));});
    $('invitationDescription').textContent=t('who');
    $('codeCard').querySelector('h2').textContent=t('enter');$('codeCard').querySelector('p').textContent=t('codeHelp');
    $('codeForm').querySelector('button').textContent=t('open');$('saveRsvp').textContent=t('submit');$('confirmFood').textContent=t('confirmFood');
    $('foodCard').querySelector('h2').textContent=t('food');$('foodCard').querySelector('p').textContent=t('foodHelp');
    const answers=Array.from($('rsvpRows').querySelectorAll('input:checked')).map(n=>[n.name,n.value]);
    renderEvent();if(invitation){renderInvitation();for(const [name,value] of answers){const n=Array.from($('rsvpRows').querySelectorAll('input')).find(n=>n.name===name&&n.value===value);if(n)n.checked=true;}}if(foodState)renderFood();
  }
  function translated(key,legacy={},last=''){const values={...legacy};for(const c of eventData?.translations||[])if(c.content_key===key)values[c.language_code]=c.content_value;return window.RSVP_I18N.resolve(values,language)||last;}
  function renderEvent(){
    const event=eventData?.event;
    if(!event)return;
    const name=event.event_name||window.RSVP_I18N.t("Your event");
    $('eventTitle').textContent=name;
    $('eventDate').textContent=R.formatDate(event.event_date,language,event.timezone);
    document.title=name+' | '+window.RSVP_I18N.t("Invitation");
    const content=eventData.content||{};
    $('welcomeMessage').textContent=window.RSVP_I18N.resolve(content,language)||t('welcome');
  }
  function renderInvitation(){
    const h=invitation.household || {}, sessions=eventData?.sessions||[];
    $('householdName').textContent=h.name||t('dear');$('invitationCard').classList.remove('hidden');
    $('rsvpRows').replaceChildren();const rows=[];
    const invited=invitation.invitations||[];
    const guests=invitation.guests||[];
    guests.forEach(guest=>{
      const items=invited.filter(x=>x.guest_id===guest.id);
      if(!items.length)return;
      const entry=R.dom('div',{class:'guest-response'});
      entry.append(R.dom('h3',{},[guest.courtesy_title,guest.first_name,guest.last_name].filter(Boolean).join(' ')||window.RSVP_I18N.t("Guest")));
      items.forEach(link=>{
        const session=sessions.find(s=>s.id===link.session_id);if(!session)return;
        entry.append(R.dom('div',{class:'session-name'},translated('session:'+session.id+':name',{},session.name)));
        const venue=eventData?.locations?.find(v=>v.id===session.location_id);
        const zone=venue?.timezone||eventData?.event?.timezone||'UTC';
        const details=[venue?.name,venue?.address,session.starts_at?R.formatDate(session.starts_at,language,zone):null,session.ends_at?'– '+R.formatDate(session.ends_at,language,zone):null,session.starts_at?zone:null].filter(Boolean);
        entry.append(R.dom('p',{class:'micro session-venue'},details.join(' · ')));
        const welcome=translated('venue:'+venue?.id+':welcome',{fo:venue?.welcome_fo,en:venue?.welcome_en,de:venue?.welcome_de});if(welcome)entry.append(R.dom('p',{class:'venue-welcome'},welcome));
        if(venue?.notes)entry.append(R.dom('p',{class:'micro'},venue.notes));
        if(venue?.map_url){try{const url=new URL(venue.map_url);if(url.protocol==='https:'){const a=R.dom('a',{class:'quiet-link'},'↗ '+venue.name);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';entry.append(a);}}catch(_){} }
        if(!link.requires_rsvp)return;
        const options=R.dom('div',{class:'response-options'});
        ['attending','declined'].forEach(value=>{
          const label=R.dom('label',{class:'radio-pill'});
          const radio=R.dom('input',{type:'radio',name:'reply_'+guest.id+'_'+session.id,value});
          radio.dataset.guestId=guest.id;radio.dataset.sessionId=session.id;
          if(link.response===value)radio.checked=true;
          radio.disabled=h.rsvp_state==='locked';
          label.append(radio,document.createTextNode(' '+t(value)));options.append(label);
        });
        entry.append(options);rows.push(link);
      });
      $('rsvpRows').append(entry);
    });
    if(!rows.length){$('rsvpRows').append(R.dom('p',{class:'muted'},t('all')));$('saveRsvp').classList.add('hidden');}
    else $('saveRsvp').classList.toggle('hidden',h.rsvp_state==='locked');
    $('rsvpHint').textContent=h.rsvp_state==='locked'?t('locked'):t('choose');
  }
  async function loadInvitation(inviteCode){
    const db=R.getClient();if(!db)return;
    status('');const {data,error}=await R.guestRpc('get_invitation_v2',{p_code:inviteCode});
    if(error){status(R.safeError(error),'error');return;}
    if(!data){status(t('missing'),'warning');return;}
    code=inviteCode;invitation=data;pendingRequestId=null;
    $('codeCard').classList.add('hidden');$('invitationCard').classList.remove('hidden');
    const guestLang=invitation.household?.language;
    if(!window.RSVP_I18N.hasPreference()&&window.RSVP_I18N.enabled(guestLang))language=guestLang;
    setLanguage(language);
    await loadFood();
  }
  async function submitRsvp(e){e.preventDefault();if(!invitation||!code)return;
    const raw=(invitation.invitations||[]).filter(x=>x.requires_rsvp);
    const responses=[];
    for(const link of raw){
      const found=Array.from($('rsvpRows').querySelectorAll('input[type=radio]:checked')).find(x=>x.dataset.guestId===link.guest_id&&x.dataset.sessionId===link.session_id);
      if(!found){status(t('choose'),'warning');return;}
      responses.push({guest_id:link.guest_id,session_id:link.session_id,status:found.value});
    }
    if(!responses.length)return;
    if(!pendingRequestId)pendingRequestId=crypto.randomUUID();
    $('saveRsvp').disabled=true;status('');
    const {error}=await R.guestRpc('submit_household_rsvp',{p_code:code,p_request_id:pendingRequestId,p_responses:responses});
    $('saveRsvp').disabled=false;
    if(error){status(R.safeError(error),'error');return;}
    status(t('thanks'),'success');pendingRequestId=null;await loadInvitation(code);
  }
  async function loadFood(){
    const db=R.getClient();
    try{
      const {data,error}=await R.guestRpc('get_household_food',{p_code:code});
      if(error||!data||!Array.isArray(data.items)){ $('foodCard').classList.add('hidden');return; }
      // The database must itself restrict food data to households with food access.
      foodState=data;$('foodCard').classList.remove('hidden');renderFood();
    }catch(_){$('foodCard').classList.add('hidden');}
  }
  function renderFood(){
    if(!foodState)return;
    const expanded=new Set(Array.from($('foodList').querySelectorAll('details[open]')).map(n=>n.dataset.itemId));
    $('foodList').replaceChildren();
    const claimed=foodState.claims||[];
    const confirmed=!!foodState.confirmed;
    for(const item of foodState.items||[]){
      const mine=claimed.find(c=>c.food_item_id===item.id)?.quantity||0;
      const available=Math.max(0,(item.quantity_needed||0)-(item.claimed_total||0));
      if(!mine&&available===0)continue;
      const wrap=R.dom('details',{class:'food-item guest-food-disclosure'}),heading=R.dom('summary');
      const label=translated('food:'+item.id+':name',{fo:item.name_fo,en:item.name_en,de:item.name_de},window.RSVP_I18N.t('Food item'));
      wrap.dataset.itemId=item.id;wrap.open=expanded.has(item.id);heading.append(R.dom('strong',{},label));
      if(item.recipe_name)heading.append(R.dom('span',{class:'food-recipe-label'},' · '+item.recipe_name));
      if(mine)heading.append(R.dom('span',{class:'tag'},window.RSVP_I18N.t('Selected')));
      const detail=R.dom('div',{class:'guest-food-details'});
      const description=translated('food:'+item.id+':description',{fo:item.description_fo,en:item.description_en,de:item.description_de});
      if(description)detail.append(R.dom('p',{class:'small'},window.RSVP_I18N.t('User Comment')+': '+description));
      if(!confirmed){
        const pick=R.dom('button',{class:'btn secondary',type:'button'},window.RSVP_I18N.t(mine?'Remove selection':'Pick item'));
        pick.dataset.itemId=item.id;pick.addEventListener('click',()=>saveFood(item.id,mine?0:1,pick));detail.append(pick);
      }
      wrap.append(heading,detail);$('foodList').append(wrap);
    }
    $('confirmFood').classList.toggle('hidden',confirmed);
    $('foodHint').textContent=confirmed?t('foodDone'):'';
  }
  async function saveFood(itemId,quantity,button){
    if(!Number.isInteger(quantity)||quantity<0)return;
    button.disabled=true;
    const {error}=await R.guestRpc('set_household_food_claim',{p_code:code,p_food_item_id:itemId,p_quantity:quantity,p_notes:null});
    if(error)status(R.safeError(error),'error');else status(t('foodSaved'),'success');
    await loadFood();button.disabled=false;
  }
  async function confirmFood(){if(!code||!window.confirm(window.RSVP_I18N.t("Confirm food selections? This will lock further edits.")))return;
    $('confirmFood').disabled=true;
    const {error}=await R.guestRpc('confirm_household_food',{p_code:code});
    $('confirmFood').disabled=false;if(error){status(R.safeError(error),'error');return;}
    await loadFood();status(t('foodDone'),'success');
  }
  async function init(){
    const rawCode=R.getInviteCode();
    // Clean the query before any network calls, even when the event is unpublished.
    $('languageSwitcher').classList.toggle('hidden',!rawCode);$('adminLink').classList.toggle('hidden',!!rawCode);
    if(window.location.search)history.replaceState(history.state,'',window.location.pathname+window.location.hash);
    await window.RSVP_I18N.load();language=window.RSVP_I18N.language;
    $('languageSwitcher').addEventListener('click',e=>{const button=e.target.closest('[data-language]');if(button)setLanguage(button.dataset.language,true);});
    $('codeForm').addEventListener('submit',e=>{e.preventDefault();const candidate=$('inviteCode').value.toUpperCase().trim();if(!R.codePattern.test(candidate)){status(window.RSVP_I18N.t("Invalid invitation code"),'warning');return;}window.location.assign(R.invitationURL(candidate));});
    const refreshFood=()=>{if(foodState&&!foodState.confirmed&&!document.hidden)loadFood();};
    const foodRefresh=setInterval(refreshFood,30000);window.addEventListener('focus',refreshFood);document.addEventListener('visibilitychange',refreshFood);window.addEventListener('pagehide',()=>clearInterval(foodRefresh),{once:true});
    $('rsvpForm').addEventListener('submit',submitRsvp);$('confirmFood').addEventListener('click',confirmFood);
    setLanguage(language);
    const db=R.getClient();if(!db){$('connectNotice').classList.remove('hidden');return;}
    try{
      const {data,error}=await db.rpc('get_public_event_v2');
      if(error&&error.code==='PGRST202'){const old=await db.rpc('get_public_event');if(old.error)throw old.error;eventData=old.data;}
      else if(error)throw error;else eventData=data;
    }catch(e){status(t('offline')+' '+R.safeError(e),'error');return;}
    $('languageSwitcher').classList.toggle('hidden',!eventData&&!rawCode);$('adminLink').classList.toggle('hidden',!!eventData||!!rawCode);
    if(!eventData){status(t('notPublished'));return;}
    if(!window.RSVP_I18N.hasPreference())setLanguage(eventData.event?.default_language||language);
    renderEvent();$('codeCard').classList.remove('hidden');
    if(rawCode){$('inviteCode').value=rawCode;await loadInvitation(rawCode);}
  }
  document.addEventListener('DOMContentLoaded',()=>{init().catch(e=>status(R.safeError(e),'error'));});
}());

