// Tipos de membros e permissões usados pela tela de gestão de usuários.
// O papel é sempre o da membership na organização, nunca o do JWT.

export type UserRole = 'owner' | 'editor' | 'viewer';

export interface OrgMember {
  /** ID da membership (organização + usuário). */
  id: string;
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AddMemberInput {
  email: string;
  /** Obrigatório apenas quando a conta ainda não existe. */
  name?: string;
  role: UserRole;
}

export interface AddMemberResult {
  member: OrgMember;
  /** Senha temporária gerada quando a conta é criada neste convite. */
  temporaryPassword?: string;
}
