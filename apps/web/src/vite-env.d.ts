/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API; empty (default) means same origin (the Vite proxy in dev, the reverse proxy in production). */
  readonly VITE_API_BASE_URL?: string;
}
