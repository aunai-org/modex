import { loadCatalog } from "../../shared/catalog";

/** models.dev changes a few times a day, so an hour at the edge is plenty; browsers keep 15 minutes. */
const EDGE_SECONDS = 60 * 60;
const BROWSER_SECONDS = 15 * 60;

type Context = { request: Request; waitUntil(promise: Promise<unknown>): void };

/**
 * Pages Functions responses skip Cloudflare's edge cache by default, so each isolate would fetch
 * models.dev on its own. The Cache API shares one copy per data centre for an hour.
 * Failed or fallback catalogs are never cached, so a recovered upstream shows up on the next request.
 */
export const onRequestGet = async (context: Context) => {
  const edge = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL("/api/catalog", context.request.url).toString(), { method: "GET" });
  const hit = await edge.match(key);
  if (hit) return hit;

  const body = await loadCatalog();
  const response = new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${BROWSER_SECONDS}, s-maxage=${EDGE_SECONDS}`,
    },
  });
  if (!body.error && body.labs.length) context.waitUntil(edge.put(key, response.clone()));
  return response;
};
