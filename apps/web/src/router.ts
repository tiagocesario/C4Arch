/**
 * Roteador mínimo baseado em hash (Onda 3, item 12).
 *
 * O C4Arch é uma SPA servida por um único `index.html`; um router por hash
 * permite deep links (`#/models/<id>`) sem exigir reescrita no servidor nem
 * adicionar uma dependência de runtime.
 */

export const APP_MODES = ['files', 'edit', 'users', 'groups', 'catalog', 'domains'] as const;

export type AppMode = (typeof APP_MODES)[number];

export interface AppRoute {
  mode: AppMode;
  modelId: string | null;
}

export function isAppMode(value: string): value is AppMode {
  return (APP_MODES as readonly string[]).includes(value);
}

export function parseHashRoute(hash: string): AppRoute {
  const cleaned = hash.replace(/^#\/?/, '').trim();
  if (!cleaned) return { mode: 'files', modelId: null };

  const [first, second] = cleaned.split('/');
  if (first === 'models' && second) {
    return { mode: 'edit', modelId: decodeURIComponent(second) };
  }
  if (first === 'model' && second) {
    return { mode: 'edit', modelId: decodeURIComponent(second) };
  }
  if (isAppMode(first)) {
    return { mode: first, modelId: null };
  }
  return { mode: 'files', modelId: null };
}

export function buildHashRoute(mode: AppMode, modelId?: string | null): string {
  if (mode === 'edit' && modelId) return `#/models/${encodeURIComponent(modelId)}`;
  return `#/${mode}`;
}

/** Substitui a URL sem criar entrada no histórico (o estado já é persistido). */
export function replaceHashRoute(mode: AppMode, modelId?: string | null): void {
  if (typeof window === 'undefined') return;
  const next = buildHashRoute(mode, modelId);
  if (window.location.hash === next) return;
  window.history.replaceState(null, '', next);
}
