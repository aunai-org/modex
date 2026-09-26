import { defineConfig, type Plugin } from "vite";
import { loadCatalog } from "./shared/catalog";

function catalog(): Plugin {
  return {
    name: "modex-catalog",
    configureServer(server) {
      server.middlewares.use("/api/catalog", async (_req, res) => {
        const body = await loadCatalog();
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig({ plugins: [catalog()] });
