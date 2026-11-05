# Food, language and task workflows

## Food administration

Food categories retain their configured order. Empty read-only comments are omitted; present User and Admin Comments sit side by side on wider screens. Empty comment inputs remain available in Edit mode so comments can be added. Each item is one expandable row: its name, claimed/total amount and whether it is shown as an available guest option. Expand it for the public User Comment, private Admin Comment and editing controls. The editor has one source name, amount and the two comments; localized names and User Comments are edited in Language → Food. Existing localized text and claims are retained.

An item is available when it is active and its amount exceeds the claimed total. Fully claimed items remain editable in administration. Increase the amount to offer more units; capacity updates cannot reduce the amount below existing claims. Archived items must also be reactivated. Existing claims are never deleted by an item edit.

Guests see item names without numerical amounts. Expand an item to see its User Comment and pick one unit. The selected item remains visible to its household, with Remove selection available until confirmation. Other households lose the option only once all units are claimed. The server serializes competing picks and rejects over-capacity requests. The page refreshes food availability every 30 seconds while visible and when focus returns; a stale pick is rejected and the list refreshed. Confirmation locks the household’s selections.

Admin Comments are stored separately and omitted from the guest RPC projection. They are not translation keys and are never rendered by the guest interface.

## Language locations

- Settings → Languages: enabled languages, ordering, default/fallback languages, event welcome messages and interface wording. Enabled-language rows are compact and collapsible.
- Language beside Food: categorized translations for food names/User Comments, venue messages and session names, with a text search.

The old event-settings editors are hidden in favor of the managed translation editor. Changing wording does not publish the event.

## Other

Other sits immediately after Food. It combines the former Things to do and Stuff to bring records under categories. Each line contains Item, Comment, Assigned to and Status. Main Edit enables the pencil at the end of a line; the pencil unlocks that line and becomes its Save control. Edits stay local until that line is saved. Escape cancels the current line draft. New entries use stable UUIDs so retrying an uncertain create response cannot duplicate them. Existing row edits reject stale timestamps.

Add category creates a group. Choose a category and select Add item for a new line. The category can also be changed while editing an existing line. Original task due dates and stuff-to-bring quantities remain in the database, although they are not among the four visible boxes. Original statuses, comments, assignments, source IDs and timestamps are retained during migration.

The canonical tables are `other_categories` and `other_items`. The task table is renamed into the canonical item table; stuff rows are copied into it, preserving source IDs even if IDs overlap across the two old lists. The former stuff table is retained as a sealed migration archive. Security-invoker compatibility views retain old read names, and the old task-save RPC routes writes into the canonical list during rollout. Application backups include the canonical categories/items, not compatibility views or the redundant archive. Fresh empty installs have no seeded Other categories, allowing empty-destination restore; migrated source lists create their own categories.

## Deployment

Apply the additive food-comment/capacity and administrator-task-sheet migrations before deploying this frontend. The fresh-project installer includes both. Keep the current event unpublished. Backups taken after these migrations include the private food comment automatically; application imports still require an exact matching schema.

## Recipes

Add or edit the recipe on the food item itself. Guests can expand the ingredient list and instructions and use **Print / Save as PDF**. In Edit mode, use Allow food in Household details to grant access. Set a household's selection and quantity under the food item. A quantity of zero removes an existing selection. The household must have food access, and confirmed selections stay locked. Existing reservations convert to one unit unless the household already selected the item.

Deploy the frontend that removes the legacy recipe-group lookup before applying the legacy-table cleanup migration. The migration stops if the recipe-group table contains rows or the bring-list archive has records missing from Other. Backups and restores use the matching application schema.

Dish editing places Name and Quantity side by side, followed by User Comment and Admin Comment side by side.

## Compact controls

Food has Expand all and Collapse all controls for category disclosures only. Recipe and item expansion states are left untouched. Saved disclosure state is retained across refreshes. Creation forms are separate from these controls.

The top language control is a globe icon with a pop-up, styled like Appearance. Enabled languages and the existing unsaved-change confirmation remain available. Food items and recipes use a move icon to open their category selector. Pop-ups close on Escape, outside clicks, scrolling or resizing, and avoid being clipped by the food hierarchy.
