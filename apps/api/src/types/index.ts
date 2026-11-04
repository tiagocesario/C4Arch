// Tipos principais do C4Arch API.

export type Role = 'owner' | 'editor' | 'viewer';
export type ElementType = 'actor' | 'system' | 'container' | 'component';
export type EdgeType = 'call' | 'http' | 'message' | 'depends';
export type ModelStatus = 'draft' | 'final';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: Role;
  createdAt: string;
}

export interface Model {
  id: string;
  orgId: string;
  title: string;
  description?: string | null;
  status: ModelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Element {
  id: string;
  modelId: string;
  type: ElementType;
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  positionX: number;
  positionY: number;
  order: number;
  updatedAt: string;
}

export interface Edge {
  id: string;
  modelId: string;
  fromId: string;
  toId: string;
  label?: string | null;
  type: EdgeType;
  createdAt: string;
}

export interface Comment {
  id: string;
  modelId: string;
  elementId?: string | null;
  content: string;
  authorId: string;
  createdAt: string;
  resolved: boolean;
}

export interface ModelVersion {
  id: string;
  modelId: string;
  version: number;
  snapshot: unknown;
  createdAt: string;
  createdBy: string;
}
