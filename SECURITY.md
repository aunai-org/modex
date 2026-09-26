# Security

## Reporting

This is a small open-source site. Report vulnerabilities privately to the maintainers. Do not publish exploit details in a public issue. Include the URL, what you did, and impact. Do not send credentials.

## Model

- The site has no accounts, uploads, or secrets.
- The browser loads only files from its own origin: `/catalog.json` in static mode, `/api/catalog` in function mode.
- Only the build (static mode) or the Pages Function (function mode) contacts models.dev, at two fixed URLs: `models.json` and `api.json`.
- Catalog text is rendered as text. Docs links must start with `https://`.
- Responses are size-capped and field-limited. Upstream errors are not forwarded verbatim.
- `public/_headers` keeps scripts, styles, and fonts on this origin.

A pin is an approximate headquarters from `src/places.ts`, not a location published by models.dev.
