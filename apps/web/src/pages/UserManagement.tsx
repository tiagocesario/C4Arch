import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Pencil,
  Trash2,
  Shield,
  Users as UsersIcon,
  Search,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { addMember, listMembers, removeMember, updateMemberRole } from '../services/users'
import type { OrgMember, UserRole } from '../types/user'

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

const ROLE_BADGE: Record<UserRole, string> = {
  owner: 'bg-purple-100 text-purple-800 border-purple-200',
  editor: 'bg-blue-100 text-blue-800 border-blue-200',
  viewer: 'bg-gray-100 text-gray-800 border-gray-200',
}

const ROLE_OPTIONS: UserRole[] = ['owner', 'editor', 'viewer']

interface UserManagementProps {
  orgId: string
  orgName?: string
  currentUserId: string
  currentRole: UserRole
  onSelfRoleChange?: (role: UserRole) => void
}

interface Draft {
  name: string
  email: string
  role: UserRole
}

const EMPTY_DRAFT: Draft = { name: '', email: '', role: 'viewer' }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export default function UserManagement({
  orgId,
  orgName,
  currentUserId,
  currentRole,
  onSelfRoleChange,
}: UserManagementProps) {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [editing, setEditing] = useState<OrgMember | null>(null)
  const [editRole, setEditRole] = useState<UserRole>('viewer')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canManage = currentRole === 'owner'
  const ownerCount = members.filter(member => member.role === 'owner').length

  const refresh = useCallback(async () => {
    if (!orgId) {
      setMembers([])
      setLoading(false)
      return
    }
    try {
      setMembers(await listMembers(orgId))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter(member => {
      const matchesQuery =
        !q ||
        member.name.toLowerCase().includes(q) ||
        member.email.toLowerCase().includes(q)
      const matchesRole = roleFilter === 'all' || member.role === roleFilter
      return matchesQuery && matchesRole
    })
  }, [members, query, roleFilter])

  function openCreate() {
    setCreating(true)
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
    setNotice(null)
  }

  function openEdit(member: OrgMember) {
    setEditing(member)
    setEditRole(member.role)
    setCreating(false)
    setError(null)
    setNotice(null)
  }

  async function handleCreate() {
    const email = draft.email.trim()
    if (!email) {
      setError('Informe o e-mail do usuário.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await addMember(orgId, {
        email,
        name: draft.name.trim() || undefined,
        role: draft.role,
      })
      if (result.temporaryPassword) {
        setNotice(
          `Conta criada. Senha temporária (exibida uma única vez): ${result.temporaryPassword} — compartilhe por um canal seguro.`
        )
      } else {
        setNotice('Usuário adicionado à organização.')
      }
      setDraft(EMPTY_DRAFT)
      setCreating(false)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const updated = await updateMemberRole(orgId, editing.userId, editRole)
      if (updated.userId === currentUserId) {
        onSelfRoleChange?.(updated.role)
      }
      setEditing(null)
      setNotice('Perfil atualizado.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(member: OrgMember) {
    if (!window.confirm(`Remover ${member.name} da organização?`)) return
    setError(null)
    setNotice(null)
    try {
      await removeMember(orgId, member.userId)
      setNotice('Membro removido da organização.')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Gestão de Usuários</h1>
              <p className="text-sm text-slate-500">
                Organização: {orgName || 'C4Arch'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <UsersIcon className="h-4 w-4" />
            <span>{members.length} {members.length === 1 ? 'membro' : 'membros'}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
          <p>
            <strong className="text-slate-900">Owner</strong> gerencia usuários e conteúdo;{' '}
            <strong className="text-slate-900">Editor</strong> edita conteúdo;{' '}
            <strong className="text-slate-900">Viewer</strong> tem acesso somente leitura.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            O perfil abaixo é o da organização. O servidor revalida a permissão em cada requisição.
          </p>
        </div>

        {!canManage && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Seu perfil não permite gerenciar usuários. A lista está em modo somente leitura.</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-xs font-medium underline">
              Fechar
            </button>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1 break-all">{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs font-medium underline">
              Fechar
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-5 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 w-full sm:max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar por nome ou e-mail..."
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="all">Todos os perfis</option>
                <option value="owner">Owner</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              {canManage && (
                <button
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" />
                  Novo usuário
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Nome</th>
                  <th className="text-left px-5 py-3 font-medium">E-mail</th>
                  <th className="text-left px-5 py-3 font-medium">Perfil</th>
                  <th className="text-left px-5 py-3 font-medium">Desde</th>
                  {canManage && (
                    <th className="text-right px-5 py-3 font-medium">Ações</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {loading && (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="px-5 py-8 text-center text-slate-500">
                      Carregando membros...
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="px-5 py-8 text-center text-slate-500">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
                {!loading && filtered.map(member => {
                  const isSelf = member.userId === currentUserId
                  const isLastOwner = member.role === 'owner' && ownerCount <= 1
                  return (
                    <tr key={member.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-medium text-slate-900">
                        <span className="inline-flex items-center gap-2">
                          {member.name}
                          {isSelf && (
                            <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                              você
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{member.email}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[member.role]}`}>
                          {ROLE_LABELS[member.role]}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500">
                        {member.createdAt ? new Date(member.createdAt).toLocaleDateString('pt-BR') : '—'}
                      </td>
                      {canManage && (
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => openEdit(member)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </button>
                            <button
                              onClick={() => handleDelete(member)}
                              disabled={isSelf || isLastOwner}
                              title={
                                isSelf
                                  ? 'Você não pode remover a si mesmo'
                                  : isLastOwner
                                    ? 'A organização precisa de pelo menos um owner'
                                    : undefined
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remover
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {canManage && (creating || editing) && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {creating ? 'Novo usuário' : 'Editar perfil'}
              </h2>
              <button
                onClick={() => {
                  setCreating(false)
                  setEditing(null)
                }}
                className="text-sm text-slate-500 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>
            <form
              className="p-5 space-y-4"
              onSubmit={e => {
                e.preventDefault()
                void (creating ? handleCreate() : handleUpdate())
              }}
            >
              {creating ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">
                        Nome <span className="text-slate-400">(para conta nova)</span>
                      </label>
                      <input
                        value={draft.name}
                        onChange={e => setDraft({ ...draft, name: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-slate-700">E-mail</label>
                      <input
                        type="email"
                        value={draft.email}
                        onChange={e => setDraft({ ...draft, email: e.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                        required
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Se o e-mail já estiver cadastrado, o usuário apenas entra na organização com o
                    perfil escolhido. Caso contrário, uma conta é criada com senha temporária.
                  </p>
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">Nome</label>
                    <input
                      value={editing?.name ?? ''}
                      readOnly
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-700">E-mail</label>
                    <input
                      value={editing?.email ?? ''}
                      readOnly
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Perfil</label>
                <select
                  value={creating ? draft.role : editRole}
                  onChange={e => {
                    const role = e.target.value as UserRole
                    if (creating) setDraft({ ...draft, role })
                    else setEditRole(role)
                  }}
                  className="w-full sm:max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {ROLE_OPTIONS.map(role => (
                    <option
                      key={role}
                      value={role}
                      disabled={
                        !creating &&
                        editing?.role === 'owner' &&
                        ownerCount <= 1 &&
                        role !== 'owner'
                      }
                    >
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                {!creating && editing?.role === 'owner' && ownerCount <= 1 && (
                  <p className="text-xs text-amber-700">
                    Este é o único owner. Promova outro usuário antes de alterar este perfil.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : creating ? 'Adicionar usuário' : 'Salvar perfil'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
