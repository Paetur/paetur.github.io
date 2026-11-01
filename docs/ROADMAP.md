# Current work and optional backlog

Updated 1 November 2026. The former source database has been deleted. Implementation is authorized; the historical read-only planning restriction no longer applies. Use only the designated current project. Keep the event unpublished until explicit launch approval.

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
