/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CANONICAL_VIEWS?: string
  readonly VITE_DAS_OVERRIDES?: string
  readonly VITE_VERSION_HASH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
