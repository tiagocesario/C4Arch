import { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { listModels, createModel, deleteModel, getModel, updateModel, updateElement, login, listFolders, createFolder, updateFolder, deleteFolder, listApps, createApp, updateApp, deleteApp, listServices, createService, updateService, deleteService, importDrawio, openDrawioEditor } from './services/api';
import { Canvas } from './components/Canvas'
import * as ws from './services/ws'
import type { Model, Element, Edge, Folder, AppObject, ServiceObject } from './services/types'
import UserManagement from './pages/UserManagement'

type Mode = 'list' | 'edit' | 'users' | 'folders' | 'apps' | 'services'
type ModelDetail = Model & { elements: Element[]; edges: Edge[] }

const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000');

export default function App() {
  const [mode, setMode] = useState<Mode>('list');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelDetail | null>(null);

  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [apps, setApps] = useState<AppObject[]>([]);
  const [services, setServices] = useState<ServiceObject[]>([]);

  useEffect(() => {
    try {
      const token = localStorage.getItem('c4arch_token')
      const sessionRaw = localStorage.getItem('c4arch_session')
      if (token && sessionRaw) {
        const session = JSON.parse(sessionRaw)
        if (session?.email) {
          setLoggedIn(true)
          setEmail(session.email)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!loggedIn || !orgId) return;
    listFolders(orgId).then(setFolders).catch(() => setFolders([]));
    listApps(orgId).then(setApps).catch(() => setApps([]));
    listServices(orgId).then(setServices).catch(() => setServices([]));
  }, [loggedIn, orgId])

  useEffect(() => {
    ws.connect();
    ws.join(selectedId);
    return () => ws.disconnect();
  }, [selectedId]);

  useEffect(() => {
    if (selectedId && model?.id !== selectedId) return;
    ws.setOnUpdate((id, elements, edges) => {
      if (id === selectedId) {
        setModel((p) => (p ? { ...p, elements, edges } : null));
      }
    });
  }, [selectedId, model?.id]);

  async function refresh() {
    const list = await listModels();
    setModels(list);
    if (!selectedId && list.length > 0) {
      openModel(list[0].id);
    }
  }

  async function openModel(id: string) {
    setSelectedId(id);
    setMode('edit');
    const detail = await getModel(id);
    setModel(detail);
  }

  async function loginUser(e: React.FormEvent) {
    e.preventDefault()
    setLoginError(null)
    try {
      const { token } = await login(email, password)
      localStorage.setItem('c4arch_token', token)
      localStorage.setItem('c4arch_session', JSON.stringify({ email }))
      setLoggedIn(true)
      setPassword('')
      const me = await fetch(API + '/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      }).then(r => r.json())
      setOrgId(me.org?.id ?? '')
    } catch (err: any) {
      setLoginError(err.message)
    }
  }

  async function onCreateModel() {
    if (!loggedIn) {
      setLoginError('Faça login primeiro para criar modelos.')
      return
    }
    const title = window.prompt('Título do modelo:', 'Modelo C4 - Demo')
    if (!title) return
    const folderId = window.prompt('ID da pasta (opcional):') || undefined
    try {
      const m = await createModel({ orgId, folderId, title, status: 'draft' })
      setModels((p) => [m, ...p])
      openModel(m.id)
      setLoginError(null)
    } catch (err: any) {
      setLoginError(err.message)
    }
  }

  async function onDelete() {
    if (!selectedId) return;
    if (!window.confirm('Excluir "' + (model?.title ?? '') + '"?')) return;
    await deleteModel(selectedId);
    setSelectedId(null);
    setModel(null);
    setMode('list');
    await refresh();
  }

  async function onSaveElementTitle(id: string, title: string) {
    if (!selectedId) return;
    await updateElement(selectedId, id, { title });
    const detail = await getModel(selectedId);
    setModel(detail);
  }

  const [search, setSearch] = useState('')
  const [folderFilter, setFolderFilter] = useState<string>('all')

  const filteredModels = models.filter((m) => {
    const matchesSearch = m.title.toLowerCase().includes(search.toLowerCase())
    const matchesFolder = folderFilter === 'all' ? !m.folderId : m.folderId === folderFilter
    return matchesSearch && matchesFolder
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1115', color: '#e8eaed' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #2a2f3a', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontWeight: 600 }}>C4Arch</h1>
        <span style={{ fontSize: 12, color: '#7b8290', marginLeft: 'auto' }}>React Flow + Yjs · Docker</span>
      </header>

      {!loggedIn ? (
        <div style={{ padding: '16px', borderBottom: '1px solid #2a2f3a' }}>
          <form onSubmit={loginUser} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }}
            />
            {loginError && <div style={{ color: '#ef4444', fontSize: 12 }}>{loginError}</div>}
            <button type="submit" style={{ padding: '8px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
              Entrar
            </button>
          </form>
        </div>
      ) : (
        <>
          <nav style={{ padding: '8px 16px', borderBottom: '1px solid #2a2f3a', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setMode('list')} style={{ padding: '6px 10px', background: mode === 'list' ? '#2a2f3a' : 'transparent', color: '#e8eaed', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }}>Modelos</button>
            <button onClick={() => setMode('folders')} style={{ padding: '6px 10px', background: mode === 'folders' ? '#2a2f3a' : 'transparent', color: '#e8eaed', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }}>Pastas</button>
            <button onClick={() => setMode('apps')} style={{ padding: '6px 10px', background: mode === 'apps' ? '#2a2f3a' : 'transparent', color: '#e8eaed', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }}>Apps</button>
            <button onClick={() => setMode('services')} style={{ padding: '6px 10px', background: mode === 'services' ? '#2a2f3a' : 'transparent', color: '#e8eaed', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }}>Serviços</button>
            <button onClick={() => setMode('users')} style={{ padding: '6px 10px', background: mode === 'users' ? '#2a2f3a' : 'transparent', color: '#e8eaed', border: '1px solid #2a2f3a', borderRadius: 6, cursor: 'pointer' }}>Usuários</button>
          </nav>

          {mode === 'list' && (
            <>
              <div style={{ padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar modelo..."
                  style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed', minWidth: 220 }}
                />
                <select
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }}
                >
                  <option value="all">Todas as pastas</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button
                  onClick={onCreateModel}
                  style={{ padding: '8px 12px', background: '#238636', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  + Novo modelo
                </button>
              </div>
              <div style={{ padding: '0 16px 16px', display: 'grid', gap: 8, gridTemplateColumns: '1fr' }}>
                {filteredModels.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => openModel(m.id)}
                    style={{
                      background: '#1a1d27',
                      border: '1px solid #2a2f3a',
                      borderRadius: 8,
                      padding: 12,
                      cursor: 'pointer',
                      borderLeft: selectedId === m.id ? '4px solid #3b82f6' : '4px solid transparent'
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: '#7b8290' }}>Clique para editar</div>
                  </div>
                ))}
                {filteredModels.length === 0 && <div style={{ color: '#7b8290' }}>Sem modelos. Clique em "+ Novo modelo".</div>}
              </div>
            </>
          )}

          {mode === 'users' && (
            <div style={{ padding: '16px' }}>
              <UserManagement />
            </div>
          )}

          {mode === 'folders' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ marginTop: 0 }}>Pastas</h2>
              <div style={{ display: 'flex', gap: '8px', marginBottom: 12 }}>
                <input id="folder-name" placeholder="Nome da pasta" style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }} />
                <button onClick={async () => {
                  const name = (document.getElementById('folder-name') as HTMLInputElement)?.value
                  if (!name) return
                  await createFolder({ orgId, name })
                  const list = await listFolders(orgId)
                  setFolders(list)
                }} style={{ padding: '8px 12px', background: '#238636', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Criar</button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {folders.map((f) => (
                  <div key={f.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{f.name}</div>
                      <div style={{ fontSize: 12, color: '#7b8290' }}>{f.id}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={async () => {
                        const name = window.prompt('Novo nome:', f.name)
                        if (!name) return
                        await updateFolder(f.id, { name })
                        const list = await listFolders(orgId)
                        setFolders(list)
                      }} style={{ padding: '6px 10px', background: '#2a2f3a', color: '#e8eaed', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Renomear</button>
                      <button onClick={async () => {
                        await deleteFolder(f.id)
                        const list = await listFolders(orgId)
                        setFolders(list)
                      }} style={{ padding: '6px 10px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Excluir</button>
                    </div>
                  </div>
                ))}
                {folders.length === 0 && <div style={{ color: '#7b8290' }}>Nenhuma pasta.</div>}
              </div>
            </div>
          )}

          {mode === 'apps' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ marginTop: 0 }}>Aplicações</h2>
              <div style={{ display: 'flex', gap: '8px', marginBottom: 12 }}>
                <input id="app-name" placeholder="Nome da aplicação" style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }} />
                <input id="app-desc" placeholder="Descrição" style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }} />
                <button onClick={async () => {
                  const name = (document.getElementById('app-name') as HTMLInputElement)?.value
                  const description = (document.getElementById('app-desc') as HTMLInputElement)?.value
                  if (!name) return
                  await createApp({ orgId, name, description })
                  const list = await listApps(orgId)
                  setApps(list)
                }} style={{ padding: '8px 12px', background: '#238636', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Criar</button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {apps.map((a) => (
                  <div key={a.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{a.name}</div>
                      <div style={{ fontSize: 12, color: '#7b8290' }}>{a.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={async () => {
                        const name = window.prompt('Novo nome:', a.name)
                        if (!name) return
                        await updateApp(a.id, { name })
                        const list = await listApps(orgId)
                        setApps(list)
                      }} style={{ padding: '6px 10px', background: '#2a2f3a', color: '#e8eaed', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Editar</button>
                      <button onClick={async () => {
                        await deleteApp(a.id)
                        const list = await listApps(orgId)
                        setApps(list)
                      }} style={{ padding: '6px 10px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Excluir</button>
                    </div>
                  </div>
                ))}
                {apps.length === 0 && <div style={{ color: '#7b8290' }}>Nenhuma aplicação.</div>}
              </div>
            </div>
          )}

          {mode === 'services' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ marginTop: 0 }}>Serviços</h2>
              <div style={{ display: 'flex', gap: '8px', marginBottom: 12 }}>
                <input id="svc-name" placeholder="Nome do serviço" style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }} />
                <input id="svc-port" placeholder="Porta" style={{ padding: '8px', borderRadius: 6, border: '1px solid #2a2f3a', background: '#1a1d27', color: '#e8eaed' }} />
                <button onClick={async () => {
                  const name = (document.getElementById('svc-name') as HTMLInputElement)?.value
                  const port = Number((document.getElementById('svc-port') as HTMLInputElement)?.value)
                  if (!name) return
                  await createService({ orgId, name, port: Number.isFinite(port) ? port : undefined })
                  const list = await listServices(orgId)
                  setServices(list)
                }} style={{ padding: '8px 12px', background: '#238636', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Criar</button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {services.map((s) => (
                  <div key={s.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: '#7b8290' }}>{s.protocol}:{s.port} — {s.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={async () => {
                        const name = window.prompt('Novo nome:', s.name)
                        if (!name) return
                        await updateService(s.id, { name })
                        const list = await listServices(orgId)
                        setServices(list)
                      }} style={{ padding: '6px 10px', background: '#2a2f3a', color: '#e8eaed', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Editar</button>
                      <button onClick={async () => {
                        await deleteService(s.id)
                        const list = await listServices(orgId)
                        setServices(list)
                      }} style={{ padding: '6px 10px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Excluir</button>
                    </div>
                  </div>
                ))}
                {services.length === 0 && <div style={{ color: '#7b8290' }}>Nenhum serviço.</div>}
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'edit' && selectedId && (
        <ReactFlowProvider>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Canvas modelId={selectedId} elements={model?.elements ?? []} edges={model?.edges ?? []} onRenameElement={onSaveElementTitle} />
            <footer style={{ padding: '8px 12px', borderTop: '1px solid #2a2f3a', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#0f1115' }}>
              <button onClick={() => { setMode('list'); setSelectedId(null); setModel(null); }} style={{ padding: '6px 10px', background: '#2a2f3a', color: '#e8eaed', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Voltar</button>
              <button onClick={onDelete} style={{ padding: '6px 10px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Excluir</button>
              <button onClick={() => { if (!selectedId) return; const xml = window.prompt('XML draw.io:') ; if (xml) importDrawio(selectedId, xml); }} style={{ padding: '6px 10px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Importar draw.io</button>
            </footer>
          </div>
        </ReactFlowProvider>
      )}
    </div>
  );
}
