# Administrator invitations

Settings → Administrators → Edit → Invite administrator sends an invitation to a typed email address and display name. Existing administrators remain listed above pending invitations. Resend and Cancel are available in Edit mode. Cancelling stops acceptance; it does not delete an Auth account or revoke unrelated access.

New accounts receive a Supabase Auth invitation. Existing confirmed accounts receive a sign-in email with account creation disabled. After email verification/sign-in, the recipient sees an explicit acceptance screen before any event tables load. Accounts without a password set and confirm a password of at least 12 characters; existing password accounts keep their password. Acceptance checks the account's current, verified email in Auth, its live session, the pending invitation and a still-authorized inviter. No user-editable profile metadata grants access. The app grants membership only after acceptance.

Invitations expire after seven days; the Supabase email sign-in link has its own shorter configured expiry. Resend renews the invitation. Sending is limited to ten requests per administrator per hour and thirty globally, with a one-minute resend cooldown and a two-minute in-flight guard. An attempt identifier prevents stale completion callbacks from changing newer, cancelled or accepted invitations. Timeouts require an explicit retry; the app never automatically retries an email send.

Pending cards distinguish awaiting acceptance, email failure, sending/uncertain status and expiry. A successful send means the Auth email service accepted the request; inbox delivery, read receipts and bounce tracking are not provided. Failed/uncertain sends never grant membership. Settings → Logs → Administrators includes email requests/results, cancellation and acceptance alongside existing membership changes. Logs store no sign-in URLs, passwords or access tokens.

## Deployment

1. Apply `20261031230121_administrator_invitations.sql` to the authorized project (`xbiklypjpnumhuohujwo`). The consolidated installer includes it for new projects.
2. Deploy `supabase/functions/admin-invitations/` with `verify_jwt=false`. The function verifies the caller with Auth `getUser`; reservation and rate limits execute with the caller's JWT and require active administrator membership and a real Auth session. Service credentials exist only in Edge runtime environment variables. `admin_finish_invitation` is service-role only. Invitation tables and audit history deny direct client access.
3. Add the exact redirect `https://paetur.github.io/admin/?admin-invitation=1` to Supabase Authentication → URL Configuration → Redirect URLs. Review Site URL and the Invite user/Magic link email templates: they must retain the supplied confirmation link and redirect. Configure custom SMTP to send beyond Supabase's default team-address restrictions. No SMTP credentials are stored in this repository.
4. Deploy the frontend assets together. This does not publish the event.
5. With an explicitly chosen test recipient, verify a real email, link redirect, password setup, acceptance and later password login. Do not send to real recipients as an automated test. Check cancellation, expiration and existing-account sign-in too.

Supabase references: [inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [email sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Validation

`node tests/admin-invitations.cjs` uses disposable PostgreSQL and a synthetic email adapter. It covers direct-table/function denials, missing/revoked sessions, recipient mismatch, unconfirmed email, expiry, resend cooldown/attempt races, cancellation, revoked inviters, hourly caps, audit integrity and unchanged publication. Adapter tests cover forged origins, missing authentication, disallowed request fields, membership denial, new-account invite versus existing-account sign-in, SMTP errors and server-fixed redirects.

`node tests/admin-layout.cjs` exercises the form, pending cards, resend/cancel, error feedback, mobile overflow and acceptance before event-data loading. It captures desktop/mobile previews with synthetic data. Live SMTP configuration and inbox delivery are a separate acceptance step.
