// Two disposable databases. No production data, connections, emails or Auth writes.
const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),assert=require('node:assert/strict');
const sourceAdmin='11111111-1111-4111-8111-111111111111',destAdmin='22222222-2222-4222-8222-222222222222',session='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const migrations=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();let checks=0;
async function setup(admin,installer=false){const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,encrypted_password text);CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid,created_at timestamptz DEFAULT now());CREATE TABLE auth.audit_log_entries(id uuid PRIMARY KEY,payload json,created_at timestamptz DEFAULT now());CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated,anon;`);
 if(installer)await db.exec(fs.readFileSync('supabase/install.sql','utf8'));else for(const file of migrations)await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
 await db.query("INSERT INTO auth.users VALUES($1,'admin@example.invalid',now(),'not-exported')",[admin]);await db.query("INSERT INTO public.admins(user_id,name) VALUES($1,'Test')",[admin]);await db.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[session,admin]);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[admin,JSON.stringify({sub:admin,session_id:session})]);await db.exec('SET ROLE authenticated');return db;}
const value=async(db,s,p=[]) =>(await db.query(s,p)).rows[0].value;
const copy=x=>JSON.parse(JSON.stringify(x));
async function checksum(db,b){b.checksum=await value(db,"SELECT encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') value",[b.payload]);return b;}
(async()=>{const src=await setup(sourceAdmin),dst=await setup(destAdmin,true);try{
 await src.query("SELECT public.admin_save_language('sv','Svenska',true,4)");await src.query("SELECT public.admin_set_language_preferences('fo','de')");
 await assert.rejects(()=>src.query("SELECT public.admin_save_language('de','Deutsch',false,3)"),/default and fallback/);checks++;
 await src.query("SELECT public.admin_save_translation('ui:Quantity for {item}','sv','Mängd för {item}')");
 await assert.rejects(()=>src.query("SELECT public.admin_save_translation('ui:Quantity for {item}','sv','Mängd')"),/placeholders/);checks++;
 await src.query("SELECT public.admin_save_translation('welcome','sv','Välkommen!')");
 const parent=await value(src,"SELECT public.admin_save_household(null,$1) value",[{household_name:'Group',side:'paetur_hentze',language:'sv'}]);
 const household=await value(src,"SELECT public.admin_save_household(null,$1) value",[{household_name:'Test household',side:'paetur_hentze',language:'sv',parent_id:parent}]);
 const guest=await value(src,"SELECT public.admin_create_guest($1,$2) value",[household,{first_name:'Example',language:'sv'}]);
 const code=await value(src,'SELECT invite_code value FROM public.households WHERE id=$1',[household]);assert.match(code,/^[A-HJ-NP-Z2-9]{8}$/);checks++;
 await src.query("SELECT public.admin_save_language('sv','Svenska',false,4)");
 await assert.rejects(()=>src.query('SELECT public.admin_create_guest($1,$2)',[household,{first_name:'Blocked',language:'sv'}]),/enabled language/);checks++;
 await src.query("SELECT public.admin_save_language('sv','Svenska',true,4)");
 await src.exec('RESET ROLE');
 // Lock a real synthetic RSVP, preserve a confirmed food claim and task/contribution rows.
 const sid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',food='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 await src.query("INSERT INTO public.event_sessions(id,session_key,name) VALUES($1,'dinner','Dinner')",[sid]);
 await src.query('INSERT INTO public.household_session_defaults VALUES($1,$2,true)',[household,sid]);
 await src.query("INSERT INTO public.food_items(id,name_fo,name_en,quantity_needed) VALUES($1,'Matur','Food',3)",[food]);
 await src.query('UPDATE public.households SET food=true WHERE id=$1',[household]);await src.exec('UPDATE public.event_settings SET is_published=true');
 await src.query('SELECT public.submit_household_rsvp($1,$2,$3)',[code,session,[{guest_id:guest,session_id:sid,status:'attending'}]]);
 await src.query('SELECT public.set_household_food_claim($1,$2,2,null)',[code,food]);await src.query('SELECT public.confirm_household_food($1)',[code]);
 await src.query('INSERT INTO public.invitation_access_audit(id,household_id) OVERRIDING SYSTEM VALUE VALUES(9007199254740993,$1)',[household]);
 await src.exec("INSERT INTO public.stuff_to_bring(item) VALUES('Chairs');INSERT INTO public.things_to_do(task) VALUES('Prepare venue');UPDATE public.event_settings SET is_published=false;SET ROLE authenticated;");
 await src.query("SELECT public.admin_prepare_invitation('invited@example.invalid','Recipient')");
 const backup=await value(src,'SELECT public.admin_export_backup() value');
 const outsider='33333333-3333-4333-8333-333333333333',otherSession='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 await src.exec('RESET ROLE');await src.query("INSERT INTO auth.users VALUES($1,'outsider@example.invalid',now(),'not-exported')",[outsider]);await src.query('INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)',[otherSession,outsider]);await src.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[outsider,JSON.stringify({sub:outsider,session_id:otherSession})]);await src.exec('SET ROLE authenticated');
 for(const query of ['SELECT public.admin_export_backup()','SELECT public.admin_preview_backup($1)',"SELECT public.admin_restore_backup($1,'RESTORE My event')"]){await assert.rejects(()=>src.query(query,query.includes('$1')?[backup]:[]),/Administrator access required/);checks++;}
 await src.exec('RESET ROLE');await src.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[sourceAdmin,JSON.stringify({sub:sourceAdmin,session_id:session})]);await src.exec('SET ROLE authenticated');
 const filtered=await value(src,'SELECT public.admin_export_backup() value');assert.equal(filtered.payload.identities.some(i=>i.id===outsider),false);checks++;

 assert.equal(backup.payload.tables['public.invitation_access_audit'][0].id,'9007199254740993');checks++;
 assert.ok(backup.checksum);assert.ok(!JSON.stringify(backup).includes('not-exported'));assert.ok(!backup.payload.tables['public.admins']);assert.ok(backup.payload.tables['app_private.invitation_code_registry'].length);checks+=4;
 await src.exec('SET ROLE anon');const publicLanguage=await value(src,'SELECT public.get_language_configuration() value');assert.equal(publicLanguage.fallback_language,'de');assert.equal(publicLanguage.translations.some(c=>c.content_key==='welcome'),false);assert.equal(await value(src,'SELECT public.get_public_event_v2() value'),null);checks+=3;await assert.rejects(()=>src.query('SELECT public.admin_export_backup()'),/permission denied/);await src.exec('RESET ROLE;SET ROLE authenticated');checks++;
 let preview=await value(src,'SELECT public.admin_preview_backup($1) value',[backup]);assert.equal(preview.can_restore,false);assert.match(preview.reason,/empty application destination/);checks++;
 const corrupt=copy(backup);corrupt.payload.tables['public.households'][0].household_name='Damaged';await assert.rejects(()=>dst.query('SELECT public.admin_preview_backup($1)',[corrupt]),/checksum/);checks++;
 const unknown=copy(backup);unknown.payload.tables['public.not_allowed']=[];await checksum(dst,unknown);await assert.rejects(()=>dst.query('SELECT public.admin_preview_backup($1)',[unknown]),/table set/);checks++;
 // Actual rehearsal executes all inserts, parent/circular FK restoration, actor mapping and sequence restarts, then rolls back.
 preview=await value(dst,'SELECT public.admin_preview_backup($1) value',[backup]);assert.equal(preview.can_restore,true,preview.reason);checks++;
 assert.equal(await value(dst,'SELECT count(*)::int value FROM public.households'),0);checks++;
 const before=await value(dst,'SELECT default_language value FROM public.event_settings');assert.equal(before,'en');checks++;
 await assert.rejects(()=>dst.query('SELECT public.admin_restore_backup($1,$2)',[backup,'wrong']),/Type RESTORE/);checks++;
 // A late constraint failure rolls back every earlier table and re-enables triggers.
 const invalid=copy(backup);invalid.payload.tables['public.food_claims'][0].quantity=99;await checksum(dst,invalid);
 preview=await value(dst,'SELECT public.admin_preview_backup($1) value',[invalid]);assert.equal(preview.can_restore,false);assert.match(preview.reason,/claims exceed/);assert.equal(await value(dst,'SELECT count(*)::int value FROM public.households'),0);checks+=3;
 const cyclic=copy(backup);cyclic.payload.tables['public.households'].find(h=>h.id===parent).parent_id=household;await checksum(dst,cyclic);preview=await value(dst,'SELECT public.admin_preview_backup($1) value',[cyclic]);assert.equal(preview.can_restore,false);assert.match(preview.reason,/cycle/);checks+=2;
 const branch=copy(cyclic);const outside=copy(branch.payload.tables['public.households'].find(h=>h.id===parent));outside.id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';branch.payload.tables['public.households'].unshift(outside);branch.payload.counts['public.households']++;await checksum(dst,branch);preview=await value(dst,'SELECT public.admin_preview_backup($1) value',[branch]);assert.equal(preview.can_restore,false);assert.match(preview.reason,/cycle/);checks+=2;
 const missing=copy(backup);missing.payload.identities[0].email='missing@example.invalid';await checksum(dst,missing);preview=await value(dst,'SELECT public.admin_preview_backup($1) value',[missing]);assert.equal(preview.can_restore,false);assert.match(preview.reason,/historical actor/);checks+=2;
 const result=await value(dst,'SELECT public.admin_restore_backup($1,$2) value',[backup,'RESTORE My event']);assert.equal(result.restored,true);checks++;
 const restored=(await dst.query('SELECT parent_id,invite_code,rsvp_state,food_confirmed,latest_rsvp_submission_id FROM public.households WHERE id=$1',[household])).rows[0];
 assert.equal(restored.parent_id,parent);assert.equal(restored.invite_code,code);assert.equal(restored.rsvp_state,'locked');assert.equal(restored.food_confirmed,true);assert.ok(restored.latest_rsvp_submission_id);checks+=5;
 assert.equal(await value(dst,'SELECT is_published value FROM public.event_settings'),false);assert.equal(await value(dst,'SELECT fallback_language value FROM public.event_settings'),'de');assert.equal(await value(dst,'SELECT count(*)::int value FROM public.stuff_to_bring'),1);assert.equal(await value(dst,'SELECT count(*)::int value FROM public.things_to_do'),1);checks+=4;
 const restoredExport=await value(dst,'SELECT public.admin_export_backup() value');
 for(const [table,rows]of Object.entries(backup.payload.tables)){if(table==='public.backup_restore_audit'||table==='public.admin_invitations')continue;const normalized=rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,v])=>[key,v===sourceAdmin?destAdmin:v])));assert.deepEqual(restoredExport.payload.tables[table].map(JSON.stringify).sort(),normalized.map(JSON.stringify).sort(),table+' roundtrip');checks++;}
 assert.equal(restoredExport.payload.tables['public.backup_restore_audit'].length,1);checks++;
 const restoredInvitation=restoredExport.payload.tables['public.admin_invitations'][0];assert.equal(restoredInvitation.id,backup.payload.tables['public.admin_invitations'][0].id);assert.equal(restoredInvitation.status,'cancelled');assert.notEqual(restoredInvitation.attempt_id,backup.payload.tables['public.admin_invitations'][0].attempt_id);checks+=3;
 await dst.exec('RESET ROLE');assert.equal(await value(dst,'SELECT user_id value FROM public.admins'),destAdmin);assert.equal(await value(dst,'SELECT actor_user_id value FROM public.management_audit LIMIT 1'),destAdmin);checks+=2;
 await assert.rejects(()=>dst.query('UPDATE public.rsvp_submissions SET submission_number=99'),/immutable/);checks++;
 assert.equal(await value(dst,"SELECT count(*)::int value FROM pg_trigger WHERE tgrelid='public.households'::regclass AND NOT tgisinternal AND tgenabled='D'"),0);checks++;
 await dst.exec('SET ROLE authenticated');await assert.rejects(()=>dst.query('SELECT public.admin_restore_backup($1,$2)',[backup,'RESTORE My event']),/empty application destination/);checks++;
 console.log('PASS: '+checks+' language, authorization, checksum/schema, non-overwrite, dry-run rollback and cross-identity full restoration checks');
 }finally{await src.close();await dst.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
