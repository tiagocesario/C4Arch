export type UserRole = 'owner' | 'editor' | 'viewer'

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  workspaceId: string
  createdAt: string
  updatedAt: string
}

export interface CreateUserInput {
  name: string
  email: string
  role: UserRole
}

export type UpdateUserInput = Partial<CreateUserInput>

export type ElementType = 'actor' | 'system' | 'container' | 'component'
export type EdgeType = 'call' | 'http' | 'message' | 'depends'
export type ModelStatus = 'draft' | 'final'

export interface Organization {
  id: string
  slug: string
  name: string
}

export interface Folder {
  id: string
  orgId: string
  name: string
  parentId?: string | null
  createdAt: string
  updatedAt: string
}

export interface AppObject {
  id: string
  orgId: string
  name: string
  description?: string | null
  kind: 'app' | 'service'
  metadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface ServiceObject {
  id: string
  orgId: string
  name: string
  description?: string | null
  protocol: string
  port?: number | null
  metadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface Model {
  id: string
  orgId: string
  folderId?: string | null
  title: string
  description?: string | null
  status: ModelStatus
  drawioXml?: string | null
  createdAt: string
  updatedAt: string
}

export interface Element {
  id: string
  modelId: string
  appId?: string | null
  serviceId?: string | null
  type: ElementType
  title: string
  description?: string | null
  metadata?: Record<string, unknown> | null
  positionX: number
  positionY: number
  order: number
  updatedAt: string
}

export interface Edge {
  id: string
  modelId: string
  fromId: string
  toId: string
  label?: string | null
  type: EdgeType
  createdAt: string
}

export interface ModelDetail extends Model {
  elements: Element[]
  edges: Edge[]
}

export interface CreateModelInput {
  orgId: string
  folderId?: string | null
  title: string
  status?: ModelStatus
  drawioXml?: string | null
}

export interface CreateFolderInput {
  orgId: string
  name: string
  parentId?: string | null
}

export interface CreateAppInput {
  orgId: string
  name: string
  description?: string | null
  kind?: 'app' | 'service'
  metadata?: Record<string, unknown> | null
}

export interface CreateServiceInput {
  orgId: string
  name: string
  description?: string | null
  protocol?: string
  port?: number | null
  metadata?: Record<string, unknown> | null
}
