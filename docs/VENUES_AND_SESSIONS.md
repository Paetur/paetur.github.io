# Venues, schedules and invitations

Enable Edit mode in Administration. Under Settings → Venues, add or edit the venue name, country, address, timezone, HTTPS map link and guest notes. Use `Atlantic/Faroe` for the Faroe Islands and `Europe/Berlin` for Germany.

Under Settings → Sessions & scheduling, create or edit each part of the event. Choose its venue, local start/end times, display order, active status and whether it requires an RSVP. Times are stored as UTC instants and displayed in the venue timezone. Ambiguous or nonexistent clock-change times are rejected. Changing the selected venue retains typed local times; review them before saving.

Under Manage Invites → Session invitations, choose each household’s default for each session. Each guest can follow that default, be explicitly invited, or explicitly excluded. Language and family side do not determine invitations: anyone may be invited to either country or both. Save all assignments together. Guest pages display only invited sessions with venue details and local times.

Households with RSVP history cannot have invitation eligibility changed. Session names, scheduling and venue details remain editable and audited; eligibility changes are protected once responses exist. Archive a venue only after moving or deactivating its active sessions. Hard deletion remains unavailable.

Apply `20261031003119_venues_and_session_invitations.sql` after earlier migrations and before deploying this UI. Existing locations inherit the event timezone; review it when editing. No real venues, dates or invitations are seeded, and publishing is not changed.
