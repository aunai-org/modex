const MODELS_URL = "https://models.dev/models.json";
const PROVIDERS_URL = "https://models.dev/api.json";
const TTL_MS = 10 * 60 * 1000;
const MAX_MODELS = 500;
const MAX_SERVES = 4000;

/** Labs we place on the globe. A model belongs to the lab in its id prefix. */
export const LAB_IDS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "meta",
  "mistral",
  "deepseek",
  "cohere",
  "ai21",
  "alibaba",
  "moonshotai",
  "zhipuai",
  "minimax",
  "nvidia",
] as const;

const LAB_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  meta: "Meta",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  cohere: "Cohere",
  ai21: "AI21",
  alibaba: "Alibaba",
  moonshotai: "Moonshot",
  zhipuai: "Zhipu",
  minimax: "MiniMax",
  nvidia: "Nvidia",
};

export type Lab = { id: string; name: string };

export type ModelRow = {
  id: string;
  name: string;
  lab: string;
  release: string;
  reasoning: boolean;
  vision: boolean;
  audio: boolean;
  tools: boolean;
  open: boolean;
};

export type Host = { id: string; name: string; doc: string };

export type Serve = { model: string; host: string };

export type CatalogBody = {
  fetchedAt: string;
  cached: boolean;
  error?: string;
  labs: Lab[];
  models: ModelRow[];
  hosts: Host[];
  serves: Serve[];
};

let fresh: { at: number; body: CatalogBody } | null = null;
let lastGood: CatalogBody | null = null;

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
}

function httpsUrl(value: unknown): string {
  const url = text(value, 300);
  return url.startsWith("https://") ? url : "";
}

function flag(value: unknown): boolean {
  return value === true;
}

function modalities(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const row = value as { input?: unknown; output?: unknown };
  const all = [...(Array.isArray(row.input) ? row.input : []), ...(Array.isArray(row.output) ? row.output : [])];
  return all.filter((item): item is string => typeof item === "string");
}

function day(value: unknown): string {
  const raw = text(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

type RawModel = Record<string, unknown>;

function asModel(value: unknown): ModelRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as RawModel;
  const id = text(row.id, 160);
  const lab = id.split("/")[0] ?? "";
  if (!id || !LAB_NAMES[lab]) return null;
  const modes = modalities(row.modalities);
  return {
    id,
    name: text(row.name, 140) || id,
    lab,
    release: day(row.release_date),
    reasoning: flag(row.reasoning),
    vision: modes.includes("image"),
    audio: modes.includes("audio"),
    tools: flag(row.tool_call),
    open: flag(row.open_weights),
  };
}

function canonicalId(providerId: string, model: RawModel, known: Set<string>): string {
  const raw = text(model.id, 160);
  if (raw.includes("/") && known.has(raw)) return raw;
  const prefixed = `${providerId}/${raw}`;
  if (known.has(prefixed)) return prefixed;
  return "";
}

function normalize(modelsJson: unknown, providersJson: unknown): Omit<CatalogBody, "fetchedAt" | "cached" | "error"> {
  const known = new Set<string>();
  const models: ModelRow[] = [];
  if (modelsJson && typeof modelsJson === "object") {
    for (const value of Object.values(modelsJson as Record<string, unknown>)) {
      if (models.length >= MAX_MODELS) break;
      const row = asModel(value);
      if (!row) continue;
      known.add(row.id);
      models.push(row);
    }
  }
  const hosts: Host[] = [];
  const serves: Serve[] = [];
  const seenHost = new Set<string>();
  if (providersJson && typeof providersJson === "object") {
    for (const [providerId, value] of Object.entries(providersJson as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const provider = value as Record<string, unknown>;
      const bucket = provider.models;
      if (!bucket || typeof bucket !== "object") continue;
      const hostId = text(providerId, 80);
      if (!hostId) continue;
      let used = false;
      for (const model of Object.values(bucket as Record<string, unknown>)) {
        if (serves.length >= MAX_SERVES) break;
        if (!model || typeof model !== "object") continue;
        const modelId = canonicalId(hostId, model as RawModel, known);
        if (!modelId) continue;
        serves.push({ model: modelId, host: hostId });
        used = true;
      }
      if (used && !seenHost.has(hostId)) {
        seenHost.add(hostId);
        hosts.push({
          id: hostId,
          name: text(provider.name, 120) || hostId,
          doc: httpsUrl(provider.doc),
        });
      }
    }
  }
  const labIds = new Set(models.map((model) => model.lab));
  const labs = LAB_IDS.filter((id) => labIds.has(id)).map((id) => ({ id, name: LAB_NAMES[id] }));
  models.sort((a, b) => b.release.localeCompare(a.release) || a.name.localeCompare(b.name));
  hosts.sort((a, b) => a.name.localeCompare(b.name));
  return { labs, models, hosts, serves };
}

export async function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<CatalogBody> {
  if (fresh && Date.now() - fresh.at < TTL_MS) return { ...fresh.body, cached: true };
  try {
    const [modelsRes, providersRes] = await Promise.all([
      fetchImpl(MODELS_URL, { headers: { accept: "application/json" } }),
      fetchImpl(PROVIDERS_URL, { headers: { accept: "application/json" } }),
    ]);
    if (!modelsRes.ok || !providersRes.ok) throw new Error("upstream");
    const body: CatalogBody = {
      fetchedAt: new Date().toISOString(),
      cached: false,
      ...normalize(await modelsRes.json(), await providersRes.json()),
    };
    fresh = { at: Date.now(), body };
    lastGood = body;
    return body;
  } catch {
    if (lastGood) return { ...lastGood, cached: true, error: "Showing the last successful catalog." };
    return {
      fetchedAt: new Date().toISOString(),
      cached: false,
      error: "Catalog unavailable.",
      labs: [],
      models: [],
      hosts: [],
      serves: [],
    };
  }
}
