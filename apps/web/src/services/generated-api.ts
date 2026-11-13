/* eslint-disable */
// Cliente gerado por scripts/generate-client.mjs a partir de /api/openapi.json.
// Não edite manualmente: rode `npm run openapi:client`.

const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') as string;

export interface GeneratedOperation {
  method: string;
  path: string;
  summary: string;
  hasBody: boolean;
}

export const operations = {
  getHealthz: { method: 'GET', path: '/healthz', summary: "Healthcheck", hasBody: false },
  getApiOpenapiJson: { method: 'GET', path: '/api/openapi.json', summary: "Documento OpenAPI", hasBody: false },
  postApiAuthLogin: { method: 'POST', path: '/api/auth/login', summary: "Autentica e devolve um JWT", hasBody: true },
  getApiAuthMe: { method: 'GET', path: '/api/auth/me', summary: "Usuário autenticado", hasBody: false },
  getApiModels: { method: 'GET', path: '/api/models', summary: "Lista modelos das organizações do usuário", hasBody: false },
  postApiModels: { method: 'POST', path: '/api/models', summary: "Cria um modelo", hasBody: true },
  postApiModelsImport: { method: 'POST', path: '/api/models/import', summary: "Importa draw.io XML de arquivo ou URL", hasBody: false },
  postApiModelsImportStructurizr: { method: 'POST', path: '/api/models/import/structurizr', summary: "Importa um workspace Structurizr (JSON ou DSL)", hasBody: true },
  getApiModelsId: { method: 'GET', path: '/api/models/{id}', summary: "Obtém um modelo com elementos e relações", hasBody: false },
  putApiModelsId: { method: 'PUT', path: '/api/models/{id}', summary: "Atualiza um modelo", hasBody: false },
  deleteApiModelsId: { method: 'DELETE', path: '/api/models/{id}', summary: "Exclui um modelo", hasBody: false },
  getApiModelsIdDas: { method: 'GET', path: '/api/models/{id}/das', summary: "Obtém o DAS", hasBody: false },
  putApiModelsIdDas: { method: 'PUT', path: '/api/models/{id}/das', summary: "Salva o DAS (gera overrides por seção)", hasBody: false },
  getApiModelsIdInspections: { method: 'GET', path: '/api/models/{id}/inspections', summary: "Saúde da arquitetura (inspections)", hasBody: false },
  getApiModelsIdVersions: { method: 'GET', path: '/api/models/{id}/versions', summary: "Histórico de versões", hasBody: false },
  postApiModelsIdVersionsVersionidRestore: { method: 'POST', path: '/api/models/{id}/versions/{versionId}/restore', summary: "Restaura uma versão", hasBody: false },
  getApiModelsIdExports: { method: 'GET', path: '/api/models/{id}/exports', summary: "Lista formatos de exportação", hasBody: false },
  getApiModelsIdExportFormat: { method: 'GET', path: '/api/models/{id}/export/{format}', summary: "Exporta o modelo", hasBody: false },
  getApiModelsIdPreview: { method: 'GET', path: '/api/models/{id}/preview', summary: "Preview server-side (SVG/PNG)", hasBody: false },
  postApiModelsIdImportStructurizr: { method: 'POST', path: '/api/models/{id}/import/structurizr', summary: "Importa/substitui o conteúdo do modelo com um workspace Structurizr", hasBody: true },
  getApiModelsIdViews: { method: 'GET', path: '/api/models/{id}/views', summary: "Lista views do modelo", hasBody: false },
  getApiModelsIdViewsKeyLayout: { method: 'GET', path: '/api/models/{id}/views/{key}/layout', summary: "Obtém o layout de uma view", hasBody: false },
  putApiModelsIdViewsKeyLayout: { method: 'PUT', path: '/api/models/{id}/views/{key}/layout', summary: "Salva o layout manual de uma view", hasBody: true },
  postApiModelsIdViewsKeyAutolayout: { method: 'POST', path: '/api/models/{id}/views/{key}/autolayout', summary: "Recalcula o layout automaticamente", hasBody: false },
  getApiModelsIdComments: { method: 'GET', path: '/api/models/{id}/comments', summary: "Lista comentários", hasBody: false },
  postApiModelsIdComments: { method: 'POST', path: '/api/models/{id}/comments', summary: "Cria um comentário (por modelo ou elemento)", hasBody: true },
  patchApiModelsIdCommentsCommentid: { method: 'PATCH', path: '/api/models/{id}/comments/{commentId}', summary: "Edita/resolve um comentário", hasBody: false },
  deleteApiModelsIdCommentsCommentid: { method: 'DELETE', path: '/api/models/{id}/comments/{commentId}', summary: "Exclui um comentário", hasBody: false },
} as const;

export type OperationName = keyof typeof operations;

export async function callOperation<T>(
  name: OperationName,
  params: Record<string, string | number> = {},
  body?: unknown,
  init: RequestInit = {}
): Promise<T> {
  const operation = operations[name];
  let path: string = operation.path;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('c4arch_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(API_BASE + path, {
    ...init,
    method: operation.method,
    headers,
    body: body === undefined ? init.body : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `Requisição falhou: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // sem corpo JSON
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const openapi = {
  version: "0.1.0",
  title: "C4Arch API",
} as const;
