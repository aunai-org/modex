# Deploying Modex

Modex builds to a plain folder of static files (`dist/`), so it runs on any static host. This guide covers Cloudflare Pages, which is what Modex is set up and tested on, and then what to watch for elsewhere.

## Cloudflare Pages

Connect the repository in **Workers & Pages → Create → Pages → Connect to Git**, then use:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |
| Production branch | `main` |

`public/_headers` is copied into `dist/` and sets the security headers, including a strict Content Security Policy. Cloudflare applies it automatically.

## Catalog mode

The catalog can be served two ways. Pick one with the `CATALOG_MODE` environment variable; no code change is needed.

| `CATALOG_MODE` | How it works | Cost |
| --- | --- | --- |
| `static` (default, or unset) | `npm run build` fetches models.dev once and writes `dist/catalog.json`. A rebuild every 12 hours keeps it current. | Static files only: free and unlimited, no CPU limit. |
| `function` | The page calls `/api/catalog`, a Pages Function in `functions/` that caches the catalog for an hour with the Cache API. | Every request is a Function call (100,000 a day on the free plan), and a cache miss needs about 60 ms of CPU, more than the free plan's 10 ms. Use it on Workers Paid. |

To switch on Cloudflare: **Settings → Variables and Secrets** → add `CATALOG_MODE` (Text) for Production, and Preview if you like → save → **Deployments → Retry deployment** on the latest build. Remove the variable, or set it to `static`, to switch back. The mode is read at build time, so it only takes effect on a new build.

In static mode, a failed fetch from models.dev fails the build on purpose, so the host keeps serving the last good deploy instead of an empty globe.

Locally: `npm run build` builds static mode, `CATALOG_MODE=function npm run build` builds function mode, and `npm run dev` serves both URLs.

The UI follows the mode: the About panel says how often the data changes, the time next to the buttons reads "Data from" (build time) or "Updated", and the refresh button either checks for a newer build or refetches. All of that wording lives in `src/mode.ts`.

## Rebuilding every 12 hours (static mode)

`.github/workflows/rebuild.yml` triggers a rebuild at 00:00 and 12:00 UTC through a Cloudflare deploy hook:

1. Cloudflare → Workers & Pages → modex → **Settings → Builds → Deploy hooks** → add one for the production branch.
2. GitHub → **Settings → Secrets and variables → Actions → Secrets** → **New repository secret** named `CLOUDFLARE_DEPLOY_HOOK`, with the hook URL.

GitHub only runs scheduled workflows from the default branch (`main`). You can also run it by hand from the **Actions** tab. If you change the schedule, update the rebuild hours in `src/mode.ts` too.

## Other hosts

Static mode works anywhere that serves files: Netlify, Vercel, GitHub Pages, an S3 bucket, your own server. Build with `npm run build` and publish `dist/`. Things to carry over:

- **Security headers.** `public/_headers` uses the Cloudflare/Netlify format. On other hosts, set the same `Content-Security-Policy` and other headers in that host's config.
- **Scheduled rebuilds.** Point `rebuild.yml` at your host's build hook, or rebuild on your own schedule. Without rebuilds, the catalog stays as it was at the last build.
- **Function mode** relies on Cloudflare Pages Functions and the Cache API, so it is Cloudflare-only.
