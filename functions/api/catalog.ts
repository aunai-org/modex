import { loadCatalog } from "../../shared/catalog";

export const onRequestGet = async () => {
  const body = await loadCatalog();
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
};
