# Application backups and restoration

The former source database has been deleted. Recovery must use retained snapshots of the current application; the old database is not a fallback.

## What is included

Settings → Backups downloads a versioned JSON application backup. The snapshot contains event settings, languages/translations, venues/sessions, households/guests/contacts, nested relationships, invitation defaults/exceptions, food/categories/claims/locks, stuff-to-bring, tasks, message templates, manual sending queues/deliveries, immutable RSVP submissions/corrections, management/configuration/access/membership/invitation audit records, previous restore audit records and the private invitation-code registry (including retired codes).

The snapshot is read in one stable database statement. It includes an exact table/column/type manifest, row counts, a schema contract version, creation time and a SHA-256 checksum over PostgreSQL's canonical JSON representation. Bigint columns are exported as strings to preserve IDs beyond JavaScript's safe integer range. The checksum detects damage; it does not authenticate a file supplied by an untrusted person.

Files contain personal information and bearer invitation codes. Keep them privately in protected storage. Do not commit backups to the public repository. No file is saved to browser local storage or uploaded to an outside service. Export is limited to snapshots that can fit within the 20 MB import limit.

## What is separate

This is not a complete Supabase infrastructure or Auth backup. Password hashes, Auth identities, sessions, secrets, SMTP/redirect settings, Edge Function deployments, API keys and rate-limit counters are excluded. The file includes source administrator metadata and historical sign-in logs as reference information, but does not import administrator memberships or sign-in sessions/logs into the destination. Retain the repository and deployment configuration separately, and keep managed database backups for infrastructure-level recovery where available.

Only Auth UUID/email metadata for referenced actors and current administrators is included. No password or token is exported. Historical actors with Auth foreign keys must exist as verified accounts at the destination; restoration maps their UUIDs by their original email addresses. It never creates Auth users or grants access. Embedded historical JSON retains its original provenance; mapped relational actor IDs are reported in the restore result. Membership audit IDs without an available mapping remain historical IDs.

## Rehearsing and restoring

1. Install the same reviewed migration set into a separate, empty destination. Configure its project URL/public key in a separate local preview or deployment; do not repoint the current event as part of a rehearsal.
2. Provision and verify the required Auth accounts using Supabase Auth and establish a destination administrator independently. Existing destination administrator memberships and its sign-in logs remain in place.
3. Sign in, open Settings → Backups, and select the JSON file. Validation verifies the checksum, exact schema, row counts and field sets.
4. Validate backup rehearses the actual import inside a subtransaction and deliberately rolls it back. This checks types, foreign keys, uniqueness, hierarchy cycles, invitation-code registry consistency, food capacity, languages and identity mapping. Neither imported records, trigger changes nor sequence restarts survive the rehearsal.
5. A populated destination is refused. Only the initial event settings/language seed configuration may be replaced; all backed-up application tables, including private retired-code records, must be empty. Publication must already be off. There is no merge, overwrite or deletion mode for a populated event.
6. In Edit mode, acknowledge the scope and type `RESTORE ` followed by the source event name exactly. The server revalidates and rechecks emptiness under locks; the preview alone never authorizes a later import.
7. Import restores all application rows atomically. It preserves UUIDs, codes, hierarchy, submission locks and history. Only application triggers are suspended during insertion; foreign keys, CHECK and uniqueness constraints remain enabled. Application triggers are re-enabled before commit and hierarchy/language guards are run again. Identity sequences restart transactionally above restored IDs.
8. The restored event is always unpublished. Pending administrator invitations are cancelled and their attempt IDs expired/replaced; they must be issued again deliberately. Administrator memberships are not restored. A new immutable restore audit records the actor, source checksum, source time and source row counts.
9. Verify counts and representative locked RSVPs, food confirmations, nested households, retired codes and translations in the destination. Review administrators and deployment settings separately. Keep the source snapshot and the rehearsal record before approving any cutover.

Malformed files, schema differences, missing verified historical actors, existing data, failed constraints or a failed confirmation abort the operation. Full PostgreSQL transactions protect against partial restore. Restore never automatically sends messages or publishes an event. If a request times out, inspect the destination and restore audit before retrying; a completed restore makes subsequent imports fail the empty-destination check.

## Current verification

`tests/languages-backup-db.cjs` performs a real synthetic export/rehearsal/restore between two disposable PostgreSQL databases, with different Auth UUIDs for the same verified administrator email. It verifies table round trips, nested households, locked RSVP snapshots, confirmed food claims, contributions/tasks, immutable history, retired-code records, IDs larger than JavaScript's safe integer limit, damaged/unknown files, cycle rejection, missing identities, rollback and non-overwrite behavior. The destination remains unpublished and administrator access is not imported.

`tests/languages-backup-browser.cjs` checks downloads, file parsing, preview gating, acknowledgment and exact confirmation in Chromium and WebKit. These are automated application recovery tests, not a completed live recovery rehearsal. Retain multiple current-event snapshots and record an independent fresh-destination acceptance rehearsal before launch. No production restore is run as part of development tests.
