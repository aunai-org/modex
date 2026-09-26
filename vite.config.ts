import { defineConfig, type Plugin } from "vite";
import { loadCatalog } from "./shared/catalog";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Two ways to serve the catalog, chosen at build time with CATALOG_MODE:
 * - `static` (default): `vite build` fetches models.dev once and writes `catalog.json` next to the page.
 *   No per-request work; a scheduled rebuild (.github/workflows/rebuild.yml) keeps it current.
 * - `function`: the page calls `/api/catalog`, the Pages Function in functions/, cached with the Cache API.
 */
const mode = env.CATALOG_MODE === "function" ? "function" : "static";
const catalogUrl = mode === "static" ? "/catalog.json" : "/api/catalog";

function catalog(): Plugin {
  const serve = async (_req: unknown, res: { setHeader(k: string, v: string): void; end(body: string): void }) => {
    const body = await loadCatalog();
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  return {
    name: "modex-catalog",
    configureServer(server) {
      // The dev server answers both, so either mode runs locally.
      server.middlewares.use("/catalog.json", serve);
      server.middlewares.use("/api/catalog", serve);
    },
    async generateBundle() {
      if (mode !== "static") {
        this.info("CATALOG_MODE=function: the page will call /api/catalog.");
        return;
      }
      const body = await loadCatalog();
      // Refuse to ship an empty or fallback catalog: a failed build leaves the last good deploy live.
      if (body.error || !body.labs.length) this.error(`Catalog unavailable (${body.error ?? "no labs"}); not deploying without data.`);
      this.emitFile({ type: "asset", fileName: "catalog.json", source: JSON.stringify(body) });
      this.info(`catalog.json: ${body.labs.length} labs, ${body.models.length} models, ${body.hosts.length} providers`);
    },
  };
}

export default defineConfig({
  plugins: [catalog()],
  define: { __CATALOG_URL__: JSON.stringify(catalogUrl) },
  server: { port: Number(env.PORT) || 5173 },
});
