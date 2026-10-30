# Security test results — 30 October 2026

**Scope:** New Supabase project `xbiklypjpnumhuohujwo` and RSVP Manager source under the GitHub Pages repository root. The original wedding database was not modified. **The event remains unpublished.**

## Verified — database role and API tests

All database behavior tests were performed inside explicit transactions that ended with `ROLLBACK`. None of the tests changed a real guest RSVP, food claim, or event publication state.

| Security check | Outcome |
| --- | --- |
| Every public table has row-level security enabled | PASS |
| Anonymous role has no direct table SELECT/INSERT/UPDATE grants | PASS |
| Unpublished event read (public event v2) is null | PASS |
| Valid invitation code cannot return guest data while unpublished | PASS — fixed in migration 011 |
| Invalid and unknown invitation codes yield no invitation data | PASS |
| Public RSVP submission denied while unpublished | PASS — fixed in migration 011 |
| Public food writes and food confirmation denied while unpublished | PASS — fixed in migration 011 |
| Published invitation (temporary, rolled back) returns authorized guest data | PASS |
| Published event data is available when temporarily enabled | PASS |
| Cross-household RSVP submission rejected | PASS |
| Incomplete RSVP submission rejected | PASS |
| Valid RSVP submission accepted in a rollback-only test | PASS |
| Retry with the same request UUID is idempotent | PASS |
| Second RSVP with a new request UUID rejected once locked | PASS |
| Unknown food invitation code returns no data | PASS |
| Excess food quantity rejected | PASS |
| Food claim cannot be edited after final confirmation | PASS |
| Non-admin authenticated role cannot read households or guests | PASS |
| Non-admin authenticated role cannot use admin-management functions | PASS |
| Final administrator cannot be removed | PASS |

## Verified — source-code checks

- `index.html` now uses `<meta name="referrer" content="no-referrer">`, preventing the invitation query from being sent as a browser Referer header.
- `js/guest.js` parses and immediately removes the query string from the address bar/history before Supabase calls.
- `js/core.js` recognizes `?=CODE`, `?CODE`, `?invite=CODE` and `?code=CODE`; generated invitations use `/?=CODE`.
- Invalid code variants are rejected by the browser pattern.
- Pages use a pinned Supabase JavaScript client dependency and do not contain direct `eval()` or client-side `innerHTML =` assignment in the reviewed invitation/admin files.
- The public `js/config.js` uses a publishable key, **not** a secret/service-role credential.

## Outstanding release blockers — NOT production-ready

1. **Rate limiting and automated abuse mitigation:** Public, invitation-code-based `SECURITY DEFINER` RPCs still support anonymous calls, by design, and have no verified per-source rate limiter. Add a protected edge/API layer or equivalent throttling and ensure direct PostgREST RPC access cannot bypass it. Supabase's internal Edge Function chaining limits do not provide inbound rate limiting.
2. **Real browser / network tests:** GitHub Pages home/admin URLs could not be fetched in the current test environment. Verify in Chrome/Safari/Firefox on desktop and mobile: first load, language selection, `/?=CODE`, login, logout, expired/reset passwords, View/Edit, RSVP, food, admin sessions, refresh, cache, and referrer headers.
3. **Concurrent request/load tests:** Two concurrent RSVP submissions and simultaneous food claims were not exercised with separate external HTTP clients. They require integration tests and review of row locks.
4. **Authentication:** Supabase advisor reports leaked-password protection disabled. Enable in Supabase Auth settings and test sign-in/reset.
5. **New empty database installation:** Consolidated SQL installer now includes migrations 009–011 but has not been tested in a disposable newly created project. Confirm schema and permission parity before declaring the generic installer ready.
6. **End-to-end capability review:** Audit all privileged RPCs, invitation-code handling, optional guest flows, household contact/communication features, and time-based policy behavior against real HTTP clients.
7. **Release decision:** Have an administrator confirm the test checklist before choosing **Settings → Event settings → Edit → Publish event**.

## Supabase Security Advisor interpretation

- `public.admins`: RLS enabled, no direct read policy. Intentional: membership is accessed via guarded functions only.
- Public `SECURITY DEFINER` RPCs: warnings remain because capability-code endpoints must be callable by guests; warnings are **not** a security clearance. Guard logic was reviewed and publication checks were added; request throttling is still required.
- Leaked password protection: advisor warning remains and requires Supabase Auth configuration.

**Conclusion:** Database-role and transactional tests passed after publication-guard remediation. **Do not publish** until rate limiting and live HTTP/browser tests are complete.

## Follow-up: throttled guest gateway

- Edge Function `guest-gateway` deployed with an allowlist of five guest operations and server-only service-role credentials.
- Migration 012 removed anon/authenticated EXECUTE on those RPCs; direct REST bypass denied.
- Database limiter rejects request 21 to the same fabricated invite code inside a rollback test.
- Live GitHub Actions Chromium smoke workflow covers guest URL hygiene, mobile viewport, admin login screen and external API behavior.
- **Auth leaked-password protection still requires enabling in Supabase Auth dashboard.** Browser tests requiring real admin login and valid invite codes remain manual.
