# Modex

A globe for the [models.dev](https://models.dev) catalog. The picture is Lab → Model → Provider: a lab has a place, its models fan out around that marker, and the providers that serve a model can sit somewhere else. Pins are approximate headquarters kept in this repo. The catalog itself has no coordinates.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints. The dev server exposes `/api/catalog` on the same origin.

## Deploy

Cloudflare Pages:

- Build command: `npm run build`
- Output directory: `dist`
- The `functions/` directory is the Pages Function for `/api/catalog`

The browser only talks to this origin. The function fetches `https://models.dev/api.json`, keeps a short summary, and caches it in the isolate for about ten minutes.

## Data

- Provider name, id, model count, npm package, and docs URL come from models.dev.
- A pin appears only when `src/places.ts` has a match. Everyone else stays in the list.
- Headquarters are approximate and are not claimed by models.dev.

models.dev data stays under its own license. This application is MIT. See `LICENSE`.
