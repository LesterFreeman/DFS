/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REPO?: string; // "owner/repo", set by the deploy workflow
  readonly VITE_REF?: string; // default branch
}
