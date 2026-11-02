# RSVP Manager — Event Invitation

A standalone, mobile-friendly **single-event** invitation and RSVP website for GitHub Pages and Supabase. One GitHub repository and one Supabase project per event. Changes through [PR #22](https://github.com/Paetur/paetur.github.io/pull/22) are merged and deployed as of **2 November 2026**. The event remains **unpublished** and is **not yet approved for public launch**. See [Security and release checklist](docs/SECURITY_AND_RELEASE.md).

The repository source files do **not** contain guest data, invitation codes, or privileged Supabase credentials.

## Current functionality

| Area | Included |
| --- | --- |
| First-time setup wizard | Existing Supabase DB or new blank DB instructions; validates required RPCs; verifies first admin; downloads `config.js` |
| Single-event website | Name, calendar date, timezone, customizable content and managed language switch (FO/EN/DE included; additional languages configurable) |
| Private invitation links | Compatible with `?ABCDEFGH` and `?invite=ABCDEFGH` |
| RSVP | One answer per invited guest and required session; atomic submission, replay-safe request ID, locked after submit |
| Food | List, claim/quantity update, final confirmation via database RPCs (when event is published and food is enabled for that household) |
| Administrator access | Supabase Auth login + `is_admin` authorization before any admin data is loaded |
| Admin dashboard | Household and guest overview, private link copy, food quantities, event settings, translations, sessions |
| Multiple administrators | Email invitations, pending/resend/cancel, verified acceptance and revoke (cannot remove last) |
| Publish control | Event defaults to **unpublished**; this starter does not provide a publish button |

**Household management:** create/edit households and guests, preserve invitations when moving guests, manage multiple contacts, archive/restore eligible records, and inspect append-only change history. See [Household management](docs/HOUSEHOLD_MANAGEMENT.md) for safeguards and migration order.

**Venues and schedules:** edit multiple venues, timezone-aware session start/end times, and individual invitation exceptions. See [Venues and sessions](docs/VENUES_AND_SESSIONS.md).

**Administration workflows:** device-based email, Messages and WhatsApp compose handoffs, separate reminder drafts, manual sending confirmation/history, reasoned RSVP corrections/reopening and household food-access controls. See [workflow guide](docs/DELIVERY_RSVP_FOOD_CONTROLS.md).

**Administrator invitations:** send, resend or cancel email invitations from Settings → Administrators. Verified recipients accept before access is granted. Requires the admin-invitations Edge Function, SMTP and allowed redirect configuration; see [Administrator invitations](docs/ADMINISTRATOR_INVITATIONS.md).

**Logs:** Settings → Logs provides searchable, filtered history across households, guests, RSVP, invitations, venues, food permissions and administrator sessions. See [Administration logs](docs/ADMINISTRATION_LOGS.md).

**Interface languages and customization:** FO/EN/DE cover the guest, administration and setup interfaces. Select a language in the toolbar; Settings → Event settings contains welcome-message editors and interface wording customization. See [Interface languages](docs/INTERFACE_LANGUAGES.md).

**Current work and optional backlog:** see [Roadmap](docs/ROADMAP.md). Automatic guest sending is an optional later decision; the manual-delivery baseline remains available. Full launch acceptance testing is still required.

**Languages:** Settings → Languages manages enabled languages, event default/fallback and translations beyond FO/EN/DE. See [Language management](docs/INTERFACE_LANGUAGES.md).

**Application backups:** Settings → Backups downloads versioned JSON and validates/restores it into an empty, unpublished destination. Auth and deployment configuration are handled separately. See [Backup and restore](docs/BACKUP_RESTORE.md).

## Completed milestones

Completed implementation and deployment milestones through PR #18:

- [x] GitHub Pages deployment connected to the current Supabase project.
- [x] Private invitation links and session-specific household RSVP with validation, atomic submission, retry protection and submission locking.
- [x] Food/category management, quantity claims, final confirmation and household food-access controls.
- [x] Administrator authentication, verified in-app administrator invitations and membership management.
- [x] Household/guest creation and editing, moves, nested hierarchy, multiple contacts and archive/restore.
- [x] Venue/session management, timezone-aware schedules and invitation defaults/exceptions.
- [x] Manual invitation delivery queues/history, audited RSVP corrections, reopening and late-response permissions.
- [x] Unified administration logs and compact collapsed hierarchy/disclosure layouts.
- [x] Faroese, English and German interfaces, customizable wording and welcome messages.
- [x] Configurable enabled languages, separate event default/fallback languages and broader translation management.
- [x] Versioned application backup export/import, validation and atomic restoration into an empty, unpublished destination.
- [x] Automated browser, authorization, database integrity and disposable-database restoration checks; PR #18 CI and deployment passed.
- [x] Publication safeguard maintained: the current event remains unpublished.

Live workflow acceptance and an independent recovery rehearsal remain open below.

## Implemented for next release

- Other combines tasks and stuff to bring under categories, with Item / Comment / Assigned to / Status boxes and per-row pencil/save. Food expansion now affects categories only; empty read-only comments are hidden.

- Food Expand/Collapse all, language/category icon pop-ups, and local task editing controlled by main Edit with dirty-only Save.

- Compact food disclosures, one-unit guest selection without displayed quantities, public/private comments, categorized language tools and an administrator task sheet with comments. Recipes group existing or new items under a category. See [Food, language and task workflows](docs/FOOD_LANGUAGES_TASKS.md).

- Device-based invitations and administrator-initiated reminders using existing Mail, Messages and WhatsApp accounts, with explicit manual sent confirmation. Opening a composer never means delivered. See [iPad sending instructions](docs/DELIVERY_RSVP_FOOD_CONTROLS.md#sending-from-an-ipad).

## To-do, process and wish list

Implemented features still need operational acceptance. Passing automated tests does not mean every live workflow has been accepted. The [Roadmap](docs/ROADMAP.md) tracks the detailed backlog.

### To-do — verification and launch preparation

- [ ] Verify the deployed Settings → Languages and Backups screens, default/fallback behavior and translations.
- [ ] Check actual-device mobile Safari behavior, collapsed spacing, keyboard access and accessibility.
- [ ] Complete controlled invitation → RSVP → confirmation and food journeys, including competing requests, deadlines and submission locks.
- [ ] Verify administrator password reset and account recovery.
- [ ] Review actual venues, sessions, invitation assignments, contacts, private links and event content.
- [ ] Establish protected, retained current-event backups and rehearse recovery in a separate empty destination.
- [ ] Finish independent installer and migration/permission parity verification and documentation reconciliation. Automated disposable-database restoration checks already pass.
- [ ] Obtain explicit approval before public launch; keep the event unpublished until then.

### Process

1. Verify the deployed language and backup screens.
2. Export a current backup and complete an independent recovery rehearsal using the [backup procedure](docs/BACKUP_RESTORE.md).
3. Run controlled guest and administrator acceptance testing.
4. Correct findings and review the event content.
5. Decide whether to launch or select another feature for implementation.

### Wish list — optional, decide later

These candidates are not commitments or launch blockers by default.

- [ ] Household-wide RSVP defaults with individual overrides.
- [ ] Review all answers before final submission.
- [ ] Reusable multilingual invitation templates.
- [ ] Automatic email/SMS/WhatsApp invitations, reminders and provider delivery tracking.
- [ ] Feature switches for food, contributions and tasks.
- [ ] Guest and administrator “Stuff to bring” and “Things to do” workflows.
- [ ] Further food/category improvements after review.
- [ ] Generalize wedding-specific grouping for other event types.

## Configuration and installation

### A. Current deployed event

The current repository is [Paetur/paetur.github.io](https://github.com/Paetur/paetur.github.io), deployed through GitHub Pages. Its current Supabase project is `xbiklypjpnumhuohujwo`. The former source database has been deleted; use retained current backups for recovery.

- Continue changes in this repository. A new repository or database is not needed for the current event.
- `js/config.js` contains the public Supabase URL and publishable key. Never put secret/service-role credentials in browser files.
- Apply reviewed incremental migrations to an existing database; never rerun the fresh installer against the populated event.
- Keep the event unpublished throughout development and verification.

### B. New blank Supabase database

1. Create a new Supabase project from the dashboard (each event must have its own Supabase database).
2. Open **SQL Editor** and run `supabase/install.sql` (one consolidated file), **or** **all** files in `supabase/migrations/` in filename order. The consolidated installer is generated from that full migration set; independent recovery acceptance is still required.
3. Go to **Authentication → Users**, add your own account and complete email verification.
4. Open `setup.html`, choose **Set up a new database**, enter the project's URL and publishable key, and test the connection.
5. The setup wizard will generate first-admin SQL for your verified email. Run it in **Supabase SQL Editor**, not in the public website. No unauthenticated user can self-claim admin through the website.
6. Sign in through the setup wizard, download `config.js`, and commit it into `js/config.js` in the new repository.
7. Sign in at `admin/` to configure the event. Invite additional administrators through Settings → Administrators after configuring its Edge Function, SMTP and allowed redirects.
8. In Households, enable Edit mode to create households and guests. Create venues and sessions in Settings, then assign household defaults and guest exceptions in Manage Invites before distributing links.

**Fresh installs and recovery:** `supabase/install.sql` is for empty databases and includes the full migration set. It is not a backup and contains no event guest data. Application import requires an empty, unpublished destination with matching schema and independently provisioned verified Auth accounts; see [Backup and restore](docs/BACKUP_RESTORE.md).

## Structure

```text
index.html             Public invitation experience
setup.html             First-time wizard (new/existing database)
admin/index.html       Private administration dashboard
js/config.js           Public-only Supabase configuration
js/core.js             Client, validation, URL helpers
js/guest.js            Invitation + RSVP + food UI
js/admin.js            Admin login, dashboard, membership and event settings
js/admin-tools.js      Language management and backup/import controls
js/i18n.js             Language selection, translations and fallback
js/setup.js            Step-by-step setup workflow
css/app.css            Responsive styles
supabase/install.sql   Consolidated SQL Editor install (new databases only)
supabase/migrations/   Ordered incremental migrations
docs/                  Security / release checklist
```

## Important limitations of GitHub Pages

GitHub Pages is static hosting. A public page can **never** safely run arbitrary SQL, create PostgreSQL databases, call privileged Auth admin endpoints, or store a `service_role` key. Therefore:

- Database creation and migrations happen privately through Supabase SQL Editor.
- First administrator bootstrap is executed privately in SQL Editor, after their Auth account has been verified.
- The website uses the project's **publishable / anon key** and explicitly scoped server-side RPCs.
- The wizard downloads a `config.js` file that must be committed to the new repo for visitors; saving connection settings in local browser storage is for preview only.
- Administrator invitation emails are sent server-side by the `admin-invitations` Edge Function; its SMTP and redirect setup is documented above.

## Guest Edge gateway (required for newly created projects)

The guest-facing app calls `supabase/functions/guest-gateway/index.ts` using the Supabase JS Functions API. Direct public RPC execution is **revoked** by migration 012, so deploying the Edge Function is mandatory; the website will not accept guest RSVPs without it.

- Apply the complete `supabase/install.sql` in a fresh database (including the gateway restrictions introduced in migration 012).
- Deploy `guest-gateway` with `verify_jwt=false` as specified in `supabase/config.toml`. This function validates requests itself, rate-limits by IP, code and a global ceiling, and uses a **server-only** Supabase service role key supplied by the Edge runtime.
- For another event/domain, change `allowedOrigin` in the function to that website's actual HTTPS origin.
- Never put a secret or service-role key in `js/config.js`. It must contain only a public publishable key.
- Verify direct REST calls to `get_invitation_v2`, `get_household_food`, `set_household_food_claim`, `confirm_household_food` and `submit_household_rsvp` are denied for both `anon` and `authenticated`.
- Run the GitHub Actions Chromium smoke test and verify the deployed Edge Function responds as expected.

**Supabase Auth:** Leaked-password protection is configured in the dashboard under Authentication → Providers → Email, not through this repository. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).


