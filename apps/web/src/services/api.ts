import type { Edge, Element, Model, ModelStatus, Folder, AppObject, ServiceObject, CreateModelInput, CreateFolderInput, CreateAppInput, CreateServiceInput } from './types';

const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000');

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
  return (await res.json()) as T;
}

export const login = async (email: string, password: string) => {
  return req<{ token: string; user: { id: string; email: string; name: string } }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
};

export const listModels = () => req<Model[]>('/api/models').then((rows) =>
  rows.map((r) => ({
    ...r,
    folderId: (r as any).folder_id,
  }))
);
export const createModel = (input: { orgId: string; folderId?: string | null; title: string; status?: ModelStatus; drawioXml?: string | null }) =>
  req<Model>('/api/models', {
    method: 'POST',
    body: JSON.stringify({ orgId: input.orgId, folderId: input.folderId ?? null, title: input.title, status: input.status ?? 'draft', drawioXml: input.drawioXml ?? null }),
  }).then((r) => ({ ...r, folderId: (r as any).folder_id }));
export const deleteModel = (id: string) =>
  req<{ ok: boolean }>('/api/models/' + id, { method: 'DELETE' });
export const getModel = (id: string): Promise<Model & { elements: Element[]; edges: Edge[] }> =>
  req('/api/models/' + id).then((r) => ({ ...r, folderId: (r as any).folder_id } as any));
export const updateModel = (id: string, input: Partial<{ title: string; status: ModelStatus; drawioXml: string | null }>) =>
  req<Model>('/api/models/' + id, {
    method: 'PUT',
    body: JSON.stringify(input),
  }).then((r) => ({ ...r, folderId: (r as any).folder_id }));
export const createElement = (modelId: string, el: any) =>
  req('/api/models/' + modelId + '/elements', { method: 'POST', body: JSON.stringify(el) });
export const updateElement = (modelId: string, id: string, el: any) =>
  req('/api/models/' + modelId + '/elements/' + id, { method: 'PUT', body: JSON.stringify(el) });
export const deleteElement = (modelId: string, id: string) =>
  req('/api/models/' + modelId + '/elements/' + id, { method: 'DELETE' });
export const createEdge = (modelId: string, e: any) =>
  req('/api/models/' + modelId + '/edges', { method: 'POST', body: JSON.stringify(e) });
export const updateEdge = (modelId: string, id: string, e: any) =>
  req('/api/models/' + modelId + '/edges/' + id, { method: 'PUT', body: JSON.stringify(e) });
export const deleteEdge = (modelId: string, id: string) =>
  req('/api/models/' + modelId + '/edges/' + id, { method: 'DELETE' });

export const listFolders = (orgId: string) => req<Folder[]>('/api/folders?orgId=' + encodeURIComponent(orgId));
export const createFolder = (input: CreateFolderInput) =>
  req<Folder>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ orgId: input.orgId, name: input.name, parentId: input.parentId ?? null }),
  });
export const updateFolder = (id: string, input: Partial<CreateFolderInput>) =>
  req<Folder>('/api/folders/' + id, {
    method: 'PUT',
    body: JSON.stringify({ name: input.name, parentId: input.parentId }),
  });
export const deleteFolder = (id: string) =>
  req<{ ok: boolean }>('/api/folders/' + id, { method: 'DELETE' });

export const listApps = (orgId: string) => req<AppObject[]>('/api/apps?orgId=' + encodeURIComponent(orgId));
export const createApp = (input: CreateAppInput) =>
  req<AppObject>('/api/apps', {
    method: 'POST',
    body: JSON.stringify({ orgId: input.orgId, name: input.name, description: input.description ?? null, kind: input.kind ?? 'app', metadata: input.metadata ?? null }),
  });
export const updateApp = (id: string, input: Partial<CreateAppInput>) =>
  req<AppObject>('/api/apps/' + id, {
    method: 'PUT',
    body: JSON.stringify({ name: input.name, description: input.description, kind: input.kind, metadata: input.metadata }),
  });
export const deleteApp = (id: string) =>
  req<{ ok: boolean }>('/api/apps/' + id, { method: 'DELETE' });

export const listServices = (orgId: string) => req<ServiceObject[]>('/api/services?orgId=' + encodeURIComponent(orgId));
export const createService = (input: CreateServiceInput) =>
  req<ServiceObject>('/api/services', {
    method: 'POST',
    body: JSON.stringify({ orgId: input.orgId, name: input.name, description: input.description ?? null, protocol: input.protocol ?? 'http', port: input.port ?? null, metadata: input.metadata ?? null }),
  });
export const updateService = (id: string, input: Partial<CreateServiceInput>) =>
  req<ServiceObject>('/api/services/' + id, {
    method: 'PUT',
    body: JSON.stringify({ name: input.name, description: input.description, protocol: input.protocol, port: input.port, metadata: input.metadata }),
  });
export const deleteService = (id: string) =>
  req<{ ok: boolean }>('/api/services/' + id, { method: 'DELETE' });

export const importDrawio = (modelId: string, xml: string) =>
  req<{ ok: boolean }>('/api/models/' + modelId + '/drawio/import', {
    method: 'POST',
    body: JSON.stringify({ xml }),
  });
export const openDrawioEditor = (modelId: string) => {
  const url = API + '/api/models/' + modelId + '/drawio';
  window.open(url, '_blank');
};
