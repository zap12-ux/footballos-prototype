/**
 * Known prior exposure in THIS browser, kept under its own key so it survives a session
 * being replaced. It records that a demo was started or the landing page was viewed here.
 * It can never show that a participant has not seen the prototype somewhere else, and the
 * baseline record says so in words.
 */
export const EXPOSURE_KEY = 'footballos.prototype.exposure.v1';

export interface ExposureStore {
  firstLandingViewedAt: string | null;
  lastDemoStartedAt: string | null;
}

const EMPTY: ExposureStore = { firstLandingViewedAt: null, lastDemoStartedAt: null };

export function readExposure(): ExposureStore {
  try {
    const raw = window.localStorage.getItem(EXPOSURE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<ExposureStore>;
    return {
      firstLandingViewedAt:
        typeof parsed.firstLandingViewedAt === 'string' ? parsed.firstLandingViewedAt : null,
      lastDemoStartedAt: typeof parsed.lastDemoStartedAt === 'string' ? parsed.lastDemoStartedAt : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(store: ExposureStore): void {
  try {
    window.localStorage.setItem(EXPOSURE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable; the prototype still runs */
  }
}

export function recordLandingViewed(iso: string): void {
  const current = readExposure();
  if (current.firstLandingViewedAt) return;
  write({ ...current, firstLandingViewedAt: iso });
}

export function recordDemoStarted(iso: string): void {
  write({ ...readExposure(), lastDemoStartedAt: iso });
}

export const EXPOSURE_NOTE =
  'Flags record what this browser has shown; "false" means none recorded, not proof of no exposure. A participant may have seen the prototype on another device or in a demonstration.';
