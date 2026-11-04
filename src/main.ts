import { Globe, type Arc, type Pin, type Tone } from "./globe";
import { locate } from "./places";
import { modeCopy } from "./mode";
import { cueCard, cueClear, cueCluster, cueLand, cueModel, cueProvider, cueTick, setSound, soundOn } from "./sound";
import type { CatalogBody, Host, Lab, ModelRow, Serve } from "../shared/catalog";

const RECENT_MS = 15 * 24 * 60 * 60 * 1000;
const MODEL_CAP = 12;
const LATEST_CAP = 50;
const LATEST_DAYS = 7;

const statusEl = document.querySelector("#status") as HTMLElement;
const clockEl = document.querySelector("#clock") as HTMLElement;
const cardEl = document.querySelector("#card") as HTMLElement;
const searchEl = document.querySelector("#search") as HTMLInputElement;
const recentEl = document.querySelector("#recent") as HTMLButtonElement;
const allEl = document.querySelector("#win-all") as HTMLButtonElement;
const refreshEl = document.querySelector("#refresh") as HTMLButtonElement;
const latestEl = document.querySelector("#latest") as HTMLElement;
const filtersEl = document.querySelector(".filters") as HTMLDetailsElement;
const appEl = document.querySelector("#app") as HTMLElement;

// Mode-dependent wording: how fresh the data is and what refresh can do.
setText("#freshness", modeCopy.freshness);
refreshEl.title = modeCopy.refreshLabel;
refreshEl.setAttribute("aria-label", modeCopy.refreshLabel);

/** While set, the top-bar time shows a short message instead of the catalog time. */
let clockHold = 0;
function flashClock(message: string) {
  window.clearTimeout(clockHold);
  clockEl.textContent = message;
  clockHold = window.setTimeout(() => {
    clockHold = 0;
    clockEl.textContent = fetchedAt ? modeCopy.stamp(new Date(fetchedAt)) : "";
  }, 3500);
}
const SHORT_PX = 640;
const COMPACT_PX = 1000;
const SHEET_PX = 600;
// Small screens start with the side panels folded, so the globe is what you see first.
if (window.innerHeight < SHORT_PX || window.innerWidth < COMPACT_PX) {
  (latestEl.closest("details") as HTMLDetailsElement).open = false;
  filtersEl.open = false;
}

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
/** Compact screens: a lab shows its providers only after its card link asks for them. */
let revealFor: string | null = null;

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
      cueCard();
    } else if (kind === "model") {
      modelId = id;
      hostId = null;
      cueModel();
    } else {
      hostId = id;
      cueProvider();
      const place = locate(id, hosts.find((host) => host.id === id)?.name ?? "");
      if (place) globe.focus(place.lat, place.lng);
    }
    render();
  },
  () => {
    // Clicking empty globe drops the selection and closes the card.
    if (!labId && !modelId && !hostId) return;
    revealFor = null;
    cueClear();
    labId = null;
    modelId = null;
    hostId = null;
    render();
  },
);

function pickModel(model: ModelRow) {
  cueModel();
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

function within(model: ModelRow, days: number): boolean {
  const time = Date.parse(`${model.release}T00:00:00Z`);
  return Number.isFinite(time) && Date.now() >= time && Date.now() - time <= days * 86400000;
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
    relatedHosts = !compact() || revealFor === openLab.id ? hostsServing(labModels(openLab.id)) : [];
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
      // Other labs step off the map while something is selected; clearing the selection brings them back.
      ghost: tone === "dim",
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
    if (tone === "dim") continue;
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
  const tight = window.innerHeight < SHORT_PX || compact();
  const card = cardEl.hidden ? "" : `${labId}|${modelId}|${hostId}`;
  appEl.dataset.card = card ? "open" : "closed";
  if (tight && card && card !== lastCard) {
    filtersEl.open = false;
    (latestEl.closest("details") as HTMLDetailsElement).open = false;
  }
  lastCard = card;
  capCard();
  placeGlobe();
}

function compact(): boolean {
  return window.innerWidth < COMPACT_PX;
}

function sheet(): boolean {
  return window.innerWidth < SHEET_PX;
}

/** Compact screens: centre the globe in the space the card leaves free. */
function placeGlobe() {
  const box = cardEl.hidden ? null : cardEl.getBoundingClientRect();
  const inset = !box ? { left: 0, bottom: 0 } : sheet() ? { left: 0, bottom: box.height } : { left: box.right, bottom: 0 };
  globe.setLayout(compact(), inset);
}

/** The card and the filters share the left edge; the card stops above the filters. */
function capCard() {
  if (sheet()) {
    // Bottom sheet: its height comes from CSS.
    cardEl.style.maxHeight = "";
    return;
  }
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
  if (!clockHold) clockEl.textContent = fetchedAt ? modeCopy.stamp(new Date(fetchedAt)) : "";
  if (!globe.ready) statusEl.textContent = "WebGL is unavailable.";
  else if (notice) statusEl.textContent = notice;
  else statusEl.textContent = `${labs.length} labs · ${models.length} models · ${hosts.length} providers`;
}

/** Latest lists recent releases: 7 days by default, 15 when the 15-day window is on. */
function paintLatest(q: string) {
  const days = recentOnly ? 15 : LATEST_DAYS;
  const labName = new Map(labs.map((lab) => [lab.id, lab.name]));
  const rows = (show.model ? models : [])
    .filter((model) => model.release && within(model, days))
    .filter((model) => !q || model.lab.includes(q) || (labName.get(model.lab) ?? "").toLowerCase().includes(q))
    .slice(0, LATEST_CAP);
  setText("#latest-count", String(rows.length));
  setText("#latest-window", `${days} days`);
  latestEl.replaceChildren();
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = show.model ? `No releases in the last ${days} days.` : "Models are hidden.";
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

function basedIn(id: string, name: string): string {
  const where = locate(id, name);
  return where ? `Based in ${where.city}, ${where.region} (approximate)` : "Not pinned on the map";
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
  cardEl.classList.toggle("model", !host && !!model && !!lab);
  cardEl.classList.toggle("glance", !!host || !(model && lab));
  if (host) {
    const served = new Set(serves.filter((link) => link.host === host.id).map((link) => link.model));
    const byLab = labs.filter((item) => models.some((row) => row.lab === item.id && served.has(row.id)));
    title.textContent = host.name;
    eyebrow.textContent = "PROVIDER";
    when.textContent = basedIn(host.id, host.name);
    sub.textContent = `inspect provider ${host.id}`;
    paintHost(body, host, served, byLab, model);
  } else if (model && lab) {
    title.textContent = model.name;
    eyebrow.textContent = "MODEL";
    const date = model.release ? (recent(model) ? `${model.release} · ${ago(model.release)}` : model.release) : "Release date unknown";
    when.textContent = `${lab.name} · ${date}`;
    sub.textContent = `inspect model ${model.id}`;
    paintModel(body, lab, openHosts, model);
  } else if (lab) {
    const fresh = models.filter((item) => item.lab === lab.id && recent(item)).length;
    title.textContent = lab.name;
    eyebrow.textContent = "LAB";
    when.textContent = basedIn(lab.id, lab.name);
    sub.textContent = `inspect lab ${lab.id}`;
    const served = hostsServing(labModels(lab.id));
    paintLab(body, lab, fresh, served, served.filter((item) => locate(item.id, item.name)));
  }
}

const ICON: Record<string, string> = {
  context: "M5 3.5H3.5v9H5M11 3.5h1.5v9H11M6.5 8h3",
  output: "M3 8h9M8.5 4.5 12 8l-3.5 3.5",
  text: "M3.5 4.5h9M8 4.5v8",
  image: "M2.5 3.5h11v9h-11zM2.5 10.5l3.2-3 2.8 2.8 1.7-1.6 3.3 3.1M10.6 6h.01",
  pdf: "M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12M6 8.5h4M6 10.8h4",
  audio: "M8 2.5v11M5 5v6M11 5v6M2.5 7v2M13.5 7v2",
  video: "M2.5 4.5h7v7h-7zM9.5 7l4-2v6l-4-2",
  reasoning: "M8 1.8 9.5 6.5 14.2 8 9.5 9.5 8 14.2 6.5 9.5 1.8 8 6.5 6.5Z",
  tools: "M3 4.5l4 3.5-4 3.5M8.5 12h4.5",
  structured:
    "M6.2 2.5c-1.5 0-1.7 1-1.7 2v1.3c0 1-.7 2.2-2 2.2 1.3 0 2 1.2 2 2.2v1.3c0 1 .2 2 1.7 2M9.8 2.5c1.5 0 1.7 1 1.7 2v1.3c0 1 .7 2.2 2 2.2-1.3 0-2 1.2-2 2.2v1.3c0 1-.2 2-1.7 2",
  dash: "M4 8h8",
  closed: "M4.5 7.5h7v5.5h-7zM6 7.5V5.5a2 2 0 0 1 4 0v2",
  open: "M4.5 7.5h7v5.5h-7zM6 7.5V5.5a2 2 0 0 1 3.7-1",
};

function svg(path: string, size = 14): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** A ring with a centre dot, the same mark as the provider legend. */
function ring(lit: boolean): string {
  return `<span class="ring${lit ? " lit" : ""}"><i></i></span>`;
}

function section(root: HTMLElement, title: string): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "sec";
  const label = document.createElement("p");
  label.className = "sec-title";
  label.textContent = title;
  wrap.append(label);
  root.append(wrap);
  return wrap;
}

function chip(className: string, icon: string, text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = className;
  el.innerHTML = svg(icon);
  el.append(text);
  return el;
}

/** Short form for token counts: 1,000,000 → 1M, 128,000 → 128K. */
function tokens(value: number): string {
  if (!value) return "—";
  if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${+(value / 1000).toFixed(1)}K`;
  return String(value);
}

/** The model card body: limits, inputs, capabilities, and who serves it, each in its own band. */
function paintModel(root: HTMLElement, lab: Lab, openHosts: Host[], model: ModelRow) {
  const mapped = openHosts.filter((item) => locate(item.id, item.name));

  const limits = section(root, "LIMITS");
  const tiles = document.createElement("div");
  tiles.className = "tiles";
  for (const [label, icon, value] of [
    ["Context window", ICON.context, model.context],
    ["Max output", ICON.output, model.output],
  ] as const) {
    const tile = document.createElement("div");
    tile.className = "tile";
    const head = document.createElement("span");
    head.className = "tile-label";
    head.innerHTML = svg(icon);
    head.append(label);
    const big = document.createElement("span");
    big.className = "tile-big";
    big.textContent = tokens(value);
    const small = document.createElement("span");
    small.className = "tile-small";
    small.textContent = value ? `${num(value)} tokens` : "not listed";
    tile.append(head, big, small);
    tiles.append(tile);
  }
  limits.append(tiles);

  const input = section(root, "INPUT");
  const kinds = document.createElement("div");
  kinds.className = "chips";
  for (const kind of model.input.length ? model.input : ["text"]) kinds.append(chip("chip", ICON[kind] ?? ICON.text, kind));
  input.append(kinds);

  const caps = section(root, "CAPABILITIES");
  const pills = document.createElement("div");
  pills.className = "chips";
  const flag = (on: boolean, icon: string, yes: string, no: string) => chip(on ? "pill on" : "pill off", on ? icon : ICON.dash, on ? yes : no);
  pills.append(
    flag(model.reasoning, ICON.reasoning, "Reasoning", "No reasoning"),
    flag(model.tools, ICON.tools, "Tool call", "No tool call"),
    flag(model.structured, ICON.structured, "Structured output", "No structured output"),
    flag(model.temperature, ICON.dash, "Temperature", "Temperature: off"),
    chip("pill plain", model.open ? ICON.open : ICON.closed, model.open ? "Open weights" : "Closed weights"),
  );
  caps.append(pills);

  const band = document.createElement("section");
  band.className = "sec";
  const box = document.createElement("div");
  box.className = "hosts";
  const head = document.createElement("div");
  head.className = "hosts-head";
  head.innerHTML = `<span class="hosts-label">${ring(true)}Providers</span>`;
  const count = document.createElement("span");
  count.className = "hosts-count";
  count.append(String(openHosts.length));
  const serve = document.createElement("small");
  serve.textContent = " serve it";
  count.append(serve);
  head.append(count);
  const lit = Math.min(mapped.length, 40);
  const dots = document.createElement("div");
  dots.className = "dots";
  dots.setAttribute("role", "img");
  dots.setAttribute("aria-label", `${openHosts.length} providers, ${mapped.length} of them on the map`);
  dots.innerHTML = ring(true).repeat(lit) + ring(false).repeat(Math.min(openHosts.length - mapped.length, 40 - lit));
  const foot = document.createElement("div");
  foot.className = "hosts-foot";
  foot.innerHTML = `<span class="hosts-key">${ring(true)}${mapped.length} on the map</span>`;
  if (mapped.length) {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "hosts-go";
    go.innerHTML = `Show on globe <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    go.addEventListener("click", () => frameProviders(lab, mapped));
    foot.append(go);
  }
  box.append(head, dots, foot);
  band.append(box);
  root.append(band);
}

/** Two big numbers side by side, each with a small caption. */
function figures(root: HTMLElement, items: [string, string, boolean?][]) {
  const row = document.createElement("div");
  row.className = "figures";
  items.forEach(([value, caption, hot], index) => {
    if (index) row.append(Object.assign(document.createElement("i"), { className: "figure-rule" }));
    const cell = document.createElement("div");
    const big = document.createElement("span");
    big.className = hot ? "figure-big hot" : "figure-big";
    big.textContent = value;
    const small = document.createElement("span");
    small.className = "figure-small";
    small.textContent = caption;
    cell.append(big, small);
    row.append(cell);
  });
  root.append(row);
}

function glanceTitle(root: HTMLElement, text: string): void {
  const label = document.createElement("p");
  label.className = "glance-title";
  label.textContent = text;
  root.append(label);
}

/** A bordered row that holds an icon, a label and an optional trailing note. */
function row(icon: string, text: string, note = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = "glance-row";
  el.innerHTML = svg(icon, 16);
  el.append(text);
  if (note) {
    const tail = document.createElement("small");
    tail.textContent = note;
    el.append(tail);
  }
  return el;
}

const GLOBE = "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM2 8h12M8 2c2 1.8 2 10.2 0 12M8 2c-2 1.8-2 10.2 0 12";

/** Lab card body: headline numbers, newest model, and a button to its providers. */
function paintLab(root: HTMLElement, lab: Lab, fresh: number, served: Host[], mapped: Host[]) {
  figures(root, [
    [String(lab.models), "models"],
    [String(fresh), "new in 15 days", fresh > 0],
  ]);
  const newest = labModels(lab.id)[0];
  if (newest) {
    glanceTitle(root, "NEWEST");
    const line = row("M8 2 14 8 8 14 2 8Z", newest.name, newest.release ? ago(newest.release) : "");
    line.classList.add("hot-icon");
    root.append(line);
  }
  const go = document.createElement("button");
  go.type = "button";
  go.className = "glance-go";
  go.innerHTML = `<span>${ring(true)}${served.length} providers · ${mapped.length} on the map</span><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (mapped.length) {
    go.addEventListener("click", () => {
      revealFor = lab.id;
      render();
      frameProviders(lab, mapped);
    });
  } else {
    go.disabled = true;
  }
  root.append(go);
}

/** Provider card body: headline numbers, the labs it serves, and how to connect. */
function paintHost(root: HTMLElement, host: Host, served: Set<string>, byLab: Lab[], model: ModelRow | null) {
  figures(root, [
    [String(host.models), "models listed"],
    [String(byLab.length), "labs served"],
  ]);
  if (model) {
    glanceTitle(root, "SERVING");
    root.append(row("M8 2 14 8 8 14 2 8Z", model.name));
  }
  if (byLab.length) {
    glanceTitle(root, "LABS");
    const names = document.createElement("p");
    names.className = "glance-labs";
    const shown = byLab.slice(0, 8);
    names.textContent = shown.map((item) => item.name).join(" · ");
    if (byLab.length > shown.length) {
      const more = document.createElement("small");
      more.textContent = ` +${byLab.length - shown.length} more`;
      names.append(more);
    }
    root.append(names);
  }
  if (host.npm || host.api) {
    glanceTitle(root, "CONNECT");
    if (host.npm) root.append(row("M3 4.5l4 3.5-4 3.5M8.5 12h4.5", host.npm));
    if (host.api) {
      const link = document.createElement("a");
      link.className = "glance-go api";
      link.href = host.api;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerHTML = `<span>${svg(GLOBE, 16)}<b></b></span><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      (link.querySelector("b") as HTMLElement).textContent = host.api.replace(/^https?:\/\//, "");
      root.append(link);
    }
  }
  void served;
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

/** The last good catalog, kept in this browser so a return visit paints at once and works offline. */
const SAVED_KEY = "modex:catalog";
/** The catalog changes a few times a day; an open tab checks twice an hour. */
const REFRESH_MS = 30 * 60 * 1000;

function useCatalog(body: CatalogBody) {
  labs = body.labs ?? [];
  models = body.models ?? [];
  hosts = body.hosts ?? [];
  serves = body.serves ?? [];
  fetchedAt = body.fetchedAt ?? "";
}

function readSaved(): CatalogBody | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const body = raw ? (JSON.parse(raw) as CatalogBody) : null;
    return body && Array.isArray(body.labs) && body.labs.length ? body : null;
  } catch {
    return null;
  }
}

function save(body: CatalogBody) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(body));
  } catch {
    // Storage full or blocked: the app still works, it just won't paint instantly next time.
  }
}

/**
 * Fetch the catalog. Quiet loads (the background refresh) leave the UI alone unless the data changed;
 * a failed fetch keeps whatever is on screen and says it is the saved copy.
 * An explicit refresh asks the browser to revalidate instead of reusing its 15-minute HTTP cache.
 */
async function load(options: { quiet?: boolean; force?: boolean } = {}) {
  if (!options.quiet) {
    statusEl.textContent = "Loading catalog…";
    refreshEl.classList.add("spin");
    refreshEl.disabled = true;
  }
  try {
    const res = await fetch(__CATALOG_URL__, options.force ? { cache: "no-cache" } : undefined);
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as CatalogBody;
    const changed = body.fetchedAt !== fetchedAt;
    if (options.force && !changed) flashClock(modeCopy.upToDate());
    const before = notice;
    if (body.labs?.length) {
      useCatalog(body);
      save(body);
    }
    notice = body.error ?? "";
    if (!options.quiet || changed || notice !== before) render();
  } catch {
    if (labs.length) {
      const time = fetchedAt ? new Date(fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
      notice = `Offline · showing the saved catalog${time ? ` from ${time}` : ""}.`;
    } else {
      notice = "Catalog request failed.";
    }
    render();
  }
  refreshEl.classList.remove("spin");
  refreshEl.disabled = false;
  appEl.dataset.state = "ready";
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
    cueTick();
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
recentEl.addEventListener("click", () => {
  cueTick();
  setWindow(true);
});
allEl.addEventListener("click", () => {
  cueTick();
  setWindow(false);
});
refreshEl.addEventListener("click", () => {
  cueTick();
  void load({ force: true });
});
document.querySelectorAll(".panel summary").forEach((summary) => summary.addEventListener("click", cueTick));
globe.onArcLand = cueLand;
globe.onClusterOpen = cueCluster;

const aboutEl = document.querySelector("#about") as HTMLElement;
const aboutBtn = document.querySelector("#about-btn") as HTMLButtonElement;
function showAbout(open: boolean) {
  if (aboutEl.hidden === !open) return;
  aboutEl.hidden = !open;
  aboutBtn.setAttribute("aria-expanded", String(open));
  cueTick();
}
aboutBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  showAbout(aboutEl.hidden);
});
document.querySelector("#about-close")?.addEventListener("click", () => showAbout(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") showAbout(false);
});
// A click anywhere outside the panel closes it, the globe included.
document.addEventListener("pointerdown", (event) => {
  const target = event.target as Node;
  if (!aboutEl.hidden && !aboutEl.contains(target) && !aboutBtn.contains(target)) showAbout(false);
});

const soundEl = document.querySelector("#sound") as HTMLButtonElement;
function paintSound() {
  const on = soundOn();
  soundEl.setAttribute("aria-pressed", String(on));
  soundEl.setAttribute("aria-label", on ? "Sound on" : "Sound off");
  soundEl.title = on ? "Sound on" : "Sound off";
}
soundEl.addEventListener("click", () => {
  setSound(!soundOn());
  paintSound();
});
paintSound();
document.querySelector("#card-close")?.addEventListener("click", () => {
  cueClear();
  if (hostId) hostId = null;
  else if (modelId) modelId = null;
  else labId = null;
  render();
});

filtersEl.addEventListener("toggle", capCard);
window.addEventListener("resize", () => {
  capCard();
  render();
});

// A saved catalog paints straight away; the network copy replaces it when it arrives.
const saved = readSaved();
if (saved) {
  useCatalog(saved);
  appEl.dataset.state = "ready";
  render();
}
void load({ quiet: !!saved });
// Keep an open tab current without polling for data that rarely changes.
setInterval(() => {
  if (!document.hidden) void load({ quiet: true });
}, REFRESH_MS);
