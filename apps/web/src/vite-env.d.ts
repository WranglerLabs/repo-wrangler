/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * API base origin for a decoupled-frontend deployment (ADR-011, Mode B).
   * Empty/undefined ⇒ same-origin relative requests (integrated Mode A).
   */
  readonly VITE_API_BASE_URL?: string;
  /** Host base path; "/" for root, "/repo-wrangler/" for a Pages project site. */
  readonly VITE_BASE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
