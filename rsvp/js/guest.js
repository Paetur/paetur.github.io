(function(){
  'use strict';
  const R=window.RSVP;
  const dict={
    fo:{invitation:'INNBJÓÐING',welcome:'Vit gleða okkum at hátíðarhalda dagin saman við tykkum.',enter:'Opna tína innbjóðing',codeHelp:'Skriva tína átta tekn longu innbjóðingarkotu.',open:'Opna',dear:'Góðu gestir',who:'Vinarliga sigið okkum, hvør kemur.',attending:'Kemur',declined:'Kemur ikki',submit:'Send svar',locked:'Svar er móttikið og læst.',thanks:'Takk! Svarið er skrásett.',missing:'Innbjóðingin varð ikki funnin.',choose:'Vel svar fyri allar gestir og samkomur.',offline:'Kundi ikki lesa úr dátugrunninum.',notPublished:'Tiltakið er ikki almannakunngjørt enn.',food:'Hvat kunnu tit taka við?',foodHelp:'Vel tað, sum tit ynskja at taka við. Nøgdin er avmarkað.',confirmFood:'Vátta val',foodDone:'Takk! Matvalið er váttað.',saveFood:'Goym',foodSaved:'Matvalið er goymt.',available:'Tøkt',all:'Øll eru skrásett.'},
    en:{invitation:'EVENT INVITATION',welcome:'We look forward to celebrating with you.',enter:'Open your invitation',codeHelp:'Enter the eight-character code from your invitation.',open:'Open',dear:'Dear guests',who:'Please let us know who will attend.',attending:'Attending',declined:'Not attending',submit:'Submit RSVP',locked:'Your response has been received and locked.',thanks:'Thank you! Your response is recorded.',missing:'No invitation was found for that code.',choose:'Choose a response for every invited guest and session.',offline:'Could not reach the database.',notPublished:'This event has not been published yet.',food:'What can you bring?',foodHelp:'Choose only what you would like to contribute. Quantities are limited.',confirmFood:'Confirm my selections',foodDone:'Thank you! Your food selection is confirmed.',saveFood:'Save',foodSaved:'Food selection saved.',available:'Available',all:'All invited guests are listed.'},
    de:{invitation:'EINLADUNG',welcome:'Wir freuen uns darauf, mit euch zu feiern.',enter:'Einladung öffnen',codeHelp:'Bitte den achtstelligen Einladungscode eingeben.',open:'Öffnen',dear:'Liebe Gäste',who:'Bitte sagt uns, wer dabei sein wird.',attending:'Kommt',declined:'Kommt nicht',submit:'Antwort senden',locked:'Eure Antwort wurde gespeichert und ist gesperrt.',thanks:'Vielen Dank! Eure Antwort wurde gespeichert.',missing:'Für diesen Code wurde keine Einladung gefunden.',choose:'Bitte für jede eingeladene Person und Veranstaltung antworten.',offline:'Die Datenbank ist momentan nicht erreichbar.',notPublished:'Diese Veranstaltung ist noch nicht veröffentlicht.',food:'Was könnt ihr mitbringen?',foodHelp:'Wählt aus, was ihr gerne mitbringen möchtet.',confirmFood:'Auswahl bestätigen',foodDone:'Vielen Dank! Eure Auswahl ist bestätigt.',saveFood:'Speichern',foodSaved:'Auswahl gespeichert.',available:'Verfügbar',all:'Alle eingeladenen Gäste sind aufgelistet.'}
  };
  let language='en',eventData=null,invitation=null,code=null,foodState=null,pendingRequestId=null;
  const $=R.byId;
  function t(k){return (dict[language]||dict.en)[k]||dict.en[k]||k;}
  function status(s,type='info'){R.showStatus('guestStatus',s,type);}
  function setLanguage(lang){ language=dict[lang]?lang:'en';document.documentElement.lang=language;
    document.querySelectorAll('[data-language]').forEach(b=>b.classList.toggle('selected',b.dataset.language===language));
    $('eventType').textContent=t('invitation');$('invitationDescription').textContent=t('who');
    $('codeCard').querySelector('h2').textContent=t('enter');$('codeCard').querySelector('p').textContent=t('codeHelp');
    $('codeForm').querySelector('button').textContent=t('open');$('saveRsvp').textContent=t('submit');$('confirmFood').textContent=t('confirmFood');
    $('foodCard').querySelector('h2').textContent=t('food');$('foodCard').querySelector('p').textContent=t('foodHelp');
    renderEvent();if(invitation)renderInvitation();if(foodState)renderFood();
  }
  function renderEvent(){
    const event=eventData?.event;
    if(!event)return;
    const name=event.event_name||'Your event';
    $('eventTitle').textContent=name;
    $('eventType').textContent=(event.event_type||'Event').toUpperCase();
    $('eventDate').textContent=R.formatDate(event.event_date,language,event.timezone);
    document.title=name+' | Invitation';
    const content=eventData.content||{};
    $('welcomeMessage').textContent=content[language]||content[event.default_language]||t('welcome');
  }
  function renderInvitation(){
    const h=invitation.household || {}, sessions=eventData?.sessions||[];
    $('householdName').textContent=h.name||t('dear');$('invitationCard').classList.remove('hidden');
    $('rsvpRows').replaceChildren();const rows=[];
    const invited=invitation.invitations||[];
    const guests=invitation.guests||[];
    guests.forEach(guest=>{
      const items=invited.filter(x=>x.guest_id===guest.id&&x.requires_rsvp);
      if(!items.length)return;
      const entry=R.dom('div',{class:'guest-response'});
      entry.append(R.dom('h3',{},[guest.courtesy_title,guest.first_name,guest.last_name].filter(Boolean).join(' ')||'Guest'));
      items.forEach(link=>{
        const session=sessions.find(s=>s.id===link.session_id);if(!session)return;
        entry.append(R.dom('div',{class:'session-name'},session.name));
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
    status('');const {data,error}=await db.rpc('get_invitation_v2',{p_code:inviteCode});
    if(error){status(R.safeError(error),'error');return;}
    if(!data){status(t('missing'),'warning');return;}
    code=inviteCode;invitation=data;pendingRequestId=null;
    $('codeCard').classList.add('hidden');$('invitationCard').classList.remove('hidden');
    const guestLang=invitation.household?.language;
    if(dict[guestLang])language=guestLang;
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
    const {error}=await R.getClient().rpc('submit_household_rsvp',{p_code:code,p_request_id:pendingRequestId,p_responses:responses});
    $('saveRsvp').disabled=false;
    if(error){status(R.safeError(error),'error');return;}
    status(t('thanks'),'success');pendingRequestId=null;await loadInvitation(code);
  }
  async function loadFood(){
    const db=R.getClient();
    try{
      const {data,error}=await db.rpc('get_household_food',{p_code:code});
      if(error||!data||!Array.isArray(data.items)){ $('foodCard').classList.add('hidden');return; }
      // The database must itself restrict food data to households with food access.
      foodState=data;$('foodCard').classList.remove('hidden');renderFood();
    }catch(_){$('foodCard').classList.add('hidden');}
  }
  function renderFood(){
    if(!foodState)return;
    $('foodList').replaceChildren();
    const claimed=foodState.claims||[];
    const confirmed=!!foodState.confirmed;
    for(const item of foodState.items||[]){
      const mine=claimed.find(c=>c.food_item_id===item.id)?.quantity||0;
      const remain=Math.max(0,(item.quantity_needed||0)-(item.claimed_total||0)+mine);
      const wrap=R.dom('div',{class:'food-item'}),left=R.dom('div');
      const label=item['name_'+language]||item.name_en||item.name_fo||item.name_de||'Food item';
      left.append(R.dom('strong',{},label),R.dom('span',{class:'food-item-meta'},`${t('available')}: ${Math.max(0,(item.quantity_needed||0)-(item.claimed_total||0))}`));
      const qty=R.dom('input',{type:'number',min:'0',max:String(remain),value:String(mine)});
      qty.dataset.itemId=item.id;qty.disabled=confirmed;
      const save=R.dom('button',{class:'btn secondary',type:'button'},t('save'));save.disabled=confirmed;
      save.addEventListener('click',()=>saveFood(item.id,qty,save));
      const controls=R.dom('div',{class:'food-controls'});controls.append(qty,save);
      wrap.append(left,controls);$('foodList').append(wrap);
    }
    $('confirmFood').classList.toggle('hidden',confirmed);
    $('foodHint').textContent=confirmed?t('foodDone'):'';
  }
  async function saveFood(itemId,qty,button){
    const quantity=Number(qty.value);if(!Number.isInteger(quantity)||quantity<0||quantity>Number(qty.max)){status('Invalid quantity','warning');return;}
    button.disabled=true;
    const {error}=await R.getClient().rpc('set_household_food_claim',{p_code:code,p_food_item_id:itemId,p_quantity:quantity,p_notes:null});
    if(error)status(R.safeError(error),'error');else {status(t('foodSaved'),'success');await loadFood();}
    button.disabled=false;
  }
  async function confirmFood(){if(!code||!window.confirm('Confirm food selections? This will lock further edits.'))return;
    $('confirmFood').disabled=true;
    const {error}=await R.getClient().rpc('confirm_household_food',{p_code:code});
    $('confirmFood').disabled=false;if(error){status(R.safeError(error),'error');return;}
    await loadFood();status(t('foodDone'),'success');
  }
  async function init(){
    document.querySelectorAll('[data-language]').forEach(b=>b.addEventListener('click',()=>setLanguage(b.dataset.language)));
    $('codeForm').addEventListener('submit',e=>{e.preventDefault();const candidate=$('inviteCode').value.toUpperCase().trim();if(!R.codePattern.test(candidate)){status('Invalid invitation code','warning');return;}window.location.assign(R.invitationURL(candidate));});
    $('rsvpForm').addEventListener('submit',submitRsvp);$('confirmFood').addEventListener('click',confirmFood);
    setLanguage(language);
    const db=R.getClient();if(!db){$('connectNotice').classList.remove('hidden');return;}
    try{
      const {data,error}=await db.rpc('get_public_event_v2');
      if(error&&error.code==='PGRST202'){const old=await db.rpc('get_public_event');if(old.error)throw old.error;eventData=old.data;}
      else if(error)throw error;else eventData=data;
    }catch(e){status(t('offline')+' '+R.safeError(e),'error');return;}
    if(!eventData){$('unpublishedMessage').textContent=t('notPublished');$('unpublishedMessage').classList.remove('hidden');return;}
    renderEvent();$('codeCard').classList.remove('hidden');const rawCode=R.getInviteCode();if(rawCode){$('inviteCode').value=rawCode;await loadInvitation(rawCode);}
  }
  document.addEventListener('DOMContentLoaded',()=>{init().catch(e=>status(R.safeError(e),'error'));});
}());
