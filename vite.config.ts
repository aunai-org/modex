import { defineConfig, type Plugin } from "vite";
import { loadCatalog } from "./shared/catalog";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * The catalog is a static file, built with the site. `vite build` fetches models.dev once and writes
 * `catalog.json` next to the page, so a visit costs no Function time at all. A scheduled rebuild
 * (see .github/workflows/rebuild.yml) keeps it current. The dev server serves the same file live.
 */
function catalog(): Plugin {
  return {
    name: "modex-catalog",
    configureServer(server) {
      server.middlewares.use("/catalog.json", async (_req, res) => {
        const body = await loadCatalog();
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      });
    },
    async generateBundle() {
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
  server: { port: Number(env.PORT) || 5173 },
});
