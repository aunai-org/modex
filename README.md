# Modex

A globe for the [models.dev](https://models.dev) catalog. The picture is Lab → Model → Provider: a lab has a place, its models fan out around that marker, and the providers that serve a model can sit somewhere else. Pins are approximate headquarters kept in this repo. The catalog itself has no coordinates.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints. The dev server serves `/catalog.json` live from models.dev.

## Deploy

Cloudflare Pages, as a fully static site:

- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `NODE_VERSION` = `22`

`npm run build` fetches models.dev once and writes `dist/catalog.json` next to the page. If models.dev is unavailable the build fails on purpose, so Cloudflare keeps serving the last good deploy. Nothing runs per request: no Pages Function, so no CPU limit and no request quota.

To keep the catalog current, `.github/workflows/rebuild.yml` triggers a rebuild every 12 hours through a Cloudflare deploy hook:

1. Cloudflare → Workers & Pages → modex → Settings → Builds → Deploy hooks → create one for the branch you deploy.
2. GitHub → Settings → Secrets and variables → Actions → add `CLOUDFLARE_DEPLOY_HOOK` with the hook URL.
3. The workflow must be on the repository's default branch for GitHub to run it on schedule. It can also be run by hand from the Actions tab.

The browser keeps the last catalog in `localStorage`, paints it at once on a return visit, and checks for a newer file every 30 minutes.

The `preview` branch keeps the earlier design, a Pages Function with the Cache API, for when per-request freshness is worth the Function cost.

## Data

- Provider name, id, model count, npm package, and docs URL come from models.dev.
- A pin appears only when `src/places.ts` has a match. Everyone else stays in the list.
- Headquarters are approximate and are not claimed by models.dev.

models.dev data stays under its own license. This application is MIT. See `LICENSE`.
