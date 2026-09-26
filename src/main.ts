import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./style.css";
import { Globe, type Arc, type Pin, type Tone } from "./globe";
import { locate } from "./places";
import type { CatalogBody, Host, Lab, ModelRow, Serve } from "../shared/catalog";

const RECENT_MS = 15 * 24 * 60 * 60 * 1000;
const MODEL_CAP = 12;
const LATEST_CAP = 30;

const statusEl = document.querySelector("#status") as HTMLElement;
const clockEl = document.querySelector("#clock") as HTMLElement;
const cardEl = document.querySelector("#card") as HTMLElement;
const searchEl = document.querySelector("#search") as HTMLInputElement;
const recentEl = document.querySelector("#recent") as HTMLButtonElement;
const allEl = document.querySelector("#win-all") as HTMLButtonElement;
const refreshEl = document.querySelector("#refresh") as HTMLButtonElement;
const latestEl = document.querySelector("#latest") as HTMLElement;
const filtersEl = document.querySelector(".filters") as HTMLDetailsElement;
const SHORT_PX = 640;
if (window.innerHeight < SHORT_PX) (latestEl.closest("details") as HTMLDetailsElement).open = false;

let labs: Lab[] = [];
let models: ModelRow[] = [];
let hosts: Host[] = [];
let serves: Serve[] = [];
let query = "";
let recentOnly = false;
let labId: string | null = null;
let modelId: string | null = null;
let hostId: string | null = null;
let fetchedAt = "";
let notice = "";

type Category = "lab" | "model" | "host" | "pulse";
const show: Record<Category, boolean> = { lab: true, model: true, host: false, pulse: true };

const globe = new Globe(
  document.querySelector("#globe") as HTMLElement,
  (id, kind) => {
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
  },
  () => {
    // Clicking empty globe drops the selection and closes the card.
    if (!labId && !modelId && !hostId) return;
    labId = null;
    modelId = null;
    hostId = null;
    render();
  },
);

function pickModel(model: ModelRow) {
  labId = model.lab;
  modelId = model.id;
  hostId = null;
  const place = locate(model.lab, "");
  if (place) globe.focus(place.lat, place.lng);
  render();
}

function recent(model: ModelRow): boolean {
  if (!model.release) return false;
  const time = Date.parse(`${model.release}T00:00:00Z`);
  return Number.isFinite(time) && Date.now() - time <= RECENT_MS && Date.now() >= time;
}

function ago(release: string): string {
  const days = Math.floor((Date.now() - Date.parse(`${release}T00:00:00Z`)) / 86400000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function labModels(id: string): ModelRow[] {
  return models.filter((model) => model.lab === id && (!recentOnly || recent(model))).sort((a, b) => b.release.localeCompare(a.release));
}

function hostsFor(id: string): Host[] {
  const ids = new Set(serves.filter((link) => link.model === id).map((link) => link.host));
  return hosts.filter((host) => ids.has(host.id));
}

function hostsServing(list: ModelRow[]): Host[] {
  const wanted = new Set(list.map((model) => model.id));
  const ids = new Set(serves.filter((link) => wanted.has(link.model)).map((link) => link.host));
  return hosts.filter((host) => ids.has(host.id));
}

/**
 * Context decides what is on the map:
 * nothing selected → labs (plus every provider when "All providers" is on);
 * lab → providers serving its models; model → its providers, joined to the lab by arcs;
 * provider → the labs it serves. Everything outside the context is dimmed.
 */
function render() {
  const q = query.trim().toLowerCase();
  const shownLabs = labs.filter((lab) => {
    if (q && !lab.name.toLowerCase().includes(q) && !lab.id.includes(q)) return false;
    if (recentOnly && !labModels(lab.id).length) return false;
    return locate(lab.id, lab.name) !== null;
  });
  const visible = shownLabs.flatMap((lab) => labModels(lab.id));
  const openLab = labs.find((lab) => lab.id === labId) ?? null;
  const openModel = models.find((model) => model.id === modelId) ?? null;
  const openHost = hosts.find((host) => host.id === hostId) ?? null;
  const openHosts = openModel ? hostsFor(openModel.id) : [];

  let relatedLabs: Set<string> | null = null;
  let relatedHosts: Host[] = [];
  if (openModel) {
    relatedLabs = new Set([openModel.lab]);
    relatedHosts = openHosts;
  } else if (openHost) {
    const served = new Set(serves.filter((link) => link.host === openHost.id).map((link) => link.model));
    relatedLabs = new Set(visible.filter((model) => served.has(model.id)).map((model) => model.lab));
    relatedHosts = [openHost];
  } else if (openLab) {
    relatedLabs = new Set([openLab.id]);
    relatedHosts = hostsServing(labModels(openLab.id));
  }
  const selecting = relatedLabs !== null;

  const pins: Pin[] = [];
  for (const lab of show.lab ? shownLabs : []) {
    const place = locate(lab.id, lab.name);
    if (!place) continue;
    const focus = lab.id === labId && !modelId && !hostId;
    const tone: Tone = focus ? "focus" : !selecting || relatedLabs?.has(lab.id) ? "related" : "dim";
    pins.push({
      id: lab.id,
      kind: "lab",
      label: lab.name,
      anchor: lab.id === labId && !hostId,
      tone,
      lat: place.lat,
      lng: place.lng,
      ripple: show.pulse && (focus || (tone !== "dim" && labModels(lab.id).some(recent))),
    });
  }

  const pinned = new Map(relatedHosts.map((host) => [host.id, host]));
  if (show.host) for (const host of hostsServing(visible)) if (!pinned.has(host.id)) pinned.set(host.id, host);
  const relatedHostIds = new Set(relatedHosts.map((host) => host.id));
  const arcs: Arc[] = [];
  for (const host of pinned.values()) {
    const where = locate(host.id, host.name);
    if (!where) continue;
    const tone: Tone = host.id === hostId ? "focus" : !selecting || relatedHostIds.has(host.id) ? "related" : "dim";
    pins.push({
      id: host.id,
      kind: "host",
      label: host.name,
      anchor: host.id === hostId,
      tone,
      lat: where.lat,
      lng: where.lng,
      ripple: show.pulse && tone === "focus",
    });
    if (openModel && relatedHostIds.has(host.id)) {
      arcs.push({ from: { kind: "lab", id: openModel.lab }, to: { kind: "host", id: host.id } });
    }
  }

  const labHome = openLab ? locate(openLab.id, openLab.name) : null;
  const spawned = labHome && show.model ? labModels(openLab!.id).slice(0, MODEL_CAP) : [];
  // An older selected model still gets a place in the ring.
  if (openModel && spawned.length && openModel.lab === openLab?.id && !spawned.includes(openModel)) {
    spawned[spawned.length - 1] = openModel;
  }
  spawned.forEach((model, index) => {
    const tone: Tone = model.id === modelId ? (hostId ? "related" : "focus") : modelId ? "dim" : "related";
    pins.push({
      id: model.id,
      kind: "model",
      label: model.name,
      tone,
      lat: labHome!.lat,
      lng: labHome!.lng,
      fan: { index, count: spawned.length, lab: model.lab },
      ripple: show.pulse && tone === "focus",
    });
  });

  globe.show(pins, arcs);
  paintCard(openLab, openModel, openHosts, openHost);
  paintCounts(shownLabs, [...pinned.values()]);
  paintLatest(q);
  fitPanels();
}

/**
 * Short windows can't fit the card and both panels. When a selection opens the card there,
 * fold the side panels; the person can still reopen them.
 */
let lastCard = "";
function fitPanels() {
  const short = window.innerHeight < SHORT_PX;
  const card = cardEl.hidden ? "" : `${labId}|${modelId}|${hostId}`;
  if (short && card && card !== lastCard) {
    filtersEl.open = false;
    (latestEl.closest("details") as HTMLDetailsElement).open = false;
  }
  lastCard = card;
  capCard();
}

/** The card and the filters share the left edge; the card stops above the filters. */
function capCard() {
  const room = filtersEl.getBoundingClientRect().top - cardEl.getBoundingClientRect().top - 10;
  cardEl.style.maxHeight = `${Math.max(room, 120)}px`;
}

function setText(selector: string, value: string) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function paintCounts(shownLabs: Lab[], pinnedHosts: Host[]) {
  const fresh = models.filter(recent).length;
  setText("#count-all", String(models.length));
  setText("#count-recent", String(fresh));
  setText("#count-labs", String(shownLabs.length));
  setText("#count-models", String(recentOnly ? fresh : models.length));
  setText("#count-hosts", String(pinnedHosts.filter((host) => locate(host.id, host.name)).length));
  setText("#count-pulse", String(fresh));
  const time = fetchedAt ? new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  clockEl.textContent = time ? `Updated ${time}` : "";
  if (!globe.ready) statusEl.textContent = "WebGL is unavailable.";
  else if (notice) statusEl.textContent = notice;
  else statusEl.textContent = `${models.length} models · ${hosts.length} providers loaded`;
}

function paintLatest(q: string) {
  const labName = new Map(labs.map((lab) => [lab.id, lab.name]));
  const rows = (show.model ? models : [])
    .filter((model) => model.release && (!recentOnly || recent(model)))
    .filter((model) => !q || model.lab.includes(q) || (labName.get(model.lab) ?? "").toLowerCase().includes(q))
    .slice(0, LATEST_CAP);
  setText("#latest-count", String(rows.length));
  latestEl.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = show.model ? "No models match." : "Models are hidden.";
    latestEl.append(li);
    return;
  }
  for (const model of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("on", model.id === modelId);
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = model.name;
    const by = document.createElement("span");
    by.className = "by";
    by.textContent = `${labName.get(model.lab) ?? model.lab} · ${model.id}`;
    const date = document.createElement("span");
    date.className = "date";
    date.textContent = recent(model) ? `${model.release} · ${ago(model.release)}` : model.release;
    button.append(name, by, date);
    button.addEventListener("click", () => pickModel(model));
    const li = document.createElement("li");
    li.append(button);
    latestEl.append(li);
  }
}

function yn(value: boolean): string {
  return value ? "Yes" : "No";
}

function num(value: number): string {
  return value ? value.toLocaleString("en-US") : "—";
}

function hq(id: string, name: string): string {
  const where = locate(id, name);
  return where ? `${where.city}, ${where.region} · approx.` : "No pin";
}

function paintCard(lab: Lab | null, model: ModelRow | null, openHosts: Host[], openHost: Host | null) {
  const host = model ? openHosts.find((item) => item.id === hostId) ?? null : openHost;
  cardEl.hidden = !lab && !model && !host;
  if (cardEl.hidden) return;
  const title = document.querySelector("#card-name") as HTMLElement;
  const eyebrow = document.querySelector("#card-id") as HTMLElement;
  const sub = document.querySelector("#card-sub") as HTMLElement;
  const when = document.querySelector("#card-when") as HTMLElement;
  const body = document.querySelector("#card-body") as HTMLElement;
  body.replaceChildren();
  if (host) {
    const served = new Set(serves.filter((link) => link.host === host.id).map((link) => link.model));
    const byLab = labs.filter((item) => models.some((row) => row.lab === item.id && served.has(row.id)));
    title.textContent = host.name;
    eyebrow.textContent = "PROVIDER";
    when.textContent = `${host.models} models listed`;
    sub.textContent = `inspect provider ${host.id}`;
    if (model) addFact(body, "Serving", model.name);
    addFact(body, "Lab models", String(served.size));
    addFact(body, "Labs", byLab.map((item) => item.name).join(" · ") || "—");
    addFact(body, "HQ", hq(host.id, host.name));
    addFact(body, "Package", host.npm || "—");
    addFact(body, "API", host.api || "—", host.api || undefined);
  } else if (model && lab) {
    title.textContent = model.name;
    eyebrow.textContent = "MODEL";
    when.textContent = model.release ? (recent(model) ? `${model.release} · ${ago(model.release)}` : model.release) : "Release date unknown";
    sub.textContent = `inspect model ${model.id}`;
    addFact(body, "Lab", lab.name);
    const mapped = openHosts.filter((item) => locate(item.id, item.name));
    const summary = `${openHosts.length} · ${mapped.length} on map`;
    if (mapped.length) addFact(body, "Providers", summary, () => frameProviders(lab, mapped));
    else addFact(body, "Providers", summary);
    addFact(body, "Context", num(model.context));
    addFact(body, "Output", num(model.output));
    addFact(body, "Input", model.input.join(" · ") || "—");
    addFact(body, "Reasoning", yn(model.reasoning));
    addFact(body, "Tool call", yn(model.tools));
    addFact(body, "Structured", yn(model.structured));
    addFact(body, "Temperature", yn(model.temperature));
    addFact(body, "Weights", model.open ? "Open" : "Closed");
  } else if (lab) {
    const fresh = models.filter((item) => item.lab === lab.id && recent(item)).length;
    title.textContent = lab.name;
    eyebrow.textContent = "LAB";
    when.textContent = `${lab.models} models${fresh ? ` · ${fresh} in 15 days` : ""}`;
    sub.textContent = `inspect lab ${lab.id}`;
    addFact(body, "HQ", hq(lab.id, lab.name));
    addFact(body, "Newest", labModels(lab.id)[0]?.name ?? "—");
    addFact(body, "About", lab.description || "—");
  }
}

function addFact(root: HTMLElement, label: string, value: string, target?: string | (() => void)) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  if (value === "Yes" || value === "Open") dd.className = "yes";
  else if (value === "No") dd.className = "no";
  if (typeof target === "function") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "fact-link";
    button.textContent = `${value} ↗`;
    button.addEventListener("click", target);
    dd.append(button);
  } else if (target) {
    const link = document.createElement("a");
    link.href = target;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = value;
    dd.append(link);
  } else {
    dd.textContent = value;
  }
  row.append(dt, dd);
  root.append(row);
}

/** Turn and zoom the globe so a lab and its mapped providers are all in view. */
function frameProviders(lab: Lab, mapped: Host[]) {
  const spots = [locate(lab.id, lab.name), ...mapped.map((host) => locate(host.id, host.name))].filter(
    (spot): spot is NonNullable<typeof spot> => spot !== null,
  );
  globe.frame(spots);
}

async function load() {
  statusEl.textContent = "Loading catalog…";
  refreshEl.classList.add("spin");
  refreshEl.disabled = true;
  notice = "";
  try {
    const res = await fetch("/api/catalog");
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as CatalogBody;
    labs = body.labs ?? [];
    models = body.models ?? [];
    hosts = body.hosts ?? [];
    serves = body.serves ?? [];
    fetchedAt = body.fetchedAt ?? "";
    notice = body.error ?? "";
  } catch {
    labs = [];
    models = [];
    hosts = [];
    serves = [];
    notice = "Catalog request failed.";
  }
  refreshEl.classList.remove("spin");
  refreshEl.disabled = false;
  render();
}

function setWindow(onlyRecent: boolean) {
  recentOnly = onlyRecent;
  recentEl.setAttribute("aria-pressed", String(recentOnly));
  recentEl.classList.toggle("on", recentOnly);
  allEl.setAttribute("aria-pressed", String(!recentOnly));
  allEl.classList.toggle("on", !recentOnly);
  if (labId && !labModels(labId).length) {
    labId = null;
    modelId = null;
    hostId = null;
  }
  render();
}

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  render();
});
document.querySelectorAll<HTMLButtonElement>(".legend button[data-cat]").forEach((button) => {
  button.addEventListener("click", () => {
    const cat = button.dataset.cat as Category;
    show[cat] = !show[cat];
    button.classList.toggle("on", show[cat]);
    button.setAttribute("aria-pressed", String(show[cat]));
    // Drop selections that the hidden category would leave dangling.
    if (!show.model) {
      modelId = null;
      hostId = null;
    }
    render();
  });
});
recentEl.addEventListener("click", () => setWindow(true));
allEl.addEventListener("click", () => setWindow(false));
refreshEl.addEventListener("click", () => void load());
document.querySelector("#card-close")?.addEventListener("click", () => {
  if (hostId) hostId = null;
  else if (modelId) modelId = null;
  else labId = null;
  render();
});

filtersEl.addEventListener("toggle", capCard);
window.addEventListener("resize", capCard);

void load();
