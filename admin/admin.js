const $ = id => document.getElementById(id);
const loginCard = $('loginCard');
const adminApp = $('adminApp');
const loginForm = $('loginForm');
const loginButton = $('loginButton');
const loginError = $('loginError');
const logoutButton = $('logoutButton');
const adminEmail = $('adminEmail');
let adminVisibleForUser = null;

function escapeHtml(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function showLogin() { adminVisibleForUser = null; loginCard.classList.remove('hidden'); adminApp.classList.add('hidden'); }
async function showAdmin(user) {
    loginCard.classList.add('hidden'); adminApp.classList.remove('hidden'); adminEmail.textContent = user.email || '';
    if (adminVisibleForUser === user.id) return;
    adminVisibleForUser = user.id;
    await loadTreeSetup();
    await Promise.all([loadAdminGuests(), loadAdminFood(), loadStuff(), loadTasks()]);
}
async function checkSession() {
    const { data:{session}, error } = await db.auth.getSession();
    if (error) { console.error('Session error:', error); showLogin(); return; }
    session?.user ? await showAdmin(session.user) : showLogin();
}

loginForm.addEventListener('submit', async event => {
    event.preventDefault(); loginError.classList.add('hidden'); loginButton.disabled = true;
    const { error } = await db.auth.signInWithPassword({ email:$('email').value.trim(), password:$('password').value });
    loginButton.disabled = false;
    if (error) { console.error('Login error:', error); loginError.textContent='Email ella password er skeivt.'; loginError.classList.remove('hidden'); }
});
logoutButton.addEventListener('click', async () => { const {error}=await db.auth.signOut(); if(error){console.error('Logout error:',error);return;} loginForm.reset(); showLogin(); });
db.auth.onAuthStateChange((_event,session)=>{ session?.user ? showAdmin(session.user) : showLogin(); });

document.querySelectorAll('.admin-tab').forEach(button => button.addEventListener('click', () => {
    const tab = button.dataset.adminTab;
    document.querySelectorAll('.admin-tab').forEach(b => { b.classList.toggle('on', b===button); b.classList.toggle('secondary', b!==button); });
    document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== `panel-${tab}`));
}));

let adminHouseholds = [];
let relationGroups = [];

function sideLabel(value) { return value === 'maria_haass' ? 'Maria Haaß' : 'Pætur Hentze'; }
function normalizeSearch(value) { return String(value || '').toLocaleLowerCase(); }
function makeTreeNode(className,label,count,open=true){const node=document.createElement('details');node.className=`tree-node ${className}`;node.open=open;const summary=document.createElement('summary');const text=document.createElement('span');text.textContent=label;const badge=document.createElement('span');badge.className='tree-count';badge.textContent=`${count}`;summary.append(text,badge);const children=document.createElement('div');children.className='tree-children';node.append(summary,children);return{node,children};}
function groupById(id){return relationGroups.find(g=>g.id===id);}
function householdById(id){return adminHouseholds.find(h=>h.id===id);}
function householdPath(id){const parts=[];const seen=new Set();let h=householdById(id);while(h&&!seen.has(h.id)){seen.add(h.id);parts.unshift(h.household_name);h=h.parent_id?householdById(h.parent_id):null;}return parts.join(' › ');}
function householdDepth(id){return householdPath(id).split(' › ').filter(Boolean).length-1;}
function optionLabel(h){return `${'— '.repeat(Math.max(0,householdDepth(h.id)))}${householdPath(h.id)}`;}
function householdsFor(side,groupId){return adminHouseholds.filter(h=>(!side||h.side===side)&&(!groupId||h.relation_group_id===groupId)).sort((a,b)=>householdPath(a.id).localeCompare(householdPath(b.id),'fo'));}
function isDescendant(candidateId,ancestorId){if(!ancestorId)return false;let h=householdById(candidateId);const seen=new Set();while(h?.parent_id&&!seen.has(h.id)){seen.add(h.id);if(h.parent_id===ancestorId)return true;h=householdById(h.parent_id);}return false;}
function fillGroupSelect(select,includeAll=false){if(!select)return;const current=select.value;select.innerHTML='';if(includeAll)select.add(new Option('All','all'));relationGroups.forEach(g=>select.add(new Option(g.name,g.id)));if([...select.options].some(o=>o.value===current))select.value=current;}
function fillParentSelect(select,side,groupId,includeRoot=true,excludeId=null){if(!select)return;const current=select.value;select.innerHTML='';if(includeRoot)select.add(new Option('— Root / no parent —',''));householdsFor(side,groupId).filter(h=>h.id!==excludeId&&!isDescendant(h.id,excludeId)).forEach(h=>select.add(new Option(optionLabel(h),h.id)));if([...select.options].some(o=>o.value===current))select.value=current;}
function refreshTreeSelectors(){fillGroupSelect($('householdRelationGroup'));fillGroupSelect($('statsHouseholdRelationGroup'));fillGroupSelect($('guestRelationFilter'),true);fillGroupSelect($('statsRelationFilter'),true);fillParentSelect($('householdParent'),$('householdSide')?.value,$('householdRelationGroup')?.value,true);fillParentSelect($('statsHouseholdParent'),$('statsHouseholdSide')?.value,$('statsHouseholdRelationGroup')?.value,true);}

async function loadTreeSetup(){
    const {data:groups,error}=await db.from('relation_groups').select('id,name,sort_order').order('sort_order').order('name');
    if(error){console.error('Tree setup error:',error);const box=$('relationGroupList');if(box)box.textContent='Koyr fyrst supabase_household_tree_migration.sql.';return false;}
    relationGroups=groups||[];refreshTreeSelectors();renderTreeSetup();return true;
}
function renderRelationGroupList(box){
    if(!box)return;
    box.innerHTML='';
    relationGroups.forEach(group=>{
        const row=document.createElement('div');row.className='relation-group-row';
        const name=document.createElement('strong');name.textContent=group.name;
        const actions=document.createElement('div');actions.className='admin-actions';
        const rename=document.createElement('button');rename.className='btn secondary';rename.type='button';rename.textContent='Rename';
        const del=document.createElement('button');del.className='btn secondary';del.type='button';del.textContent='Delete';
        actions.append(rename,del);row.append(name,actions);box.appendChild(row);
        rename.addEventListener('click',async()=>{const value=prompt('New name:',group.name)?.trim();if(!value||value===group.name)return;const {error}=await db.from('relation_groups').update({name:value}).eq('id',group.id);if(error){alert(error.message);return;}await reloadGuestAdmin();});
        del.addEventListener('click',async()=>{if(!confirm(`Delete relation group "${group.name}"?`))return;const {error}=await db.from('relation_groups').delete().eq('id',group.id);if(error){alert('Could not delete: '+error.message);return;}await reloadGuestAdmin();});
    });
}
function renderTreeSetup(){renderRelationGroupList($('relationGroupList'));renderRelationGroupList($('statsRelationGroupList'));}

function renderSetupHousehold(h){const wrap=document.createElement('div');wrap.className='setup-node';const row=document.createElement('div');row.className='setup-node-row';const label=document.createElement('span');label.textContent=householdDisplayName(h);const meta=document.createElement('span');meta.className='muted small';meta.textContent=h.guests.length?` · ${h.guests.length} guest(s)`:'';label.appendChild(meta);row.appendChild(label);wrap.appendChild(row);const kids=adminHouseholds.filter(x=>x.parent_id===h.id).sort((a,b)=>a.household_name.localeCompare(b.household_name,'fo'));if(kids.length){const child=document.createElement('div');child.className='setup-node-children';kids.forEach(k=>child.appendChild(renderSetupHousehold(k)));wrap.appendChild(child);}return wrap;}

function householdMatches(h,side,relation,search){if(side!=='all'&&h.side!==side)return false;if(relation!=='all'&&h.relation_group_id!==relation)return false;if(!search)return true;const group=groupById(h.relation_group_id)?.name||'';const haystack=[h.household_name,h.family_name,h.invite_code,householdPath(h.id),group,...h.guests.flatMap(g=>[g.first_name,g.last_name,g.relation])].join(' ');return normalizeSearch(haystack).includes(search);}
function countGuests(items){return items.reduce((n,h)=>n+h.guests.length,0);}
function branchGuestCount(h){return h.guests.length+adminHouseholds.filter(x=>x.parent_id===h.id).reduce((n,c)=>n+branchGuestCount(c),0);}
function inviteUrl(h){return `${location.origin}${location.pathname.replace(/\/admin\/?$/, '/')}?${encodeURIComponent(h.invite_code)}`;}
function householdDisplayName(h){const name=String(h?.household_name||'').trim(),last=String(h?.last_name||'').trim();if(!last)return name;if(name.toLocaleLowerCase('fo').endsWith(last.toLocaleLowerCase('fo')))return name;return `${name} ${last}`.trim();}
function hasVisibleDescendant(h,visibleIds){if(visibleIds.has(h.id))return true;return adminHouseholds.filter(x=>x.parent_id===h.id).some(x=>hasVisibleDescendant(x,visibleIds));}
function renderGuestTree(){const list=$('adminGuestList');if(!list)return;const side=$('guestSideFilter')?.value||'all';const relation=$('guestRelationFilter')?.value||'all';const search=normalizeSearch($('guestSearch')?.value.trim());const matches=adminHouseholds.filter(h=>householdMatches(h,side,relation,search));const visibleIds=new Set(matches.map(h=>h.id));list.innerHTML='';['paetur_hentze','maria_haass'].forEach(sideKey=>{const sideAll=adminHouseholds.filter(h=>h.side===sideKey);if(!sideAll.some(h=>hasVisibleDescendant(h,visibleIds)))return;const sideNode=makeTreeNode('tree-side',sideLabel(sideKey),countGuests(matches.filter(h=>h.side===sideKey)),true);list.appendChild(sideNode.node);relationGroups.forEach(group=>{const groupAll=sideAll.filter(h=>h.relation_group_id===group.id);if(!groupAll.some(h=>hasVisibleDescendant(h,visibleIds)))return;const groupNode=makeTreeNode('tree-relation',group.name,countGuests(matches.filter(h=>h.side===sideKey&&h.relation_group_id===group.id)),true);sideNode.children.appendChild(groupNode.node);groupAll.filter(h=>!h.parent_id||!householdById(h.parent_id)||householdById(h.parent_id).relation_group_id!==group.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo')).forEach(root=>{const el=renderHouseholdBranch(root,visibleIds);if(el)groupNode.children.appendChild(el);});});sideAll.filter(h=>(!h.relation_group_id||!groupById(h.relation_group_id))&&hasVisibleDescendant(h,visibleIds)).forEach(h=>sideNode.children.appendChild(renderHouseholdBranch(h,visibleIds)));});if(!matches.length){const p=document.createElement('p');p.className='muted';p.textContent='No guests or households match the filters.';list.appendChild(p);}}
function renderHouseholdBranch(h,visibleIds){
    if(!hasVisibleDescendant(h,visibleIds))return null;
    const children=adminHouseholds.filter(x=>x.parent_id===h.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo'));
    const details=document.createElement('details');details.className='compact-household-node';details.open=false;
    const summary=document.createElement('summary');
    const label=document.createElement('span');label.className='compact-household-label';label.textContent=householdDisplayName(h);
    const count=document.createElement('span');count.className='tree-count';count.textContent=`${branchGuestCount(h)}`;
    summary.append(label,count);details.appendChild(summary);
    const body=document.createElement('div');body.className='compact-household-body';
    body.appendChild(renderHousehold(h,true));
    children.forEach(child=>{const el=renderHouseholdBranch(child,visibleIds);if(el)body.appendChild(el);});
    details.appendChild(body);return details;
}
function householdEditOptions(h){const groupOptions=relationGroups.map(g=>`<option value="${g.id}" ${g.id===h.relation_group_id?'selected':''}>${escapeHtml(g.name)}</option>`).join('');const parentOptions=['<option value="">— Root / no parent —</option>',...householdsFor(h.side,h.relation_group_id).filter(x=>x.id!==h.id&&!isDescendant(x.id,h.id)).map(x=>`<option value="${x.id}" ${x.id===h.parent_id?'selected':''}>${escapeHtml(optionLabel(x))}</option>`)].join('');return{groupOptions,parentOptions};}
function renderHousehold(household,insideBranch=false){
    const card=document.createElement('div');card.className='compact-household-card';
    const toolbar=document.createElement('div');toolbar.className='compact-household-toolbar';
    const meta=document.createElement('span');meta.className='muted small';meta.innerHTML=`${household.language.toUpperCase()} · <a href="${escapeHtml(inviteUrl(household))}" target="_blank" rel="noopener">🔗</a> · ${household.guests.length} guest(s) · ${household.visited ? '✓ Opened' : 'Not opened'}`;
    const actions=document.createElement('div');actions.className='admin-actions';
    const editHouse=document.createElement('button');editHouse.type='button';editHouse.className='btn secondary';editHouse.textContent='Edit';
    const addGuest=document.createElement('button');addGuest.type='button';addGuest.className='btn secondary';addGuest.textContent='Add';
    const delHouse=document.createElement('button');delHouse.type='button';delHouse.className='btn secondary';delHouse.textContent='Delete';
    actions.append(addGuest,editHouse,delHouse);toolbar.append(meta,actions);card.appendChild(toolbar);

    const opts=householdEditOptions(household);const houseForm=document.createElement('form');houseForm.className='admin-edit-guest hidden compact-inline-form';
    houseForm.innerHTML=`<input name="household_name" value="${escapeHtml(household.household_name)}" required><input name="last_name" value="${escapeHtml(household.last_name||'')}" placeholder="Last name"><select name="relation_group_id">${opts.groupOptions}</select><select name="parent_id">${opts.parentOptions}</select><select name="language"><option value="fo" ${household.language==='fo'?'selected':''}>FO</option><option value="en" ${household.language==='en'?'selected':''}>EN</option><option value="de" ${household.language==='de'?'selected':''}>DE</option></select><label><input type="checkbox" name="food" ${household.food?'checked':''}> Food</label><label><input type="checkbox" name="stuff" ${household.stuff?'checked':''}> Stuff</label><label><input type="checkbox" name="things" ${household.things?'checked':''}> Things</label><button class="btn" type="submit">Save</button><button class="btn secondary cancel" type="button">Cancel</button><span class="muted small msg"></span>`;
    card.appendChild(houseForm);editHouse.addEventListener('click',()=>houseForm.classList.toggle('hidden'));houseForm.querySelector('.cancel').addEventListener('click',()=>houseForm.classList.add('hidden'));const groupSelect=houseForm.querySelector('[name="relation_group_id"]'),parentSelect=houseForm.querySelector('[name="parent_id"]');groupSelect.addEventListener('change',()=>fillParentSelect(parentSelect,household.side,groupSelect.value,true,household.id));
    houseForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(houseForm),msg=houseForm.querySelector('.msg');const {error}=await db.from('households').update({household_name:String(f.get('household_name')).trim(),last_name:String(f.get('last_name')||'').trim()||null,family_name:String(f.get('household_name')).trim(),relation_group_id:f.get('relation_group_id')||null,parent_id:f.get('parent_id')||null,language:f.get('language'),food:f.get('food')==='on',stuff:f.get('stuff')==='on',things:f.get('things')==='on'}).eq('id',household.id);if(error){console.error('Edit household error:',error);msg.textContent='Could not save household.';return;}await reloadGuestAdmin();});
    delHouse.addEventListener('click',async()=>{const children=adminHouseholds.filter(x=>x.parent_id===household.id);if(children.length){alert(`This household has ${children.length} child household(s). Move or delete them first.`);return;}if(!confirm(`Delete household "${household.household_name}" and all guests in it?`))return;const {error}=await db.from('households').delete().eq('id',household.id);if(error){console.error('Delete household error:',error);alert('Could not delete household: '+error.message);return;}await reloadGuestAdmin();});

    const addGuestBox=document.createElement('div');addGuestBox.className='add-person-box admin-add-person-box hidden';
    addGuest.addEventListener('click',()=>addGuestBox.classList.toggle('hidden'));
    const guestForm=document.createElement('form');guestForm.className='admin-add-guest compact-add-guest add-person-form';guestForm.innerHTML=`<input name="first_name" placeholder="First name" required><input name="last_name" placeholder="${escapeHtml(household.last_name||'Last name')}"><input name="relation" placeholder="Relation"><label><input type="checkbox" name="is_child"> Child</label><button class="btn" type="submit" aria-label="Add person">✓</button><span class="muted small guest-form-message"></span>`;
    guestForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(guestForm),button=guestForm.querySelector('button'),message=guestForm.querySelector('.guest-form-message'),first=String(f.get('first_name')||'').trim();if(!first)return;button.disabled=true;const {error}=await db.from('guests').insert({household_id:household.id,first_name:first,last_name:String(f.get('last_name')||'').trim()||null,relation:String(f.get('relation')||'').trim()||null,is_child:f.get('is_child')==='on',rsvp_status:'pending'});button.disabled=false;if(error){message.textContent='Could not create guest.';return;}await loadAdminGuests();});addGuestBox.appendChild(guestForm);

    household.guests.sort((a,b)=>(a.last_name||'').localeCompare(b.last_name||'','fo')||a.first_name.localeCompare(b.first_name,'fo')).forEach(guest=>{const row=document.createElement('div');row.className='compact-guest-row';const info=document.createElement('div');const name=document.createElement('strong');const guestLastName=String(guest.last_name||'').trim();name.textContent=guestLastName?`${guest.first_name} ${guestLastName}`:guest.first_name;const detail=document.createElement('span');detail.className='muted small';detail.textContent=`${guest.relation?guest.relation+' · ':''}${guest.is_child?'Child · ':''}${guest.rsvp_status==='attending'?'✓ Attending':guest.rsvp_status==='declined'?'– Declined':'? Pending'}`;info.append(name,document.createTextNode(' '),detail);const rowActions=document.createElement('div');rowActions.className='admin-actions';const edit=document.createElement('button');edit.type='button';edit.className='btn secondary';edit.textContent='Edit';const del=document.createElement('button');del.type='button';del.className='btn secondary';del.textContent='Delete';rowActions.append(edit,del);row.append(info,rowActions);card.appendChild(row);const form=document.createElement('form');form.className='admin-edit-guest hidden compact-inline-form';form.innerHTML=`<input name="first_name" value="${escapeHtml(guest.first_name)}" required><input name="last_name" value="${escapeHtml(guest.last_name)}" placeholder="${escapeHtml(household.last_name||'Last name')}"><input name="relation" value="${escapeHtml(guest.relation)}"><label><input type="checkbox" name="is_child" ${guest.is_child?'checked':''}> Child</label><select name="rsvp_status"><option value="pending" ${guest.rsvp_status==='pending'?'selected':''}>Pending</option><option value="attending" ${guest.rsvp_status==='attending'?'selected':''}>Attending</option><option value="declined" ${guest.rsvp_status==='declined'?'selected':''}>Declined</option></select><button class="btn" type="submit">Save</button><button class="btn secondary cancel" type="button">Cancel</button><span class="muted small msg"></span>`;card.appendChild(form);edit.addEventListener('click',()=>form.classList.toggle('hidden'));form.querySelector('.cancel').addEventListener('click',()=>form.classList.add('hidden'));form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form),msg=form.querySelector('.msg');const {error}=await db.from('guests').update({first_name:String(f.get('first_name')||'').trim(),last_name:String(f.get('last_name')||'').trim()||null,relation:String(f.get('relation')||'').trim()||null,is_child:f.get('is_child')==='on',rsvp_status:f.get('rsvp_status')}).eq('id',guest.id);if(error){msg.textContent='Could not save.';return;}await loadAdminGuests();});del.addEventListener('click',async()=>{if(!confirm(`Delete ${guest.first_name}?`))return;const {error}=await db.from('guests').delete().eq('id',guest.id);if(error){alert('Could not delete guest.');return;}await loadAdminGuests();});});
    card.appendChild(addGuestBox);
    return card;
}
function renderStats(){
    const summary=$('statsSummary'), tree=$('statsTree');
    if(!summary||!tree)return;
    const households=adminHouseholds.length;
    let guests=0,attending=0,declined=0,pending=0;
    adminHouseholds.forEach(h=>(h.guests||[]).forEach(g=>{guests++;if(g.rsvp_status==='attending')attending++;else if(g.rsvp_status==='declined')declined++;else pending++;}));
    const seen=adminHouseholds.filter(h=>h.visited).length;
    const unseen=households-seen;
    const complete=adminHouseholds.filter(h=>(h.guests?.length||0)>0&&h.guests.every(g=>g.rsvp_status!=='pending')).length;
    summary.innerHTML='';
    [
        [`${households} Households`,`${seen} / ${unseen} seen`],
        [`${guests} Guests`,`${pending} Pending`],
        [`${complete} RSVP Complete`,`${attending} Attending / ${declined} Declined`]
    ].forEach(([primary,secondary])=>{
        const box=document.createElement('div');
        const strong=document.createElement('strong');strong.textContent=primary;
        const span=document.createElement('span');span.textContent=secondary;
        box.append(strong,span);summary.appendChild(box);
    });
    const side=$('statsSideFilter')?.value||'all';
    const relation=$('statsRelationFilter')?.value||'all';
    const search=normalizeSearch($('statsSearch')?.value.trim());
    const matches=adminHouseholds.filter(h=>householdMatches(h,side,relation,search));
    const visibleIds=new Set(matches.map(h=>h.id));
    tree.innerHTML='';
    const renderRow=(h,depth)=>{
        if(!hasVisibleDescendant(h,visibleIds))return;
        const wrap=document.createElement('div');wrap.className='stats-household';
        const row=document.createElement('div');row.className='stats-row';row.style.setProperty('--depth',depth);
        const nameCell=document.createElement('span');nameCell.className='stats-name-cell';
        const hasGuests=(h.guests?.length||0)>0;const toggle=document.createElement(hasGuests?'button':'span');if(hasGuests){toggle.type='button';toggle.className='stats-household-toggle';toggle.setAttribute('aria-expanded','false');}else{toggle.className='stats-household-label';}toggle.textContent=householdDisplayName(h);nameCell.appendChild(toggle);
        const claims=(h.food_claims||[]).filter(c=>c.food_items);
        if(claims.length){const foods=document.createElement('span');foods.className='stats-food-claims';foods.textContent=claims.map(c=>{const item=c.food_items||{};const label=item.name_en||item.name_fo||item.name_de||'Food';return `${label}${Number(c.quantity||1)>1?` × ${c.quantity}`:''}`;}).join(', ');nameCell.appendChild(foods);}
        const code=document.createElement('a');code.href=inviteUrl(h);code.target='_blank';code.rel='noopener';code.textContent='🔗';code.title='Open invitation';code.setAttribute('aria-label',`Open invitation for ${householdDisplayName(h)}`);
        const count=document.createElement('span');const directGuestCount=h.guests?.length||0;count.textContent=directGuestCount>0?String(directGuestCount):'';count.title=directGuestCount>0?'Direct guests':'';
        const language=document.createElement('span');language.className='stats-language';language.textContent=String(h.language||'').toUpperCase()||'—';language.title='Invitation language';
        const access=document.createElement('span');access.className='stats-access';const flag=document.createElement('span');flag.className=h.food?'stats-access-on':'stats-access-off';flag.textContent=h.food?'✓':'—';flag.title=`Food: ${h.food?'Yes':'No'}`;flag.setAttribute('aria-label',flag.title);flag.dataset.label='F';access.appendChild(flag);
        const visited=document.createElement('span');visited.textContent=h.visited?'✓':'—';visited.title=h.visited?(h.visited_at?`Seen ${new Date(h.visited_at).toLocaleString()}`:'Seen'):'Not seen';
        const rsvpComplete=(h.guests?.length||0)>0&&h.guests.every(g=>g.rsvp_status!=='pending');const attendingCount=(h.guests||[]).filter(g=>g.rsvp_status==='attending').length;const rsvp=document.createElement('span');rsvp.textContent=rsvpComplete?`✓ (${attendingCount})`:'—';rsvp.title=rsvpComplete?`RSVP complete · ${attendingCount} attending`:'RSVP incomplete';
        const actions=document.createElement('span');actions.className='stats-manage-actions';
        const addBtn=document.createElement('button');addBtn.type='button';addBtn.className='stats-action';addBtn.textContent='Add';
        const editBtn=document.createElement('button');editBtn.type='button';editBtn.className='stats-action';editBtn.textContent='Edit';
        const deleteBtn=document.createElement('button');deleteBtn.type='button';deleteBtn.className='stats-action';deleteBtn.textContent='Delete';
        actions.append(addBtn,editBtn,deleteBtn);row.append(nameCell,code,count,language,access,visited,rsvp,actions);wrap.appendChild(row);

        const manageBox=document.createElement('div');manageBox.className='stats-manage-box hidden';manageBox.style.setProperty('--depth',depth);
        const addForm=document.createElement('form');addForm.className='stats-inline-form hidden';addForm.innerHTML=`<input name="first_name" placeholder="First name" required><input name="last_name" placeholder="${escapeHtml(h.last_name||'Last name')}"><input name="relation" placeholder="Relation"><label><input type="checkbox" name="is_child"> Child</label><button class="stats-action" type="submit">Save</button><button class="stats-action cancel" type="button">Cancel</button><span class="muted small msg"></span>`;
        const opts=householdEditOptions(h);const editForm=document.createElement('form');editForm.className='stats-inline-form hidden';editForm.innerHTML=`<input name="household_name" value="${escapeHtml(h.household_name)}" required><input name="last_name" value="${escapeHtml(h.last_name||'')}" placeholder="Last name"><select name="relation_group_id">${opts.groupOptions}</select><select name="parent_id">${opts.parentOptions}</select><select name="language"><option value="fo" ${h.language==='fo'?'selected':''}>FO</option><option value="en" ${h.language==='en'?'selected':''}>EN</option><option value="de" ${h.language==='de'?'selected':''}>DE</option></select><label><input type="checkbox" name="food" ${h.food?'checked':''}> Food</label><button class="stats-action" type="submit">Save</button><button class="stats-action cancel" type="button">Cancel</button><span class="muted small msg"></span>`;
        manageBox.append(addForm,editForm);wrap.appendChild(manageBox);
        const showManage=form=>{manageBox.classList.remove('hidden');[addForm,editForm].forEach(f=>f.classList.toggle('hidden',f!==form));};
        addBtn.addEventListener('click',()=>showManage(addForm));editBtn.addEventListener('click',()=>showManage(editForm));addForm.querySelector('.cancel').addEventListener('click',()=>{addForm.reset();addForm.querySelector('.msg').textContent='';manageBox.classList.add('hidden');});editForm.querySelector('.cancel').addEventListener('click',()=>manageBox.classList.add('hidden'));
        const groupSelect=editForm.querySelector('[name="relation_group_id"]'),parentSelect=editForm.querySelector('[name="parent_id"]');groupSelect.addEventListener('change',()=>fillParentSelect(parentSelect,h.side,groupSelect.value,true,h.id));
        addForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(addForm),msg=addForm.querySelector('.msg'),first=String(f.get('first_name')||'').trim();if(!first)return;const {error}=await db.from('guests').insert({household_id:h.id,first_name:first,last_name:String(f.get('last_name')||'').trim()||null,relation:String(f.get('relation')||'').trim()||null,is_child:f.get('is_child')==='on',rsvp_status:'pending'});if(error){msg.textContent='Could not create guest.';return;}await loadAdminGuests();});
        editForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(editForm),msg=editForm.querySelector('.msg');const {error}=await db.from('households').update({household_name:String(f.get('household_name')).trim(),last_name:String(f.get('last_name')||'').trim()||null,family_name:String(f.get('household_name')).trim(),relation_group_id:f.get('relation_group_id')||null,parent_id:f.get('parent_id')||null,language:f.get('language'),food:f.get('food')==='on'}).eq('id',h.id);if(error){msg.textContent='Could not save household.';return;}await reloadGuestAdmin();});
        deleteBtn.addEventListener('click',async()=>{const children=adminHouseholds.filter(x=>x.parent_id===h.id);if(children.length){alert(`This household has ${children.length} child household(s). Move or delete them first.`);return;}if(!confirm(`Delete household "${h.household_name}" and all guests in it?`))return;const {error}=await db.from('households').delete().eq('id',h.id);if(error){alert('Could not delete household: '+error.message);return;}await reloadGuestAdmin();});

        const guestBox=document.createElement('div');guestBox.className='stats-guests hidden';guestBox.style.setProperty('--depth',depth);
        if(hasGuests){[...h.guests].sort((a,b)=>a.first_name.localeCompare(b.first_name,'fo')).forEach(g=>{const line=document.createElement('div');line.className='stats-guest-row';const guestName=document.createElement('span');guestName.textContent=[g.first_name,g.last_name].filter(Boolean).join(' ');guestName.title=g.rsvp_status==='attending'?'Attending':g.rsvp_status==='declined'?'Declined':'Pending';const ga=document.createElement('span');ga.className='stats-manage-actions';const ge=document.createElement('button');ge.type='button';ge.className='stats-action';ge.textContent='Edit';const gd=document.createElement('button');gd.type='button';gd.className='stats-action';gd.textContent='Delete';ga.append(ge,gd);line.append(guestName,ga);guestBox.appendChild(line);const gf=document.createElement('form');gf.className='stats-inline-form hidden';gf.innerHTML=`<input name="first_name" value="${escapeHtml(g.first_name)}" required><input name="last_name" value="${escapeHtml(g.last_name||'')}" placeholder="${escapeHtml(h.last_name||'Last name')}"><input name="relation" value="${escapeHtml(g.relation||'')}"><label><input type="checkbox" name="is_child" ${g.is_child?'checked':''}> Child</label><select name="rsvp_status"><option value="pending" ${g.rsvp_status==='pending'?'selected':''}>Pending</option><option value="attending" ${g.rsvp_status==='attending'?'selected':''}>Attending</option><option value="declined" ${g.rsvp_status==='declined'?'selected':''}>Declined</option></select><button class="stats-action" type="submit">Save</button><button class="stats-action cancel" type="button">Cancel</button><span class="muted small msg"></span>`;guestBox.appendChild(gf);ge.addEventListener('click',()=>gf.classList.toggle('hidden'));gf.querySelector('.cancel').addEventListener('click',()=>gf.classList.add('hidden'));gf.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(gf),msg=gf.querySelector('.msg');const {error}=await db.from('guests').update({first_name:String(f.get('first_name')||'').trim(),last_name:String(f.get('last_name')||'').trim()||null,relation:String(f.get('relation')||'').trim()||null,is_child:f.get('is_child')==='on',rsvp_status:f.get('rsvp_status')}).eq('id',g.id);if(error){msg.textContent='Could not save.';return;}await loadAdminGuests();});gd.addEventListener('click',async()=>{if(!confirm(`Delete ${g.first_name}?`))return;const {error}=await db.from('guests').delete().eq('id',g.id);if(error){alert('Could not delete guest.');return;}await loadAdminGuests();});});}
        if(hasGuests){wrap.appendChild(guestBox);toggle.addEventListener('click',()=>{const opening=guestBox.classList.contains('hidden');guestBox.classList.toggle('hidden',!opening);toggle.setAttribute('aria-expanded',String(opening));wrap.classList.toggle('stats-household-open',opening);});}tree.appendChild(wrap);
        adminHouseholds.filter(x=>x.parent_id===h.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo')).forEach(c=>renderRow(c,depth+1));
    };
    ['paetur_hentze','maria_haass'].forEach(sideKey=>{const sideHouseholds=adminHouseholds.filter(h=>h.side===sideKey);if(!sideHouseholds.some(h=>hasVisibleDescendant(h,visibleIds)))return;const heading=document.createElement('h3');heading.className='stats-side';heading.textContent=sideLabel(sideKey);tree.appendChild(heading);relationGroups.forEach(group=>{const grouped=sideHouseholds.filter(h=>h.relation_group_id===group.id);if(!grouped.some(h=>hasVisibleDescendant(h,visibleIds)))return;const gh=document.createElement('div');gh.className='stats-group';gh.textContent=group.name;tree.appendChild(gh);grouped.filter(h=>!h.parent_id||!grouped.some(x=>x.id===h.parent_id)).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo')).forEach(h=>renderRow(h,0));});});
    if(!matches.length){const p=document.createElement('p');p.className='muted';p.textContent='No guests or households match the filters.';tree.appendChild(p);}
}
async function loadAdminGuests(){const container=$('adminGuestList'),summary=$('guestSummary');if(!container||!summary)return;container.innerHTML='';summary.textContent='Loading guests…';const {data,error}=await db.from('households').select(`id,household_name,side,language,invite_code,family_name,last_name,relation_group_id,parent_id,sort_order,food,stuff,things,visited,visited_at,guests(id,first_name,last_name,relation,is_child,rsvp_status),food_claims(quantity,food_items(name_fo,name_en,name_de))`).order('sort_order').order('household_name');if(error){console.error('Admin guests error:',error);summary.textContent='Could not load guests.';return;}adminHouseholds=data||[];refreshTreeSelectors();let total=0,attending=0,declined=0,pending=0;adminHouseholds.forEach(h=>h.guests.forEach(g=>{total++;if(g.rsvp_status==='attending')attending++;else if(g.rsvp_status==='declined')declined++;else pending++;}));summary.textContent=`${total} guests · ${attending} attending · ${declined} declined · ${pending} pending`;renderGuestTree();renderStats();}
async function reloadGuestAdmin(){await loadTreeSetup();await loadAdminGuests();renderTreeSetup();}
['guestSideFilter','guestRelationFilter'].forEach(id=>$(id)?.addEventListener('change',renderGuestTree));$('guestSearch')?.addEventListener('input',renderGuestTree);$('expandGuestTree')?.addEventListener('click',()=>document.querySelectorAll('#adminGuestList details').forEach(d=>d.open=true));$('collapseGuestTree')?.addEventListener('click',()=>document.querySelectorAll('#adminGuestList details').forEach(d=>d.open=false));
$('householdSide')?.addEventListener('change',()=>fillParentSelect($('householdParent'),$('householdSide').value,$('householdRelationGroup').value,true));$('householdRelationGroup')?.addEventListener('change',()=>fillParentSelect($('householdParent'),$('householdSide').value,$('householdRelationGroup').value,true));
$('statsSideFilter')?.addEventListener('change',renderStats);$('statsRelationFilter')?.addEventListener('change',renderStats);$('statsSearch')?.addEventListener('input',renderStats);
const statsEditMode=$('statsEditMode');
function applyStatsEditMode(){const enabled=!!statsEditMode?.checked;const panel=$('panel-stats');panel?.classList.toggle('stats-edit-mode',enabled);document.querySelectorAll('#panel-stats .stats-management-control').forEach(el=>el.classList.toggle('hidden',!enabled));if(!enabled)document.querySelectorAll('#panel-stats .stats-manage-box').forEach(el=>el.classList.add('hidden'));}
statsEditMode?.addEventListener('change',applyStatsEditMode);applyStatsEditMode();
$('statsHouseholdSide')?.addEventListener('change',()=>fillParentSelect($('statsHouseholdParent'),$('statsHouseholdSide').value,$('statsHouseholdRelationGroup').value,true));$('statsHouseholdRelationGroup')?.addEventListener('change',()=>fillParentSelect($('statsHouseholdParent'),$('statsHouseholdSide').value,$('statsHouseholdRelationGroup').value,true));
$('relationGroupForm')?.addEventListener('submit',async e=>{e.preventDefault();const name=$('relationGroupName').value.trim();if(!name)return;const {error}=await db.from('relation_groups').insert({name,sort_order:relationGroups.length*10+10});if(error){alert(error.message);return;}$('relationGroupForm').reset();await reloadGuestAdmin();});
$('statsRelationGroupForm')?.addEventListener('submit',async e=>{e.preventDefault();const name=$('statsRelationGroupName').value.trim();if(!name)return;const {error}=await db.from('relation_groups').insert({name,sort_order:relationGroups.length*10+10});if(error){alert(error.message);return;}$('statsRelationGroupForm').reset();await reloadGuestAdmin();});
$('householdForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('addHouseholdButton'),message=$('householdMessage'),name=$('householdName').value.trim();if(!name)return;button.disabled=true;message.classList.add('hidden');const {data,error}=await db.from('households').insert({household_name:name,side:$('householdSide').value,relation_group_id:$('householdRelationGroup').value||null,parent_id:$('householdParent').value||null,family_name:name,last_name:$('householdLastName').value.trim()||null,language:$('householdLanguage').value,food:$('householdFood').checked}).select().single();button.disabled=false;if(error){console.error('Add household error:',error);message.textContent='Could not create household.';message.classList.remove('hidden');return;}message.textContent=`✓ ${data.household_name} created · Invite code: ${data.invite_code}`;message.classList.remove('hidden');$('householdName').value='';$('householdLastName').value='';await reloadGuestAdmin();});
$('statsHouseholdForm')?.addEventListener('submit',async event=>{event.preventDefault();const button=$('statsAddHouseholdButton'),message=$('statsHouseholdMessage'),name=$('statsHouseholdName').value.trim();if(!name)return;button.disabled=true;message.classList.add('hidden');const {data,error}=await db.from('households').insert({household_name:name,side:$('statsHouseholdSide').value,relation_group_id:$('statsHouseholdRelationGroup').value||null,parent_id:$('statsHouseholdParent').value||null,family_name:name,last_name:$('statsHouseholdLastName').value.trim()||null,language:$('statsHouseholdLanguage').value,food:$('statsHouseholdFood').checked}).select().single();button.disabled=false;if(error){console.error('Add household error:',error);message.textContent='Could not create household.';message.classList.remove('hidden');return;}message.textContent=`✓ ${data.household_name} created · Invite code: ${data.invite_code}`;message.classList.remove('hidden');$('statsHouseholdName').value='';$('statsHouseholdLastName').value='';await reloadGuestAdmin();});

async function loadAdminFood(){
    const container=$('adminFoodList'),summary=$('foodAdminSummary');
    if(!container||!summary)return;
    container.innerHTML='';summary.textContent='Loading food…';
    const {data,error}=await db.from('food_items').select(`id,category,name_fo,name_en,name_de,description_fo,description_en,description_de,quantity_needed,active,sort_order,food_claims(id,quantity,household_id,households(household_name))`).order('sort_order').order('name_fo');
    if(error){console.error('Admin food error:',error);summary.textContent='Could not load the food list.';return;}

    let needed=0,claimed=0;
    data.forEach(i=>{needed+=i.quantity_needed;claimed+=i.food_claims.reduce((s,c)=>s+c.quantity,0);});
    summary.textContent=`${data.length} food items · ${claimed} of ${needed} claimed`;

    const groups=new Map();
    data.forEach(item=>{const category=String(item.category||'').trim()||'Uncategorized';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(item);});

    groups.forEach((items,category)=>{
        const group=document.createElement('details');group.className='tree-node food-admin-category';group.open=true;
        const head=document.createElement('summary');
        const title=document.createElement('strong');title.textContent=category;
        const groupClaimed=items.reduce((sum,item)=>sum+item.food_claims.reduce((s,c)=>s+c.quantity,0),0);
        const groupNeeded=items.reduce((sum,item)=>sum+item.quantity_needed,0);
        const count=document.createElement('span');count.className='tree-count';count.textContent=`${items.length} items · ${groupClaimed}/${groupNeeded} claimed`;
        head.append(title,count);
        const children=document.createElement('div');children.className='tree-children';

        items.forEach(item=>{
            const taken=item.food_claims.reduce((s,c)=>s+c.quantity,0),available=Math.max(item.quantity_needed-taken,0);
            const node=document.createElement('details');node.className='compact-household-node food-admin-item';
            const itemSummary=document.createElement('summary');
            const label=document.createElement('span');label.className='compact-household-label';label.textContent=item.name_fo;
            const itemCount=document.createElement('span');itemCount.className='tree-count';itemCount.textContent=`${taken}/${item.quantity_needed} claimed${item.active?'':' · Inactive'}`;
            itemSummary.append(label,itemCount);

            const body=document.createElement('div');body.className='compact-household-body';
            const card=document.createElement('div');card.className='compact-household-card';
            const toolbar=document.createElement('div');toolbar.className='compact-household-toolbar';
            const info=document.createElement('div');
            const languages=document.createElement('div');languages.className='muted small';languages.textContent=[item.name_en,item.name_de].filter(Boolean).join(' · ');
            const status=document.createElement('div');status.className='muted small';status.textContent=`${available} available · ${item.quantity_needed} total`;
            info.append(languages,status);
            const actions=document.createElement('div');actions.className='admin-actions';
            const edit=document.createElement('button');edit.className='btn secondary';edit.type='button';edit.textContent='Edit';
            const del=document.createElement('button');del.className='btn secondary';del.type='button';del.textContent='Delete';
            actions.append(edit,del);toolbar.append(info,actions);card.appendChild(toolbar);

            if(item.food_claims.length){
                item.food_claims.forEach(claim=>{const row=document.createElement('div');row.className='compact-guest-row';const who=document.createElement('span');who.textContent=claim.households?.household_name||'Unknown';const qty=document.createElement('span');qty.className='muted small';qty.textContent=`× ${claim.quantity}`;row.append(who,qty);card.appendChild(row);});
            }

            const form=document.createElement('form');form.className='admin-edit-food hidden compact-inline-form';
            form.innerHTML=`<input name="name_fo" value="${escapeHtml(item.name_fo)}" required><input name="name_en" value="${escapeHtml(item.name_en)}"><input name="name_de" value="${escapeHtml(item.name_de)}"><input name="category" value="${escapeHtml(item.category)}" placeholder="Category"><input name="quantity" type="number" min="${Math.max(taken,1)}" value="${item.quantity_needed}" required><input name="sort" type="number" value="${item.sort_order}"><label><input name="active" type="checkbox" ${item.active?'checked':''}> Active</label><button class="btn" type="submit">Save</button><button class="btn secondary cancel" type="button">Cancel</button><span class="muted small msg"></span>`;
            card.appendChild(form);body.appendChild(card);node.append(itemSummary,body);children.appendChild(node);

            edit.addEventListener('click',()=>{form.classList.toggle('hidden');node.open=true;});
            form.querySelector('.cancel').addEventListener('click',()=>form.classList.add('hidden'));
            form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form),msg=form.querySelector('.msg');const {error}=await db.from('food_items').update({name_fo:String(f.get('name_fo')).trim(),name_en:String(f.get('name_en')||'').trim()||null,name_de:String(f.get('name_de')||'').trim()||null,category:String(f.get('category')||'').trim()||null,quantity_needed:Number(f.get('quantity')),sort_order:Number(f.get('sort')||0),active:f.get('active')==='on'}).eq('id',item.id);if(error){console.error('Edit food error:',error);msg.textContent='Could not save.';return;}await loadAdminFood();});
            del.addEventListener('click',async()=>{if(!confirm(`Delete "${item.name_fo}"? Claims for this item will also be deleted.`))return;const {error}=await db.from('food_items').delete().eq('id',item.id);if(error){console.error('Delete food error:',error);alert('Could not delete food item.');return;}await loadAdminFood();});
        });
        group.append(head,children);container.appendChild(group);
    });
}
$('foodForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('addFoodButton'),msg=$('foodFormMessage');button.disabled=true;const {error}=await db.from('food_items').insert({name_fo:$('foodNameFo').value.trim(),name_en:$('foodNameEn').value.trim()||null,name_de:$('foodNameDe').value.trim()||null,category:$('foodCategory').value.trim()||null,quantity_needed:Number($('foodQuantity').value),sort_order:Number($('foodSortOrder').value||0),active:true});button.disabled=false;if(error){console.error('Add food error:',error);msg.textContent='Could not create food item.';msg.classList.remove('hidden');return;}$('foodForm').reset();$('foodQuantity').value=1;$('foodSortOrder').value=0;msg.classList.add('hidden');await loadAdminFood();});

async function loadStuff(){const box=$('adminStuffList');if(!box)return;box.innerHTML='';const {data,error}=await db.from('stuff_to_bring').select('*').order('sort_order').order('item');if(error){console.error('Stuff error:',error);box.textContent='Could not load the list.';return;}data.forEach(item=>{const row=document.createElement('div');row.className='admin-list-row';const label=document.createElement('span');label.textContent=`${item.item}${item.quantity?` × ${item.quantity}`:''}${item.assigned_to?` · ${item.assigned_to}`:''}`;const actions=document.createElement('div');actions.className='admin-actions';const status=document.createElement('select');['open','assigned','done'].forEach(s=>{const o=new Option(s,s,s===item.status,s===item.status);status.add(o);});status.addEventListener('change',async()=>{const {error}=await db.from('stuff_to_bring').update({status:status.value}).eq('id',item.id);if(error)console.error('Stuff update error:',error);});const del=document.createElement('button');del.className='btn secondary';del.textContent='Delete';del.addEventListener('click',async()=>{if(!confirm(`Delete "${item.item}"?`))return;await db.from('stuff_to_bring').delete().eq('id',item.id);await loadStuff();});actions.append(status,del);row.append(label,actions);box.appendChild(row);});}
$('stuffForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await db.from('stuff_to_bring').insert({item:$('stuffItem').value.trim(),quantity:Number($('stuffQuantity').value||1),assigned_to:$('stuffAssigned').value.trim()||null,status:$('stuffAssigned').value.trim()?'assigned':'open'});if(error){console.error('Add stuff error:',error);return;}$('stuffForm').reset();$('stuffQuantity').value=1;await loadStuff();});

async function loadTasks(){const box=$('adminTaskList');if(!box)return;box.innerHTML='';const {data,error}=await db.from('things_to_do').select('*').order('sort_order').order('due_date',{ascending:true,nullsFirst:false});if(error){console.error('Tasks error:',error);box.textContent='Could not load tasks.';return;}data.forEach(item=>{const row=document.createElement('div');row.className='admin-list-row';const label=document.createElement('span');label.textContent=`${item.task}${item.assigned_to?` · ${item.assigned_to}`:''}${item.due_date?` · ${item.due_date}`:''}`;const actions=document.createElement('div');actions.className='admin-actions';const status=document.createElement('select');['open','in_progress','done'].forEach(s=>status.add(new Option(s,s,s===item.status,s===item.status)));status.addEventListener('change',async()=>{const {error}=await db.from('things_to_do').update({status:status.value}).eq('id',item.id);if(error)console.error('Task update error:',error);});const del=document.createElement('button');del.className='btn secondary';del.textContent='Delete';del.addEventListener('click',async()=>{if(!confirm(`Delete "${item.task}"?`))return;await db.from('things_to_do').delete().eq('id',item.id);await loadTasks();});actions.append(status,del);row.append(label,actions);box.appendChild(row);});}
$('taskForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await db.from('things_to_do').insert({task:$('taskName').value.trim(),assigned_to:$('taskAssigned').value.trim()||null,due_date:$('taskDue').value||null,status:'open'});if(error){console.error('Add task error:',error);return;}$('taskForm').reset();await loadTasks();});

checkSession();
