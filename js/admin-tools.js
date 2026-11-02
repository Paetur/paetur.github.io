(function(){
 'use strict';
 const I=window.RSVP_I18N,T=(text,params)=>I.t(text,params);
 let ctx,backup=null,preview=null,renderedLanguageCount=0,fileGeneration=0,translationScopeValue='settings',taskDraft=null,taskOriginal=[],taskChanged=new Set(),taskSaving=false,taskNeedsRefresh=false,tasksActive=false;
 const $=id=>document.getElementById(id);
 function enabled(){const rows=ctx.getStore().languages;return rows.length?rows.filter(l=>l.enabled).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.language_code.localeCompare(b.language_code)):I.languages;}
 function options(select,rows,selected){select.replaceChildren(...rows.map(([value,label])=>ctx.R.dom('option',{value},label)));if(rows.some(([value])=>value===selected))select.value=selected;}
 async function rpc(name,args){const {data,error}=await ctx.R.adminRpc(name,args);if(error)throw error;return data;}
 function mode(){
  for(const form of document.querySelectorAll('#languageRows form'))for(const control of form.elements)control.disabled=!ctx.isEditing();
  taskMode();
  $('restoreBackupButton').disabled=!ctx.isEditing()||!preview?.can_restore||!$('restoreBackupAck').checked||$('restoreBackupConfirmation').value!=='RESTORE '+preview.event_name;
 }
 function translationKeys(){const s=ctx.getStore();return [['welcome',T('Welcome messages')],...s.locations.map(v=>['venue:'+v.id+':welcome',T('Venue')+' · '+v.name]),...s.sessions.map(v=>['session:'+v.id+':name',T('Session')+' · '+v.name]),...s.food.flatMap(v=>[['food:'+v.id+':name',T('Food')+' · '+(v.name_en||v.name_fo)],['food:'+v.id+':description',T('User Comment')+' · '+(v.name_en||v.name_fo)]]),...Object.keys(I.catalog).sort().map(key=>['ui:'+key,key])];}
 function keyCategory(key){if(key==='welcome')return 'welcome';return key.split(':')[0];}
 function renderTranslationKeys(){
  const categories=translationScopeValue==='settings'?[['ui',T('Interface wording')],['welcome',T('Welcome messages')]]:[['food',T('Food')],['venue',T('Venues')],['session',T('Sessions')]];
  options($('translationCategory'),categories,$('translationCategory').value);
  const category=$('translationCategory').value,search=$('translationSearch').value.toLowerCase();
  options($('translationKey'),translationKeys().filter(([key,label])=>keyCategory(key)===category&&(!search||label.toLowerCase().includes(search))),$('translationKey').value);
  $('translationForm').querySelector('button[type="submit"]').disabled=!$('translationKey').value;loadTranslation();
 }
 function translationScope(scope){translationScopeValue=scope;if(!ctx)return;$(scope==='content'?'contentTranslationHost':'settingsTranslationHost').append($('translationEditor'));renderTranslationKeys();}
 function legacyTranslation(key){const s=ctx.getStore(),parts=key.split(':'),record=parts[0]==='venue'?s.locations.find(v=>v.id===parts[1]):parts[0]==='food'?s.food.find(v=>v.id===parts[1]):null;return record?Object.fromEntries(['fo','en','de'].map(lang=>[lang,record[(parts[0]==='venue'?'welcome':parts[2])+'_'+lang]])):{};}
 function loadTranslation(){
  const s=ctx.getStore(),key=$('translationKey').value,lang=$('translationLanguage').value;
  $('translationValue').value=s.content.find(c=>c.content_key===key&&c.language_code===lang)?.content_value||legacyTranslation(key)[lang]||'';
  const values=Object.assign(legacyTranslation(key),Object.fromEntries(s.content.filter(c=>c.content_key===key).map(c=>[c.language_code,c.content_value])));
  const fallback=key.startsWith('ui:')?I.t(key.slice(3),{},lang):I.resolve(values,lang);
  $('translationFallbackPreview').textContent=T('Fallback preview')+': '+(fallback||'—');
 }
 const taskKeys=['task','notes','assigned_to','status'];
 function hasUnsavedTasks(){return taskChanged.size>0;}
 function taskMode(){
  const editable=ctx.isEditing()&&!taskSaving&&!taskNeedsRefresh;
  for(const control of $('taskRows').querySelectorAll('input,select'))control.disabled=!editable;
  $('addTaskRows').disabled=!editable;$('saveTasks').disabled=!editable||!hasUnsavedTasks();
 }
 function taskRow(row,index){
  const tr=ctx.R.dom('tr');
  for(const key of taskKeys){const td=ctx.R.dom('td'),control=ctx.R.dom(key==='status'?'select':'input');
   if(key==='status')options(control,[['open',T('Open')],['in_progress',T('In progress')],['done',T('Done')]],row.status||'open');else{control.value=row[key]||'';control.maxLength=key==='task'?1000:key==='notes'?4000:300;}
   control.dataset.taskIndex=index;control.dataset.taskField=key;control.disabled=!ctx.isEditing();control.setAttribute('aria-label',T(key==='task'?'Task':key==='notes'?'Comment':key==='assigned_to'?'Assigned to':'Status')+' · '+(index+1));td.append(control);tr.append(td);
  }return tr;
 }
 function taskNotice(){if(!taskSaving&&!taskNeedsRefresh)$('tasksStatus').textContent=hasUnsavedTasks()?T('Unsaved changes. Select Save to update the database.'):T('Use main Edit mode to change tasks. Save sends your changes to the database.');}
 function renderTasks(){
  if(!taskDraft||!hasUnsavedTasks()||taskNeedsRefresh){
   taskDraft=[...(ctx.getStore().tasks||[])].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.task.localeCompare(b.task)).map(r=>({...r}));taskOriginal=taskDraft.map(r=>({...r}));taskChanged.clear();taskNeedsRefresh=false;
   const fragment=document.createDocumentFragment();taskDraft.forEach((r,i)=>fragment.append(taskRow(r,i)));$('taskRows').replaceChildren(fragment);
  }taskMode();taskNotice();
 }
 function editTask(e){
  const control=e.target,key=control.dataset.taskField,index=Number(control.dataset.taskIndex);if(!key||!ctx.isEditing()||taskSaving||taskNeedsRefresh)return;
  const row=taskDraft[index];row[key]=control.value;const original=taskOriginal[index];
  const changed=original?taskKeys.some(k=>(row[k]||'')!==(original[k]||'')):!!(row.task?.trim()||row.notes?.trim()||row.assigned_to?.trim()||row.status!=='open');
  if(changed)taskChanged.add(index);else taskChanged.delete(index);
  $('saveTasks').disabled=!hasUnsavedTasks();taskNotice();
 }
 function showTasks(active){tasksActive=active;if(active)renderTasks();}
 function render(){if(!ctx)return;if(tasksActive)renderTasks();
  const s=ctx.getStore(),langs=enabled().map(l=>[l.language_code,l.display_name]),keep=$('translationLanguage').value;
  options($('languageDefault'),langs,s.settings?.default_language||I.defaultLanguage);options($('languageFallback'),langs,s.settings?.fallback_language||'en');
  options($('translationLanguage'),langs,keep||I.language);renderTranslationKeys();
  const host=$('languageRows');host.replaceChildren();
  for(const l of [...(s.languages.length?s.languages:I.languages)].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.language_code.localeCompare(b.language_code))){
   const form=ctx.R.dom('form',{class:'form-grid language-row'});form.dataset.languageCode=l.language_code;
   const name=ctx.R.dom('input',{value:l.display_name});name.maxLength=80;name.required=true;name.setAttribute('aria-label',T('Display name')+' · '+l.language_code);
   const order=ctx.R.dom('input',{type:'number',value:l.sort_order||0});order.setAttribute('aria-label',T('Display order')+' · '+l.language_code);
   const active=ctx.R.dom('input',{type:'checkbox'});active.checked=l.enabled!==false;active.setAttribute('aria-label',T('Enabled')+' · '+l.language_code);
   const label=ctx.R.dom('label');label.className='language-enabled';label.append(active,ctx.R.dom('span',{},T('Enabled')));
   const save=ctx.R.dom('button',{class:'btn secondary',type:'submit'},T('Save language'));
   form.append(ctx.R.dom('strong',{},l.language_code),name,order,label,save);
   form.addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;save.disabled=true;try{await rpc('admin_save_language',{p_code:l.language_code,p_name:name.value.trim(),p_enabled:active.checked,p_order:Number(order.value)});await ctx.reload();ctx.show(T('Language saved.'),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}finally{mode();}});host.append(form);
  }
  renderedLanguageCount=langs.length;loadTranslation();mode();
 }
 function init(context){ctx=context;
  $('taskRows').addEventListener('input',editTask);$('taskRows').addEventListener('change',editTask);
  window.addEventListener('beforeunload',e=>{if(hasUnsavedTasks()&&!I.languageReloadApproved){e.preventDefault();e.returnValue='';}});
  $('addTaskRows').addEventListener('click',()=>{if(!ctx.isEditing()||taskSaving||taskNeedsRefresh)return;const row={task:'',notes:'',assigned_to:'',status:'open'},index=taskDraft.length;taskDraft.push(row);$('taskRows').append(taskRow(row,index));$('taskRows tr:last-child input')?.focus();});
  $('saveTasks').addEventListener('click',async()=>{
   if(!ctx.isEditing()||!hasUnsavedTasks()||taskSaving||taskNeedsRefresh)return;
   taskSaving=true;taskMode();let saved=false;
   try{
    const rows=[...taskChanged].sort((a,b)=>a-b).map(i=>({row:taskDraft[i],index:i}));
    await rpc('admin_save_tasks',{p_rows:rows.map(({row:r,index:i})=>({id:r.id||null,task:r.task.trim(),notes:(r.notes||'').trim(),assigned_to:(r.assigned_to||'').trim(),status:r.status,expected_updated_at:r.updated_at||null,sort_order:r.sort_order??i}))});saved=true;
    const {data,error}=await ctx.R.getClient().from('things_to_do').select('*');if(error)throw error;
    ctx.getStore().tasks=data||[];taskChanged.clear();taskDraft=null;renderTasks();ctx.show(T('Tasks saved.'),'success');
   }catch(error){
    if(saved){taskChanged.clear();taskNeedsRefresh=true;$('tasksStatus').textContent=T('Tasks were saved. Refresh the page before editing again.');}
    else $('tasksStatus').textContent=ctx.R.safeError(error);
   }finally{taskSaving=false;taskMode();}
  });

  $('languagePreferences').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;try{await rpc('admin_set_language_preferences',{p_default:$('languageDefault').value,p_fallback:$('languageFallback').value});await ctx.reload();ctx.show(T('Language preferences saved.'),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}});
  $('addLanguageForm').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing())return;try{const code=Intl.getCanonicalLocales($('newLanguageCode').value.trim())[0];await rpc('admin_save_language',{p_code:code,p_name:$('newLanguageName').value.trim(),p_enabled:true,p_order:renderedLanguageCount+1});e.target.reset();await ctx.reload();ctx.show(T('Language saved.'),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}});
  $('translationCategory').addEventListener('change',renderTranslationKeys);$('translationSearch').addEventListener('input',renderTranslationKeys);
  $('translationKey').addEventListener('change',loadTranslation);$('translationLanguage').addEventListener('change',loadTranslation);
  $('translationForm').addEventListener('submit',async e=>{e.preventDefault();if(!ctx.isEditing()||e.target.getAttribute('aria-busy')==='true')return;const form=e.target,button=form.querySelector('button[type="submit"]');form.setAttribute('aria-busy','true');button.disabled=true;try{await rpc('admin_save_translation',{p_key:$('translationKey').value,p_language:$('translationLanguage').value,p_value:$('translationValue').value});await ctx.reload();ctx.show(T('Translation saved.'),'success');}catch(error){ctx.show(ctx.R.safeError(error),'error');}finally{form.removeAttribute('aria-busy');button.disabled=!$('translationKey').value;}});
  $('exportBackup').addEventListener('click',async()=>{const button=$('exportBackup');button.disabled=true;$('backupStatus').textContent=T('Preparing backup…');try{const data=await rpc('admin_export_backup');if(!data?.payload)throw Error(T('Backup export is unavailable. Install the matching migration first.'));ctx.R.dl('rsvp-application-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(data,null,2),'application/json;charset=utf-8');$('backupStatus').textContent=T('Backup downloaded. Store it privately and rehearse restoration.');}catch(error){$('backupStatus').textContent=ctx.R.safeError(error);}finally{button.disabled=false;}});
  $('backupFile').addEventListener('change',async()=>{const generation=++fileGeneration;backup=null;preview=null;$('backupPreview').replaceChildren();$('previewBackup').disabled=true;$('restoreBackupConfirmation').value='';$('restoreBackupAck').checked=false;mode();const file=$('backupFile').files[0];if(!file)return;try{if(file.size>20971520)throw Error(T('Backup exceeds 20 MB.'));const parsed=JSON.parse(await file.text());if(generation!==fileGeneration)return;backup=parsed;if(backup.format!=='rsvp-application-backup'||backup.version!==1||!backup.payload)throw Error(T('Unsupported backup format or version.'));$('previewBackup').disabled=false;}catch(error){if(generation===fileGeneration){backup=null;$('backupPreview').textContent=ctx.R.safeError(error);}}});
  $('previewBackup').addEventListener('click',async()=>{if(!backup)return;const candidate=backup;preview=null;mode();$('previewBackup').disabled=true;$('backupPreview').textContent=T('Validating backup…');try{const result=await rpc('admin_preview_backup',{p_backup:candidate});if(candidate!==backup)return;preview=result;if(!preview?.counts)throw Error(T('Backup validation is unavailable.'));const box=$('backupPreview');box.replaceChildren(ctx.R.dom('h3',{},preview.event_name),ctx.R.dom('p',{},preview.can_restore?T('Restore rehearsal passed. No data was changed.'):T('This destination cannot be restored: ')+(preview.reason||'')));for(const [name,count]of Object.entries(preview.counts))box.append(ctx.R.dom('p',{class:'micro'},name+': '+count));$('restoreBackupConfirmation').placeholder='RESTORE '+preview.event_name;}catch(error){preview=null;$('backupPreview').textContent=ctx.R.safeError(error);}finally{$('previewBackup').disabled=!backup;mode();}});
  $('restoreBackupConfirmation').addEventListener('input',mode);$('restoreBackupAck').addEventListener('change',mode);
  $('restoreBackupForm').addEventListener('submit',async e=>{e.preventDefault();if($('restoreBackupButton').disabled)return;const button=$('restoreBackupButton');button.disabled=true;try{await rpc('admin_restore_backup',{p_backup:backup,p_confirmation:$('restoreBackupConfirmation').value});backup=null;preview=null;$('backupFile').value='';$('backupPreview').textContent=T('Application restored. The event is unpublished. Review administrator access separately.');await ctx.reload();}catch(error){$('backupPreview').textContent=ctx.R.safeError(error);}finally{mode();}});
 }
 window.RSVP_ADMIN_TOOLS={init,render,mode,translationScope,hasUnsavedTasks,showTasks};
}());
