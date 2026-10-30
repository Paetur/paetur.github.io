# RSVP Manager — release checklist

**Current release status: NOT APPROVED FOR PUBLICATION.** The event is still unpublished.

See [Security test results (30 October 2026)](SECURITY_TEST_RESULTS_2026-10-30.md) for verified database role, invitation-code, RSVP, and food tests and their rollback methodology.

## Remediated and verified

- Migration **011** prevents anonymous invitation lookup and all public RSVP/food writes while the event is unpublished.
- All public tables have RLS; anonymous roles lack direct read and write table grants.
- Published-state invitation, isolation, RSVP completeness/idempotency, food quantity/confirmation and last-admin checks passed in rolled-back database transactions.
- Invite links use `/?=CODE` and are also accepted as `?CODE`, `?invite=CODE` and `?code=CODE`.
- Guest pages use `no-referrer`; the invitation code is cleared from the browser URL before the Supabase request.
- The existing destination records remain intact.

## Required before launch

1. **Gateway protection deployed:** Edge Function and atomic SQL limiter added; direct PostgREST calls to guest RPCs are denied. Confirm live rate-limit smoke test and monitor logs.
2. **Run actual browser and HTTP tests**, including guest links, HTTPS/referrer behavior, admin login/logout, mobile and accessibility checks.
3. **Test concurrent requests** for duplicate RSVP and food quantity contention with independent connections.
4. Enable **Supabase Auth leaked-password protection**. See the security advisor and [Supabase Auth password guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
5. Test the **consolidated installer** (`supabase/install.sql`, including migrations 009–011) in a disposable blank Supabase project.
6. Review remaining administrative CRUD, invitation delivery, session override, audit and guest capability controls. Do not assume a successful database test validates unrelated unfinished UI.
7. Obtain a full destination backup and verify against the original dataset. Do not delete the original database.
8. Have an administrator review the results before publication.

## Publishing

The admin interface provides **Settings → Event settings → Edit → Publish event** with readiness checks and an acknowledgement. That acknowledgement is not an automated security audit.

**Do not click Publish while the above blockers remain.** GitHub Pages deployment and Supabase event publication are separate: the static website can be online while `is_published=false`.

## Administrator setup

The initial account must be verified in Supabase Auth and provisioned as an admin in the SQL Editor. Subsequent administrators are invited through the Supabase dashboard and granted access via guarded admin RPCs. No browser `service_role` key is allowed, and the last administrator cannot be removed.

## Known warnings

Security advisors flag `SECURITY DEFINER` functions that are callable by guest and authenticated roles. Some are intended capability-code entrypoints and others require a signed-in administrator; guard logic and abuse controls must be reviewed, not ignored. The `admins` table has no direct read policy by design.

## Gateway protection

Migration 012 and the deployed `guest-gateway` now enforce code/IP/global throttling and prevent direct anonymous guest RPC bypass. A live GitHub Actions Chromium smoke workflow tests this connection and should be green before publication. Remaining browser scenarios requiring real admin credentials or existing valid invitation codes require a controlled manual test.
