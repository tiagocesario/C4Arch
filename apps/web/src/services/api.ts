import type {
  AppObject,
  CreateAppInput,
  CreateEdgeInput,
  CreateElementInput,
  CreateFolderInput,
  CreateModelInput,
  CreateServiceInput,
  Edge,
  Element,
  Folder,
  MeResponse,
  Model,
  ModelDetail,
  ModelStatus,
  ServiceObject,
  UpdateEdgeInput,
  UpdateElementInput,
  UpdateModelInput,
} from './types';

const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000');

type Raw = Record<string, unknown>;

function getToken(): string | null {
  return localStorage.getItem('c4arch_token');
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }
  if (options && options.headers) {
    Object.assign(headers, options.headers as Record<string, string>);
  }
  const res = await fetch(API + path, {
    headers,
    ...options,
  });
  if (!res.ok) {
    let msg = 'Requisição falhou: ' + res.status;
    try {
      const body = await res.json();
      if (body && body.error) {
        msg = body.error;
      }
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Normalização de snake_case (Postgres) para camelCase (domínio do frontend).
// ---------------------------------------------------------------------------

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapModel(raw: Raw): Model {
  return {
    id: str(raw.id),
    orgId: str(raw.org_id ?? raw.orgId),
    folderId: nullableStr(raw.folder_id ?? raw.folderId),
    title: str(raw.title),
    description: nullableStr(raw.description),
    status: (raw.status === 'final' ? 'final' : 'draft') as ModelStatus,
    drawioXml: nullableStr(raw.drawio_xml ?? raw.drawioXml),
    orgName: nullableStr(raw.org_name ?? raw.orgName),
    createdAt: str(raw.created_at ?? raw.createdAt),
    updatedAt: str(raw.updated_at ?? raw.updatedAt),
  };
}

function mapElement(raw: Raw): Element {
  return {
    id: str(raw.id),
    modelId: str(raw.model_id ?? raw.modelId),
    type: (str(raw.type, 'system') as Element['type']),
    title: str(raw.title),
    description: nullableStr(raw.description),
    metadata: (raw.metadata as Record<string, unknown> | null | undefined) ?? null,
    positionX: num(raw.positionX ?? raw.position_x),
    positionY: num(raw.positionY ?? raw.position_y),
    order: num(raw.order),
    updatedAt: str(raw.updated_at ?? raw.updatedAt),
  };
}

function mapEdge(raw: Raw): Edge {
  return {
    id: str(raw.id),
    modelId: str(raw.model_id ?? raw.modelId),
    fromId: str(raw.fromId ?? raw.from_id),
    toId: str(raw.toId ?? raw.to_id),
    label: nullableStr(raw.label),
    type: (str(raw.type, 'call') as Edge['type']),
    sourceTitle: nullableStr(raw.source_title ?? raw.sourceTitle),
    targetTitle: nullableStr(raw.target_title ?? raw.targetTitle),
    createdAt: str(raw.created_at ?? raw.createdAt),
  };
}

function mapFolder(raw: Raw): Folder {
  return {
    id: str(raw.id),
    orgId: str(raw.org_id ?? raw.orgId),
    name: str(raw.name),
    parentId: nullableStr(raw.parent_id ?? raw.parentId),
    createdAt: str(raw.created_at ?? raw.createdAt),
    updatedAt: str(raw.updated_at ?? raw.updatedAt),
  };
}

function mapApp(raw: Raw): AppObject {
  return {
    id: str(raw.id),
    orgId: str(raw.org_id ?? raw.orgId),
    name: str(raw.name),
    description: nullableStr(raw.description),
    kind: raw.kind === 'service' ? 'service' : 'app',
    metadata: (raw.metadata as Record<string, unknown> | null | undefined) ?? null,
    createdAt: str(raw.created_at ?? raw.createdAt),
    updatedAt: str(raw.updated_at ?? raw.updatedAt),
  };
}

function mapService(raw: Raw): ServiceObject {
  return {
    id: str(raw.id),
    orgId: str(raw.org_id ?? raw.orgId),
    name: str(raw.name),
    description: nullableStr(raw.description),
    protocol: str(raw.protocol, 'http'),
    port: raw.port === null || raw.port === undefined ? null : num(raw.port),
    metadata: (raw.metadata as Record<string, unknown> | null | undefined) ?? null,
    createdAt: str(raw.created_at ?? raw.createdAt),
    updatedAt: str(raw.updated_at ?? raw.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

export const login = async (email: string, password: string) => {
  return req<{ token: string; user: { id: string; email: string; name: string } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
};

export const me = () => req<MeResponse>('/api/auth/me');

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

export const listModels = async (): Promise<Model[]> => {
  const rows = await req<Raw[]>('/api/models');
  return rows.map(mapModel);
};

export const createModel = async (input: CreateModelInput): Promise<Model> => {
  const raw = await req<Raw>('/api/models', {
    method: 'POST',
    body: JSON.stringify({
      orgId: input.orgId,
      folderId: input.folderId ?? null,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'draft',
      drawioXml: input.drawioXml ?? null,
    }),
  });
  return mapModel(raw);
};

export const deleteModel = (id: string) =>
  req<{ ok: boolean }>('/api/models/' + id, { method: 'DELETE' });

export const getModel = async (id: string): Promise<ModelDetail> => {
  const raw = await req<Raw>('/api/models/' + id);
  return {
    ...mapModel(raw),
    elements: Array.isArray(raw.elements) ? (raw.elements as Raw[]).map(mapElement) : [],
    edges: Array.isArray(raw.edges) ? (raw.edges as Raw[]).map(mapEdge) : [],
  };
};

export const updateModel = async (id: string, input: UpdateModelInput): Promise<Model> => {
  const raw = await req<Raw>('/api/models/' + id, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return mapModel(raw);
};

// ---------------------------------------------------------------------------
// Elementos e conexões
// ---------------------------------------------------------------------------

export const createElement = async (modelId: string, input: CreateElementInput): Promise<Element> => {
  const raw = await req<Raw>('/api/models/' + modelId + '/elements', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      type: input.type,
      description: input.description ?? null,
      metadata: input.metadata ?? null,
      position_x: input.positionX ?? 0,
      position_y: input.positionY ?? 0,
      order: input.order ?? 0,
    }),
  });
  return mapElement(raw);
};

export const updateElement = async (modelId: string, id: string, input: UpdateElementInput): Promise<Element> => {
  const raw = await req<Raw>('/api/models/' + modelId + '/elements/' + id, {
    method: 'PUT',
    body: JSON.stringify({
      title: input.title,
      type: input.type,
      description: input.description,
      metadata: input.metadata,
      position_x: input.positionX,
      position_y: input.positionY,
      order: input.order,
    }),
  });
  return mapElement(raw);
};

export const deleteElement = (modelId: string, id: string) =>
  req<{ ok: boolean }>('/api/models/' + modelId + '/elements/' + id, { method: 'DELETE' });

export const createEdge = async (modelId: string, input: CreateEdgeInput): Promise<Edge> => {
  const raw = await req<Raw>('/api/models/' + modelId + '/edges', {
    method: 'POST',
    body: JSON.stringify({
      fromId: input.fromId,
      toId: input.toId,
      label: input.label ?? '',
      type: input.type ?? 'call',
    }),
  });
  return mapEdge(raw);
};

export const updateEdge = async (modelId: string, id: string, input: UpdateEdgeInput): Promise<Edge> => {
  const raw = await req<Raw>('/api/models/' + modelId + '/edges/' + id, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return mapEdge(raw);
};

export const deleteEdge = (modelId: string, id: string) =>
  req<{ ok: boolean }>('/api/models/' + modelId + '/edges/' + id, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Pastas, aplicações e serviços
// ---------------------------------------------------------------------------

export const listFolders = async (orgId: string): Promise<Folder[]> => {
  const rows = await req<Raw[]>('/api/folders?orgId=' + encodeURIComponent(orgId));
  return rows.map(mapFolder);
};

export const createFolder = async (input: CreateFolderInput): Promise<Folder> => {
  const raw = await req<Raw>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ orgId: input.orgId, name: input.name, parentId: input.parentId ?? null }),
  });
  return mapFolder(raw);
};

export const updateFolder = async (id: string, input: Partial<CreateFolderInput>): Promise<Folder> => {
  const raw = await req<Raw>('/api/folders/' + id, {
    method: 'PUT',
    body: JSON.stringify({ name: input.name, parentId: input.parentId }),
  });
  return mapFolder(raw);
};

export const deleteFolder = (id: string) =>
  req<{ ok: boolean }>('/api/folders/' + id, { method: 'DELETE' });

export const listApps = async (orgId: string): Promise<AppObject[]> => {
  const rows = await req<Raw[]>('/api/apps?orgId=' + encodeURIComponent(orgId));
  return rows.map(mapApp);
};

export const createApp = async (input: CreateAppInput): Promise<AppObject> => {
  const raw = await req<Raw>('/api/apps', {
    method: 'POST',
    body: JSON.stringify({
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind ?? 'app',
      metadata: input.metadata ?? null,
    }),
  });
  return mapApp(raw);
};

export const updateApp = async (id: string, input: Partial<CreateAppInput>): Promise<AppObject> => {
  const raw = await req<Raw>('/api/apps/' + id, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      kind: input.kind,
      metadata: input.metadata,
    }),
  });
  return mapApp(raw);
};

export const deleteApp = (id: string) =>
  req<{ ok: boolean }>('/api/apps/' + id, { method: 'DELETE' });

export const listServices = async (orgId: string): Promise<ServiceObject[]> => {
  const rows = await req<Raw[]>('/api/services?orgId=' + encodeURIComponent(orgId));
  return rows.map(mapService);
};

export const createService = async (input: CreateServiceInput): Promise<ServiceObject> => {
  const raw = await req<Raw>('/api/services', {
    method: 'POST',
    body: JSON.stringify({
      orgId: input.orgId,
      name: input.name,
      description: input.description ?? null,
      protocol: input.protocol ?? 'http',
      port: input.port ?? null,
      metadata: input.metadata ?? null,
    }),
  });
  return mapService(raw);
};

export const updateService = async (id: string, input: Partial<CreateServiceInput>): Promise<ServiceObject> => {
  const raw = await req<Raw>('/api/services/' + id, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      protocol: input.protocol,
      port: input.port,
      metadata: input.metadata,
    }),
  });
  return mapService(raw);
};

export const deleteService = (id: string) =>
  req<{ ok: boolean }>('/api/services/' + id, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// draw.io
// ---------------------------------------------------------------------------

export const importDrawio = (modelId: string, xml: string) =>
  req<{ ok: boolean }>('/api/models/' + modelId + '/drawio/import', {
    method: 'POST',
    body: JSON.stringify({ xml }),
  });

/**
 * Solicita um token escopado de 5 minutos (em vez de colocar o JWT de sessão
 * na URL). O token só abre o editor do modelo informado.
 */
export async function getDrawioEditorUrl(modelId: string): Promise<string> {
  const { token } = await req<{ token: string }>(
    '/api/models/' + modelId + '/drawio/token',
    { method: 'POST' }
  );
  return (
    API + '/api/models/' + modelId + '/drawio?token=' + encodeURIComponent(token)
  );
}

export async function openDrawioEditor(modelId: string): Promise<void> {
  const url = await getDrawioEditorUrl(modelId);
  window.open(url, '_blank', 'noopener');
}

/**
 * Preview somente leitura do diagrama salvo. O XML vai no hash (#R), então não
 * é enviado ao servidor do draw.io nem aparece em logs de proxy.
 */
export function getDrawioPreviewUrl(xml: string): string {
  return (
    'https://viewer.diagrams.net/?chrome=0&nav=1&toolbar=0&noPrint=1&noExport=1&lightbox=1&border=10#R' +
    encodeURIComponent(xml)
  );
}
