# Event Invitation — Fresh GitHub starter

A standalone, mobile-friendly **single-event** invitation and RSVP website for GitHub Pages and Supabase. One GitHub repository and one Supabase project per event. This is a **working starter/prototype**, **not yet approved for public launch**: see `docs/SECURITY_AND_RELEASE.md`.

The source files in this archive do **not** contain guest data, invitation codes, or privileged Supabase credentials.

## Current functionality

| Area | Included |
| --- | --- |
| First-time setup wizard | Existing Supabase DB or new blank DB instructions; validates required RPCs; verifies first admin; downloads `config.js` |
| Single-event website | Name, calendar date, timezone, customizable content and language switch (FO/EN/DE) |
| Private invitation links | Compatible with `?ABCDEFGH` and `?invite=ABCDEFGH` |
| RSVP | One answer per invited guest and required session; atomic submission, replay-safe request ID, locked after submit |
| Food | List, claim/quantity update, final confirmation via database RPCs (when event is published and food is enabled for that household) |
| Administrator access | Supabase Auth login + `is_admin` authorization before any admin data is loaded |
| Admin dashboard | Household and guest overview, private link copy, food quantities, event settings, translations, sessions |
| Multiple administrators | Email invitations, pending/resend/cancel, verified acceptance and revoke (cannot remove last) |
| Publish control | Event defaults to **unpublished**; this starter does not provide a publish button |

**Household management:** create/edit households and guests, preserve invitations when moving guests, manage multiple contacts, archive/restore eligible records, and inspect append-only change history. See [Household management](docs/HOUSEHOLD_MANAGEMENT.md) for safeguards and migration order.

**Venues and schedules:** edit multiple venues, timezone-aware session start/end times, and individual invitation exceptions. See [Venues and sessions](docs/VENUES_AND_SESSIONS.md).

**Administration workflows:** manual invitation delivery tracking, reasoned RSVP corrections/reopening and household food-access controls. See [workflow guide](docs/DELIVERY_RSVP_FOOD_CONTROLS.md).

**Administrator invitations:** send, resend or cancel email invitations from Settings → Administrators. Verified recipients accept before access is granted. Requires the admin-invitations Edge Function, SMTP and allowed redirect configuration; see [Administrator invitations](docs/ADMINISTRATOR_INVITATIONS.md).

**Logs:** Settings → Logs provides searchable, filtered history across households, guests, RSVP, invitations, venues, food permissions and administrator sessions. See [Administration logs](docs/ADMINISTRATION_LOGS.md).

**Interface languages and customization:** FO/EN/DE cover the guest, administration and setup interfaces. Select a language in the toolbar; Settings → Event settings contains welcome-message editors and interface wording customization. See [Interface languages](docs/INTERFACE_LANGUAGES.md).

**Current work and optional backlog:** see [Roadmap](docs/ROADMAP.md). Automatic guest sending is an optional later decision; the manual-delivery baseline remains available. Full launch acceptance testing is still required.

**Languages:** Settings → Languages manages enabled languages, event default/fallback and translations beyond FO/EN/DE. See [Language management](docs/INTERFACE_LANGUAGES.md).

**Application backups:** Settings → Backups downloads versioned JSON and validates/restores it into an empty, unpublished destination. Auth and deployment configuration are handled separately. See [Backup and restore](docs/BACKUP_RESTORE.md).

## Install without terminal or Python

### A. Existing RSVP database (your current event)

1. Create a new, **empty** GitHub repository, e.g. `event-invitation`. Keep `Paetur/paetur.github.io` intact until migration is complete.
2. Upload **the contents** of this ZIP to that repository (including `index.html`, `setup.html`, `js/`, `css/`, `admin/`, `supabase/`). Use GitHub's **Add file → Upload files** in your browser.
3. Open **Settings → Pages** of the new repository, select *Deploy from a branch*, `main`, `/ (root)`. Wait for the GitHub Pages deployment.
4. Open `https://YOUR-USERNAME.github.io/YOUR-REPO/setup.html` and select **Use existing database**.
5. The Supabase project is `xbiklypjpnumhuohujwo`; its URL is `https://xbiklypjpnumhuohujwo.supabase.co`. Copy the **publishable or legacy anon** key from **Supabase → Project Settings → API Keys**. **Never use the secret/service_role key.**
6. Test the connection, sign in with the already-created verified administrator account, and download the generated `config.js`.
7. In the **new** GitHub repository, replace `js/config.js` with the downloaded file and commit. Only then can **other browsers** use your event website. The wizard's browser preview alone does not configure GitHub Pages for visitors.
8. Visit `admin/` in the new repository's GitHub Pages deployment to view your migrated households and adjust settings.
9. **Keep the current event unpublished** until all release checklist items pass. The former source database has already been deleted; retain current backups instead.

**Note:** GitHub's connector can inspect or update an existing repository, but cannot create a new repository through the currently connected tools. Creating the empty GitHub repository in GitHub's web UI is a one-time step. Once it exists, the files can also be committed through a connected GitHub workflow.

### B. New blank Supabase database

1. Create a new Supabase project from the dashboard (each event must have its own Supabase database).
2. Open **SQL Editor** and run `supabase/install.sql` (one consolidated file), **or** `supabase/migrations/001...008` in order. These were authored as starter migrations and need separate validation in a disposable project before production reuse.
3. Go to **Authentication → Users**, add your own account and complete email verification.
4. Open `setup.html`, choose **Set up a new database**, enter the project's URL and publishable key, and test the connection.
5. The setup wizard will generate first-admin SQL for your verified email. Run it in **Supabase SQL Editor**, not in the public website. No unauthenticated user can self-claim admin through the website.
6. Sign in through the setup wizard, download `config.js`, and commit it into `js/config.js` in the new repository.
7. Sign in at `admin/` to configure the event. Invite further verified Auth users through the Supabase dashboard, then grant admin access in **Administrators**.
8. In Households, enable Edit mode to create households and guests. Create venues and sessions in Settings, then assign household defaults and guest exceptions in Manage Invites before distributing links.

**New database installer and live database:** The installer includes the pre-existing draft migrations 001–004. The live wedding project was originally migrated with equivalent but not always identical SQL; migrations 005–008 reflect later additions. The install file is **not a database backup** and does **not** copy wedding guest data.

## Structure

```text
index.html             Public invitation experience
setup.html             First-time wizard (new/existing database)
admin/index.html       Private administration dashboard
js/config.js           Blank public-only Supabase configuration
js/core.js             Client, validation, URL helpers
js/guest.js            Invitation + RSVP + food UI
js/admin.js            Admin login, dashboard, membership and event settings
js/setup.js            Step-by-step setup workflow
css/app.css            Responsive styles
supabase/install.sql   Consolidated SQL Editor install (new databases only)
supabase/migrations/   Individual numbered migrations
docs/                  Security / release checklist
```

## Important limitations of GitHub Pages

GitHub Pages is static hosting. A public page can **never** safely run arbitrary SQL, create PostgreSQL databases, call privileged Auth admin endpoints, or store a `service_role` key. Therefore:

- Database creation and migrations happen privately through Supabase SQL Editor.
- First administrator bootstrap is executed privately in SQL Editor, after their Auth account has been verified.
- The website uses the project's **publishable / anon key** and explicitly scoped server-side RPCs.
- The wizard downloads a `config.js` file that must be committed to the new repo for visitors; saving connection settings in local browser storage is for preview only.
- Administrator invitation emails are sent server-side by the `admin-invitations` Edge Function; its SMTP and redirect setup is documented above.

## Original project

Original website source is at `https://github.com/Paetur/paetur.github.io`. The new starter is a separate codebase; it does not modify or delete the original repository. Those original migration counts are historical, not a fresh verification of current records. The former source database has since been deleted. Keep the current event **unpublished** and retain tested backups of it.


## Guest Edge gateway (required for newly created projects)

The guest-facing app calls `supabase/functions/guest-gateway/index.ts` using the Supabase JS Functions API. Direct public RPC execution is **revoked** by migration 012, so deploying the Edge Function is mandatory; the website will not accept guest RSVPs without it.

- Apply `supabase/install.sql`, including migration 012, in a fresh database.
- Deploy `guest-gateway` with `verify_jwt=false` as specified in `supabase/config.toml`. This function validates requests itself, rate-limits by IP, code and a global ceiling, and uses a **server-only** Supabase service role key supplied by the Edge runtime.
- For another event/domain, change `allowedOrigin` in the function to that website's actual HTTPS origin.
- Never put a secret or service-role key in `js/config.js`. It must contain only a public publishable key.
- Verify direct REST calls to `get_invitation_v2`, `get_household_food`, `set_household_food_claim`, `confirm_household_food` and `submit_household_rsvp` are denied for both `anon` and `authenticated`.
- Run the GitHub Actions Chromium smoke test and verify the deployed Edge Function responds as expected.

**Supabase Auth:** Leaked-password protection is configured in the dashboard under Authentication → Providers → Email, not through this repository. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).


