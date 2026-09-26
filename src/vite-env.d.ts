declare module "world-atlas/countries-110m.json" {
  const value: unknown;
  export default value;
}

/** Where the page loads the catalog from; set at build time by CATALOG_MODE (see vite.config.ts). */
declare const __CATALOG_URL__: string;
/** "static" or "function"; read it through src/mode.ts. */
declare const __CATALOG_MODE__: string;
