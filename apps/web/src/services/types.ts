export interface Element {
  id: string;
  modelId: string;
  type: 'actor' | 'system' | 'container' | 'component';
  title: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  position_x: number;
  position_y: number;
  order: number;
  updatedAt: string;
}

export interface Edge {
  id: string;
  modelId: string;
  fromId: string;
  toId: string;
  label?: string | null;
  type: 'call' | 'http' | 'message' | 'depends';
  createdAt: string;
}

export interface Model {
  id: string;
  orgId: string;
  folderId?: string | null;
  title: string;
  description?: string | null;
  status: 'draft' | 'final';
  createdAt: string;
  updatedAt: string;
}

export interface ModelDetail extends Model {
  elements: Element[];
  edges: Edge[];
}
