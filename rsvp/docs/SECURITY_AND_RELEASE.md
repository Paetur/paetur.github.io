# Release checklist — do not publish before completion

This is a **starter project**. Its SQL includes unreviewed legacy migrations. It has not undergone an end-to-end integration test against both freshly installed and imported Supabase projects.

## Verified in the connected NEW Supabase project

- 61 households / 104 guests retained, plus all 245 non-admin imported legacy records.
- 1 verified Supabase Auth administrator present.
- 3 languages, one wedding celebration session, 61 session-default invitations, 104 effective guest session invitations.
- New admin-list/add/remove/rename RPCs installed. All four deny anonymous `EXECUTE`.
- Public event v2 returns `NULL` while event is unpublished. Food read is also hidden when unpublished or when the household's `food` permission is not enabled.
- Source (old wedding DB) and source (old GitHub repository) were not modified in building this starter.

## Must fix before going live

1. **Public invitation-code RPC security and abuse controls.** `get_invitation_v2`, `submit_household_rsvp`, `set_household_food_claim`, and `confirm_household_food` still expose security-definer functions callable by `anon`. Apply per-IP and/or per-code rate limiting at an edge/API boundary; verify entitlement and audit checks. The existing `get_invitation_v2` can return data even while the event is unpublished when called directly. The UI refusing to display an unpublished event is not a substitute for database-side authorization.
2. **Publication guards.** Add database-level `is_published` enforcement to *all* public RSVP and food **write** RPCs; the starter currently only protects public event read and food read. Test the admin preview workflow separately. Do not assume hiding buttons is sufficient.
3. **End-to-end tests.** Test anonymous/non-admin/admin roles; guest isolation; invalid/guessed invite codes; response completeness; exact-once idempotency; concurrent double submissions; last-admin protection; password reset; session eligibility changes; deadline and late overrides; food quantity contention; locked/confirmed food; and audit history immutability.
4. **Full CRUD with validation/audit.** Build reviewed admin create/edit/remove flows for households/guests, with valid invite code generation; no direct anonymous CRUD. Preserve original codes and guest IDs.
5. **Invitation flow.** Implement per-household/per-guest session inclusion overrides, delivery queues, manual confirmation, and communication audit. Add launch review for appropriate timezone and RSVP deadline.
6. **New-project installer validation.** Run `supabase/install.sql` in a disposable blank project and compare the resulting function/column set with the live project. Migrations 001–004 were originally drafts and are not assumed to match the deployed SQL byte-for-byte.
7. **Backup & cleanup.** Export a full destination database backup and compare field-level data against source; never delete the old project solely because counts match. Freeze old-site writes before cutover.
8. **Supabase security advisors.** Investigate the warnings for intentionally public SECURITY DEFINER RPCs. `public.admins` has RLS with no direct SELECT policy intentionally; membership is accessed through admin-only RPCs. The linter marks it as informational.
9. **GitHub Pages release.** Use a pinned, reviewed Supabase JS client version, check the external script, configure HTTPS, test mobile UI, and avoid committing private guest information or any privileged key.
10. **Configuration.** Leave `is_published=false` until all safeguards pass and a test invite has been exercised successfully against the new deployed site.

## Administrators

`admin_add_existing_user` requires an email-confirmed row in Supabase `auth.users` and an already-authorized admin. There is no unauthenticated registration or first-user self-claim endpoint. `admin_remove_member` takes an advisory transaction lock and refuses to remove the final admin. The actor/subject/action is appended to an immutable membership-audit table.

**Email invitation automation** is not included: automated Auth invites would require a protected Supabase Edge Function or trusted server with a `service_role` secret never sent to the browser. For now, send invitations from **Supabase Dashboard → Authentication → Users** and promote them in the website after verification.

## Suggested manual checks in new project SQL Editor

```sql
SELECT is_published FROM public.event_settings WHERE id=1;
SELECT count(*) FROM public.households;
SELECT count(*) FROM public.guests;
SELECT count(*) FROM public.admins;
SELECT public.get_public_event_v2() IS NULL AS unpublished_event_hidden;
SELECT has_function_privilege('anon','public.admin_list_members()','EXECUTE') AS anon_can_list_admins;
```

Expected while staging: `false`, `61`, `104`, `1`, `true`, `false` respectively, for this wedding's copied data.
