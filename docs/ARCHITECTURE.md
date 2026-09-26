# Architecture

Modex is a Vite + TypeScript site deployed on Cloudflare Pages. The browser calls only `/api/catalog`.

```
browser  -- GET /api/catalog -->  Pages Function
                                      |
                                      models.dev/models.json   lab models
                                      models.dev/api.json      who serves them
                                      join into Lab → Model → Host
                                      cache 1 hour (isolate + edge)
```

`shared/catalog.ts` is the only upstream client. It fetches two fixed URLs, keeps a short graph, and drops everything else. A model is placed with its lab, never at its own coordinates. A host is placed only when `src/places.ts` has an approximate headquarters. Vite’s dev server uses the same function as the Pages Function.

The globe draws labs first. Choosing a lab fans that lab’s models out around the marker, the same way Orbitals fans missions around a pad. Choosing a model draws the hosts that serve it. Those host pins are geographic. Model pins are not.

`src/globe.ts` is the Orbit Watch black-earth sphere: Natural Earth country geometry, Phong lighting, OrbitControls. Category icons are canvas sprites. A marker ripples when its model, or a model from that lab, was released in the last 15 days.

The browser saves the last good catalog in `localStorage`: a return visit paints it immediately, the network copy replaces it when it arrives, and an open tab refreshes every 30 minutes. If the request fails, the saved copy stays on screen with a notice.

There is no account, database, or secret. Static files ship from `dist/`. `public/_headers` keeps scripts, styles, and fonts on this origin.

## Later layers

These stay off the globe until the catalog graph above is the source they read:

- Capability layers: reasoning, vision, audio, tools, open weights. Flags are already on each model.
- Price layer: provider cost, drawn per host, not per lab.
- Timeline: models appearing by `release_date`.
