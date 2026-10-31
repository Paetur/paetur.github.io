# Choose a guest as a contact person

In Households → Contacts → Add contact, open “Choose someone from the guest list”. Search by guest or household name. Matches show their household so similar names can be distinguished. Case, accents and common Faroese/German letter variants are normalized for matching. Up to ten matches are shown; refine the search to find another person.

Choosing a person stores an optional link to the existing guest and fills their name and language. Guests from other active households can be selected. This does not create a guest, move them or change their invitations. Phone/email/postal details remain independently entered; household contact information is not silently treated as that individual’s details. The contact label remains editable.

Existing manual contacts remain supported. Linked contacts show a Guest badge with their current guest household. Editing offers “Remove guest link”; this leaves the contact fields for manual editing and does not alter the guest. Cancel discards unsaved changes. Contact names/languages are saved values, not automatically synchronized when the guest profile later changes.

The administrator-only save RPC validates newly assigned guest links against active guests in active households. Existing links are retained if that guest is later archived, and contact details can still be maintained or unlinked. Older clients that omit the guest field preserve the existing association. A foreign key prevents dangling identities; no contact or guest is deleted. Existing contact RLS and audit rules also protect and log this field.

Apply `20261031215758_guest_linked_household_contacts.sql` before the UI update. The migration adds nullable links and does not alter existing contact values, guest data, invitations or publication state. Disposable SQL and browser tests cover cross-household selection, invalid/archived selections, link persistence/removal, search, name/language filling and mobile layout.
