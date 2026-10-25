/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` (default) or `http`. */
  readonly VITE_API_MODE?: string;
  /** Origin of the API when `VITE_API_MODE=http`; empty means same origin (Vite proxy in dev). */
  readonly VITE_API_BASE_URL?: string;
}
