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

export type Lab = { id: string; name: string; description: string; models: number };

export type ModelRow = {
  id: string;
  name: string;
  lab: string;
  release: string;
  context: number;
  output: number;
  input: string[];
  reasoning: boolean;
  tools: boolean;
  structured: boolean;
  temperature: boolean;
  open: boolean;
};

export type Host = { id: string; name: string; npm: string; api: string; models: number };

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

function inputModes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const input = (value as { input?: unknown }).input;
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is string => typeof item === "string").slice(0, 6);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
  const limit = row.limit && typeof row.limit === "object" ? (row.limit as Record<string, unknown>) : {};
  return {
    id,
    name: text(row.name, 140) || id,
    lab,
    release: day(row.release_date),
    context: count(limit.context),
    output: count(limit.output),
    input: inputModes(row.modalities),
    reasoning: flag(row.reasoning),
    tools: flag(row.tool_call),
    structured: flag(row.structured_output),
    temperature: flag(row.temperature),
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
        const raw = model as RawModel;
        const modelId = canonicalId(hostId, raw, known);
        if (!modelId) continue;
        serves.push({ model: modelId, host: hostId });
        const knownModel = models.find((item) => item.id === modelId);
        if (knownModel && flag(raw.structured_output)) knownModel.structured = true;
        used = true;
      }
      if (used && !seenHost.has(hostId)) {
        seenHost.add(hostId);
        const listed = provider.models && typeof provider.models === "object" ? Object.keys(provider.models).length : 0;
        hosts.push({
          id: hostId,
          name: text(provider.name, 120) || hostId,
          npm: text(provider.npm, 120),
          api: httpsUrl(provider.api),
          models: listed,
        });
      }
    }
  }
  const labIds = new Set(models.map((model) => model.lab));
  const labs = LAB_IDS.filter((id) => labIds.has(id)).map((id) => ({
    id,
    name: LAB_NAMES[id],
    description: "",
    models: models.filter((model) => model.lab === id).length,
  }));
  models.sort((a, b) => b.release.localeCompare(a.release) || a.name.localeCompare(b.name));
  hosts.sort((a, b) => a.name.localeCompare(b.name));
  return { labs, models, hosts, serves };
}

function descriptionFromToml(toml: string): string {
  const block = toml.match(/description\s*=\s*"""([\s\S]*?)"""/);
  const line = toml.match(/description\s*=\s*"([^"]*)"/);
  const raw = (block?.[1] ?? line?.[1] ?? "").replace(/\s+/g, " ").trim();
  return raw.slice(0, 400);
}

async function fillLabDescriptions(labs: Lab[], fetchImpl: typeof fetch) {
  await Promise.all(
    labs.map(async (lab) => {
      try {
        const res = await fetchImpl(
          `https://raw.githubusercontent.com/anomalyco/models.dev/dev/labs/${lab.id}/lab.toml`,
          { headers: { accept: "text/plain" } },
        );
        if (!res.ok) return;
        lab.description = descriptionFromToml(await res.text());
      } catch {
        lab.description = "";
      }
    }),
  );
}

export async function loadCatalog(fetchImpl: typeof fetch = fetch): Promise<CatalogBody> {
  if (fresh && Date.now() - fresh.at < TTL_MS) return { ...fresh.body, cached: true };
  try {
    const [modelsRes, providersRes] = await Promise.all([
      fetchImpl(MODELS_URL, { headers: { accept: "application/json" } }),
      fetchImpl(PROVIDERS_URL, { headers: { accept: "application/json" } }),
    ]);
    if (!modelsRes.ok || !providersRes.ok) throw new Error("upstream");
    const graph = normalize(await modelsRes.json(), await providersRes.json());
    await fillLabDescriptions(graph.labs, fetchImpl);
    const body: CatalogBody = {
      fetchedAt: new Date().toISOString(),
      cached: false,
      ...graph,
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
