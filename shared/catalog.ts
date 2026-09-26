const MODELS_URL = "https://models.dev/models.json";
const PROVIDERS_URL = "https://models.dev/api.json";
/** Only the dev server reuses a loaded catalog; a production build fetches once per build. */
const TTL_MS = 60 * 60 * 1000;
const MAX_MODELS = 1000;
const MAX_SERVES = 12000;

/**
 * Labs come from the data: every model id starts with its lab (`amazon/nova-pro`).
 * These are display names where the id alone reads badly; anything else is title-cased.
 */
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
  "bytedance-seed": "ByteDance Seed",
  "arcee-ai": "Arcee",
  ibm: "IBM",
  openbmb: "OpenBMB",
  sakana: "Sakana AI",
  "swiss-ai": "Swiss AI",
  thinkingmachines: "Thinking Machines",
  aisingapore: "AI Singapore",
  inclusionai: "inclusionAI",
  sdaia: "SDAIA",
  deepreinforce: "DeepReinforce",
  "nex-agi": "Nex AGI",
  quiverai: "QuiverAI",
  stepfun: "StepFun",
};

/** Vendor names providers use that differ from the lab id in models.dev. */
const VENDOR_ALIASES: Record<string, string> = {
  qwen: "alibaba",
  bailian: "alibaba",
  "meta-llama": "meta",
  mistralai: "mistral",
  "z-ai": "zhipuai",
  zai: "zhipuai",
  "zai-org": "zhipuai",
  "x-ai": "xai",
  spacexai: "xai",
  moonshot: "moonshotai",
  "deepseek-ai": "deepseek",
  "google-deepmind": "google",
  bytedance: "bytedance-seed",
};

function labName(id: string): string {
  return LAB_NAMES[id] ?? id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export type Lab = { id: string; name: string; models: number };

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
  const lab = id.includes("/") ? id.split("/")[0] : "";
  if (!id || !lab) return null;
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

/**
 * Providers name models their own way: `gpt-5.4`, `qwen/qwen3.5-plus`, `eu.anthropic.claude-opus-4-6-v1`,
 * `together_ai/deepseek-ai/DeepSeek-V4-Pro`, `claude-sonnet-4-5@20250929`. Each is reduced to a bare model name
 * (plus a lab hint when the provider names one) and matched only when exactly one catalog model has that name.
 */
class ModelMatcher {
  private known: Set<string>;
  private labs: Set<string>;
  private byName = new Map<string, string[]>();

  constructor(ids: string[]) {
    this.known = new Set(ids);
    this.labs = new Set(ids.map((id) => id.split("/")[0]));
    for (const id of ids) {
      const name = id.split("/").slice(1).join("/").toLowerCase();
      const list = this.byName.get(name);
      if (list) list.push(id);
      else this.byName.set(name, [id]);
    }
  }

  private lab(vendor: string): string | null {
    const v = vendor.toLowerCase();
    return this.labs.has(v) ? v : (VENDOR_ALIASES[v] ?? null);
  }

  match(providerId: string, rawId: string): string {
    if (rawId.includes("/") && this.known.has(rawId)) return rawId;
    if (this.known.has(`${providerId}/${rawId}`)) return `${providerId}/${rawId}`;
    let name = rawId.trim().toLowerCase().replace(/^(us|eu|apac|global|au|jp|ca|us-gov)\./, "");
    let hint: string | null = null;
    const parts = name.split("/");
    if (parts.length > 1) {
      for (const part of parts.slice(0, -1)) hint = this.lab(part) ?? hint;
      name = parts[parts.length - 1];
    }
    const dotted = name.match(/^([a-z0-9-]+)\.(.+)$/);
    if (dotted && this.lab(dotted[1])) {
      hint = this.lab(dotted[1]);
      name = dotted[2];
    }
    name = name.replace(/@.*$/, "").replace(/-v\d+(:\d+)?$/, "").replace(/:\d+$/, "");
    let found = this.byName.get(name) ?? [];
    if (hint && found.length > 1) found = found.filter((id) => id.startsWith(`${hint}/`));
    return found.length === 1 ? found[0] : "";
  }
}

function normalize(modelsJson: unknown, providersJson: unknown): Omit<CatalogBody, "fetchedAt" | "cached" | "error"> {
  const models: ModelRow[] = [];
  if (modelsJson && typeof modelsJson === "object") {
    for (const value of Object.values(modelsJson as Record<string, unknown>)) {
      if (models.length >= MAX_MODELS) break;
      const row = asModel(value);
      if (row) models.push(row);
    }
  }
  const byId = new Map(models.map((model) => [model.id, model]));
  const matcher = new ModelMatcher(models.map((model) => model.id));
  const providers = providersJson && typeof providersJson === "object" ? (providersJson as Record<string, unknown>) : {};
  const hosts: Host[] = [];
  const serves: Serve[] = [];
  // One link per model and provider, even when a provider lists regional copies of the same model.
  const linked = new Set<string>();
  for (const [providerId, value] of Object.entries(providers)) {
    if (!value || typeof value !== "object") continue;
    const provider = value as Record<string, unknown>;
    const bucket = provider.models;
    const hostId = text(providerId, 80);
    if (!bucket || typeof bucket !== "object" || !hostId) continue;
    let used = false;
    for (const model of Object.values(bucket as Record<string, unknown>)) {
      if (serves.length >= MAX_SERVES) break;
      if (!model || typeof model !== "object") continue;
      const raw = model as RawModel;
      const modelId = matcher.match(hostId, text(raw.id, 160));
      if (!modelId) continue;
      used = true;
      const known = byId.get(modelId);
      if (known && flag(raw.structured_output)) known.structured = true;
      const key = `${modelId}|${hostId}`;
      if (linked.has(key)) continue;
      linked.add(key);
      serves.push({ model: modelId, host: hostId });
    }
    if (used) {
      hosts.push({
        id: hostId,
        name: text(provider.name, 120) || hostId,
        npm: text(provider.npm, 120),
        api: httpsUrl(provider.api),
        models: Object.keys(bucket).length,
      });
    }
  }
  const perLab = new Map<string, number>();
  for (const model of models) perLab.set(model.lab, (perLab.get(model.lab) ?? 0) + 1);
  const labs = [...perLab]
    .map(([id, count]) => ({ id, name: labName(id), models: count }))
    .sort((a, b) => b.models - a.models || a.name.localeCompare(b.name));
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
    const graph = normalize(await modelsRes.json(), await providersRes.json());
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
