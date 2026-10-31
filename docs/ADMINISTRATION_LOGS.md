# Administration logs

Settings → Logs brings existing management, RSVP, delivery, venue/session and administrator-membership history into one read-only view. The former Change history, RSVP history and Delivery history panels are removed from individual records. Delivery log remains in Manage Invites as the operational sending queue.

Search matches household/guest names, administrators, actions and recorded details. Category and action filters work together, with actions populated from recorded events. Inclusive date selections use the event timezone. Entries display local date/time with seconds; expand one for its UTC timestamp, stable reference, and changed fields or reason. Pages contain 50 entries and load older records using a timestamp/key cursor. Filters are applied on the server, not to a truncated browser-only list.

Categories include households, guests, contacts, RSVP, invitations, login, venues, sessions, food access and administrators. Household creation/update/movement/archive/restore are distinct actions. Permanent deletion remains unavailable. RSVP submission, per-guest correction, reopening, late permissions and invitation assignments are recorded separately. Invitation preparation/sending history and successful invitation openings are included.

New invitation-open records begin with this deployment. An opening means a valid published invitation was loaded, not that an email was read. Repeated loads for the same household within 15 minutes are grouped. No invitation code, IP address or access token is stored in these opening records. Unpublished, invalid and archived invitations do not create an opening.

Login combines available Auth service audit records with verified app session records. The active project had no stored Auth audit rows when implemented; missing history is not reconstructed. A sign-in session is recorded only when its signed JWT session claim matches that user's actual Auth session. Reopening the app in the same session does not create duplicate logins. Sign-out requests are explicitly labelled as requests; they do not assert that all access tokens were revoked. Provider-side failed-login records appear only if available in the Auth audit table. Client-reported failed credentials are not fabricated as authoritative audit events.

All log access requires a signed-in administrator through the guarded RPC. New session/opening tables deny direct client reads/writes and are append-only. Public users cannot query logs or forge session events. Native Auth payloads are reduced to action/provider metadata; tokens and IP addresses are not exposed. The gateway uses a service-only transactional invitation lookup to record valid openings.

Apply `20261031212201_unified_administration_logs.sql` before deploying the updated guest-gateway and UI. No existing audit rows are deleted, and the migration does not publish the event. Existing histories start at their original capture dates; new events start going forward.
