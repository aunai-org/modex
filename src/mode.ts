/**
 * How this build serves the catalog, and every piece of UI copy that depends on it.
 * The mode is fixed at build time by CATALOG_MODE (see vite.config.ts); nothing else should branch on it.
 */

export type CatalogMode = "static" | "function";

export const CATALOG_MODE: CatalogMode = __CATALOG_MODE__ === "function" ? "function" : "static";

/** UTC hours of the scheduled rebuild. Keep in step with the cron in .github/workflows/rebuild.yml. */
const REBUILD_UTC_HOURS = [0, 12];

const clock = (date: Date) => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The next scheduled rebuild after `now`. */
export function nextRebuild(now = new Date()): Date {
  for (let day = 0; day < 2; day++) {
    for (const hour of REBUILD_UTC_HOURS) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, hour));
      if (at > now) return at;
    }
  }
  return new Date(now.getTime() + 12 * 3600 * 1000);
}

type Copy = {
  /** About → Data: how often the catalog changes. */
  freshness: string;
  /** Top bar, next to the buttons, from the catalog's own timestamp. */
  stamp: (fetchedAt: Date) => string;
  /** Refresh button tooltip and label. */
  refreshLabel: string;
  /** Shown briefly after a manual refresh that found nothing newer. */
  upToDate: () => string;
};

const COPY: Record<CatalogMode, Copy> = {
  static: {
    freshness: `Rebuilt every 12 hours (${REBUILD_UTC_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`).join(" and ")} UTC).`,
    stamp: (at) => `Data from ${clock(at)}`,
    refreshLabel: "Check for a newer catalog",
    upToDate: () => `Up to date · next build ${clock(nextRebuild())}`,
  },
  function: {
    freshness: "Refreshed hourly.",
    stamp: (at) => `Updated ${clock(at)}`,
    refreshLabel: "Refresh catalog",
    upToDate: () => "Up to date",
  },
};

export const modeCopy: Copy = COPY[CATALOG_MODE];
