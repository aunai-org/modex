export type Place = {
  city: string;
  region: string;
  lat: number;
  lng: number;
};

/** Approximate public headquarters. Not part of the models.dev catalog. */
const places: Record<string, Place> = {
  openai: { city: "San Francisco", region: "United States", lat: 37.79, lng: -122.4 },
  anthropic: { city: "San Francisco", region: "United States", lat: 37.78, lng: -122.41 },
  google: { city: "Mountain View", region: "United States", lat: 37.42, lng: -122.08 },
  "google-vertex": { city: "Mountain View", region: "United States", lat: 37.41, lng: -122.09 },
  xai: { city: "Palo Alto", region: "United States", lat: 37.44, lng: -122.14 },
  meta: { city: "Menlo Park", region: "United States", lat: 37.45, lng: -122.18 },
  groq: { city: "Mountain View", region: "United States", lat: 37.4, lng: -122.07 },
  cerebras: { city: "Sunnyvale", region: "United States", lat: 37.37, lng: -122.03 },
  fireworks: { city: "Redwood City", region: "United States", lat: 37.49, lng: -122.23 },
  "fireworks-ai": { city: "Redwood City", region: "United States", lat: 37.49, lng: -122.23 },
  together: { city: "San Francisco", region: "United States", lat: 37.77, lng: -122.42 },
  "togetherai": { city: "San Francisco", region: "United States", lat: 37.77, lng: -122.42 },
  perplexity: { city: "San Francisco", region: "United States", lat: 37.79, lng: -122.39 },
  nvidia: { city: "Santa Clara", region: "United States", lat: 37.37, lng: -121.96 },
  databricks: { city: "San Francisco", region: "United States", lat: 37.79, lng: -122.4 },
  "amazon-bedrock": { city: "Seattle", region: "United States", lat: 47.62, lng: -122.33 },
  azure: { city: "Redmond", region: "United States", lat: 47.67, lng: -122.12 },
  "github-copilot": { city: "San Francisco", region: "United States", lat: 37.78, lng: -122.4 },
  huggingface: { city: "New York", region: "United States", lat: 40.74, lng: -73.99 },
  cohere: { city: "Toronto", region: "Canada", lat: 43.65, lng: -79.38 },
  mistral: { city: "Paris", region: "Europe", lat: 48.86, lng: 2.35 },
  ai21: { city: "Tel Aviv", region: "Israel", lat: 32.07, lng: 34.79 },
  deepseek: { city: "Hangzhou", region: "China", lat: 30.27, lng: 120.15 },
  alibaba: { city: "Hangzhou", region: "China", lat: 30.28, lng: 120.16 },
  "alibaba-cn": { city: "Hangzhou", region: "China", lat: 30.26, lng: 120.14 },
  moonshot: { city: "Beijing", region: "China", lat: 39.9, lng: 116.4 },
  moonshotai: { city: "Beijing", region: "China", lat: 39.9, lng: 116.4 },
  "zhipuai": { city: "Beijing", region: "China", lat: 39.91, lng: 116.41 },
  zai: { city: "Beijing", region: "China", lat: 39.92, lng: 116.39 },
  baidu: { city: "Beijing", region: "China", lat: 39.99, lng: 116.32 },
  minimax: { city: "Shanghai", region: "China", lat: 31.23, lng: 121.47 },
};

const byName: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  "xai": "xai",
  "x.ai": "xai",
  meta: "meta",
  groq: "groq",
  cerebras: "cerebras",
  "fireworks ai": "fireworks",
  together: "together",
  "together ai": "together",
  perplexity: "perplexity",
  nvidia: "nvidia",
  databricks: "databricks",
  "amazon bedrock": "amazon-bedrock",
  azure: "azure",
  "github copilot": "github-copilot",
  huggingface: "huggingface",
  cohere: "cohere",
  mistral: "mistral",
  "ai21 labs": "ai21",
  deepseek: "deepseek",
  alibaba: "alibaba",
  "alibaba (china)": "alibaba-cn",
  "moonshot ai": "moonshot",
  moonshotai: "moonshotai",
  zhipuai: "zhipuai",
  "z.ai": "zai",
  baidu: "baidu",
  minimax: "minimax",
};

export function locate(id: string, name: string): Place | null {
  const key = id.toLowerCase();
  if (places[key]) return places[key];
  const alias = byName[name.trim().toLowerCase()];
  return alias ? places[alias] ?? null : null;
}
