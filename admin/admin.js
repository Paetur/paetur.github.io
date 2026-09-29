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
function fillGroupSelect(select,includeAll=false){if(!select)return;const current=select.value;select.innerHTML='';if(includeAll)select.add(new Option('Allir','all'));relationGroups.forEach(g=>select.add(new Option(g.name,g.id)));if([...select.options].some(o=>o.value===current))select.value=current;}
function fillParentSelect(select,side,groupId,includeRoot=true,excludeId=null){if(!select)return;const current=select.value;select.innerHTML='';if(includeRoot)select.add(new Option('— Root / eingin parent —',''));householdsFor(side,groupId).filter(h=>h.id!==excludeId&&!isDescendant(h.id,excludeId)).forEach(h=>select.add(new Option(optionLabel(h),h.id)));if([...select.options].some(o=>o.value===current))select.value=current;}
function refreshTreeSelectors(){fillGroupSelect($('householdRelationGroup'));fillGroupSelect($('guestRelationFilter'),true);fillParentSelect($('householdParent'),$('householdSide')?.value,$('householdRelationGroup')?.value,true);}

async function loadTreeSetup(){
    const {data:groups,error}=await db.from('relation_groups').select('id,name,sort_order').order('sort_order').order('name');
    if(error){console.error('Tree setup error:',error);const box=$('relationGroupList');if(box)box.textContent='Koyr fyrst supabase_household_tree_migration.sql.';return false;}
    relationGroups=groups||[];refreshTreeSelectors();renderTreeSetup();return true;
}
function renderTreeSetup(){
    const box=$('relationGroupList');
    if(!box)return;
    box.innerHTML='';
    relationGroups.forEach(group=>{
        const row=document.createElement('div');
        row.className='relation-group-row';
        const name=document.createElement('strong');name.textContent=group.name;
        const actions=document.createElement('div');actions.className='admin-actions';
        const rename=document.createElement('button');rename.className='btn secondary';rename.type='button';rename.textContent='Rename';
        const del=document.createElement('button');del.className='btn secondary';del.type='button';del.textContent='Delete';
        actions.append(rename,del);row.append(name,actions);box.appendChild(row);
        rename.addEventListener('click',async()=>{const value=prompt('Nýtt navn:',group.name)?.trim();if(!value||value===group.name)return;const {error}=await db.from('relation_groups').update({name:value}).eq('id',group.id);if(error){alert(error.message);return;}await reloadGuestAdmin();});
        del.addEventListener('click',async()=>{if(!confirm(`Strika relation group "${group.name}"?`))return;const {error}=await db.from('relation_groups').delete().eq('id',group.id);if(error){alert('Kundi ikki strika: '+error.message);return;}await reloadGuestAdmin();});
    });
}
function renderSetupHousehold(h){const wrap=document.createElement('div');wrap.className='setup-node';const row=document.createElement('div');row.className='setup-node-row';const label=document.createElement('span');label.textContent=householdDisplayName(h);const meta=document.createElement('span');meta.className='muted small';meta.textContent=h.guests.length?` · ${h.guests.length} guest(s)`:'';label.appendChild(meta);row.appendChild(label);wrap.appendChild(row);const kids=adminHouseholds.filter(x=>x.parent_id===h.id).sort((a,b)=>a.household_name.localeCompare(b.household_name,'fo'));if(kids.length){const child=document.createElement('div');child.className='setup-node-children';kids.forEach(k=>child.appendChild(renderSetupHousehold(k)));wrap.appendChild(child);}return wrap;}

function householdMatches(h,side,relation,search){if(side!=='all'&&h.side!==side)return false;if(relation!=='all'&&h.relation_group_id!==relation)return false;if(!search)return true;const group=groupById(h.relation_group_id)?.name||'';const haystack=[h.household_name,h.family_name,h.invite_code,householdPath(h.id),group,...h.guests.flatMap(g=>[g.first_name,g.last_name,g.relation])].join(' ');return normalizeSearch(haystack).includes(search);}
function countGuests(items){return items.reduce((n,h)=>n+h.guests.length,0);}
function branchGuestCount(h){return h.guests.length+adminHouseholds.filter(x=>x.parent_id===h.id).reduce((n,c)=>n+branchGuestCount(c),0);}
function inviteUrl(h){return `${location.origin}${location.pathname.replace(/\/admin\/?$/, '/')}?${encodeURIComponent(h.invite_code)}`;}
function householdDisplayName(h){const name=String(h?.household_name||'').trim(),last=String(h?.last_name||'').trim();if(!last)return name;if(name.toLocaleLowerCase('fo').endsWith(last.toLocaleLowerCase('fo')))return name;return `${name} ${last}`.trim();}
function hasVisibleDescendant(h,visibleIds){if(visibleIds.has(h.id))return true;return adminHouseholds.filter(x=>x.parent_id===h.id).some(x=>hasVisibleDescendant(x,visibleIds));}
function renderGuestTree(){const list=$('adminGuestList');if(!list)return;const side=$('guestSideFilter')?.value||'all';const relation=$('guestRelationFilter')?.value||'all';const search=normalizeSearch($('guestSearch')?.value.trim());const matches=adminHouseholds.filter(h=>householdMatches(h,side,relation,search));const visibleIds=new Set(matches.map(h=>h.id));list.innerHTML='';['paetur_hentze','maria_haass'].forEach(sideKey=>{const sideAll=adminHouseholds.filter(h=>h.side===sideKey);if(!sideAll.some(h=>hasVisibleDescendant(h,visibleIds)))return;const sideNode=makeTreeNode('tree-side',sideLabel(sideKey),countGuests(matches.filter(h=>h.side===sideKey)),true);list.appendChild(sideNode.node);relationGroups.forEach(group=>{const groupAll=sideAll.filter(h=>h.relation_group_id===group.id);if(!groupAll.some(h=>hasVisibleDescendant(h,visibleIds)))return;const groupNode=makeTreeNode('tree-relation',group.name,countGuests(matches.filter(h=>h.side===sideKey&&h.relation_group_id===group.id)),true);sideNode.children.appendChild(groupNode.node);groupAll.filter(h=>!h.parent_id||!householdById(h.parent_id)||householdById(h.parent_id).relation_group_id!==group.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo')).forEach(root=>{const el=renderHouseholdBranch(root,visibleIds);if(el)groupNode.children.appendChild(el);});});sideAll.filter(h=>(!h.relation_group_id||!groupById(h.relation_group_id))&&hasVisibleDescendant(h,visibleIds)).forEach(h=>sideNode.children.appendChild(renderHouseholdBranch(h,visibleIds)));});if(!matches.length){const p=document.createElement('p');p.className='muted';p.textContent='Eingin gestur/household passar til filtrið.';list.appendChild(p);}}
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
function householdEditOptions(h){const groupOptions=relationGroups.map(g=>`<option value="${g.id}" ${g.id===h.relation_group_id?'selected':''}>${escapeHtml(g.name)}</option>`).join('');const parentOptions=['<option value="">— Root / eingin parent —</option>',...householdsFor(h.side,h.relation_group_id).filter(x=>x.id!==h.id&&!isDescendant(x.id,h.id)).map(x=>`<option value="${x.id}" ${x.id===h.parent_id?'selected':''}>${escapeHtml(optionLabel(x))}</option>`)].join('');return{groupOptions,parentOptions};}
function renderHousehold(household,insideBranch=false){
    const card=document.createElement('div');card.className='compact-household-card';
    const toolbar=document.createElement('div');toolbar.className='compact-household-toolbar';
    const meta=document.createElement('span');meta.className='muted small';meta.innerHTML=`${household.language.toUpperCase()} · <a href="${escapeHtml(inviteUrl(household))}" target="_blank" rel="noopener">${escapeHtml(household.invite_code)}</a> · ${household.guests.length} guest(s) · ${household.visited ? '✓ Opened' : 'Not opened'}`;
    const actions=document.createElement('div');actions.className='admin-actions';
    const addChild=document.createElement('button');addChild.type='button';addChild.className='btn secondary';addChild.textContent='+ Child';
    const editHouse=document.createElement('button');editHouse.type='button';editHouse.className='btn secondary';editHouse.textContent='Edit';
    const delHouse=document.createElement('button');delHouse.type='button';delHouse.className='btn secondary';delHouse.textContent='Delete';
    actions.append(addChild,editHouse,delHouse);toolbar.append(meta,actions);card.appendChild(toolbar);

    const childForm=document.createElement('form');childForm.className='admin-edit-guest hidden compact-inline-form';
    childForm.innerHTML=`<input name="household_name" placeholder="Child household name" required><input name="last_name" placeholder="Last name"><select name="language"><option value="fo" ${household.language==='fo'?'selected':''}>FO</option><option value="en" ${household.language==='en'?'selected':''}>EN</option><option value="de" ${household.language==='de'?'selected':''}>DE</option></select><button class="btn" type="submit">Add child</button><button class="btn secondary cancel" type="button">Cancel</button><span class="muted small msg"></span>`;
    card.appendChild(childForm);addChild.addEventListener('click',()=>childForm.classList.toggle('hidden'));childForm.querySelector('.cancel').addEventListener('click',()=>childForm.classList.add('hidden'));
    childForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(childForm),msg=childForm.querySelector('.msg'),name=String(f.get('household_name')||'').trim();if(!name)return;const {error}=await db.from('households').insert({household_name:name,last_name:String(f.get('last_name')||'').trim()||null,family_name:name,side:household.side,relation_group_id:household.relation_group_id,parent_id:household.id,language:f.get('language')||household.language,food:household.food,stuff:household.stuff,things:household.things});if(error){console.error('Add child household error:',error);msg.textContent='Kundi ikki stovna child household.';return;}await reloadGuestAdmin();});

    const opts=householdEditOptions(household);const houseForm=document.createElement('form');houseForm.className='admin-edit-guest hidden compact-inline-form';
    houseForm.innerHTML=`<input name="household_name" value="${escapeHtml(household.household_name)}" required><input name="last_name" value="${escapeHtml(household.last_name||'')}" placeholder="Last name"><select name="relation_group_id">${opts.groupOptions}</select><select name="parent_id">${opts.parentOptions}</select><select name="language"><option value="fo" ${household.language==='fo'?'selected':''}>FO</option><option value="en" ${household.language==='en'?'selected':''}>EN</option><option value="de" ${household.language==='de'?'selected':''}>DE</option></select><label><input type="checkbox" name="food" ${household.food?'checked':''}> Food</label><label><input type="checkbox" name="stuff" ${household.stuff?'checked':''}> Stuff</label><label><input type="checkbox" name="things" ${household.things?'checked':''}> Things</label><button class="btn" type="submit">Save</button><button class="btn secondary cancel" type="button">Cancel</button><span class="muted small msg"></span>`;
    card.appendChild(houseForm);editHouse.addEventListener('click',()=>houseForm.classList.toggle('hidden'));houseForm.querySelector('.cancel').addEventListener('click',()=>houseForm.classList.add('hidden'));const groupSelect=houseForm.querySelector('[name="relation_group_id"]'),parentSelect=houseForm.querySelector('[name="parent_id"]');groupSelect.addEventListener('change',()=>fillParentSelect(parentSelect,household.side,groupSelect.value,true,household.id));
    houseForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(houseForm),msg=houseForm.querySelector('.msg');const {error}=await db.from('households').update({household_name:String(f.get('household_name')).trim(),last_name:String(f.get('last_name')||'').trim()||null,family_name:String(f.get('household_name')).trim(),relation_group_id:f.get('relation_group_id')||null,parent_id:f.get('parent_id')||null,language:f.get('language'),food:f.get('food')==='on',stuff:f.get('stuff')==='on',things:f.get('things')==='on'}).eq('id',household.id);if(error){console.error('Edit household error:',error);msg.textContent='Kundi ikki goyma household.';return;}await reloadGuestAdmin();});
    delHouse.addEventListener('click',async()=>{const children=adminHouseholds.filter(x=>x.parent_id===household.id);if(children.length){alert(`Hetta household hevur ${children.length} child household(s). Flyt ella strika tey fyrst.`);return;}if(!confirm(`Strika household "${household.household_name}" og allar gestir í tí?`))return;const {error}=await db.from('households').delete().eq('id',household.id);if(error){console.error('Delete household error:',error);alert('Kundi ikki strika household: '+error.message);return;}await reloadGuestAdmin();});

    const guestForm=document.createElement('form');guestForm.className='admin-add-guest compact-add-guest';guestForm.innerHTML=`<input name="first_name" placeholder="First name" required><input name="last_name" placeholder="${escapeHtml(household.last_name||'Last name')}"><input name="relation" placeholder="Relation"><label><input type="checkbox" name="is_child"> Child</label><button class="btn" type="submit">+ Guest</button><span class="muted small guest-form-message"></span>`;
    guestForm.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(guestForm),button=guestForm.querySelector('button'),message=guestForm.querySelector('.guest-form-message'),first=String(f.get('first_name')||'').trim();if(!first)return;button.disabled=true;const {error}=await db.from('guests').insert({household_id:household.id,first_name:first,last_name:String(f.get('last_name')||'').trim()||null,relation:String(f.get('relation')||'').trim()||null,is_child:f.get('is_child')==='on',rsvp_status:'pending'});button.disabled=false;if(error){message.textContent='Kundi ikki stovna gest.';return;}await loadAdminGuests();});card.appendChild(guestForm);

    household.guests.sort((a,b)=>(a.last_name||'').localeCompare(b.last_name||'','fo')||a.first_name.localeCompare(b.first_name,'fo')).forEach(guest=>{const row=document.createElement('div');row.className='compact-guest-row';const info=document.createElement('div');const name=document.createElement('strong');const guestLastName=String(guest.last_name||'').trim();name.textContent=guestLastName?`${guest.first_name} ${guestLastName}`:guest.first_name;const detail=document.createElement('span');detail.className='muted small';detail.textContent=`${guest.relation?guest.relation+' · ':''}${guest.is_child?'Barn · ':''}${guest.rsvp_status==='attending'?'✓ Kemur':guest.rsvp_status==='declined'?'– Kemur ikki':'? Ikki svarað'}`;info.append(name,document.createTextNode(' '),detail);const rowActions=document.createElement('div');rowActions.className='admin-actions';const edit=document.createElement('button');edit.type='button';edit.className='btn secondary';edit.textContent='Edit';const del=document.createElement('button');del.type='button';del.className='btn secondary';del.textContent='Delete';rowActions.append(edit,del);row.append(info,rowActions);card.appendChild(row);const form=document.createElement('form');form.className='admin-edit-guest hidden compact-inline-form';form.innerHTML=`<input name="first_name" value="${escapeHtml(guest.first_name)}" required><input name="last_name" value="${escapeHtml(guest.last_name)}" placeholder="${escapeHtml(household.last_name||'Last name')}"><input name="relation" value="${escapeHtml(guest.relation)}"><label><input type="checkbox" name="is_child" ${guest.is_child?'checked':''}> Child</label><select name="rsvp_status"><option value="pending" ${guest.rsvp_status==='pending'?'selected':''}>Pending</option><option value="attending" ${guest.rsvp_status==='attending'?'selected':''}>Attending</option><option value="declined" ${guest.rsvp_status==='declined'?'selected':''}>Declined</option></select><button class="btn" type="submit">Save</button><button class="btn secondary cancel" type="button">Cancel</button><span class="muted small msg"></span>`;card.appendChild(form);edit.addEventListener('click',()=>form.classList.toggle('hidden'));form.querySelector('.cancel').addEventListener('click',()=>form.classList.add('hidden'));form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form),msg=form.querySelector('.msg');const {error}=await db.from('guests').update({first_name:String(f.get('first_name')||'').trim(),last_name:String(f.get('last_name')||'').trim()||null,relation:String(f.get('relation')||'').trim()||null,is_child:f.get('is_child')==='on',rsvp_status:f.get('rsvp_status')}).eq('id',guest.id);if(error){msg.textContent='Kundi ikki goyma.';return;}await loadAdminGuests();});del.addEventListener('click',async()=>{if(!confirm(`Strika ${guest.first_name}?`))return;const {error}=await db.from('guests').delete().eq('id',guest.id);if(error){alert('Kundi ikki strika gest.');return;}await loadAdminGuests();});});
    return card;
}
function renderStats(){
    const summary=$('statsSummary'), tree=$('statsTree');
    if(!summary||!tree)return;
    const households=adminHouseholds.length;
    const guests=adminHouseholds.reduce((n,h)=>n+(h.guests?.length||0),0);
    const seen=adminHouseholds.filter(h=>h.visited).length;
    const unseen=households-seen;
    const complete=adminHouseholds.filter(h=>(h.guests?.length||0)>0&&h.guests.every(g=>g.rsvp_status!=='pending')).length;
    summary.innerHTML='';
    [['Households',households],['Guests',guests],['Seen',seen],['Not seen',unseen],['RSVP complete',complete]].forEach(([label,value])=>{
        const box=document.createElement('div');
        const strong=document.createElement('strong');strong.textContent=value;
        const span=document.createElement('span');span.textContent=label;
        box.append(strong,span);summary.appendChild(box);
    });
    tree.innerHTML='';
    const renderRow=(h,depth)=>{
        const row=document.createElement('div');row.className='stats-row';row.style.setProperty('--depth',depth);
        const name=document.createElement('span');name.textContent=householdDisplayName(h);
        const code=document.createElement('a');code.href=inviteUrl(h);code.target='_blank';code.rel='noopener';code.textContent=h.invite_code||'—';
        const count=document.createElement('span');count.textContent=String(h.guests?.length||0);count.title='Direct guests';
        const access=document.createElement('span');access.className='stats-access';
        [['F',h.food,'Food'],['S',h.stuff,'Stuff'],['T',h.things,'Things']].forEach(([label,enabled,title])=>{const flag=document.createElement('span');flag.className=enabled?'stats-access-on':'stats-access-off';flag.textContent=enabled?'✓':'—';flag.title=`${title}: ${enabled?'Yes':'No'}`;flag.setAttribute('aria-label',`${title}: ${enabled?'Yes':'No'}`);flag.dataset.label=label;access.appendChild(flag);});
        const visited=document.createElement('span');visited.textContent=h.visited?'✓':'—';visited.title=h.visited?(h.visited_at?`Seen ${new Date(h.visited_at).toLocaleString()}`:'Seen'):'Not seen';
        row.append(name,code,count,access,visited);tree.appendChild(row);
        adminHouseholds.filter(x=>x.parent_id===h.id).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo')).forEach(c=>renderRow(c,depth+1));
    };
    ['paetur_hentze','maria_haass'].forEach(side=>{
        const sideHouseholds=adminHouseholds.filter(h=>h.side===side);
        if(!sideHouseholds.length)return;
        const heading=document.createElement('h3');heading.className='stats-side';heading.textContent=sideLabel(side);tree.appendChild(heading);
        relationGroups.forEach(group=>{
            const grouped=sideHouseholds.filter(h=>h.relation_group_id===group.id);
            if(!grouped.length)return;
            const gh=document.createElement('div');gh.className='stats-group';gh.textContent=group.name;tree.appendChild(gh);
            grouped.filter(h=>!h.parent_id||!grouped.some(x=>x.id===h.parent_id)).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||a.household_name.localeCompare(b.household_name,'fo')).forEach(h=>renderRow(h,0));
        });
    });
}

async function loadAdminGuests(){const container=$('adminGuestList'),summary=$('guestSummary');if(!container||!summary)return;container.innerHTML='';summary.textContent='Lesi gestir…';const {data,error}=await db.from('households').select(`id,household_name,side,language,invite_code,family_name,last_name,relation_group_id,parent_id,sort_order,food,stuff,things,visited,visited_at,guests(id,first_name,last_name,relation,is_child,rsvp_status)`).order('sort_order').order('household_name');if(error){console.error('Admin guests error:',error);summary.textContent='Kundi ikki lesa gestir. Koyr supabase_household_tree_migration.sql fyrst.';return;}adminHouseholds=data||[];refreshTreeSelectors();let total=0,attending=0,declined=0,pending=0;adminHouseholds.forEach(h=>h.guests.forEach(g=>{total++;if(g.rsvp_status==='attending')attending++;else if(g.rsvp_status==='declined')declined++;else pending++;}));summary.textContent=`${total} gestir · ${attending} koma · ${declined} koma ikki · ${pending} ikki svarað`;renderGuestTree();renderStats();}
async function reloadGuestAdmin(){await loadTreeSetup();await loadAdminGuests();renderTreeSetup();}
['guestSideFilter','guestRelationFilter'].forEach(id=>$(id)?.addEventListener('change',renderGuestTree));$('guestSearch')?.addEventListener('input',renderGuestTree);$('expandGuestTree')?.addEventListener('click',()=>document.querySelectorAll('#adminGuestList details').forEach(d=>d.open=true));$('collapseGuestTree')?.addEventListener('click',()=>document.querySelectorAll('#adminGuestList details').forEach(d=>d.open=false));
$('householdSide')?.addEventListener('change',()=>fillParentSelect($('householdParent'),$('householdSide').value,$('householdRelationGroup').value,true));$('householdRelationGroup')?.addEventListener('change',()=>fillParentSelect($('householdParent'),$('householdSide').value,$('householdRelationGroup').value,true));
$('relationGroupForm')?.addEventListener('submit',async e=>{e.preventDefault();const name=$('relationGroupName').value.trim();if(!name)return;const {error}=await db.from('relation_groups').insert({name,sort_order:relationGroups.length*10+10});if(error){alert(error.message);return;}$('relationGroupForm').reset();await reloadGuestAdmin();});
$('householdForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('addHouseholdButton'),message=$('householdMessage'),name=$('householdName').value.trim();if(!name)return;button.disabled=true;message.classList.add('hidden');const {data,error}=await db.from('households').insert({household_name:name,side:$('householdSide').value,relation_group_id:$('householdRelationGroup').value||null,parent_id:$('householdParent').value||null,family_name:name,last_name:$('householdLastName').value.trim()||null,language:$('householdLanguage').value,food:$('householdFood').checked,stuff:$('householdStuff').checked,things:$('householdThings').checked}).select().single();button.disabled=false;if(error){console.error('Add household error:',error);message.textContent='Kundi ikki stovna household.';message.classList.remove('hidden');return;}message.textContent=`✓ ${data.household_name} stovnað · Invite code: ${data.invite_code}`;message.classList.remove('hidden');$('householdName').value='';$('householdLastName').value='';await reloadGuestAdmin();});

async function loadAdminFood(){
    const container=$('adminFoodList'),summary=$('foodAdminSummary');
    if(!container||!summary)return;
    container.innerHTML='';summary.textContent='Lesi food…';
    const {data,error}=await db.from('food_items').select(`id,category,name_fo,name_en,name_de,description_fo,description_en,description_de,quantity_needed,active,sort_order,food_claims(id,quantity,household_id,households(household_name))`).order('sort_order').order('name_fo');
    if(error){console.error('Admin food error:',error);summary.textContent='Kundi ikki lesa Food-listan.';return;}

    let needed=0,claimed=0;
    data.forEach(i=>{needed+=i.quantity_needed;claimed+=i.food_claims.reduce((s,c)=>s+c.quantity,0);});
    summary.textContent=`${data.length} food items · ${claimed} av ${needed} tikin`;

    const groups=new Map();
    data.forEach(item=>{const category=String(item.category||'').trim()||'Uncategorized';if(!groups.has(category))groups.set(category,[]);groups.get(category).push(item);});

    groups.forEach((items,category)=>{
        const group=document.createElement('details');group.className='tree-node food-admin-category';group.open=true;
        const head=document.createElement('summary');
        const title=document.createElement('strong');title.textContent=category;
        const groupClaimed=items.reduce((sum,item)=>sum+item.food_claims.reduce((s,c)=>s+c.quantity,0),0);
        const groupNeeded=items.reduce((sum,item)=>sum+item.quantity_needed,0);
        const count=document.createElement('span');count.className='tree-count';count.textContent=`${items.length} items · ${groupClaimed}/${groupNeeded} tikin`;
        head.append(title,count);
        const children=document.createElement('div');children.className='tree-children';

        items.forEach(item=>{
            const taken=item.food_claims.reduce((s,c)=>s+c.quantity,0),available=Math.max(item.quantity_needed-taken,0);
            const node=document.createElement('details');node.className='compact-household-node food-admin-item';
            const itemSummary=document.createElement('summary');
            const label=document.createElement('span');label.className='compact-household-label';label.textContent=item.name_fo;
            const itemCount=document.createElement('span');itemCount.className='tree-count';itemCount.textContent=`${taken}/${item.quantity_needed} tikin${item.active?'':' · Inactive'}`;
            itemSummary.append(label,itemCount);

            const body=document.createElement('div');body.className='compact-household-body';
            const card=document.createElement('div');card.className='compact-household-card';
            const toolbar=document.createElement('div');toolbar.className='compact-household-toolbar';
            const info=document.createElement('div');
            const languages=document.createElement('div');languages.className='muted small';languages.textContent=[item.name_en,item.name_de].filter(Boolean).join(' · ');
            const status=document.createElement('div');status.className='muted small';status.textContent=`${available} tøkt · ${item.quantity_needed} totalt`;
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
            form.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(form),msg=form.querySelector('.msg');const {error}=await db.from('food_items').update({name_fo:String(f.get('name_fo')).trim(),name_en:String(f.get('name_en')||'').trim()||null,name_de:String(f.get('name_de')||'').trim()||null,category:String(f.get('category')||'').trim()||null,quantity_needed:Number(f.get('quantity')),sort_order:Number(f.get('sort')||0),active:f.get('active')==='on'}).eq('id',item.id);if(error){console.error('Edit food error:',error);msg.textContent='Kundi ikki goyma.';return;}await loadAdminFood();});
            del.addEventListener('click',async()=>{if(!confirm(`Strika "${item.name_fo}"? Claims á hesum item verða eisini strikað.`))return;const {error}=await db.from('food_items').delete().eq('id',item.id);if(error){console.error('Delete food error:',error);alert('Kundi ikki strika food item.');return;}await loadAdminFood();});
        });
        group.append(head,children);container.appendChild(group);
    });
}
$('foodForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('addFoodButton'),msg=$('foodFormMessage');button.disabled=true;const {error}=await db.from('food_items').insert({name_fo:$('foodNameFo').value.trim(),name_en:$('foodNameEn').value.trim()||null,name_de:$('foodNameDe').value.trim()||null,category:$('foodCategory').value.trim()||null,quantity_needed:Number($('foodQuantity').value),sort_order:Number($('foodSortOrder').value||0),active:true});button.disabled=false;if(error){console.error('Add food error:',error);msg.textContent='Kundi ikki stovna food item.';msg.classList.remove('hidden');return;}$('foodForm').reset();$('foodQuantity').value=1;$('foodSortOrder').value=0;msg.classList.add('hidden');await loadAdminFood();});

async function loadStuff(){const box=$('adminStuffList');if(!box)return;box.innerHTML='';const {data,error}=await db.from('stuff_to_bring').select('*').order('sort_order').order('item');if(error){console.error('Stuff error:',error);box.textContent='Kundi ikki lesa listan.';return;}data.forEach(item=>{const row=document.createElement('div');row.className='admin-list-row';const label=document.createElement('span');label.textContent=`${item.item}${item.quantity?` × ${item.quantity}`:''}${item.assigned_to?` · ${item.assigned_to}`:''}`;const actions=document.createElement('div');actions.className='admin-actions';const status=document.createElement('select');['open','assigned','done'].forEach(s=>{const o=new Option(s,s,s===item.status,s===item.status);status.add(o);});status.addEventListener('change',async()=>{const {error}=await db.from('stuff_to_bring').update({status:status.value}).eq('id',item.id);if(error)console.error('Stuff update error:',error);});const del=document.createElement('button');del.className='btn secondary';del.textContent='Delete';del.addEventListener('click',async()=>{if(!confirm(`Strika "${item.item}"?`))return;await db.from('stuff_to_bring').delete().eq('id',item.id);await loadStuff();});actions.append(status,del);row.append(label,actions);box.appendChild(row);});}
$('stuffForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await db.from('stuff_to_bring').insert({item:$('stuffItem').value.trim(),quantity:Number($('stuffQuantity').value||1),assigned_to:$('stuffAssigned').value.trim()||null,status:$('stuffAssigned').value.trim()?'assigned':'open'});if(error){console.error('Add stuff error:',error);return;}$('stuffForm').reset();$('stuffQuantity').value=1;await loadStuff();});

async function loadTasks(){const box=$('adminTaskList');if(!box)return;box.innerHTML='';const {data,error}=await db.from('things_to_do').select('*').order('sort_order').order('due_date',{ascending:true,nullsFirst:false});if(error){console.error('Tasks error:',error);box.textContent='Kundi ikki lesa uppgávur.';return;}data.forEach(item=>{const row=document.createElement('div');row.className='admin-list-row';const label=document.createElement('span');label.textContent=`${item.task}${item.assigned_to?` · ${item.assigned_to}`:''}${item.due_date?` · ${item.due_date}`:''}`;const actions=document.createElement('div');actions.className='admin-actions';const status=document.createElement('select');['open','in_progress','done'].forEach(s=>status.add(new Option(s,s,s===item.status,s===item.status)));status.addEventListener('change',async()=>{const {error}=await db.from('things_to_do').update({status:status.value}).eq('id',item.id);if(error)console.error('Task update error:',error);});const del=document.createElement('button');del.className='btn secondary';del.textContent='Delete';del.addEventListener('click',async()=>{if(!confirm(`Strika "${item.task}"?`))return;await db.from('things_to_do').delete().eq('id',item.id);await loadTasks();});actions.append(status,del);row.append(label,actions);box.appendChild(row);});}
$('taskForm').addEventListener('submit',async e=>{e.preventDefault();const {error}=await db.from('things_to_do').insert({task:$('taskName').value.trim(),assigned_to:$('taskAssigned').value.trim()||null,due_date:$('taskDue').value||null,status:'open'});if(error){console.error('Add task error:',error);return;}$('taskForm').reset();await loadTasks();});

checkSession();
