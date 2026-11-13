// Cliente das capacidades colaborativas e de interoperabilidade (Ondas 2/3):
// views/layout, autolayout, comentários, exportação e importação Structurizr.

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function getToken(): string | null {
  return localStorage.getItem('c4arch_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  Object.assign(headers, (options.headers as Record<string, string> | undefined) ?? {});

  const res = await fetch(API + path, { ...options, headers });
  if (!res.ok) {
    let message = 'Requisição falhou: ' + res.status;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // resposta sem JSON
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { headers });
  if (!res.ok) throw new Error('Falha ao baixar arquivo: ' + res.status);
  return res.blob();
}

// ---------------------------------------------------------------------------
// Views e layout
// ---------------------------------------------------------------------------

export interface ModelView {
  id: string | null;
  key: string;
  type: string;
  title: string | null;
  description?: string | null;
  scopeElementId?: string | null;
  autoLayout: boolean;
  elementCount: number;
}

export interface LayoutItem {
  elementId?: string | null;
  objectKey?: string | null;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  style?: Record<string, unknown> | null;
}

export async function listModelViews(modelId: string): Promise<{
  modelId: string;
  source: string;
  views: ModelView[];
}> {
  return request(`/api/models/${modelId}/views`);
}

export async function getViewModelLayout(
  modelId: string,
  viewKey: string
): Promise<{ modelId: string; viewKey: string; source: string; items: LayoutItem[] }> {
  return request(`/api/models/${modelId}/views/${encodeURIComponent(viewKey)}/layout`);
}

export async function saveViewModelLayout(
  modelId: string,
  viewKey: string,
  items: LayoutItem[]
): Promise<{ ok: boolean; items: number }> {
  return request(`/api/models/${modelId}/views/${encodeURIComponent(viewKey)}/layout`, {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

export async function autoLayoutViewModel(
  modelId: string,
  viewKey: string,
  direction: 'LR' | 'TB' = 'LR'
): Promise<{ ok: boolean; positions: Array<{ id: string; x: number; y: number }> }> {
  return request(`/api/models/${modelId}/views/${encodeURIComponent(viewKey)}/autolayout`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

// ---------------------------------------------------------------------------
// Comentários
// ---------------------------------------------------------------------------

export interface CommentAuthor {
  id: string;
  name: string;
  email?: string | null;
}

export interface ModelComment {
  id: string;
  modelId: string;
  elementId: string | null;
  content: string;
  author: CommentAuthor;
  createdAt: string;
  updatedAt?: string | null;
  resolved: boolean;
  resolvedBy?: string | null;
}

export async function listModelComments(
  modelId: string,
  resolved?: boolean
): Promise<{ modelId: string; comments: ModelComment[] }> {
  const query = resolved === undefined ? '' : `?resolved=${resolved}`;
  return request(`/api/models/${modelId}/comments${query}`);
}

export async function createModelComment(
  modelId: string,
  input: { content: string; elementId?: string | null }
): Promise<ModelComment> {
  return request(`/api/models/${modelId}/comments`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateModelComment(
  modelId: string,
  commentId: string,
  patch: { content?: string; resolved?: boolean }
): Promise<ModelComment> {
  return request(`/api/models/${modelId}/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteModelComment(modelId: string, commentId: string): Promise<void> {
  await request(`/api/models/${modelId}/comments/${commentId}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

export interface ExportFormatInfo {
  format: string;
  label: string;
  contentType: string;
  extension: string;
  url: string;
  previewUrl: string | null;
}

export async function listExportFormats(modelId: string): Promise<{
  modelId: string;
  formats: ExportFormatInfo[];
}> {
  return request(`/api/models/${modelId}/exports`);
}

function exportPath(
  modelId: string,
  format: string,
  options: { theme?: 'light' | 'dark'; legend?: boolean } = {}
): string {
  const params = new URLSearchParams();
  if (options.theme) params.set('theme', options.theme);
  if (options.legend === false) params.set('legend', '0');
  const query = params.toString();
  return `/api/models/${modelId}/export/${format}${query ? `?${query}` : ''}`;
}

/** Busca o arquivo com autenticação e dispara o download no navegador. */
export async function downloadModelExport(
  modelId: string,
  format: string,
  options: { theme?: 'light' | 'dark'; legend?: boolean; filename?: string } = {}
): Promise<void> {
  const blob = await requestBlob(exportPath(modelId, format, options));
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.filename ?? `modelo.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** URL de objeto para preview (SVG/PNG) autenticado. */
export async function fetchModelPreview(
  modelId: string,
  format: 'svg' | 'png',
  options: { theme?: 'light' | 'dark'; legend?: boolean } = {}
): Promise<string> {
  const params = new URLSearchParams({ format });
  if (options.theme) params.set('theme', options.theme);
  if (options.legend === false) params.set('legend', '0');
  const blob = await requestBlob(`/api/models/${modelId}/preview?${params.toString()}`);
  return URL.createObjectURL(blob);
}

// ---------------------------------------------------------------------------
// Importação Structurizr
// ---------------------------------------------------------------------------

export interface StructurizrImportResult {
  modelId: string;
  mode: 'replace' | 'merge';
  elements: number;
  relationships: number;
  views: number;
  skippedRelationships: number;
}

export async function importStructurizrWorkspace(input: {
  orgId: string;
  content: string;
  title?: string;
  description?: string | null;
  c4Type?: string;
  folderId?: string | null;
  parentId?: string | null;
  format?: 'json' | 'dsl';
}): Promise<{ id: string; import: StructurizrImportResult }> {
  return request('/api/models/import/structurizr', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function importStructurizrIntoModel(
  modelId: string,
  input: {
    content: string;
    format?: 'json' | 'dsl';
    mode?: 'replace' | 'merge';
    title?: string;
    c4Type?: string;
  }
): Promise<{ ok: boolean; das_content?: string; import: StructurizrImportResult }> {
  return request(`/api/models/${modelId}/import/structurizr`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
