import type { User, CreateUserInput, UpdateUserInput } from '../types/user'

const STORAGE_KEY = 'c4arch.users'

const initialUsers: User[] = [
  {
    id: '1',
    name: 'Ana Arquiteta',
    email: 'ana@c4arch.io',
    role: 'owner',
    workspaceId: 'ws-1',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  },
  {
    id: '2',
    name: 'Bruno Soluções',
    email: 'bruno@c4arch.io',
    role: 'editor',
    workspaceId: 'ws-1',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z'
  },
  {
    id: '3',
    name: 'Carlos Engenharia',
    email: 'carlos@c4arch.io',
    role: 'editor',
    workspaceId: 'ws-1',
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z'
  },
  {
    id: '4',
    name: 'Daniela Negócios',
    email: 'daniela@c4arch.io',
    role: 'viewer',
    workspaceId: 'ws-1',
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z'
  }
]

function readUsers(): User[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialUsers))
      return initialUsers
    }
    return JSON.parse(raw) as User[]
  } catch {
    return [...initialUsers]
  }
}

function persist(users: User[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(users))
  } catch {
    // ignore storage errors
  }
}

const delay = (ms = 250) => new Promise(resolve => setTimeout(resolve, ms))

export async function listUsers(): Promise<User[]> {
  await delay()
  return readUsers()
}

export async function createUser(input: CreateUserInput): Promise<User> {
  await delay()
  const users = readUsers()
  const now = new Date().toISOString()
  const user: User = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    ...input,
    workspaceId: 'ws-1',
    createdAt: now,
    updatedAt: now
  }
  users.push(user)
  persist(users)
  return user
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<User> {
  await delay()
  const users = readUsers()
  const index = users.findIndex(u => u.id === id)
  if (index === -1) throw new Error('Usuário não encontrado')
  users[index] = { ...users[index], ...input, updatedAt: new Date().toISOString() }
  persist(users)
  return users[index]
}

export async function removeUser(id: string): Promise<void> {
  await delay()
  const users = readUsers().filter(u => u.id !== id)
  persist(users)
}
