# Food, language and task workflows

## Food administration

Food categories retain their configured order. Each item is one expandable row: its name, claimed/total amount and whether it is shown as an available guest option. Expand it for the public User Comment, private Admin Comment and editing controls. The editor has one source name, amount and the two comments; localized names and User Comments are edited in Language → Food. Existing localized text and claims are retained.

An item is available when it is active and its amount exceeds the claimed total. Fully claimed items remain editable in administration. Increase the amount to offer more units; capacity updates cannot reduce the amount below existing claims. Archived items must also be reactivated. Existing claims are never deleted by an item edit.

Guests see item names without numerical amounts. Expand an item to see its User Comment and pick one unit. The selected item remains visible to its household, with Remove selection available until confirmation. Other households lose the option only once all units are claimed. The server serializes competing picks and rejects over-capacity requests. The page refreshes food availability every 30 seconds while visible and when focus returns; a stale pick is rejected and the list refreshed. Confirmation locks the household’s selections.

Admin Comments are stored separately and omitted from the guest RPC projection. They are not translation keys and are never rendered by the guest interface.

## Language locations

- Settings → Languages: enabled languages, ordering, default/fallback languages, event welcome messages and interface wording. Enabled-language rows are compact and collapsible.
- Language beside Food: categorized translations for food names/User Comments, venue messages and session names, with a text search.

The old event-settings editors are hidden in favor of the managed translation editor. Changing wording does not publish the event.

## Things to do

The administrator task sheet has three columns: Task, Assigned to and Status (Open, In progress, Done). Select Edit, use Add rows for additional tasks, then Save. Blank new rows are ignored. Existing notes and due dates are retained although they are not shown in these three columns. There is no deletion operation.

The save RPC requires a live administrator session, validates every row and commits the sheet atomically. A changed existing row causes the whole save to fail rather than overwrite another administrator’s change. Unsaved cells remain available after errors. Reload the page to discard/reload a conflicting draft. The sheet is administrator-only; guest task assignment workflows remain a future decision.

## Deployment

Apply the additive food-comment/capacity and administrator-task-sheet migrations before deploying this frontend. The fresh-project installer includes both. Keep the current event unpublished. Backups taken after these migrations include the private food comment automatically; application imports still require an exact matching schema.
