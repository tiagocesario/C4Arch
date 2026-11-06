// Camada de serviço da gestão de membros. A persistência real é a API
// (`memberships` no Postgres); não há mais mock em localStorage.

import {
  addOrgMember,
  listOrgMembers,
  removeOrgMember,
  updateOrgMemberRole,
} from './api';
import type { AddMemberInput, AddMemberResult, OrgMember, UserRole } from '../types/user';

export const listMembers = (orgId: string): Promise<OrgMember[]> => listOrgMembers(orgId);

export const addMember = (orgId: string, input: AddMemberInput): Promise<AddMemberResult> =>
  addOrgMember(orgId, input);

export const updateMemberRole = (
  orgId: string,
  userId: string,
  role: UserRole
): Promise<OrgMember> => updateOrgMemberRole(orgId, userId, role);

export const removeMember = (orgId: string, userId: string): Promise<void> =>
  removeOrgMember(orgId, userId).then(() => undefined);
