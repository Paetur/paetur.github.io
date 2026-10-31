# Household and guest management

The Households tab supports creation, profile editing, guest creation and moves,
multiple contacts, reversible archival, and an administrator-only change history.
Use the top-header pencil to enter Edit mode. Add household is above the tree;
Add guest, Contacts and Change history are inside expanded households.

## Behaviour

- Household profile: name, side, relation group, parent, language, email, phone,
  WhatsApp, postal address, preferred contact method, and notes. Codes and UUIDs are preserved during edits. Empty households have no code. Adding the first active guest generates a code;
  removing/archiving the last withdraws it. Retired codes are reserved and never reused.
- A new household starts without session invitations. Assign them in Settings.
  A new guest inherits the household defaults.
- Parent choices stay within the same side and relation group. Cycles are rejected.
  Move children before changing a parent's grouping; no subtree is silently moved.
- Guest moves preserve current invitations for all existing sessions, including
  inactive sessions, using individual overrides. Future sessions follow the new
  household's defaults. Moves involving archived records or any RSVP history are
  blocked, including reopened households. No response or snapshot is rewritten.
- Creation of guests and guest/household archival require an open household without
  prior submissions. Guest archival is also blocked by response/audit history.
- Household archival disables invitation reads, RSVPs and food operations. Food
  claims/confirmation, active children, pending sending queues and RSVP history
  must be resolved first. Records are retained; Show archived records exposes
  Restore actions. Restore a parent before its children. Household archival does
  not independently change its guests' own archive flags.
- Contacts support name, type, details, language, preferred delivery method and
  one primary contact per type. Archiving clears the primary flag. Existing
  household email/phone remain separate legacy fields; editing them does not
  silently rewrite contacts. No messages are sent.
- Change history is append-only and administrator-only. It shows actor UUID/name,
  timestamp, entity, and before/after fields. Invitation codes are excluded.
  Guest moves appear in both households. History begins at migration installation;
  historical changes cannot be reconstructed. The interface shows the latest 100.
- Household-row locks serialize membership changes with guest submissions and food
  claims. An advisory lock serializes hierarchy/lifecycle changes. No hard delete
  action is provided.

## Installation and validation

Apply `20261030235507_household_guest_management.sql` to the active destination
project before deploying the updated UI. The installer also includes this change.
Do not run the complete installer against an existing database. The migration is
transactional, additive, and does not publish the event or modify imported profiles.
The older reference project must remain untouched.

Run `node tests/household-management-db.cjs` with pinned `@electric-sql/pglite@0.5.13`
for disposable local SQL validation. With `DATABASE_URL` and `pg@8.16.3`, the same
suite uses an empty disposable PostgreSQL database and additionally tests parallel
RSVPs, retry IDs, competing food claims, and archiving concurrent with claims.
Never point this bootstrap test at an existing project.

`node tests/admin-layout.cjs` uses mocked data to test desktop/mobile layout,
creation, editing, moves, contacts, archive/restore, and save errors. GitHub Actions
runs both suites; the production smoke suite remains read-only for real records.
Live authenticated acceptance and Safari testing remain separate release checks.

## Validation record — 31 October 2026

- Disposable local PostgreSQL: 39 lifecycle, audit, gateway and access assertions passed.
- PostgreSQL 17 in CI: 43 assertions passed, including independent concurrent requests.
- Chromium desktop/mobile workflows and deployed guest gateway smoke checks passed.
- Consolidated installer successfully applied to an empty disposable database.
- Migration applied to the active destination project. Synthetic creation, movement,
  contacts, archive/restore and audit checks passed inside a transaction ending in
  ROLLBACK. No synthetic records remain.
- Before/after hashes confirm all 61 household and 104 guest records are unchanged;
  two existing food claims remain and the event is unpublished.
- Security advisor reviewed: existing public-event/authentication advisories remain.
  New management functions require authenticated administrator authorization;
  anonymous execution is denied. Audit data has admin-only RLS and immutable history.

## Invitation navigation and appearance

Manage Invites is a separate main menu. Copy code/link actions are available only
there, and only for active households with active guests. Empty parents show the
number of descendant households and their active guests. Household details has a
read-only view and a full Edit-mode form; the row pencil opens it directly.

The application uses Administration on administrator/setup pages and Event
Invitation on the guest page. All pages follow `prefers-color-scheme` at first paint
and when the operating-system preference changes. Old manual theme preferences
are ignored. Archiving a household withdraws its code; restoring a populated one
creates a new code, so copy a fresh link in Manage Invites after restoration.
