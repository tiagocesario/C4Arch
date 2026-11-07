// Tipos de domínio do frontend.
// Fonte única: a API é normalizada para camelCase em `services/api.ts`.

import type { UserRole } from '../types/user';

export type ElementType = 'actor' | 'system' | 'container' | 'component';
export type EdgeType = 'call' | 'http' | 'message' | 'depends';
export type ModelStatus = 'draft' | 'final';

export const C4_MODEL_TYPES = [
  'system-context',
  'container',
  'component',
  'code',
  'system-landscape',
  'dynamic',
  'deployment',
] as const;

export type C4ModelType = (typeof C4_MODEL_TYPES)[number];

export interface ModelDiagram {
  c4Type: C4ModelType;
  drawioXml?: string | null;
}

export interface Model {
  id: string;
  orgId: string;
  folderId?: string | null;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status: ModelStatus;
  c4Type: C4ModelType;
  c4Scope?: string | null;
  drawioXml?: string | null;
  /** Tipos de diagrama extras vinculados ao mesmo modelo. */
  diagrams?: ModelDiagram[];
  orgName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Element {
  id: string;
  modelId: string;
  appId?: string | null;
  serviceId?: string | null;
  type: ElementType;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  positionX: number;
  positionY: number;
  order: number;
  updatedAt: string;
}

/**
 * Modelo que reutiliza um app/serviço. `occurrences` conta elementos REST e
 * objetos do draw.io; as flags indicam onde o vínculo foi encontrado.
 */
export interface AssetDependency extends Model {
  folderName?: string | null;
  occurrences: number;
  viaElements: boolean;
  viaDrawio: boolean;
}

export interface Edge {
  id: string;
  modelId: string;
  fromId: string;
  toId: string;
  label?: string | null;
  type: EdgeType;
  sourceTitle?: string | null;
  targetTitle?: string | null;
  createdAt: string;
}

export interface ModelDetail extends Model {
  elements: Element[];
  edges: Edge[];
}

export interface Folder {
  id: string;
  orgId: string;
  name: string;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccessGroup {
  id: string;
  orgId: string;
  name: string;
  description?: string | null;
  baseRole: UserRole;
  memberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccessGroupMember {
  userId: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AppObject {
  id: string;
  orgId: string;
  name: string;
  description?: string | null;
  kind: 'app' | 'service';
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceObject {
  id: string;
  orgId: string;
  name: string;
  description?: string | null;
  protocol: string;
  port?: number | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateModelInput {
  orgId: string;
  folderId?: string | null;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status?: ModelStatus;
  c4Type?: C4ModelType;
  c4Scope?: string | null;
  drawioXml?: string | null;
}

/** Importação de um modelo a partir de arquivo local, Drive ou URL. */
export interface ImportModelInput {
  orgId: string;
  folderId?: string | null;
  title?: string;
  description?: string | null;
  c4Type?: C4ModelType;
  xml?: string;
  url?: string;
  name?: string;
  source?: string;
}

export interface UpdateModelInput {
  title?: string;
  description?: string | null;
  status?: ModelStatus;
  folderId?: string | null;
  parentId?: string | null;
  c4Type?: C4ModelType;
  c4Scope?: string | null;
  drawioXml?: string | null;
}

export interface CreateFolderInput {
  orgId: string;
  name: string;
  parentId?: string | null;
}

export interface CreateAppInput {
  orgId: string;
  name: string;
  description?: string | null;
  kind?: 'app' | 'service';
  metadata?: Record<string, unknown> | null;
}

export interface CreateServiceInput {
  orgId: string;
  name: string;
  description?: string | null;
  protocol?: string;
  port?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface CreateElementInput {
  title: string;
  type: ElementType;
  appId?: string | null;
  serviceId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  positionX?: number;
  positionY?: number;
  order?: number;
}

export interface UpdateElementInput {
  title?: string;
  type?: ElementType;
  appId?: string | null;
  serviceId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  positionX?: number;
  positionY?: number;
  order?: number;
}

export interface CreateEdgeInput {
  fromId: string;
  toId: string;
  label?: string | null;
  type?: EdgeType;
}

export interface UpdateEdgeInput {
  fromId?: string;
  toId?: string;
  label?: string | null;
  type?: EdgeType;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface MeResponse {
  user: SessionUser;
  org?: {
    id: string;
    name?: string;
    slug?: string;
    /** Papel do usuário na organização, lido de `memberships` pela API. */
    role?: UserRole;
  } | null;
}
