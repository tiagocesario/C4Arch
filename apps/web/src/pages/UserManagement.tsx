import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Shield, Users as UsersIcon, Search } from 'lucide-react'
import { listUsers, createUser, updateUser, removeUser } from '../services/users'
import type { User, UserRole, CreateUserInput } from '../types/user'

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer'
}

const ROLE_BADGE: Record<UserRole, string> = {
  owner: 'bg-purple-100 text-purple-800 border-purple-200',
  editor: 'bg-blue-100 text-blue-800 border-blue-200',
  viewer: 'bg-gray-100 text-gray-800 border-gray-200'
}

function toInput(input: Partial<CreateUserInput>): CreateUserInput {
  const r = input.role ?? 'viewer'
  return {
    name: input.name ?? '',
    email: input.email ?? '',
    role: r
  }
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all')
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<CreateUserInput>({ name: '', email: '', role: 'viewer' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listUsers().then(setUsers)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter(u => {
      const matchesQuery = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
      const matchesRole = roleFilter === 'all' || u.role === roleFilter
      return matchesQuery && matchesRole
    })
  }, [users, query, roleFilter])

  async function refresh() {
    setUsers(await listUsers())
  }

  async function handleCreate() {
    if (!draft.name || !draft.email) return
    setSaving(true)
    try {
      await createUser(toInput(draft))
      setDraft({ name: '', email: '', role: 'viewer' })
      setCreating(false)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    setSaving(true)
    try {
      await updateUser(editing.id, toInput(editing))
      setEditing(null)
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este usuário?')) return
    await removeUser(id)
    await refresh()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Gestão de Usuários</h1>
              <p className="text-sm text-slate-500">Workspace: C4Arch</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <UsersIcon className="h-4 w-4" />
            <span>{users.length} usuários</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
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
              <button
                onClick={() => {
                  setCreating(true)
                  setEditing(null)
                  setDraft({ name: '', email: '', role: 'viewer' })
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                Novo usuário
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">Nome</th>
                  <th className="text-left px-5 py-3 font-medium">E-mail</th>
                  <th className="text-left px-5 py-3 font-medium">Perfil</th>
                  <th className="text-left px-5 py-3 font-medium">Atualizado</th>
                  <th className="text-right px-5 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                )}
                {filtered.map(user => (
                  <tr key={user.id} className="hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-900">{user.name}</td>
                    <td className="px-5 py-3 text-slate-600">{user.email}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ROLE_BADGE[user.role]}`}>
                        {ROLE_LABELS[user.role]}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(user.updatedAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditing(user)
                            setCreating(false)
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {(creating || editing) && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">
                {creating ? 'Criar usuário' : 'Editar usuário'}
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
                if (creating) handleCreate()
                else handleUpdate()
              }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">Nome</label>
                  <input
                    value={creating ? draft.name : editing?.name ?? ''}
                    onChange={e => creating
                      ? setDraft({ ...draft, name: e.target.value })
                      : setEditing(prev => prev ? { ...prev, name: e.target.value } : prev)
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-700">E-mail</label>
                  <input
                    type="email"
                    value={creating ? draft.email : editing?.email ?? ''}
                    onChange={e => creating
                      ? setDraft({ ...draft, email: e.target.value })
                      : setEditing(prev => prev ? { ...prev, email: e.target.value } : prev)
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Perfil</label>
                <select
                  value={creating ? draft.role : editing?.role ?? 'viewer'}
                  onChange={e => creating
                    ? setDraft({ ...draft, role: e.target.value as UserRole })
                    : setEditing(prev => prev ? { ...prev, role: e.target.value as UserRole } : prev)
                  }
                  className="w-full sm:max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : creating ? 'Criar usuário' : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}
