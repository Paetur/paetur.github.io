(function(){
 'use strict';
 const I=window.RSVP_I18N,T=(text,params)=>I.t(text,params);
 let ctx,backup=null,preview=null,lastLanguageOrder=0,fileGeneration=0,translationScopeValue='settings',foodTranslationId='',foodTranslationCategory='',foodTypeTranslationKey='',translationLocaleSignature='';
 const contentTranslationIds={};
 const $=id=>document.getElementById(id);
 function enabled(){const rows=ctx.getStore().languages;return rows.length?rows.filter(l=>l.enabled).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.language_code.localeCompare(b.language_code)):I.languages;}
 function options(select,rows,selected){select.replaceChildren(...rows.map(([value,label])=>ctx.R.dom('option',{value},label)));if(rows.some(([value])=>value===selected))select.value=selected;}
 async function rpc(name,args){const {data,error}=await ctx.R.adminRpc(name,args);if(error)throw error;return data;}
 function mode(){
  for(const form of document.querySelectorAll('#languageRows form'))for(const control of form.elements)control.disabled=!ctx.isEditing()||control.dataset.orderBoundary==='true';
  for(const control of $('foodTranslationGrid').querySelectorAll('form input,form textarea,form button'))control.disabled=!ctx.isEditing();
  taskMode();
  $('restoreBackupButton').disabled=!ctx.isEditing()||!preview?.can_restore||!$('restoreBackupAck').checked||$('restoreBackupConfirmation').value!=='RESTORE '+preview.event_name;
 }
 function translationKeys(){const s=ctx.getStore();return [['welcome',T("interface.messages.event_welcome")],...s.locations.map(v=>['venue:'+v.id+':welcome',T("interface.messages.venue_welcome")+' · '+v.name]),...s.foodCategories.map(v=>['food-category:'+v.id+':name',T("food.messages.food_categories")+' · '+v.name]),...s.sessions.map(v=>['session:'+v.id+':name',T("interface.messages.session")+' · '+v.name]),...s.food.flatMap(v=>[['food:'+v.id+':name',T("food.messages.food")+' · '+v.name_en],['food:'+v.id+':description',T("interface.messages.user_comment")+' · '+v.name_en]]),...s.foodTypes.map(type=>['ui:Food type: '+type.name,T("interface.messages.type")+' · '+type.name]),...Object.keys(I.catalog).sort().map(key=>['ui:'+key,ctx.R.foodTypes.includes(key)?T("interface.messages.type")+' · '+key:key])];}
 function keyCategory(key){if(key==='welcome')return 'welcome';if(key.startsWith('ui:Food type: ')||ctx.R.foodTypes.includes(key.slice(3)))return 'food-types';return key.split(':')[0];}
 function renderFoodTranslations(search){
  const R=ctx.R,s=ctx.getStore(),host=$('foodTranslationGrid');
  host.replaceChildren();
  const categories=ctx.foodMenuCategories();
  const categoryLabel=R.dom('label',{},T("food.messages.food_categories"));
  const categoryPicker=R.dom('select');categoryPicker.setAttribute('aria-label',T("food.messages.food_categories"));
  options(categoryPicker,[['',T("interface.messages.all_categories")],...categories.map(category=>[
    'category:'+category.name,category.name||T("interface.messages.uncategorized")
  ])],foodTranslationCategory);
  foodTranslationCategory=categoryPicker.value;
  categoryPicker.addEventListener('change',()=>{
   foodTranslationCategory=categoryPicker.value;renderFoodTranslations(search);
  });
  categoryLabel.append(categoryPicker);
  const pickers=R.dom('div',{class:'food-translation-picker'});
  pickers.append(categoryLabel);host.append(pickers);
  const items=categories.filter(category=>!foodTranslationCategory||foodTranslationCategory==='category:'+category.name)
    .flatMap(category=>ctx.foodMenuItems(category.name))
    .filter(item=>[item.name_en,item.category].join(' ').toLowerCase().includes(search));
  if(!items.length){host.append(R.dom('p',{class:'muted'},T("food.messages.no_matching_food_items")));return;}
  const pickerLabel=R.dom('label',{},T("food.messages.food_item"));
  const picker=R.dom('select');picker.setAttribute('aria-label',T("food.messages.food_item"));
  options(picker,items.map(item=>[item.id,item.name_en]),foodTranslationId);
  foodTranslationId=picker.value;
  picker.addEventListener('change',()=>{foodTranslationId=picker.value;renderFoodTranslations(search);});
  pickerLabel.append(picker);pickers.append(pickerLabel);
  const item=items.find(item=>item.id===foodTranslationId);
  renderFoodItemTranslations(host,item);
 }
 function renderFoodItemTranslations(host,item,onSaved){
  const R=ctx.R;
  const type=item.quantity_type||'Piece(s)';
  const typeKey=R.foodTypes.includes(type)?'ui:'+type:'ui:Food type: '+type;
  const columns=[['Name','food:'+item.id+':name'],['Type',typeKey],['User Comment','food:'+item.id+':description']];
  host.append(R.dom('p',{class:'micro'},T("food.messages.type_translations_are_shared_by_food_items_with_the_same_type")));
  renderTranslationRows(host,columns,(key,language)=>key===typeKey?(R.foodTypes.includes(type)?I.t(type,{},language):type):sourceTranslation(key)[language]||'',
   changes=>rpc('admin_save_food_translations',{p_food_item_id:item.id,p_changes:changes}),false,onSaved);
 }
 async function openFoodTranslations(item,trigger){
  if(!ctx.isEditing())return;
  trigger.disabled=true;
  try{await I.loadCatalogs(enabled().map(language=>language.language_code));}
  finally{trigger.disabled=!ctx.isEditing();}
  if(!ctx.isEditing()||!trigger.isConnected)return;
  const editor=trigger.closest('.food-compact-item').querySelector('.food-edit-form');
  const editorOpen=editor&&!editor.classList.contains('hidden');
  const drafts=Array.from(editor?.querySelectorAll('input,select,textarea')||[]).map((control,index)=>({
   index,value:control.type==='checkbox'?String(control.checked):control.value,original:control.dataset.foodOriginal
  })).filter(draft=>draft.value!==draft.original);
  const R=ctx.R,dialog=R.dom('dialog',{class:'food-recipe-dialog food-language-dialog'});
  const title=T('interface.messages.language')+' · '+(item.name_en||'');
  dialog.setAttribute('aria-label',title);
  dialog.append(R.dom('h2',{},title));
  const host=R.dom('div');dialog.append(host);
  renderFoodItemTranslations(host,item,()=>dialog.close());
  const form=host.querySelector('form');
  const cancel=R.dom('button',{type:'button',class:'btn secondary'},T('interface.messages.cancel'));
  cancel.addEventListener('click',()=>dialog.close());form.append(cancel);
  dialog.addEventListener('cancel',event=>{if(form.getAttribute('aria-busy')==='true')event.preventDefault();});
  dialog.addEventListener('close',()=>{
   dialog.remove();
   const button=Array.from(document.querySelectorAll('[data-food-language]')).find(button=>button.dataset.foodLanguage===item.id);
   if(button&&editor&&!editor.isConnected){
    const updatedEditor=button.closest('.food-compact-item').querySelector('.food-edit-form');
    const controls=updatedEditor.querySelectorAll('input,select,textarea');
    for(const draft of drafts){
     const control=controls[draft.index];
     if(control.type==='checkbox')control.checked=draft.value==='true';else control.value=draft.value;
    }
    if(editorOpen)updatedEditor.classList.remove('hidden');
   }
   requestAnimationFrame(()=>{if((button||trigger)?.isConnected)(button||trigger).focus();});
  },{once:true});
  $('adminApp').append(dialog);dialog.showModal();
  host.querySelector('input')?.focus();
 }
 function renderFoodTypeTranslations(search){
  const R=ctx.R,host=$('foodTranslationGrid');
  host.replaceChildren();
  const rows=translationKeys().filter(([key,label])=>keyCategory(key)==='food-types'&&label.toLowerCase().includes(search));
  if(!rows.length){host.append(R.dom('p',{class:'muted'},T("food.messages.no_matching_food_types")));return;}
  const pickers=R.dom('div',{class:'food-translation-picker'});
  const label=R.dom('label',{},T("interface.messages.type"));
  const picker=R.dom('select');picker.setAttribute('aria-label',T("interface.messages.type"));
  options(picker,rows,foodTypeTranslationKey);
  foodTypeTranslationKey=picker.value;
  picker.addEventListener('change',()=>{foodTypeTranslationKey=picker.value;renderFoodTypeTranslations(search);});
  label.append(picker);pickers.append(label);host.append(pickers);
  renderTranslationRows(host,[['Type',picker.value]],(key,language)=>
   key.startsWith('ui:Food type: ')?key.slice('ui:Food type: '.length):I.t(key.slice(3),{},language),
   saveTranslationRows);
 }
 function renderContentTranslations(category,search){
  const R=ctx.R,s=ctx.getStore(),host=$('foodTranslationGrid');
  const groups={
   'food-category':{
    label:'Food categories',
    records:ctx.foodMenuCategories().filter(record=>record.registered),
    fields:[['Name','name','name']]
   },
   venue:{
    label:'Venue',records:ctx.ordered(s.locations,'name'),
    fields:[['Name','name','name'],['Welcome messages','welcome','welcome_en','textarea'],['Guest venue notes','notes','notes','textarea']]
   },
   session:{
    label:'Session',records:ctx.ordered(s.sessions,'name'),
    fields:[['Name','name','name'],['Description','description','description','textarea']]
   }
  };
  const group=groups[category];
  const records=group.records.filter(record=>record.name.toLowerCase().includes(search));
  host.replaceChildren();
  const pickers=R.dom('div',{class:'food-translation-picker'});
  const label=R.dom('label',{},T(group.label));
  const picker=R.dom('select');picker.setAttribute('aria-label',T(group.label));
  options(picker,records.map(record=>[record.id,record.name]),contentTranslationIds[category]);
  picker.addEventListener('change',()=>{
   contentTranslationIds[category]=picker.value;
   renderContentTranslations(category,search);
  });
  label.append(picker);pickers.append(label);host.append(pickers);
  if(!records.length){
   host.append(R.dom('p',{class:'muted'},T('interface.messages.no_matching_entries')));
   return;
  }
  contentTranslationIds[category]=picker.value;
  const record=records.find(record=>record.id===picker.value);
  const columns=group.fields.map(([label,field,source,kind])=>[label,category+':'+record.id+':'+field,kind]);
  renderTranslationRows(host,columns,(key,language)=>{
   const field=group.fields.find(field=>key.endsWith(':'+field[1]));
   if(language==='en')return record[field[2]]||'';
   return '';
  },saveTranslationRows);
 }
 async function saveTranslationRows(changes,markSaved){
  await rpc('admin_save_translations',{p_changes:changes});
  changes.forEach(markSaved);
 }
 function renderSettingsTranslations(){
  const host=$('foodTranslationGrid'),key=$('translationKey').value;
  host.replaceChildren();
  if(!key)return;
  if(key==='welcome')host.append(ctx.R.dom('p',{class:'micro'},T("interface.messages.appears_at_the_top_of_the_guest_invitation")));
  renderTranslationRows(host,[['Translation',key]],(key,language)=>
   key.startsWith('ui:')?I.t(key.slice(3),{},language):'',saveTranslationRows,true);
 }
 function renderTranslationRows(host,columns,fallback,saveChanges,multiline=false,onSaved){
  const R=ctx.R,s=ctx.getStore();
  const form=R.dom('form',{class:'food-translation-grid'});
  const cells=[];
  for(const language of enabled()){
   const row=R.dom('div',{class:'food-translation-row'+(columns.length===1?' food-type-translation-row':'')});
   row.dataset.languageCode=language.language_code;
   row.style.setProperty('--translation-columns',columns.length);
   row.append(R.dom('strong',{},language.display_name));
   for(const [label,key,kind] of columns){
    const wrap=R.dom('label');
    wrap.append(R.dom('span',{},T(label)));
    const value=s.content.find(c=>c.content_key===key&&c.language_code===language.language_code)?.content_value
      ??fallback(key,language.language_code);
    const input=R.dom(kind||(multiline?'textarea':'input'),{type:'text'});
    input.value=value;
    input.maxLength=12000;
    if(multiline||kind==='textarea')input.rows=2;
    input.setAttribute('aria-label',T(label)+' · '+language.display_name);
    input.disabled=!ctx.isEditing();
    cells.push({key,language:language.language_code,input,original:value});
    wrap.append(input);row.append(wrap);
   }
   form.append(row);
  }
  const save=R.dom('button',{class:'btn edit-only',type:'submit'},T("interface.messages.save_translations"));
  save.disabled=!ctx.isEditing();form.append(save);
  const errorMessage=R.dom('p',{class:'small error hidden'});
  errorMessage.setAttribute('role','alert');form.append(errorMessage);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!ctx.isEditing()||save.disabled)return;
   const changes=cells.filter(c=>c.input.value!==c.original).map(c=>({key:c.key,language:c.language,value:c.input.value}));
   if(!changes.length){onSaved?.();return;}
   form.setAttribute('aria-busy','true');
   errorMessage.classList.add('hidden');
   for(const control of form.querySelectorAll('input,textarea,button'))control.disabled=true;
   try{
    await saveChanges(changes,change=>{
     const cell=cells.find(c=>c.key===change.key&&c.language===change.language);
     cell.original=change.value;
    });
    await ctx.reload();ctx.show(T("interface.messages.translation_saved"),'success');
    onSaved?.();
   }
   catch(error){errorMessage.textContent=R.safeError(error);errorMessage.classList.remove('hidden');ctx.show(R.safeError(error),'error');}
   finally{
    form.removeAttribute('aria-busy');
    for(const control of form.querySelectorAll('input,textarea,button'))control.disabled=!ctx.isEditing();
   }
  });
  host.append(form);
 }
 function renderTranslationKeys(){
  const codes=enabled().map(row=>row.language_code);
  const signature=codes.join('|');
  if(signature!==translationLocaleSignature){
   translationLocaleSignature=signature;
   I.loadCatalogs(codes).then(()=>{if(translationLocaleSignature===signature)renderTranslationKeys();});
   return;
  }
  const categories=translationScopeValue==='settings'?[['ui',T("interface.messages.interface_wording")],['welcome',T("interface.messages.event_welcome")]]:[['food',T("food.messages.food")],['food-category',T("food.messages.food_categories")],['food-types',T("food.messages.food_types")],['venue',T("interface.messages.venues")],['session',T("interface.messages.sessions")]];
  options($('translationCategory'),categories,$('translationCategory').value);
  const category=$('translationCategory').value,search=$('translationSearch').value.toLowerCase();
  const foodMatrix=translationScopeValue==='content';
  const settingsMatrix=translationScopeValue==='settings';
  $('translationForm').classList.toggle('food-matrix-active',foodMatrix);
  $('translationForm').classList.toggle('settings-matrix-active',settingsMatrix);
  $('foodTranslationGrid').classList.toggle('hidden',!foodMatrix&&!settingsMatrix);
  if(foodMatrix){
   if(category==='food')renderFoodTranslations(search);
   else if(category==='food-types')renderFoodTypeTranslations(search);
   else renderContentTranslations(category,search);
   return;
  }
  options($('translationKey'),translationKeys().filter(([key,label])=>keyCategory(key)===category&&(!search||label.toLowerCase().includes(search))),$('translationKey').value);
  if(settingsMatrix){renderSettingsTranslations();return;}
  $('translationForm').querySelector('button[type="submit"]').disabled=!$('translationKey').value;loadTranslation();
 }
 function translationScope(scope){translationScopeValue=scope;if(!ctx)return;$(scope==='content'?'contentTranslationHost':'settingsTranslationHost').append($('translationEditor'));renderTranslationKeys();}
 function sourceTranslation(key){
  const s=ctx.getStore(),parts=key.split(':');
  if(parts[0]==='food'){
   const item=s.food.find(item=>item.id===parts[1]);
   return {en:item?.[parts[2]+'_en']||''};
  }
  if(parts[0]==='venue')return {en:s.locations.find(venue=>venue.id===parts[1])?.welcome_en||''};
  return {};
 }
 function loadTranslation(){
  const s=ctx.getStore(),key=$('translationKey').value,lang=$('translationLanguage').value;
  $('translationValue').value=s.content.find(c=>c.content_key===key&&c.language_code===lang)?.content_value||sourceTranslation(key)[lang]||'';
  const values=Object.assign(sourceTranslation(key),Object.fromEntries(s.content.filter(c=>c.content_key===key).map(c=>[c.language_code,c.content_value])));
  const fallback=key.startsWith('ui:Food type: ')?I.resolve(values,lang)||key.slice('ui:Food type: '.length):key.startsWith('ui:')?I.t(key.slice(3),{},lang):I.resolve(values,lang);
  $('translationFallbackPreview').textContent=T("interface.messages.fallback_preview")+': '+(fallback||'—');
 }
 const otherFields=['item','notes','assigned_to','status'];
 const otherModels=new Map(),otherOpen=new Map();let otherActive=false;
 function otherDirty(model){return !model.original?!!(model.row.item?.trim()||model.row.notes?.trim()||model.row.assigned_to?.trim()||model.row.status!=='open'):otherFields.some(k=>(model.row[k]||'')!==(model.original[k]||''))||model.row.category_id!==model.original.category_id;}
 function hasUnsavedTasks(){return [...otherModels.values()].some(otherDirty);}
 function taskMode(){for(const model of otherModels.values())otherLineMode(model);$('addOtherItem').disabled=!ctx.isEditing();$('otherNewCategory').disabled=!ctx.isEditing();}
 function otherLineMode(model){
  if(!model.element)return;const editing=ctx.isEditing()&&model.editing&&!model.saving;
  model.element.querySelectorAll('input,select').forEach(c=>c.disabled=!editing);model.categoryLabel.classList.toggle('hidden',!editing);
  model.button.disabled=!ctx.isEditing()||model.saving;model.button.title=T(model.editing?'Save item':'Edit item');model.button.setAttribute('aria-label',model.button.title+' · '+(model.row.item||T("interface.messages.new_item")));
  model.button.innerHTML=model.editing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 5 3 3M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg>';
 }
 function otherLine(model){
  const line=ctx.R.dom('div',{class:'other-line'});line.dataset.otherId=model.row.id;model.element=line;
  for(const key of otherFields){const label=ctx.R.dom('label',{},T(key==='item'?'Item':key==='notes'?'Comment':key==='assigned_to'?'Assigned to':'Status')),control=ctx.R.dom(key==='status'?'select':'input');
   if(key==='status')options(control,[['open',T("interface.messages.open")],['assigned',T("interface.messages.assigned")],['in_progress',T("interface.messages.in_progress")],['done',T("interface.messages.done")]],model.row.status||'open');else{control.value=model.row[key]||'';control.maxLength=key==='item'?1000:key==='notes'?4000:300;control.required=key==='item';}
   control.dataset.otherField=key;control.setAttribute('aria-label',T(key==='item'?'Item':key==='notes'?'Comment':key==='assigned_to'?'Assigned to':'Status')+' · '+model.row.id);
   const change=()=>{if(ctx.isEditing()&&model.editing&&!model.saving)model.row[key]=control.value;};control.addEventListener('input',change);control.addEventListener('change',change);label.append(control);line.append(label);
  }
  const button=ctx.R.dom('button',{type:'button',class:'admin-row-icon edit-only'});model.button=button;button.addEventListener('click',async()=>{
   if(!ctx.isEditing()||model.saving)return;if(!model.editing){model.editing=true;otherLineMode(model);line.querySelector('input').focus();return;}
   if(!line.querySelector('input').reportValidity())return;if(model.original&&!otherDirty(model)){model.editing=false;otherLineMode(model);return;}
   model.saving=true;otherLineMode(model);model.error.textContent='';
   try{const result=await rpc('admin_save_other',{p_id:model.row.id,p_values:{item:model.row.item.trim(),notes:(model.row.notes||'').trim(),assigned_to:(model.row.assigned_to||'').trim(),status:model.row.status,category_id:model.row.category_id,sort_order:model.row.sort_order??0},p_expected_updated_at:model.original?.updated_at||null});
    const rows=ctx.getStore().tasks,index=rows.findIndex(r=>r.id===result.id);if(index<0)rows.push(result);else rows[index]=result;model.row={...result};model.original={...result};model.editing=false;model.saving=false;
    const oldLine=model.element,target=$('otherRows').querySelector('[data-other-category="'+model.row.category_id+'"] .other-category-body'),newLine=otherLine(model);
    if(target===oldLine.parentElement)oldLine.replaceWith(newLine);else{oldLine.remove();target?.querySelector('.other-empty')?.remove();target?.append(newLine);}ctx.show(T("interface.messages.item_saved"),'success');
   }catch(error){model.saving=false;model.error.textContent=ctx.R.safeError(error);otherLineMode(model);}
  });line.append(button);
  const categoryLabel=ctx.R.dom('label',{class:'other-line-category'},T("interface.messages.category")),category=ctx.R.dom('select');options(category,ctx.getStore().otherCategories.map(c=>[c.id,c.name]),model.row.category_id);category.addEventListener('change',()=>{model.row.category_id=category.value;});categoryLabel.append(category);model.categoryLabel=categoryLabel;line.append(categoryLabel);
  const error=ctx.R.dom('div',{class:'other-row-status'});error.setAttribute('role','status');model.error=error;line.append(error);
  line.addEventListener('keydown',e=>{if(e.key==='Escape'&&model.editing&&!model.saving){e.preventDefault();if(model.original){model.row={...model.original};model.editing=false;}else otherModels.delete(model.row.id);renderTasks();}});
  otherLineMode(model);return line;
 }
 function renderTasks(){
  const store=ctx.getStore(),categories=[...store.otherCategories].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.name.localeCompare(b.name));
  options($('otherNewCategory'),categories.map(c=>[c.id,c.name]),$('otherNewCategory').value);
  for(const row of store.tasks){const current=otherModels.get(row.id);if(!current||(!current.editing&&!otherDirty(current)))otherModels.set(row.id,{row:{...row},original:{...row},editing:false,saving:false});}
  const host=$('otherRows');host.replaceChildren();
  for(const category of categories){
   const group=ctx.R.dom('details',{class:'other-category'});group.dataset.otherCategory=category.id;group.open=otherOpen.get(category.id)!==false;group.addEventListener('toggle',()=>otherOpen.set(category.id,group.open));
   group.append(ctx.R.dom('summary',{},category.name));const body=ctx.R.dom('div',{class:'other-category-body'});
   const items=[...otherModels.values()].filter(m=>m.row.category_id===category.id).sort((a,b)=>(a.row.sort_order||0)-(b.row.sort_order||0)||(a.row.item||'').localeCompare(b.row.item||''));items.forEach(m=>body.append(otherLine(m)));
   if(!items.length)body.append(ctx.R.dom('p',{class:'micro other-empty'},T("interface.messages.no_items_in_this_category")));group.append(body);host.append(group);
  }taskMode();$('otherStatus').textContent=T("interface.messages.use_main_edit_then_the_pencil_to_edit_and_save_a_line");
 }
 function showTasks(active){otherActive=active;if(active)renderTasks();}
 function render(){if(!ctx)return;if(otherActive)renderTasks();
  const s=ctx.getStore(),langs=enabled().map(l=>[l.language_code,l.display_name]),keep=$('translationLanguage').value;
  options($('languageDefault'),langs,s.settings?.default_language||I.defaultLanguage);options($('languageFallback'),langs,s.settings?.fallback_language||'en');
  options($('translationLanguage'),langs,keep||I.language);renderTranslationKeys();
  const host=$('languageRows');host.replaceChildren();
  const languageRows=[...(s.languages.length?s.languages:I.languages)].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.language_code.localeCompare(b.language_code));
  for(const [index,l] of languageRows.entries()){
   const form=ctx.R.dom('form',{class:'language-row'});form.dataset.languageCode=l.language_code;
   const name=ctx.R.dom('input',{value:l.display_name});name.maxLength=80;name.required=true;name.setAttribute('aria-label',T("interface.messages.display_name")+' · '+l.language_code);
   const arrows=ctx.R.dom('span',{class:'language-order edit-only'});
   for(const [direction,boundary] of [[-1,index===0],[1,index===languageRows.length-1]]){
    const button=ctx.iconAction(direction<0?'up':'down',T(direction<0?'Move language up':'Move language down')+' · '+l.display_name,async()=>{
     await rpc('admin_move_language',{p_code:l.language_code,p_direction:direction});
     await ctx.reload();
    },boundary);
    button.dataset.orderBoundary=String(boundary);
    arrows.append(button);
   }
   const active=ctx.R.dom('input',{type:'checkbox'});active.checked=l.enabled!==false;active.setAttribute('aria-label',T("interface.messages.enabled")+' · '+l.language_code);
   const label=ctx.R.dom('label');label.className='language-enabled';label.append(active,ctx.R.dom('span',{},T("interface.messages.enabled")));
   const save=ctx.R.dom('button',{class:'btn secondary edit-only',type:'submit'},T("interface.messages.save_language"));
   form.append(ctx.R.dom('strong',{},l.language_code),name,arrows,label,save);
   form.addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;save.disabled=true;try{await rpc('admin_save_language',{p_code:l.language_code,p_name:name.value.trim(),p_enabled:active.checked,p_order:l.sort_order||0});await ctx.reload();ctx.show(T("interface.messages.language_saved"),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}finally{mode();}});host.append(form);
  }
  lastLanguageOrder=Math.max(0,...languageRows.map(l=>l.sort_order||0));loadTranslation();mode();
 }
 function init(context){ctx=context;
  window.addEventListener('beforeunload',e=>{if(hasUnsavedTasks()&&!I.languageReloadApproved){e.preventDefault();e.returnValue='';}});
  $('addOtherItem').addEventListener('click',()=>{if(!ctx.isEditing())return;const category_id=$('otherNewCategory').value;if(!category_id){$('otherStatus').textContent=T("interface.messages.add_a_category_first");return;}const id=crypto.randomUUID();otherModels.set(id,{row:{id,category_id,item:'',notes:'',assigned_to:'',status:'open',sort_order:Math.max(0,...ctx.getStore().tasks.filter(r=>r.category_id===category_id).map(r=>r.sort_order||0))+1},original:null,editing:true,saving:false});otherOpen.set(category_id,true);const group=$('otherRows').querySelector('[data-other-category="'+category_id+'"]');group.open=true;const body=group.querySelector('.other-category-body');body.querySelector('.other-empty')?.remove();body.append(otherLine(otherModels.get(id)));$('otherRows').querySelector('[data-other-id="'+id+'"] input').focus();});
  $('addOtherCategory').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;const button=e.target.querySelector('button');if(button.disabled)return;button.disabled=true;try{const category=await rpc('admin_save_other_category',{p_id:null,p_name:$('otherCategoryName').value.trim(),p_expected_updated_at:null});const categories=ctx.getStore().otherCategories;if(!categories.some(c=>c.id===category.id))categories.push(category);$('otherCategoryName').value='';renderTasks();$('otherNewCategory').value=category.id;}catch(error){$('otherStatus').textContent=ctx.R.safeError(error);}finally{button.disabled=false;}});

  $('languagePreferences').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;try{await rpc('admin_set_language_preferences',{p_default:$('languageDefault').value,p_fallback:$('languageFallback').value});await ctx.reload();ctx.show(T("interface.messages.language_preferences_saved"),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}});
  $('addLanguageForm').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;try{const code=Intl.getCanonicalLocales($('newLanguageCode').value.trim())[0];await rpc('admin_save_language',{p_code:code,p_name:$('newLanguageName').value.trim(),p_enabled:true,p_order:lastLanguageOrder+1});e.target.reset();await ctx.reload();ctx.show(T("interface.messages.language_saved"),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}});
  $('translationCategory').addEventListener('change',renderTranslationKeys);$('translationSearch').addEventListener('input',renderTranslationKeys);
  $('translationKey').addEventListener('change',()=>{if(translationScopeValue==='settings')renderSettingsTranslations();else loadTranslation();});$('translationLanguage').addEventListener('change',loadTranslation);
  $('translationForm').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing()||e.target.getAttribute('aria-busy')==='true')return;const form=e.target,button=form.querySelector('button[type="submit"]');form.setAttribute('aria-busy','true');button.disabled=true;try{await rpc('admin_save_translation',{p_key:$('translationKey').value,p_language:$('translationLanguage').value,p_value:$('translationValue').value});await ctx.reload();ctx.show(T("interface.messages.translation_saved"),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}finally{form.removeAttribute('aria-busy');button.disabled=!$('translationKey').value;}});
  $('exportBackup').addEventListener('click',async()=>{const button=$('exportBackup');button.disabled=true;$('backupStatus').textContent=T("interface.messages.preparing_backup");try{const data=await rpc('admin_export_backup');if(!data?.payload)throw Error(T("interface.messages.backup_export_is_unavailable_install_the_matching_migration_first"));ctx.R.dl('rsvp-application-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data,null,2),'application/json;charset=utf-8');$('backupStatus').textContent=T("interface.messages.backup_downloaded_store_it_privately_and_rehearse_restoration");}catch(error){$('backupStatus').textContent=ctx.R.safeError(error);}finally{button.disabled=false;}});
  $('backupFile').addEventListener('change',async()=>{const generation=++fileGeneration;backup=null;preview=null;$('backupPreview').replaceChildren();$('previewBackup').disabled=true;$('restoreBackupConfirmation').value='';$('restoreBackupAck').checked=false;mode();const file=$('backupFile').files[0];if(!file)return;try{if(file.size>20971520)throw Error(T("interface.messages.backup_exceeds_20_mb"));const parsed=JSON.parse(await file.text());if(generation!==fileGeneration)return;backup=parsed;if(backup.format!=='rsvp-application-backup'||backup.version!==1||!backup.payload)throw Error(T("interface.messages.unsupported_backup_format_or_version"));$('previewBackup').disabled=false;}catch(error){if(generation===fileGeneration){backup=null;$('backupPreview').textContent=ctx.R.safeError(error);}}});
  $('previewBackup').addEventListener('click',async()=>{if(!backup)return;const candidate=backup;preview=null;mode();$('previewBackup').disabled=true;$('backupPreview').textContent=T("interface.messages.validating_backup");try{const result=await rpc('admin_preview_backup',{p_backup:candidate});if(candidate!==backup)return;preview=result;if(!preview?.counts)throw Error(T("interface.messages.backup_validation_is_unavailable"));const box=$('backupPreview');box.replaceChildren(ctx.R.dom('h3',{},preview.event_name),ctx.R.dom('p',{},preview.can_restore?T("interface.messages.restore_rehearsal_passed_no_data_was_changed"):T("interface.messages.this_destination_cannot_be_restored")+(preview.reason||'')));for(const [name,count]of Object.entries(preview.counts))box.append(ctx.R.dom('p',{class:'micro'},name+': '+count));$('restoreBackupConfirmation').placeholder='RESTORE '+preview.event_name;}catch(error){preview=null;$('backupPreview').textContent=ctx.R.safeError(error);}finally{$('previewBackup').disabled=!backup;mode();}});
  $('restoreBackupConfirmation').addEventListener('input',mode);$('restoreBackupAck').addEventListener('change',mode);
  $('restoreBackupForm').addEventListener('submit',async e=>{e.preventDefault();if($('restoreBackupButton').disabled)return;const button=$('restoreBackupButton');button.disabled=true;try{await rpc('admin_restore_backup',{p_backup:backup,p_confirmation:$('restoreBackupConfirmation').value});backup=null;preview=null;$('backupFile').value='';$('backupPreview').textContent=T("interface.messages.application_restored_the_event_is_unpublished_review_administrato");await ctx.reload();}catch(error){$('backupPreview').textContent=ctx.R.safeError(error);}finally{mode();}});
 }
 window.RSVP_ADMIN_TOOLS={init,render,mode,translationScope,hasUnsavedTasks,showTasks,openFoodTranslations};
}());
