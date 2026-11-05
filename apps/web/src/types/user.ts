// Tipos de usuário e permissões usados pela tela de gestão de usuários.
// Tipos de domínio (Model, Element, Edge, Folder, etc.) ficam em
// `services/types.ts` para evitar duplicação.

export type UserRole = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: UserRole;
}

export type UpdateUserInput = Partial<CreateUserInput>;
