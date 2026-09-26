# Modex

A globe for the [models.dev](https://models.dev) catalog. The picture is Lab → Model → Provider: a lab has a place, its models fan out around that marker, and the providers that serve a model can sit somewhere else. Pins are approximate headquarters kept in this repo. The catalog itself has no coordinates.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints. The dev server serves `/catalog.json` live from models.dev.

## Deploy

Cloudflare Pages, connected to this repository:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |

### Catalog mode

The catalog can be served two ways. Pick one with the `CATALOG_MODE` environment variable; no code change is needed.

| `CATALOG_MODE` | How it works | Cost |
| --- | --- | --- |
| `static` (default, or unset) | `npm run build` fetches models.dev once and writes `dist/catalog.json`. A rebuild every 12 hours keeps it current. | Static files only: free and unlimited, no CPU limit. |
| `function` | The page calls `/api/catalog`, a Pages Function in `functions/` that caches the catalog for an hour with the Cache API. | Each request is a Function call (100,000 a day on the free plan), and a cache miss needs about 60 ms of CPU, more than the free plan's 10 ms. Use it on Workers Paid. |

To change it: Cloudflare → Workers & Pages → modex → **Settings → Variables and Secrets** → add `CATALOG_MODE` (Text) for Production (and Preview if you like) → save → **Deployments → Retry deployment** on the latest build. Remove the variable, or set it to `static`, to switch back.

In static mode a failed fetch fails the build on purpose, so Cloudflare keeps serving the last good deploy. The Function in `functions/` is still deployed but nothing calls it.

Locally: `npm run build` for static, `CATALOG_MODE=function npm run build` for function mode. `npm run dev` serves both URLs.

### Rebuild every 12 hours (static mode)

`.github/workflows/rebuild.yml` calls a Cloudflare deploy hook at 00:00 and 12:00 UTC:

1. Cloudflare → Workers & Pages → modex → Settings → Builds → **Deploy hooks** → add one for the production branch.
2. GitHub → Settings → Secrets and variables → Actions → add `CLOUDFLARE_DEPLOY_HOOK` with the hook URL.

GitHub runs scheduled workflows only from the default branch (`main`). The workflow can also be run by hand from the Actions tab.

The browser keeps the last catalog in `localStorage`, paints it at once on a return visit, and checks for a newer one every 30 minutes.

## Data

- Provider name, id, model count, npm package, and docs URL come from models.dev.
- A pin appears only when `src/places.ts` has a match. Everyone else stays in the list.
- Headquarters are approximate and are not claimed by models.dev.

models.dev data stays under its own license. This application is MIT. See `LICENSE`.
