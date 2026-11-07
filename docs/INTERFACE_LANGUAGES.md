# Languages, fallback and translations

## Repository catalogs

The implementation uses `locales/{language}/interface.json`, `food.json` and `types.json`, initially for English (`en`), Faroese (`fo`) and German (`de`). English defines the keys and source wording. Catalogs use nested objects. For example, `RSVP_I18N.t('interface.messages.save')` looks up the Save label.

Keep keys stable when changing wording. All maintained language directories carry the same leaf keys as English. Blank translated values use the fallback. Preserve interpolation placeholders such as `{item}` and `{count}`. Catalog output is plain text.

Run these checks from the repository root after editing catalogs.

```sh
node tools/validate-locales.cjs
```

`locales/aliases.json` maps existing English phrase calls and static HTML to stable catalog keys. When adding a phrase, add its English source/key mapping and the same key to every maintained catalog. If the English source changes, update the alias source while retaining its key. Regenerate the English compatibility manifest with `node tools/validate-locales.cjs --generate`. The manifest supports existing source-phrase callers and English startup wording. It contains no Faroese or German translation values. New application calls should reference stable keys.

Catalog changes are reviewed through GitHub pull requests. Event-specific food, household and venue data must stay out of these public files. Private administrator comments are excluded.

## Loading and iPad behavior

The browser fetches language/category files in parallel and reuses one promise per language/category for the page lifetime. Normal HTTP caching reuses files between visits. Catalog URLs carry a release version in `js/i18n.js`; increment it when releasing changed catalogs. Network failures have a five-second timeout and can be retried. Missing custom-language files are remembered for the page lifetime and fall back to English or the configured intermediate fallback.

Language metadata and custom interface wording load together through the existing configuration endpoint. Content translations arrive in one batched `event_content` projection alongside the existing administration data. Guest rendering indexes content translations once. No request is made per food item or per keystroke. Translation forms save changed cells in one atomic request.

The selected language is stored in browser local storage. Guest preference takes precedence over the household language, then the event default. Changing the guest language retains checked RSVP answers. Late language responses cannot repaint over a newer selection.

## Database layout

The normalized storage is introduced by migration `20261107102351_normalized_translations.sql`. It was applied to the designated live project on 7 November 2026 before deploying the new editors. All eight historical text rows and protected-record fingerprints matched the pre-migration backup.

| Table | Content |
|---|---|
| `event_languages` | Language codes, display names, enabled state and ordering |
| `translation_overrides` | Event-specific overrides of shared JSON wording, with stable key, category and original source metadata |
| `food_item_translations` | Non-English food names and public user comments |
| `food_category_translations` | Non-English category names |
| `food_type_translations` | Non-English custom unit labels and optional plural labels |
| `venue_translations` | Non-English venue names, welcome messages and guest notes |
| `session_translations` | Non-English session names and descriptions |
| `event_translations` | Non-English event introduction and historical invitation wording |

This application has one event per database. Content rows refer to their parent record using a foreign key and have a unique parent/language combination. English stays in canonical fields, including `event_settings.introduction`. Translation rows record the last editor and update time. Administrator read policies protect the tables, and authenticated administrator RPCs validate writes and live sessions. Guests receive public translations through the existing publication-controlled endpoints.

The old physical `event_content` table is replaced by a read-only, security-invoker view. It preserves the existing `content_key / language_code / content_value` payload shape while reading normalized tables. The migration moves its supported existing rows into the new storage atomically and copies existing FO/DE food and venue translations.

Migration `20261107120915_translated_venue_editor.sql` installs the atomic venue-and-translations endpoint before the frontend release. After deployment, `20261107120916_retire_legacy_language_columns.sql` verifies parity and removes the four FO/DE food columns, two FO/DE venue columns and synchronization triggers. English source fields such as `food_items.name_en`, `description_en` and `event_locations.welcome_en` remain canonical. Compatibility food-response keys are derived from normalized rows. Older cached administrator pages must reload after this release.

Shared wording resolves through file overrides, database overrides, selected-language JSON, the configured intermediate fallback and English. Previously committed `interface-overrides.js` customizations keep their existing priority. Clearing a database override exposes catalog wording again. The configured event fallback remains available. Selecting English uses its source directly. Dates follow the selected locale and venue times follow the venue timezone.

## Editing and language management

Settings → Languages manages enabled languages, default/fallback preferences, interface wording and the event introduction. The main Languages section edits food, food types, food category names, venues and sessions. Existing all-language editors remain available. Food → item → Language opens the same item translation rows in a dialog. Cancel discards the dialog draft, failed saves retain its text, and saving preserves unfinished edits in the main food form. Type wording is shared by items using the same type. English custom-unit label overrides retain their existing `ui:Food type: …` identity.

Additional languages can be enabled without adding columns or tables. Their custom translations are entered in the application. A repository catalog is optional for these languages, and missing shared wording falls back until translations are supplied. Language codes cannot be renamed or deleted. Disabling a language retains existing translations and profile assignments.

The default and fallback must be enabled. Invitation eligibility remains independent of language. Neither translation editing nor migration publishes the event.

## Backup and verification

Application backups include the normalized physical tables, editor identities and canonical English content. The compatibility view is excluded because its data is derived. Repository JSON and the optional deployed file overrides are retained with Git history and should be included in repository backups.

Restore requires matching application migrations. Retain pre-migration backups with the corresponding repository revision. Recover an older backup into a matching disposable destination before upgrading that destination.

Validation covers JSON syntax, nested string leaves, key parity, English sources, placeholders and generated manifest consistency. Database suites verify migration preservation, stable override keys, blank deletion, atomic batch rollback, publication and administrator boundaries, plus cross-identity export/restoration. Chromium and WebKit suites cover FO/EN/DE, custom-language fallback, saved preferences, all-language editing and retained RSVP answers. An iPad-size test verifies layout and one request per language/category across repeated reads. Physical iPad/Safari acceptance remains required.

Reusable multilingual templates remain in the optional wish list for later discussion.
