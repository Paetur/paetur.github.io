# Interface languages and customization

The guest, administration and setup pages share `js/translations.js`, with English source phrases and Faroese/German translations. Static labels, hints, accessibility labels, appearance controls, confirmation dialogs, validation and dynamic administrative summaries use the catalog. Technical identifiers, Supabase dashboard navigation, provider/database diagnostics and user-entered data remain as supplied.

## Language preferences

- Administration and setup have a compact FO/EN/DE selector in the top bar. The selection is saved in this browser. Switching languages reloads the page; a confirmation protects unsaved form input.
- Guest pages use their existing language buttons. A saved visitor preference takes precedence; otherwise the household language, then event default, selects the language. Switching retains checked RSVP answers.
- Language selection never changes household languages, invitation assignments or publication state.
- Dates use the selected interface language; venue-local session timezones remain authoritative.

## Welcome messages

In Settings → Event settings, enter Edit mode to save the Faroese, English and German welcome messages. They are written together to the existing `event_content` table with `content_key='welcome'`. A blank welcome uses the built-in welcome for that language. Venue-specific welcome messages remain in the venue editor.

This uses existing administrator-only SELECT/INSERT/UPDATE RLS policies. No migration, Edge Function deployment or publication change is needed. Changes become visible to invited guests when the event is eventually published.

## Custom interface wording

Settings → Event settings → Customize interface wording lets an administrator choose an English source phrase, a language and replacement wording. Apply wording previews the selected phrase. Download wording file exports all currently applied overrides as `interface-overrides.js`.

Commit that file at `js/interface-overrides.js` in the repository, using the normal pull request/deployment workflow. It is loaded by all three interfaces. Downloaded wording is public; do not include private data. The editor does not automatically commit or deploy the file. Reopen the editor from the current deployment before making additional changes so the download includes the latest overrides.

Placeholders such as `{count}`, `{time}` and `{item}` must be preserved. Blank wording restores the built-in translation. Overrides are plain text, with a 12,000-character limit; HTML is never interpreted. Unknown phrases, unsupported languages and invalid placeholder sets are ignored when loading an override file. Interface overrides are independent of guest names, venue names, food labels, invitation messages and event data.

## Validation

`node tests/interface-localization.cjs` checks all catalog translations and placeholder sets, then exercises FO/EN/DE guest, administrator and setup pages in Chromium and WebKit at mobile width. It checks administrator welcome saves, unpublished-state preservation, customization escaping/export, placeholder rejection, guest language preferences, localized food actions and retained RSVP answers. It uses only synthetic data.

Run the existing authentication, administrator invitation, timezone and layout regressions as well. The GitHub Actions workflow runs the browser checks before release. Language review by native speakers remains part of launch acceptance, especially for event-specific wording entered by administrators.
