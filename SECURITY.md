# Security

## Reporting

This is a small open-source site. Report vulnerabilities privately to the maintainers. Do not publish exploit details in a public issue. Include the URL, what you did, and impact. Do not send credentials.

## Model

- The site has no accounts, uploads, or secrets.
- The browser calls only `/api/catalog`. The function calls only `https://models.dev/api.json`.
- Catalog text is rendered as text. Docs links must start with `https://`.
- Responses are size-capped and field-limited. Upstream errors are not forwarded verbatim.
- `public/_headers` keeps scripts, styles, and fonts on this origin.

A pin is an approximate headquarters from `src/places.ts`, not a location published by models.dev.
