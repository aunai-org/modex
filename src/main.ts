import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import { Globe, type GeoPin, type SatPin } from "./globe";
import { locate } from "./places";
import type { CatalogBody, Host, Lab, ModelRow, Serve } from "../shared/catalog";

const RECENT_MS = 15 * 24 * 60 * 60 * 1000;
const MODEL_CAP = 12;

const statusEl = document.querySelector("#status") as HTMLElement;
const cardEl = document.querySelector("#card") as HTMLElement;
const searchEl = document.querySelector("#search") as HTMLInputElement;
const recentEl = document.querySelector("#recent") as HTMLButtonElement;

let labs: Lab[] = [];
let models: ModelRow[] = [];
let hosts: Host[] = [];
let serves: Serve[] = [];
let query = "";
let recentOnly = false;
let labId: string | null = null;
let modelId: string | null = null;
let hostId: string | null = null;

const globe = new Globe(document.querySelector("#globe") as HTMLElement, (id, kind) => {
  if (kind === "lab") {
    labId = id;
    modelId = null;
    hostId = null;
    const place = locate(id, "");
    if (place) globe.focus(place.lat, place.lng);
  } else if (kind === "model") {
    modelId = id;
    hostId = null;
  } else {
    hostId = id;
    const place = locate(id, hosts.find((host) => host.id === id)?.name ?? "");
    if (place) globe.focus(place.lat, place.lng);
  }
  render();
});

function recent(model: ModelRow): boolean {
  if (!model.release) return false;
  const time = Date.parse(`${model.release}T00:00:00Z`);
  return Number.isFinite(time) && Date.now() - time <= RECENT_MS && Date.now() >= time;
}

function labModels(id: string): ModelRow[] {
  return models.filter((model) => model.lab === id && (!recentOnly || recent(model))).sort((a, b) => b.release.localeCompare(a.release));
}

function hostsFor(id: string): Host[] {
  const ids = new Set(serves.filter((link) => link.model === id).map((link) => link.host));
  return hosts.filter((host) => ids.has(host.id));
}

function render() {
  const q = query.trim().toLowerCase();
  const shownLabs = labs.filter((lab) => {
    if (q && !lab.name.toLowerCase().includes(q) && !lab.id.includes(q)) return false;
    if (recentOnly && !labModels(lab.id).length) return false;
    return locate(lab.id, lab.name) !== null;
  });
  const geo: GeoPin[] = [];
  for (const lab of shownLabs) {
    const place = locate(lab.id, lab.name);
    if (!place) continue;
    geo.push({
      id: lab.id,
      kind: "lab",
      lat: place.lat,
      lng: place.lng,
      ripple: labModels(lab.id).some(recent),
    });
  }
  const openLab = labs.find((lab) => lab.id === labId) ?? null;
  const spawned = openLab ? labModels(openLab.id).slice(0, MODEL_CAP) : [];
  const place = openLab ? locate(openLab.id, openLab.name) : null;
  const sats: SatPin[] = place
    ? spawned.map((model, index) => ({
        id: model.id,
        lat: place.lat,
        lng: place.lng,
        index,
        count: spawned.length,
        ripple: recent(model),
      }))
    : [];
  const openModel = models.find((model) => model.id === modelId) ?? null;
  const openHosts = openModel ? hostsFor(openModel.id) : [];
  if (openModel) {
    openHosts.forEach((host, index) => {
      const where = locate(host.id, host.name);
      if (!where) return;
      geo.push({
        id: host.id,
        kind: "host",
        lat: where.lat,
        lng: where.lng + index * 0.35,
        ripple: recent(openModel),
      });
    });
  }
  const selected = hostId ?? modelId ?? labId;
  globe.show(geo, sats, selected);
  paintCard(openLab, openModel, openHosts, spawned.length);
  const fresh = models.filter(recent).length;
  statusEl.textContent = globe.ready
    ? `${shownLabs.length} labs · ${fresh} models in 15 days`
    : "WebGL is unavailable.";
}

function paintCard(lab: Lab | null, model: ModelRow | null, openHosts: Host[], shown: number) {
  const host = openHosts.find((item) => item.id === hostId) ?? null;
  cardEl.hidden = !lab && !model;
  if (!lab && !model) return;
  const title = document.querySelector("#card-name") as HTMLElement;
  const eyebrow = document.querySelector("#card-id") as HTMLElement;
  const body = document.querySelector("#card-body") as HTMLElement;
  body.replaceChildren();
  if (host && model && lab) {
    title.textContent = host.name;
    eyebrow.textContent = "Provider";
    addFact(body, "Serves", model.name);
    addFact(body, "Lab", lab.name);
    const where = locate(host.id, host.name);
    addFact(body, "Place", where ? `${where.city} · approximate` : "No pin");
  } else if (model && lab) {
    title.textContent = model.name;
    eyebrow.textContent = "Model";
    addFact(body, "Lab", lab.name);
    addFact(body, "Released", model.release || "Undated");
    const caps = [
      model.reasoning ? "reasoning" : "",
      model.vision ? "vision" : "",
      model.audio ? "audio" : "",
      model.tools ? "tools" : "",
      model.open ? "open weights" : "",
    ].filter(Boolean);
    addFact(body, "Capabilities", caps.join(" · ") || "—");
    const pinned = openHosts.filter((item) => locate(item.id, item.name)).length;
    addFact(body, "Providers", `${openHosts.length} serving · ${pinned} on the globe`);
    const names = openHosts.slice(0, 6).map((item) => item.name);
    if (names.length) addFact(body, "Including", names.join(", ") + (openHosts.length > 6 ? "…" : ""));
  } else if (lab) {
    title.textContent = lab.name;
    eyebrow.textContent = "Lab";
    const all = labModels(lab.id);
    const where = locate(lab.id, lab.name);
    addFact(body, "Place", where ? `${where.city} · approximate HQ` : "No pin");
    addFact(body, "Models", `${all.length}${all.length > shown ? ` · showing ${shown} around the lab` : ""}`);
    if (spawnedNames(lab)) addFact(body, "Around", spawnedNames(lab));
  }
}

function spawnedNames(lab: Lab): string {
  return labModels(lab.id)
    .slice(0, 4)
    .map((model) => model.name)
    .join(", ");
}

function addFact(root: HTMLElement, label: string, value: string) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  row.append(dt, dd);
  root.append(row);
}

async function load() {
  statusEl.textContent = "Loading catalog…";
  try {
    const res = await fetch("/api/catalog");
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as CatalogBody;
    labs = body.labs ?? [];
    models = body.models ?? [];
    hosts = body.hosts ?? [];
    serves = body.serves ?? [];
    if (body.error) statusEl.textContent = body.error;
  } catch {
    labs = [];
    models = [];
    hosts = [];
    serves = [];
    statusEl.textContent = "Catalog request failed.";
  }
  render();
}

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});
recentEl.addEventListener("click", () => {
  recentOnly = !recentOnly;
  recentEl.setAttribute("aria-pressed", String(recentOnly));
  recentEl.classList.toggle("on", recentOnly);
  if (labId && !labModels(labId).length) {
    labId = null;
    modelId = null;
    hostId = null;
  }
  render();
});
document.querySelector("#refresh")?.addEventListener("click", () => void load());
document.querySelector("#card-close")?.addEventListener("click", () => {
  if (hostId) hostId = null;
  else if (modelId) modelId = null;
  else labId = null;
  render();
});

void load();
