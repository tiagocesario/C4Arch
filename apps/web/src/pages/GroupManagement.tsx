import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Shield, Users as UsersIcon, Search, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  listGroupMembers,
  addGroupMember,
  removeGroupMember,
  listOrgMembers,
} from '../services/api';
import type { AccessGroup, AccessGroupMember } from '../services/types';
import type { OrgMember, UserRole } from '../types/user';

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

interface Props {
  orgId: string;
  orgName?: string;
  currentRole: UserRole;
}

interface Draft {
  name: string;
  description: string;
  baseRole: UserRole;
}

const EMPTY_DRAFT: Draft = { name: '', description: '', baseRole: 'viewer' };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function GroupManagement({ orgId, orgName, currentRole }: Props) {
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccessGroup | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [viewingGroup, setViewingGroup] = useState<AccessGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<AccessGroupMember[]>([]);
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);

  const canManage = currentRole === 'owner';

  const refresh = useCallback(async () => {
    if (!orgId) {
      setGroups([]);
      setLoading(false);
      return;
    }
    try {
      const [g, m] = await Promise.all([listGroups(orgId), listOrgMembers(orgId)]);
      setGroups(g);
      setMembers(m);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => !q || g.name.toLowerCase().includes(q) || (g.description ?? '').toLowerCase().includes(q));
  }, [groups, query]);

  async function openGroupMembers(group: AccessGroup) {
    setViewingGroup(group);
    setGroupMembers([]);
    setGroupMembersLoading(true);
    try {
      setGroupMembers(await listGroupMembers(group.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGroupMembersLoading(false);
    }
  }

  async function handleCreate() {
    const name = draft.name.trim();
    if (!name) {
      setError('Informe o nome do grupo.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await createGroup({ orgId, name, description: draft.description.trim() || null, baseRole: draft.baseRole });
      setDraft(EMPTY_DRAFT);
      setCreating(false);
      setNotice('Grupo criado.');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateGroup(editing.id, {
        name: editDraft.name.trim(),
        description: editDraft.description.trim() || null,
        baseRole: editDraft.baseRole,
      });
      setEditing(null);
      setNotice('Grupo atualizado.');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(group: AccessGroup) {
    if (!window.confirm(`Excluir o grupo "${group.name}"?`)) return;
    setError(null);
    setNotice(null);
    try {
      await deleteGroup(group.id);
      if (viewingGroup?.id === group.id) setViewingGroup(null);
      setNotice('Grupo excluído.');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleAddMember(userId: string) {
    if (!viewingGroup) return;
    try {
      await addGroupMember(viewingGroup.id, userId);
      setGroupMembers(await listGroupMembers(viewingGroup.id));
      setNotice('Membro adicionado ao grupo.');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!viewingGroup) return;
    try {
      await removeGroupMember(viewingGroup.id, userId);
      setGroupMembers(await listGroupMembers(viewingGroup.id));
      setNotice('Membro removido do grupo.');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const availableMembers = useMemo(() => {
    const inGroup = new Set(groupMembers.map((m) => m.userId));
    return members.filter((m) => !inGroup.has(m.userId));
  }, [members, groupMembers]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Perfis e Grupos de Acesso</h1>
              <p className="text-sm text-slate-500">Organização: {orgName || 'C4Arch'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <UsersIcon className="h-4 w-4" />
            <span>{groups.length} {groups.length === 1 ? 'grupo' : 'grupos'}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
          <p>
            <strong className="text-slate-900">Perfis:</strong> owner (gerencia), editor (edita conteúdo), viewer (somente leitura).
            <strong className="text-slate-900 ml-2">Grupos:</strong> agrupam usuários e aplicam um perfil base automaticamente.
          </p>
        </div>

        {!canManage && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Somente o owner pode gerenciar grupos. Visualização em modo leitura.</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-xs font-medium underline">Fechar</button>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 break-all">{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs font-medium underline">Fechar</button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 w-full sm:max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar grupo..."
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
            {canManage && (
              <button
                onClick={() => { setCreating(true); setEditing(null); setDraft(EMPTY_DRAFT); setError(null); setNotice(null); }}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Novo grupo
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Nome</th>
                  <th className="text-left px-5 py-3 font-medium">Descrição</th>
                  <th className="text-left px-5 py-3 font-medium">Perfil base</th>
                  <th className="text-left px-5 py-3 font-medium">Membros</th>
                  {canManage && <th className="text-right px-5 py-3 font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading && (
                  <tr><td colSpan={canManage ? 5 : 4} className="px-5 py-8 text-center text-slate-500">Carregando grupos...</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={canManage ? 5 : 4} className="px-5 py-8 text-center text-slate-500">Nenhum grupo encontrado.</td></tr>
                )}
                {!loading && filtered.map((group) => (
                  <tr key={group.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-900">{group.name}</td>
                    <td className="px-5 py-3 text-slate-600">{group.description || '—'}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 border-blue-200">
                        {ROLE_LABELS[group.baseRole]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">{group.memberCount ?? 0}</td>
                    {canManage && (
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openGroupMembers(group)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <UsersIcon className="h-3.5 w-3.5" />
                            Membros
                          </button>
                          <button
                            onClick={() => {
                              setEditing(group);
                              setEditDraft({ name: group.name, description: group.description ?? '', baseRole: group.baseRole });
                              setCreating(false);
                              setError(null);
                              setNotice(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(group)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Excluir
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {canManage && (creating || editing) && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">{creating ? 'Novo grupo' : 'Editar grupo'}</h2>
              <button onClick={() => { setCreating(false); setEditing(null); }} className="text-sm text-slate-500 hover:text-slate-900">
                Cancelar
              </button>
            </div>
            <form
              className="p-5 space-y-4"
              onSubmit={(e) => { e.preventDefault(); void (creating ? handleCreate() : handleUpdate()); }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Nome</label>
                  <input
                    value={creating ? draft.name : editDraft.name}
                    onChange={(e) => creating ? setDraft({ ...draft, name: e.target.value }) : setEditDraft({ ...editDraft, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Perfil base</label>
                  <select
                    value={creating ? draft.baseRole : editDraft.baseRole}
                    onChange={(e) => {
                      const role = e.target.value as UserRole;
                      if (creating) setDraft({ ...draft, baseRole: role });
                      else setEditDraft({ ...editDraft, baseRole: role });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Descrição</label>
                <textarea
                  value={creating ? draft.description : editDraft.description}
                  onChange={(e) => creating ? setDraft({ ...draft, description: e.target.value }) : setEditDraft({ ...editDraft, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
                  {saving ? 'Salvando...' : creating ? 'Criar grupo' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        )}

        {viewingGroup && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Membros — {viewingGroup.name}</h2>
              <button onClick={() => setViewingGroup(null)} className="text-sm text-slate-500 hover:text-slate-900">Fechar</button>
            </div>
            <div className="p-5 space-y-4">
              {groupMembersLoading && <div className="text-sm text-slate-500">Carregando membros...</div>}
              {!groupMembersLoading && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {groupMembers.map((m) => (
                      <span key={m.userId} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs">
                        {m.name} ({m.email})
                        {canManage && (
                          <button onClick={() => handleRemoveMember(m.userId)} className="text-red-600 hover:text-red-800">×</button>
                        )}
                      </span>
                    ))}
                    {groupMembers.length === 0 && <span className="text-sm text-slate-500">Nenhum membro neste grupo.</span>}
                  </div>
                  {canManage && availableMembers.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        onChange={(e) => {
                          const uid = e.target.value;
                          if (uid) {
                            void handleAddMember(uid);
                            e.target.value = '';
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="">Adicionar membro...</option>
                        {availableMembers.map((m) => (
                          <option key={m.userId} value={m.userId}>{m.name} ({m.email})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}