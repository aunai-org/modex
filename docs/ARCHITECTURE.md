# Architecture

Modex is a static Vite + TypeScript site on Cloudflare Pages. The browser loads only files from its own origin, including `/catalog.json`.

```
every 12 hours:  GitHub Action --> Cloudflare deploy hook --> npm run build
                                                               |
                                            models.dev/models.json   lab models
                                            models.dev/api.json      who serves them
                                            join into Lab → Model → Host
                                            write dist/catalog.json (static)

browser  -- GET /catalog.json -->  static file (no Function, no CPU limit)
```

That is the default, `CATALOG_MODE=static`. With `CATALOG_MODE=function` the build skips `catalog.json` and the page calls `/api/catalog` instead: the Pages Function in `functions/` runs the same `loadCatalog`, keeps it for an hour per isolate, and shares one copy per data centre through the Cache API. The mode is read at build time and baked into the page as its catalog URL. The project has no `wrangler.toml`, so build variables stay editable in the Cloudflare dashboard.

`shared/catalog.ts` is the only upstream client. It fetches two fixed URLs, keeps a short graph, and drops everything else. Labs are not a hand-kept list: every model id starts with its lab (`amazon/nova-pro`), so the lab set follows the catalog. A few display names are kept in `LAB_NAMES`; others are title-cased from the id. Providers name models their own way (`gpt-5.4`, `qwen/qwen3.5-plus`, `eu.anthropic.claude-opus-4-6-v1`, `claude-sonnet-4-5@20250929`), so each provider id is reduced to a bare model name, with a lab hint when the provider names one, and linked only when exactly one catalog model has that name. Ambiguous names stay unlinked. A lab without a place in `src/places.ts` keeps its models in the data and lists; it just has no pin. A model is placed with its lab, never at its own coordinates. A host is placed only when `src/places.ts` has an approximate headquarters. The build and the dev server use the same function; a failed fetch fails the build rather than shipping an empty catalog.

The globe draws labs first. Choosing a lab fans that lab’s models out around the marker, the same way Orbitals fans missions around a pad. Choosing a model draws the hosts that serve it. Those host pins are geographic. Model pins are not.

`src/globe.ts` is the Orbit Watch black-earth sphere: Natural Earth country geometry, Phong lighting, OrbitControls. Category icons are canvas sprites. A marker ripples when its model, or a model from that lab, was released in the last 15 days.

The browser saves the last good catalog in `localStorage`: a return visit paints it immediately, the network copy replaces it when it arrives, and an open tab refreshes every 30 minutes. If the request fails, the saved copy stays on screen with a notice.

There is no account, database, or secret. Static files ship from `dist/`. `public/_headers` keeps scripts, styles, and fonts on this origin.

## Later layers

These stay off the globe until the catalog graph above is the source they read:

- Capability layers: reasoning, vision, audio, tools, open weights. Flags are already on each model.
- Price layer: provider cost, drawn per host, not per lab.
- Timeline: models appearing by `release_date`.
