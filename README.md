# RSVP Manager — Fresh GitHub starter

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
| Multiple administrators | List / add a previously invited and email-confirmed Auth user / revoke (cannot remove last) |
| Publish control | Event defaults to **unpublished**; this starter does not provide a publish button |

**Household management:** create/edit households and guests, preserve invitations when moving guests, manage multiple contacts, archive/restore eligible records, and inspect append-only change history. See [Household management](docs/HOUSEHOLD_MANAGEMENT.md) for safeguards and migration order.

**Still incomplete:** full venue/calendar UI, individual session invitation controls, manual communication queues, administrator email invitations, broader language customization, and full launch acceptance testing.

## Install without terminal or Python

### A. Existing RSVP database (your current event)

1. Create a new, **empty** GitHub repository, e.g. `rsvp-manager`. Keep `Paetur/paetur.github.io` intact until migration is complete.
2. Upload **the contents** of this ZIP to that repository (including `index.html`, `setup.html`, `js/`, `css/`, `admin/`, `supabase/`). Use GitHub's **Add file → Upload files** in your browser.
3. Open **Settings → Pages** of the new repository, select *Deploy from a branch*, `main`, `/ (root)`. Wait for the GitHub Pages deployment.
4. Open `https://YOUR-USERNAME.github.io/YOUR-REPO/setup.html` and select **Use existing database**.
5. The Supabase project is `xbiklypjpnumhuohujwo`; its URL is `https://xbiklypjpnumhuohujwo.supabase.co`. Copy the **publishable or legacy anon** key from **Supabase → Project Settings → API Keys**. **Never use the secret/service_role key.**
6. Test the connection, sign in with the already-created verified administrator account, and download the generated `config.js`.
7. In the **new** GitHub repository, replace `js/config.js` with the downloaded file and commit. Only then can **other browsers** use your event website. The wizard's browser preview alone does not configure GitHub Pages for visitors.
8. Visit `admin/` in the new repository's GitHub Pages deployment to view your migrated households and adjust settings.
9. **Do not publish or delete the original Supabase database** until all release checklist items pass.

**Note:** GitHub's connector can inspect or update an existing repository, but cannot create a new repository through the currently connected tools. Creating the empty GitHub repository in GitHub's web UI is a one-time step. Once it exists, the files can also be committed through a connected GitHub workflow.

### B. New blank Supabase database

1. Create a new Supabase project from the dashboard (each event must have its own Supabase database).
2. Open **SQL Editor** and run `supabase/install.sql` (one consolidated file), **or** `supabase/migrations/001...008` in order. These were authored as starter migrations and need separate validation in a disposable project before production reuse.
3. Go to **Authentication → Users**, add your own account and complete email verification.
4. Open `setup.html`, choose **Set up a new database**, enter the project's URL and publishable key, and test the connection.
5. The setup wizard will generate first-admin SQL for your verified email. Run it in **Supabase SQL Editor**, not in the public website. No unauthenticated user can self-claim admin through the website.
6. Sign in through the setup wizard, download `config.js`, and commit it into `js/config.js` in the new repository.
7. Sign in at `admin/` to configure the event. Invite further verified Auth users through the Supabase dashboard, then grant admin access in **Administrators**.
8. In Households, enable Edit mode to create households and guests. Assign household sessions in Settings before distributing invitation links.

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
- New admin email invitations are sent through the Supabase dashboard; adding them to the app is done in **Administrators** once they are verified.

## Original project

Original website source is at `https://github.com/Paetur/paetur.github.io`. The new starter is a separate codebase; it does not modify or delete the original repository. The existing database retains its 61 households, 104 guests, 49 food items, 2 claims, and other imported records. The new wedding event is initially **unpublished**.


## Guest Edge gateway (required for newly created projects)

The guest-facing app calls `supabase/functions/guest-gateway/index.ts` using the Supabase JS Functions API. Direct public RPC execution is **revoked** by migration 012, so deploying the Edge Function is mandatory; the website will not accept guest RSVPs without it.

- Apply `supabase/install.sql`, including migration 012, in a fresh database.
- Deploy `guest-gateway` with `verify_jwt=false` as specified in `supabase/config.toml`. This function validates requests itself, rate-limits by IP, code and a global ceiling, and uses a **server-only** Supabase service role key supplied by the Edge runtime.
- For another event/domain, change `allowedOrigin` in the function to that website's actual HTTPS origin.
- Never put a secret or service-role key in `js/config.js`. It must contain only a public publishable key.
- Verify direct REST calls to `get_invitation_v2`, `get_household_food`, `set_household_food_claim`, `confirm_household_food` and `submit_household_rsvp` are denied for both `anon` and `authenticated`.
- Run the GitHub Actions Chromium smoke test and verify the deployed Edge Function responds as expected.

**Supabase Auth:** Leaked-password protection is configured in the dashboard under Authentication → Providers → Email, not through this repository. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).


