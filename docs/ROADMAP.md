# Current work and optional backlog

Updated 2 November 2026. The former source database has been deleted. Implementation is authorized; the historical read-only planning restriction no longer applies. Use only the designated current project. Keep the event unpublished until explicit launch approval.

## Selected for implementation

- [x] Configurable fallback language and broader language management (implementation and automated tests; deployment/acceptance tracked below).
- [x] Structured application backup, export/import and tested restoration in disposable databases (live recovery acceptance remains below).

## Implemented baseline

- [x] Household/guest creation, profile editing, moves, nesting and archive/restore.
- [x] Multiple household contacts and guest-linked contacts.
- [x] Venue/session management and invitation defaults/exceptions.
- [x] Atomic household RSVP, required-answer checks, locking, audited corrections/reopening and late-response permissions.
- [x] Food/category management, claims, confirmation and household food access.
- [x] Manual invitation delivery drafts/queues, sending confirmation and history.
- [x] Administrator authentication, verified in-app administrator invitations and membership controls.
- [x] Unified administration logs.
- [x] FO/EN/DE interface translation, wording customization and welcome-message editors.
- [x] Compact hierarchy/disclosure layouts, appearance preferences and browser/database regression checks.

## Implemented for next release

- [x] Unified categorized Other list for tasks and stuff to bring, four-box lines with per-row pencil/save, and preservation of original metadata.
- [x] Category-only Food expansion and conditional side-by-side comment displays.

- [x] Food expansion controls, compact language/category pop-ups, and local task drafts with main Edit and explicit changed-row Save.

- [x] Compact Food rows, guest one-unit picks with capacity-based hiding, and separate public/private comments.
- [x] Categorized content translations and consolidated settings language controls.
- [x] Administrator Things to do spreadsheet (Task / Comment / Assigned to / Status); guest task workflows remain optional.

- [x] Device-based email, SMS/Messages and WhatsApp invitations with administrator-initiated reminder drafts and existing manual sent history. Actual iPad/account handoff acceptance remains required; no background sending or automatic delivery/read receipts.

- [x] Recipe groups containing existing and/or newly created food items, with category assignment and backup/restore coverage.

## Optional features — decide later

These are candidates, not commitments or launch blockers by default.

- [ ] Household-wide RSVP answer defaults with per-guest overrides.
- [ ] Pre-submission review/confirmation of all RSVP answers.
- [ ] Reusable multilingual invitation-template editor.
- [ ] Automatic guest invitation sending, reminders and provider delivery tracking. The original baseline specifies manual sending; automation is a later option. Administrator invitation emails are separate.
- [ ] Broader food/contribution/task feature switches.
- [ ] Guest and administrator workflows for stuff-to-bring and things-to-do.
- [ ] Additional food/category improvements following user review.
- [ ] Further generalization of wedding-specific grouping assumptions for other event types.

## Operational acceptance — still required

- [ ] Verify the latest deployment and actual-device spacing/language behavior.
- [ ] Controlled guest RSVP and food journeys, including competing requests and deadline/lock cases.
- [ ] Password reset/recovery, keyboard access and accessibility acceptance.
- [ ] Review actual venue/session assignments, contacts, invitation links, event content and translations.
- [ ] Establish retained backups and rehearse recovery from the current database; the deleted source is not a rollback option.
- [ ] Validate the consolidated installer and migration/permission parity in a disposable environment.
- [ ] Complete documentation reconciliation and explicit launch approval.

Historical counts are not current verification. Do not mark a feature as accepted merely because it is implemented or automated tests pass.
