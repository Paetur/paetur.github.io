# Delivery tracking, RSVP administration and food access

In Edit mode, Manage Invites → household → Invitation delivery lets an administrator prepare a message using a saved household contact or the household’s own details. Save a draft, mark it ready, copy its text, then send it manually. Record as sent requires explicit confirmation. The app does not send messages and does not claim recipient receipt or read status. Failed/cancelled attempts require a note; sent and cancelled records are read-only. Create a new record for a resend. Delivery log includes status filters and archived-household history.

Prepared records retain recipient snapshots. Updating a draft/ready record refreshes that snapshot. Sent records retain the exact prepared recipient and message. Review both before sending. Revision checks reject stale edits, repeated confirmation is idempotent, cross-household contacts are rejected, and retired invitation codes cannot be confirmed as current. Delivery history records the administrator and time.

Households → household → RSVP management shows current per-session responses. Corrections require a reason and retain original submission snapshots and the household’s lock state. Reopening requires a reason and lets guests submit again, but does not lift the event deadline or permit membership/invitation changes protected by history. An open household can be granted a future late-response deadline using the event timezone. Reopening clears the previous late window. RSVP history shows guest submissions and administrator actions.

Households → household → Food access allows or prevents food contribution. Every change requires a reason. Empty/archived households cannot be enabled. Disabling is blocked if food claims or a confirmed selection exist; commitments are never silently deleted. The permission change appears in Change history.

Apply `20261031101548_admin_delivery_rsvp_food_controls.sql` after earlier migrations, before deploying the interface. It changes no real delivery status, RSVP response, food permission or publication state. Existing ready records must be saved once to capture recipient details before confirmation. Legacy direct queue writes and the unchecked legacy confirmation entry point are revoked. Use guarded administrator RPCs.

Tests use disposable PostgreSQL and synthetic browser fixtures. Real communications are not sent during tests. The event remains unpublished until explicitly approved for launch.

Venue welcome messages are independently editable in Settings → Venues → each venue, in Faroese, English and German. Existing global welcome text is copied into existing venues during migration. Guests see the venue message alongside each invited session. Main-page language controls appear when an event or invitation code is present; the Admin link appears on the empty landing page.

Household saves validate the signed-in account, and retry once after refreshing the session if the server rejects the function permission. A failed refresh leaves the form intact and requests sign-in. The reported Maria account was verified as an existing confirmed administrator, with an authenticated save succeeding in a rolled-back live transaction; the reported browser failure was not reproduced server-side.
