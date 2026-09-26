import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { feature } from "topojson-client";
import { geoEquirectangular, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import world from "world-atlas/countries-110m.json";
import type { Topology } from "topojson-specification";

const RADIUS = 1.48;

export type Kind = "lab" | "model" | "host";

export type GeoPin = {
  id: string;
  kind: "lab" | "host";
  lat: number;
  lng: number;
  ripple: boolean;
};

export type SatPin = {
  id: string;
  lat: number;
  lng: number;
  index: number;
  count: number;
  ripple: boolean;
};

export function toVector(lat: number, lng: number, radius = RADIUS): THREE.Vector3 {
  const a = (lat * Math.PI) / 180;
  const b = (lng * Math.PI) / 180;
  return new THREE.Vector3(radius * Math.cos(a) * Math.cos(b), radius * Math.sin(a), -radius * Math.cos(a) * Math.sin(b));
}

function icon(kind: Kind, on: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 96;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  const color = on ? "#f54e00" : kind === "host" ? "#9ecbff" : "#f4f4f4";
  g.clearRect(0, 0, 96, 96);
  g.strokeStyle = color;
  g.fillStyle = "#101114";
  g.lineWidth = on ? 7 : 4;
  if (kind === "lab") {
    g.beginPath();
    g.roundRect(18, 22, 60, 48, 8);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(30, 46);
    g.lineTo(30, 70);
    g.moveTo(48, 38);
    g.lineTo(48, 70);
    g.moveTo(66, 50);
    g.lineTo(66, 70);
    g.stroke();
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

function around(lat: number, lng: number, index: number, count: number): THREE.Vector3 {
  const up = toVector(lat, lng, 1).normalize();
  const east = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), up);
  if (east.lengthSq() < 1e-4) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const ang = (index / Math.max(count, 1)) * Math.PI * 2;
  const radius = count <= 1 ? 0.1 : 0.14 + Math.min(count, 12) * 0.008;
  return up
    .clone()
    .multiplyScalar(RADIUS + 0.06)
    .addScaledVector(east, Math.cos(ang) * radius)
    .addScaledVector(north, Math.sin(ang) * radius);
}

export class Globe {
  readonly ready: boolean;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;
  private markers = new THREE.Group();
  private ripples = new THREE.Group();
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down: [number, number] | null = null;
  private onPick: (id: string, kind: Kind) => void;
  private frame = 0;
  private icons = new Map<string, THREE.CanvasTexture>();

  constructor(private root: HTMLElement, onPick: (id: string, kind: Kind) => void) {
    this.onPick = onPick;
    this.ray.params.Sprite = { threshold: 0.04 };
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(1.2, 0.8, 6.6);
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
    this.scene.add(this.markers);
    this.scene.add(this.ripples);
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      this.down = [event.clientX, event.clientY];
    });
    this.renderer.domElement.addEventListener("pointerup", (event) => this.pick(event));
    this.resize();
    window.addEventListener("resize", () => this.resize());
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      const t = performance.now() / 1000;
      for (const ring of this.ripples.children) {
        const phase = (t + (ring.userData.phase as number)) % 1.6;
        const k = phase / 1.6;
        const base = (ring.userData.base as number) || 0.03;
        ring.scale.setScalar((base / 0.03) * (1 + k * 2.2));
        (ring as THREE.Mesh).material && (((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k));
      }
      this.controls?.update();
      this.fitMarkers();
      this.renderer?.render(this.scene, this.camera);
    };
    loop();
  }

  show(geo: GeoPin[], sats: SatPin[], selected: string | null) {
    this.markers.clear();
    this.ripples.clear();
    for (const pin of geo.filter((item) => item.kind === "lab")) {
      this.add(pin.id, pin.kind, toVector(pin.lat, pin.lng, RADIUS + 0.02), pin.id === selected, pin.ripple);
    }
    for (const pin of geo.filter((item) => item.kind === "host")) {
      this.add(pin.id, pin.kind, toVector(pin.lat, pin.lng, RADIUS + 0.05), pin.id === selected, pin.ripple);
    }
    for (const pin of sats) {
      this.add(pin.id, "model", around(pin.lat, pin.lng, pin.index, pin.count), pin.id === selected, pin.ripple);
    }
  }

  private fitMarkers() {
    const dist = this.camera.position.length();
    const size = Math.min(0.042, Math.max(0.014, dist * 0.0055));
    for (const child of this.markers.children) {
      const on = child.userData.on === true;
      const kind = child.userData.kind;
      const scale = size * (on ? 1.2 : kind === "model" ? 0.72 : kind === "host" ? 0.82 : 1);
      child.scale.set(scale, scale, 1);
    }
    for (const ring of this.ripples.children) {
      ring.userData.base = size;
    }
  }

  focus(lat: number, lng: number) {
    this.camera.position.copy(toVector(lat, lng, 5.4));
    this.controls?.update();
  }

  private tex(kind: Kind, on: boolean): THREE.CanvasTexture {
    const key = `${kind}:${on ? 1 : 0}`;
    const cached = this.icons.get(key);
    if (cached) return cached;
    const made = icon(kind, on);
    this.icons.set(key, made);
    return made;
  }

  private add(id: string, kind: Kind, position: THREE.Vector3, on: boolean, ripple: boolean) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.tex(kind, on), transparent: true, depthTest: false, depthWrite: false }),
    );
    sprite.position.copy(position);
    sprite.renderOrder = kind === "host" ? 3 : kind === "model" ? 2 : 1;
    sprite.userData.id = id;
    sprite.userData.kind = kind;
    sprite.userData.on = on;
    this.markers.add(sprite);
    if (!ripple) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.03, 0.038, 28),
      new THREE.MeshBasicMaterial({
        color: on ? 0xf54e00 : 0xf4f4f4,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.position.copy(position);
    ring.lookAt(position.clone().multiplyScalar(2));
    ring.userData.phase = Math.random();
    this.ripples.add(ring);
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
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = this.ray.intersectObjects(this.markers.children, false)[0];
    const id = hit?.object.userData.id;
    const kind = hit?.object.userData.kind;
    if (typeof id === "string" && (kind === "lab" || kind === "model" || kind === "host")) this.onPick(id, kind);
  }
}
