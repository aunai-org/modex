import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { feature } from "topojson-client";
import { geoEquirectangular, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import world from "world-atlas/countries-110m.json";
import type { Topology } from "topojson-specification";

const RADIUS = 1.48;
const RING_OUTER = 0.05;
const FLIGHT_MS = 700;
/** Pins closer than this on screen merge into one cluster badge. */
const CLUSTER_PX = 26;
/** Ring radii in CSS pixels: models around their lab, and pins fanned around a point. */
const FAN_PX = 56;
const RING_MIN_PX = 30;

export type Kind = "lab" | "model" | "host";

/**
 * focus: the selection. related: tied to the selection (or everything when nothing is selected).
 * dim: on the map for orientation only.
 */
export type Tone = "focus" | "related" | "dim";

export type Pin = {
  id: string;
  kind: Kind;
  label: string;
  tone: Tone;
  ripple: boolean;
  lat: number;
  lng: number;
  /** Models fan out around their lab instead of sitting on the map. */
  fan?: { index: number; count: number };
  /** The selected place: never clustered, and nearby pins ring around it. */
  anchor?: boolean;
};

export type Arc = { fromLat: number; fromLng: number; toLat: number; toLng: number };


/** On-screen marker size in CSS pixels, whatever the zoom. */
const MARKER_PX: Record<Kind, number> = { lab: 22, host: 18, model: 16 };
const TONE_SCALE: Record<Tone, number> = { focus: 1.3, related: 1, dim: 0.7 };
const AMBER = "#f5a04a";

export function toVector(lat: number, lng: number, radius = RADIUS): THREE.Vector3 {
  const a = (lat * Math.PI) / 180;
  const b = (lng * Math.PI) / 180;
  return new THREE.Vector3(radius * Math.cos(a) * Math.cos(b), radius * Math.sin(a), -radius * Math.cos(a) * Math.sin(b));
}

function toLatLng(v: THREE.Vector3): { lat: number; lng: number } {
  const n = v.clone().normalize();
  return { lat: (Math.asin(n.y) * 180) / Math.PI, lng: (Math.atan2(-n.z, n.x) * 180) / Math.PI };
}

function icon(kind: Kind, tone: Tone): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  const color = tone === "focus" ? AMBER : tone === "dim" ? "#6b7178" : kind === "host" ? "#9ecbff" : "#f4f4f4";
  g.clearRect(0, 0, 96, 96);
  g.strokeStyle = color;
  g.fillStyle = "#101114";
  g.lineWidth = tone === "focus" ? 7 : tone === "dim" ? 3 : 4;
  if (kind === "lab") {
    // Hexagon hub with a three-node network inside.
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = 48 + Math.cos(a) * 38;
      const y = 48 + Math.sin(a) * 38;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.stroke();
    const nodes: [number, number][] = [
      [48, 30],
      [33, 57],
      [63, 57],
    ];
    g.lineWidth = tone === "focus" ? 4 : 3;
    g.beginPath();
    g.moveTo(...nodes[0]);
    g.lineTo(...nodes[1]);
    g.lineTo(...nodes[2]);
    g.closePath();
    g.stroke();
    g.fillStyle = color;
    for (const [x, y] of nodes) {
      g.beginPath();
      g.arc(x, y, 6.5, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "model") {
    g.beginPath();
    g.moveTo(48, 14);
    g.lineTo(80, 48);
    g.lineTo(48, 82);
    g.lineTo(16, 48);
    g.closePath();
    g.fill();
    g.stroke();
  } else {
    g.beginPath();
    g.arc(48, 48, 28, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(48, 48, 8, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A round badge with the number of pins it stands for. */
function badge(count: number, tone: Tone): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  const color = tone === "dim" ? "#6b7178" : "#f4f4f4";
  g.beginPath();
  g.arc(48, 48, 40, 0, Math.PI * 2);
  g.fillStyle = "#101114";
  g.fill();
  g.lineWidth = tone === "dim" ? 3 : 4;
  g.strokeStyle = color;
  g.stroke();
  g.beginPath();
  g.arc(48, 48, 32, 0, Math.PI * 2);
  g.lineWidth = 1.5;
  g.globalAlpha = 0.5;
  g.stroke();
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.font = `600 ${count > 9 ? 34 : 40}px "IBM Plex Mono", monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(count), 48, 51);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function earthTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#07080b";
  ctx.fillRect(0, 0, 2048, 1024);
  const topology = world as unknown as Topology;
  const countries = feature(topology, topology.objects.countries) as FeatureCollection<Geometry>;
  const projection = geoEquirectangular().scale(2048 / (2 * Math.PI)).translate([1024, 512]);
  const path = geoPath(projection, ctx);
  const land = ["#1c1e22", "#26282d", "#141618", "#2e3136", "#101214"];
  countries.features.forEach((country, i) => {
    ctx.beginPath();
    path(country);
    ctx.fillStyle = land[i % land.length];
    ctx.fill();
    ctx.strokeStyle = "#8b8e95";
    ctx.lineWidth = 1.1;
    ctx.stroke();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return tex;
}

/** A point on a ring of `radius` world units around `center`, lifted off the surface. */
function around(center: THREE.Vector3, index: number, count: number, radius: number, lift = 0.06): THREE.Vector3 {
  const up = center.clone().normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
  if (east.lengthSq() < 1e-4) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const ang = (index / Math.max(count, 1)) * Math.PI * 2 + Math.PI / 2;
  return up
    .multiplyScalar(RADIUS + lift)
    .addScaledVector(east, Math.cos(ang) * radius)
    .addScaledVector(north, Math.sin(ang) * radius);
}

function arcLine(arc: Arc): THREE.Line {
  const a = toVector(arc.fromLat, arc.fromLng, 1);
  const b = toVector(arc.toLat, arc.toLng, 1);
  const angle = a.angleTo(b);
  const lift = 0.04 + angle * 0.22;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const p = a.clone().lerp(b, t).normalize();
    points.push(p.multiplyScalar(RADIUS + 0.02 + Math.sin(Math.PI * t) * lift));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: 0x9ecbff, transparent: true, opacity: 0.55 }),
  );
}

type Marker = THREE.Sprite & {
  userData: {
    id: string;
    kind: Kind;
    label: string;
    tone: Tone;
    home: THREE.Vector3;
    fan: { index: number; count: number } | null;
    anchor: boolean;
    ring: THREE.Mesh | null;
  };
};

/** Labs and providers can share an id (a lab that also serves its own API), so key by both. */
const key = (m: Marker) => `${m.userData.kind}:${m.userData.id}`;

type Badge = THREE.Sprite & {
  userData: { center: THREE.Vector3; ids: string[]; label: string; ring: THREE.Mesh; tone: Tone; count: number };
};

export class Globe {
  readonly ready: boolean;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private markers = new THREE.Group();
  private badges = new THREE.Group();
  private ripples = new THREE.Group();
  private arcs = new THREE.Group();
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down: [number, number] | null = null;
  private onPick: (id: string, kind: Kind) => void;
  private icons = new Map<string, THREE.CanvasTexture>();
  private ringGeometry = new THREE.RingGeometry(RING_OUTER * 0.8, RING_OUTER, 40);
  private scratch = new THREE.Vector3();
  private flight: { from: THREE.Quaternion; to: THREE.Quaternion; dir: THREE.Vector3; start: number; d0: number; d1: number } | null =
    null;
  /** A cluster that could not split by zooming, fanned out in place. */
  private spider: { center: THREE.Vector3; ids: string[]; dist: number } | null = null;
  private tip: HTMLElement;
  private hover: [number, number] | null = null;

  constructor(private root: HTMLElement, onPick: (id: string, kind: Kind) => void) {
    this.onPick = onPick;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(1.2, 0.8, 6.6);
    this.tip = document.createElement("div");
    this.tip.className = "tip";
    this.tip.hidden = true;
    this.root.append(this.tip);
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(1);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.root.append(this.renderer.domElement);
      this.ready = true;
    } catch {
      this.ready = false;
      return;
    }
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.45;
    this.controls.zoomSpeed = 0.55;
    this.controls.minDistance = 3.1;
    this.controls.maxDistance = 9;
    this.controls.addEventListener("start", () => {
      this.flight = null;
    });
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(RADIUS, 40, 28),
      new THREE.MeshPhongMaterial({ map: earthTexture(this.renderer), specular: 0x111111, shininess: 4 }),
    );
    this.scene.add(globe);
    this.scene.add(new THREE.AmbientLight(0xc8c8cc, 1.05));
    const sun = new THREE.DirectionalLight(0xf2f2f4, 1.15);
    sun.position.set(-3, 1.6, 4.2);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x3a3d44, 0.4);
    fill.position.set(3.4, -1.2, -2.8);
    this.scene.add(fill);
    this.scene.add(this.arcs, this.ripples, this.markers, this.badges);
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.down = [event.clientX, event.clientY];
    });
    canvas.addEventListener("pointerup", (event) => this.pick(event));
    canvas.addEventListener("pointermove", (event) => {
      this.hover = event.buttons ? null : [event.clientX, event.clientY];
    });
    canvas.addEventListener("pointerleave", () => {
      this.hover = null;
    });
    this.resize();
    window.addEventListener("resize", () => this.resize());
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      this.fly(now);
      this.controls?.update();
      this.layout(now / 1000);
      this.hoverTip();
      this.renderer?.render(this.scene, this.camera);
    };
    loop();
  }

  show(pins: Pin[], arcs: Arc[]) {
    this.clear();
    this.spider = null;
    for (const pin of pins) {
      // A fanned model's home is its lab; layout() rings it around that point.
      this.add(pin, toVector(pin.lat, pin.lng, RADIUS + (pin.kind === "host" ? 0.05 : 0.02)));
    }
    for (const arc of arcs) this.arcs.add(arcLine(arc));
  }

  /** Turn the globe to face a place. Keeps the current zoom unless a distance is given. */
  focus(lat: number, lng: number, distance?: number) {
    const from = this.camera.position.clone().normalize();
    const to = toVector(lat, lng, 1).normalize();
    const d0 = this.camera.position.length();
    this.flight = {
      from: new THREE.Quaternion(),
      to: new THREE.Quaternion().setFromUnitVectors(from, to),
      dir: from,
      start: performance.now(),
      d0,
      d1: distance ?? d0,
    };
  }

  private fly(now: number) {
    if (!this.flight) return;
    const k = Math.min((now - this.flight.start) / FLIGHT_MS, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    const turn = this.flight.from.clone().slerp(this.flight.to, ease);
    const dist = this.flight.d0 + (this.flight.d1 - this.flight.d0) * ease;
    this.camera.position.copy(this.flight.dir).applyQuaternion(turn).setLength(dist);
    if (k === 1) this.flight = null;
  }

  /**
   * Every frame: fixed pixel sizes, far-side hiding, and screen-space clustering.
   * Clusters only form among pins of the same tone, and never include the selection.
   */
  private layout(t: number) {
    const cam = this.camera.position;
    const height = Math.max(this.renderer?.domElement.clientHeight ?? 1, 1);
    const width = Math.max(this.renderer?.domElement.clientWidth ?? 1, 1);
    const perPx = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / height;
    const horizon = RADIUS * RADIUS;
    const facing = (at: THREE.Vector3) => this.scratch.copy(at).setLength(RADIUS).dot(cam) - horizon > 0;
    const worldSize = (at: THREE.Vector3, px: number) => px * perPx * at.distanceTo(cam);

    const ringPx = (n: number) => Math.max(RING_MIN_PX, 12 + n * 6);
    const screen = (at: THREE.Vector3) => {
      const p = this.scratch.copy(at).project(this.camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    };

    if (this.spider && cam.length() > this.spider.dist + 0.35) this.spider = null;
    const spun = new Map<string, THREE.Vector3>();
    if (this.spider) {
      const { center, ids } = this.spider;
      const r = worldSize(center, ringPx(ids.length));
      ids.forEach((id, i) => spun.set(id, around(center, i, ids.length, r, 0.05)));
    }

    const markers = this.markers.children as Marker[];
    // The selection's neighbours ring around it, so nothing hides under the selected pin.
    const anchor = markers.find((m) => m.userData.anchor && facing(m.userData.home));
    if (anchor) {
      const at = screen(anchor.userData.home);
      const near = markers.filter((m) => {
        const d = m.userData;
        if (m === anchor || d.fan || spun.has(key(m)) || !facing(d.home)) return false;
        const p = screen(d.home);
        return Math.hypot(p.x - at.x, p.y - at.y) <= CLUSTER_PX;
      });
      const r = worldSize(anchor.userData.home, ringPx(near.length));
      near.forEach((m, i) => spun.set(key(m), around(anchor.userData.home, i, near.length, r, 0.05)));
    }

    const loose: { m: Marker; x: number; y: number }[] = [];
    for (const m of markers) {
      const d = m.userData;
      if (d.fan) {
        const r = worldSize(d.home, FAN_PX + d.fan.count * 2);
        m.position.copy(around(d.home, d.fan.index, d.fan.count, r));
      } else {
        m.position.copy(spun.get(key(m)) ?? d.home);
      }
      m.visible = facing(d.fan ? d.home : m.position);
      if (m.visible && !d.fan && !d.anchor && d.tone !== "focus" && !spun.has(key(m))) {
        loose.push({ m, ...screen(m.position) });
      }
    }

    // Greedy clustering: labs seed first so a lab city reads as a lab cluster.
    loose.sort((a, b) => (a.m.userData.kind === "lab" ? 0 : 1) - (b.m.userData.kind === "lab" ? 0 : 1));
    const groups: Marker[][] = [];
    const taken = new Set<Marker>();
    for (const seed of loose) {
      if (taken.has(seed.m)) continue;
      const group = [seed.m];
      taken.add(seed.m);
      for (const other of loose) {
        if (taken.has(other.m) || other.m.userData.tone !== seed.m.userData.tone) continue;
        if (Math.hypot(other.x - seed.x, other.y - seed.y) <= CLUSTER_PX) {
          group.push(other.m);
          taken.add(other.m);
        }
      }
      if (group.length > 1) groups.push(group);
    }

    const pool = this.badges.children as Badge[];
    groups.forEach((group, i) => {
      for (const m of group) m.visible = false;
      const center = new THREE.Vector3();
      for (const m of group) center.add(m.userData.home.clone().normalize());
      center.setLength(RADIUS + 0.06);
      const tone = group[0].userData.tone;
      const labs = group.filter((m) => m.userData.kind === "lab");
      const hosts = group.length - labs.length;
      const names = group.map((m) => m.userData.label);
      const label = [
        [labs.length && `${labs.length} lab${labs.length > 1 ? "s" : ""}`, hosts && `${hosts} provider${hosts > 1 ? "s" : ""}`]
          .filter(Boolean)
          .join(" · "),
        names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : ""),
      ].join("\n");
      const b = pool[i] ?? this.newBadge();
      b.visible = true;
      b.position.copy(center);
      b.userData.center = center;
      b.userData.ids = group.map(key);
      b.userData.label = label;
      if (b.userData.tone !== tone || b.userData.count !== group.length) {
        b.userData.tone = tone;
        b.userData.count = group.length;
        b.material.map = this.badgeTex(group.length, tone);
        b.material.opacity = tone === "dim" ? 0.6 : 1;
        b.material.needsUpdate = true;
      }
      // A cluster pulses once when any lab inside it is fresh.
      b.userData.ring.visible = group.some((m) => m.userData.ring);
      b.userData.ring.position.copy(center);
      b.userData.ring.lookAt(center.clone().multiplyScalar(2));
      const px = 26 * (tone === "dim" ? 0.8 : 1);
      const size = worldSize(center, px);
      b.scale.set(size, size, 1);
      this.pulse(b.userData.ring, size, t, 0);
    });
    for (let i = groups.length; i < pool.length; i++) {
      pool[i].visible = false;
      pool[i].userData.ring.visible = false;
    }

    for (const m of markers) {
      const d = m.userData;
      const size = worldSize(m.position, MARKER_PX[d.kind] * TONE_SCALE[d.tone]);
      m.scale.set(size, size, 1);
      if (d.ring) {
        d.ring.visible = m.visible;
        d.ring.position.copy(m.position);
        d.ring.lookAt(m.position.clone().multiplyScalar(2));
        this.pulse(d.ring, size, t, d.ring.userData.phase as number);
      }
    }
  }

  private pulse(ring: THREE.Mesh, size: number, t: number, phase: number) {
    const k = ((t + phase) % 1.6) / 1.6;
    ring.scale.setScalar((size / 2 / RING_OUTER) * (1 + k * 1.6));
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
  }

  private hoverTip() {
    if (!this.hover || !this.renderer) {
      this.tip.hidden = true;
      this.renderer?.domElement.style.setProperty("cursor", "");
      return;
    }
    const hit = this.hitAt(this.hover[0], this.hover[1]);
    const label = hit ? (hit.userData.label as string) : "";
    this.renderer.domElement.style.cursor = hit ? "pointer" : "";
    if (!label) {
      this.tip.hidden = true;
      return;
    }
    const rect = this.root.getBoundingClientRect();
    if (this.tip.textContent !== label) this.tip.textContent = label;
    this.tip.style.left = `${this.hover[0] - rect.left + 14}px`;
    this.tip.style.top = `${this.hover[1] - rect.top + 14}px`;
    this.tip.hidden = false;
  }

  private hitAt(x: number, y: number): THREE.Object3D | null {
    if (!this.renderer) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const targets = [...this.badges.children, ...this.markers.children].filter((o) => o.visible);
    return this.ray.intersectObjects(targets, false)[0]?.object ?? null;
  }

  private clear() {
    for (const child of [...this.markers.children, ...this.ripples.children, ...this.badges.children]) {
      const material = (child as THREE.Sprite | THREE.Mesh).material;
      if (material && !Array.isArray(material)) material.dispose();
    }
    for (const line of this.arcs.children as THREE.Line[]) {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.markers.clear();
    this.ripples.clear();
    this.badges.clear();
    this.arcs.clear();
  }

  private tex(kind: Kind, tone: Tone): THREE.CanvasTexture {
    const key = `${kind}:${tone}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const made = icon(kind, tone);
    this.icons.set(key, made);
    return made;
  }

  private badgeTex(count: number, tone: Tone): THREE.CanvasTexture {
    const key = `badge:${count}:${tone}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const made = badge(count, tone);
    this.icons.set(key, made);
    return made;
  }

  private ring(color: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      this.ringGeometry,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.userData.phase = Math.random();
    this.ripples.add(ring);
    return ring;
  }

  private newBadge(): Badge {
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false })) as Badge;
    b.renderOrder = 2;
    b.userData = { center: new THREE.Vector3(), ids: [], label: "", ring: this.ring(0xf4f4f4), tone: "related", count: 0 };
    this.badges.add(b);
    return b;
  }

  private add(pin: Pin, home: THREE.Vector3) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex(pin.kind, pin.tone),
        transparent: true,
        opacity: pin.tone === "dim" ? 0.6 : 1,
        depthTest: false,
        depthWrite: false,
      }),
    ) as Marker;
    sprite.position.copy(home);
    sprite.renderOrder = pin.tone === "focus" ? 5 : pin.kind === "host" ? 4 : pin.kind === "model" ? 3 : 1;
    sprite.userData = {
      id: pin.id,
      kind: pin.kind,
      label: pin.label,
      tone: pin.tone,
      home,
      fan: pin.fan ?? null,
      anchor: pin.anchor === true,
      ring: pin.ripple ? this.ring(pin.tone === "focus" ? 0xf5a04a : 0xf4f4f4) : null,
    };
    this.markers.add(sprite);
  }

  private resize() {
    const w = Math.max(this.root.clientWidth, 1);
    const h = Math.max(this.root.clientHeight, 1);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(w, h, false);
  }

  private pick(event: PointerEvent) {
    if (!this.renderer || !this.down) return;
    if (Math.hypot(event.clientX - this.down[0], event.clientY - this.down[1]) > 8) return;
    const hit = this.hitAt(event.clientX, event.clientY);
    if (!hit) return;
    if (this.badges.children.includes(hit)) {
      const { center, ids } = (hit as Badge).userData;
      this.openCluster(center, ids);
    } else {
      this.onPick(hit.userData.id as string, hit.userData.kind as Kind);
    }
  }

  /** Zoom toward a cluster; once zoom can't split it, fan its pins out in place. */
  private openCluster(center: THREE.Vector3, ids: string[]) {
    const dist = this.camera.position.length();
    const min = this.controls?.minDistance ?? 3.1;
    const { lat, lng } = toLatLng(center);
    if (dist > min + 0.25) {
      this.focus(lat, lng, Math.max(min, RADIUS + (dist - RADIUS) * 0.5));
    } else {
      this.focus(lat, lng);
      this.spider = { center: center.clone(), ids, dist };
    }
  }
}
