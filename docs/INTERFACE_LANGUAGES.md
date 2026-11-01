# Languages, fallback and translations

Settings → Languages supports adding language codes (for example `sv` or `pt-BR`), choosing display names/order, enabling/disabling languages and selecting separate event default and fallback languages. English is the final built-in fallback for interface phrases. Language codes use canonical BCP-47-style tags, up to 16 characters; the interface validates their structure with Intl.

The selected language wins. Missing interface text follows selected language → configured fallback → English source. Missing event/venue/food/session translations follow the same language chain, then the existing canonical session name or generic label where appropriate. Selecting English uses the English source directly, not another language's translation.

FO/EN/DE remain bundled translations. Additional languages are editable translations, not automatically generated translations. Until their texts are entered, the configured fallback appears. Dates use the selected locale; venue-local timezones remain authoritative.

The default and fallback must be enabled; they cannot be disabled until replacement choices are saved. Disabling a language hides it from visitor selectors and new assignments but retains its translations and existing household/guest/contact values. Codes cannot be renamed or deleted. Existing profiles can retain their disabled language while other fields are edited. Guest invitation eligibility is independent of language.

Administration and setup use a browser language preference. Guest preferences take precedence over the household language, then the event default. Guest language buttons preserve checked RSVP answers. The language configuration endpoint exposes only enabled language metadata and public interface phrases while the event is unpublished; invitation details and event content remain behind the publication gate.

## Translation editing

The Languages translation editor covers interface phrases, event introductions, venue welcomes, session names, food names and descriptions. Blank text removes the translation and uses the fallback. Placeholder sets such as `{item}` and `{count}` must be preserved; the database validates them. All output is plain text.

FO/EN/DE venue welcomes and food labels continue to use their existing columns, so the existing venue/food editors and the translation editor edit the same values. Additional languages and per-language session names use `event_content`. Event introductions use its `welcome` key. Additional languages can also be assigned to households, guests and contacts.

The existing Event settings welcome editors and interface wording preview remain available. Applying interface wording now saves it in the database. Downloading `interface-overrides.js` is an optional file-based customization mechanism; previously committed overrides retain precedence over database/bundled text. Remove an old file override if you want the database editor to control that phrase. Keep `{placeholders}` intact.

Language preferences, profiles and translations are part of application backups. Source code and an optional deployed interface-overrides.js file are backed up separately with the repository. None of these operations changes event publication.

## Validation

The browser suites cover FO/EN/DE, adding Swedish, selector updates, saved language preferences, German fallback for missing Swedish text, English source precedence, protected default/fallback disabling, translation persistence and backup/import screens. Database tests cover enabled-language assignment, placeholders, authorization and restoration. Native-speaker review remains part of acceptance for administrator-entered translations.
