import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  listModels,
  createModel,
  deleteModel,
  getModel,
  updateModel,
  updateElement,
  login,
  me,
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  listApps,
  createApp,
  updateApp,
  deleteApp,
  listServices,
  createService,
  updateService,
  deleteService,
  importDrawio,
  openDrawioEditor,
  getDrawioEditorUrl,
} from './services/api';
import { Canvas } from './components/Canvas';
import * as ws from './services/ws';
import type { Model, ModelDetail, Folder, AppObject, ServiceObject, ModelStatus } from './services/types';
import UserManagement from './pages/UserManagement';

type Mode = 'list' | 'edit' | 'users' | 'folders' | 'apps' | 'services';

const inputStyle: CSSProperties = {
  padding: '8px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#1a1d27',
  color: '#e8eaed',
};

const buttonStyle: CSSProperties = {
  padding: '6px 10px',
  background: '#2a2f3a',
  color: '#e8eaed',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: '#238636',
  color: '#fff',
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: '#b91c1c',
  color: '#fff',
};

const smallMuted: CSSProperties = { fontSize: 12, color: '#7b8290' };

const statusLabel: Record<ModelStatus, string> = { draft: 'Rascunho', final: 'Final' };

export default function App() {
  const [mode, setMode] = useState<Mode>('list');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelDetail | null>(null);

  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [booting, setBooting] = useState(true);
  const [orgId, setOrgId] = useState('');

  const [folders, setFolders] = useState<Folder[]>([]);
  const [apps, setApps] = useState<AppObject[]>([]);
  const [services, setServices] = useState<ServiceObject[]>([]);

  const [showCreateModel, setShowCreateModel] = useState(false);
  const [newModelTitle, setNewModelTitle] = useState('');
  const [newModelDescription, setNewModelDescription] = useState('');
  const [newModelFolderId, setNewModelFolderId] = useState<string | null>(null);
  const [openDrawioAfterCreate, setOpenDrawioAfterCreate] = useState(true);

  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<ModelStatus>('draft');
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);

  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('all');

  // -------------------------------------------------------------------------
  // Bootstrap / sessão
  // -------------------------------------------------------------------------

  async function refreshModels() {
    const list = await listModels();
    setModels(list);
    return list;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const token = localStorage.getItem('c4arch_token');
      if (!token) {
        ws.setToken(null);
        setBooting(false);
        return;
      }
      try {
        const session = await me();
        if (cancelled) return;
        setLoggedIn(true);
        setEmail(session.user.email);
        setOrgId(session.org?.id ?? '');
        ws.setToken(token);
        const list = await listModels();
        if (!cancelled) setModels(list);
      } catch {
        if (cancelled) return;
        localStorage.removeItem('c4arch_token');
        localStorage.removeItem('c4arch_session');
        ws.setToken(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loggedIn || !orgId) return;
    listFolders(orgId).then(setFolders).catch(() => setFolders([]));
    listApps(orgId).then(setApps).catch(() => setApps([]));
    listServices(orgId).then(setServices).catch(() => setServices([]));
  }, [loggedIn, orgId]);

  useEffect(() => {
    ws.setOnUpdate((id, elements, edges) => {
      setModel((previous) => {
        if (!previous || previous.id !== id) return previous;
        const hasIncoming = elements.length > 0 || edges.length > 0;
        const hasLocal = previous.elements.length > 0 || previous.edges.length > 0;
        if (!hasIncoming && hasLocal) {
          // Modelo só existe no Postgres: semeia o Yjs com o estado do REST
          // para que arrastar/renomear não crie elementos vazios.
          ws.sendOp({
            type: 'patch',
            modelId: id,
            patch: {
              op: 'hydrateModel',
              data: { elements: previous.elements, edges: previous.edges },
            },
          });
          return previous;
        }
        return { ...previous, elements, edges };
      });
    });
  }, []);

  useEffect(() => {
    ws.join(selectedId);
  }, [selectedId]);

  function clearSession() {
    localStorage.removeItem('c4arch_token');
    localStorage.removeItem('c4arch_session');
    ws.setToken(null);
    setLoggedIn(false);
    setOrgId('');
    setModels([]);
    setSelectedId(null);
    setModel(null);
    setMode('list');
    setError(null);
  }

  async function loginUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { token, user } = await login(email, password);
      localStorage.setItem('c4arch_token', token);
      localStorage.setItem('c4arch_session', JSON.stringify({ email: user.email }));
      ws.setToken(token);
      setLoggedIn(true);
      setPassword('');
      setEmail(user.email);
      const session = await me();
      const nextOrgId = session.org?.id ?? '';
      setOrgId(nextOrgId);
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function ensureOrgId(): Promise<string> {
    if (orgId) return orgId;
    const session = await me();
    const id = session.org?.id ?? '';
    setOrgId(id);
    return id;
  }

  // -------------------------------------------------------------------------
  // Modelos
  // -------------------------------------------------------------------------

  async function openModel(id: string) {
    setSelectedId(id);
    setMode('edit');
    setError(null);
    setModel(null);
    try {
      const detail = await getModel(id);
      setModel(detail);
      if (detail.elements.length > 0 || detail.edges.length > 0) {
        ws.sendOp({
          type: 'patch',
          modelId: id,
          patch: {
            op: 'hydrateModel',
            data: { elements: detail.elements, edges: detail.edges },
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openCreateModel() {
    if (!loggedIn) {
      setError('Faça login primeiro para criar modelos.');
      return;
    }
    try {
      const currentOrgId = await ensureOrgId();
      if (!currentOrgId) {
        setError('Organização não encontrada. Faça login novamente.');
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setNewModelTitle('');
    setNewModelDescription('');
    setNewModelFolderId(null);
    setOpenDrawioAfterCreate(true);
    setShowCreateModel(true);
  }

  async function onCreateModelFromModal() {
    const title = newModelTitle.trim();
    if (!title) {
      setError('Informe o título do modelo.');
      return;
    }

    // Abre a aba antes do await para não ser bloqueada como popup.
    const popup = openDrawioAfterCreate ? window.open('about:blank', '_blank') : null;

    try {
      const currentOrgId = await ensureOrgId();
      if (!currentOrgId) {
        popup?.close();
        setError('Organização não encontrada. Faça login novamente.');
        return;
      }
      const created = await createModel({
        orgId: currentOrgId,
        folderId: newModelFolderId,
        title,
        description: newModelDescription.trim() || null,
        status: 'draft',
      });
      setModels((previous) => [created, ...previous]);
      setShowCreateModel(false);
      setError(null);
      await openModel(created.id);

      if (openDrawioAfterCreate) {
        const url = await getDrawioEditorUrl(created.id);
        if (popup && !popup.closed) {
          popup.location.href = url;
        } else {
          await openDrawioEditor(created.id);
        }
      } else {
        popup?.close();
      }
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function openEditModel(target: Model) {
    setEditingModel(target);
    setEditTitle(target.title);
    setEditDescription(target.description ?? '');
    setEditStatus(target.status);
    setEditFolderId(target.folderId ?? null);
    setError(null);
  }

  async function onSaveModelEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingModel) return;
    const title = editTitle.trim();
    if (!title) {
      setError('O título do modelo não pode ser vazio.');
      return;
    }
    setSavingModel(true);
    try {
      const updated = await updateModel(editingModel.id, {
        title,
        description: editDescription.trim() || null,
        status: editStatus,
        folderId: editFolderId,
      });
      setModels((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      setModel((previous) => (previous && previous.id === updated.id ? { ...previous, ...updated } : previous));
      setEditingModel(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingModel(false);
    }
  }

  function openDrawio(id: string) {
    openDrawioEditor(id).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  async function onDelete() {
    if (!selectedId) return;
    if (!window.confirm('Excluir "' + (model?.title ?? '') + '"?')) return;
    try {
      await deleteModel(selectedId);
      setSelectedId(null);
      setModel(null);
      setMode('list');
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSaveElementTitle(id: string, title: string) {
    if (!selectedId) return;
    try {
      // Persiste no Postgres e propaga ao Yjs. Sem o patch WS, o próximo
      // movimento do nó reenviaria o título antigo guardado no CRDT.
      await updateElement(selectedId, id, { title });
      ws.sendOp({
        type: 'patch',
        modelId: selectedId,
        patch: { op: 'updateElement', data: { id, title } },
      });
      setModel((previous) => previous
        ? { ...previous, elements: previous.elements.map((element) => (element.id === id ? { ...element, title } : element)) }
        : previous);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const filteredModels = models.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
    const matchesFolder = folderFilter === 'all' ? true : item.folderId === folderFilter;
    return matchesSearch && matchesFolder;
  });

  const folderName = (id?: string | null) => folders.find((folder) => folder.id === id)?.name ?? 'Sem pasta';

  if (booting) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f1115', color: '#7b8290' }}>
        Carregando sessão...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1115', color: '#e8eaed' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #2a2f3a', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontWeight: 600 }}>C4Arch</h1>
        <span style={{ ...smallMuted, marginLeft: 'auto' }}>React Flow + Yjs · Docker</span>
        {loggedIn && (
          <button onClick={clearSession} style={buttonStyle}>Sair</button>
        )}
      </header>

      {!loggedIn ? (
        <div style={{ padding: '16px', borderBottom: '1px solid #2a2f3a' }}>
          <form onSubmit={loginUser} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              style={inputStyle}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              style={inputStyle}
            />
            {error && <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>}
            <button type="submit" style={{ ...buttonStyle, background: '#3b82f6', color: '#fff' }}>
              Entrar
            </button>
          </form>
        </div>
      ) : (
        <>
          <nav style={{ padding: '8px 16px', borderBottom: '1px solid #2a2f3a', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setMode('list')} style={{ ...buttonStyle, background: mode === 'list' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a' }}>Modelos</button>
            <button onClick={() => setMode('folders')} style={{ ...buttonStyle, background: mode === 'folders' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a' }}>Pastas</button>
            <button onClick={() => setMode('apps')} style={{ ...buttonStyle, background: mode === 'apps' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a' }}>Apps</button>
            <button onClick={() => setMode('services')} style={{ ...buttonStyle, background: mode === 'services' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a' }}>Serviços</button>
            <button onClick={() => setMode('users')} style={{ ...buttonStyle, background: mode === 'users' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a' }}>Usuários</button>
          </nav>

          {error && mode !== 'edit' && (
            <div style={{ padding: '8px 16px', color: '#f87171', borderBottom: '1px solid #2a2f3a' }}>
              {error}
              <button onClick={() => setError(null)} style={{ ...buttonStyle, marginLeft: 8, color: '#93c5fd', background: 'transparent' }}>OK</button>
            </div>
          )}

          {mode === 'list' && (
            <>
              <div style={{ padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar modelo..."
                  style={{ ...inputStyle, minWidth: 220 }}
                />
                <select
                  value={folderFilter}
                  onChange={(e) => setFolderFilter(e.target.value)}
                  style={inputStyle}
                >
                  <option value="all">Todas as pastas</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.name}</option>
                  ))}
                </select>
                <button onClick={openCreateModel} style={primaryButtonStyle}>+ Novo modelo</button>
              </div>

              {showCreateModel && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                  <div style={{ background: '#1a1d27', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, width: 440 }}>
                    <h3 style={{ margin: 0 }}>Novo modelo</h3>
                    <input
                      type="text"
                      placeholder="Título do modelo"
                      value={newModelTitle}
                      onChange={(e) => setNewModelTitle(e.target.value)}
                      style={{ ...inputStyle, width: '100%' }}
                      autoFocus
                    />
                    <textarea
                      placeholder="Descrição (opcional)"
                      value={newModelDescription}
                      onChange={(e) => setNewModelDescription(e.target.value)}
                      rows={3}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
                    />
                    <select
                      value={newModelFolderId ?? ''}
                      onChange={(e) => setNewModelFolderId(e.target.value ? e.target.value : null)}
                      style={{ ...inputStyle, width: '100%' }}
                    >
                      <option value="">Sem pasta</option>
                      {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={openDrawioAfterCreate}
                        onChange={(e) => setOpenDrawioAfterCreate(e.target.checked)}
                      />
                      Abrir draw.io após criar
                    </label>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowCreateModel(false)} style={buttonStyle}>Cancelar</button>
                      <button onClick={onCreateModelFromModal} style={primaryButtonStyle}>Criar</button>
                    </div>
                  </div>
                </div>
              )}

              <div style={{ padding: '0 16px 16px', display: 'grid', gap: 8, gridTemplateColumns: '1fr' }}>
                {filteredModels.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openModel(item.id)}
                    style={{
                      background: '#1a1d27',
                      border: '1px solid #2a2f3a',
                      borderRadius: 8,
                      padding: 12,
                      cursor: 'pointer',
                      borderLeft: selectedId === item.id ? '4px solid #3b82f6' : '4px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {item.title}{' '}
                          <span style={{ fontSize: 11, color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 999, padding: '1px 6px' }}>
                            {statusLabel[item.status]}
                          </span>
                        </div>
                        <div style={smallMuted}>{item.description || 'Sem descrição'}</div>
                        <div style={smallMuted}>{folderName(item.folderId)}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditModel(item); }}
                          style={buttonStyle}
                        >
                          Editar
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openDrawio(item.id); }}
                          style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}
                        >
                          draw.io
                        </button>
                      </div>
                    </div>
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
                <input id="folder-name" placeholder="Nome da pasta" style={inputStyle} />
                <button
                  onClick={async () => {
                    const name = (document.getElementById('folder-name') as HTMLInputElement)?.value;
                    if (!name) return;
                    await createFolder({ orgId, name });
                    setFolders(await listFolders(orgId));
                  }}
                  style={primaryButtonStyle}
                >
                  Criar
                </button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {folders.map((folder) => (
                  <div key={folder.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{folder.name}</div>
                      <div style={smallMuted}>{folder.id}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          const name = window.prompt('Novo nome:', folder.name);
                          if (!name) return;
                          await updateFolder(folder.id, { name });
                          setFolders(await listFolders(orgId));
                        }}
                        style={buttonStyle}
                      >
                        Renomear
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('Excluir a pasta "' + folder.name + '"?')) return;
                          await deleteFolder(folder.id);
                          setFolders(await listFolders(orgId));
                        }}
                        style={dangerButtonStyle}
                      >
                        Excluir
                      </button>
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
                <input id="app-name" placeholder="Nome da aplicação" style={inputStyle} />
                <input id="app-desc" placeholder="Descrição" style={inputStyle} />
                <button
                  onClick={async () => {
                    const name = (document.getElementById('app-name') as HTMLInputElement)?.value;
                    const description = (document.getElementById('app-desc') as HTMLInputElement)?.value;
                    if (!name) return;
                    await createApp({ orgId, name, description });
                    setApps(await listApps(orgId));
                  }}
                  style={primaryButtonStyle}
                >
                  Criar
                </button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {apps.map((item) => (
                  <div key={item.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={smallMuted}>{item.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          const name = window.prompt('Novo nome:', item.name);
                          if (!name) return;
                          await updateApp(item.id, { name });
                          setApps(await listApps(orgId));
                        }}
                        style={buttonStyle}
                      >
                        Editar
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('Excluir a aplicação "' + item.name + '"?')) return;
                          await deleteApp(item.id);
                          setApps(await listApps(orgId));
                        }}
                        style={dangerButtonStyle}
                      >
                        Excluir
                      </button>
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
                <input id="svc-name" placeholder="Nome do serviço" style={inputStyle} />
                <input id="svc-port" placeholder="Porta" style={inputStyle} />
                <button
                  onClick={async () => {
                    const name = (document.getElementById('svc-name') as HTMLInputElement)?.value;
                    const port = Number((document.getElementById('svc-port') as HTMLInputElement)?.value);
                    if (!name) return;
                    await createService({ orgId, name, port: Number.isFinite(port) ? port : undefined });
                    setServices(await listServices(orgId));
                  }}
                  style={primaryButtonStyle}
                >
                  Criar
                </button>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {services.map((item) => (
                  <div key={item.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={smallMuted}>{item.protocol}:{item.port} — {item.description}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={async () => {
                          const name = window.prompt('Novo nome:', item.name);
                          if (!name) return;
                          await updateService(item.id, { name });
                          setServices(await listServices(orgId));
                        }}
                        style={buttonStyle}
                      >
                        Editar
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('Excluir o serviço "' + item.name + '"?')) return;
                          await deleteService(item.id);
                          setServices(await listServices(orgId));
                        }}
                        style={dangerButtonStyle}
                      >
                        Excluir
                      </button>
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
            {error && (
              <div style={{ padding: '8px 12px', color: '#f87171', background: '#1f2937', borderBottom: '1px solid #2a2f3a' }}>
                {error}
                <button onClick={() => setError(null)} style={{ ...buttonStyle, marginLeft: 8, color: '#93c5fd', background: 'transparent' }}>OK</button>
              </div>
            )}
            <Canvas
              modelId={selectedId}
              elements={model?.elements ?? []}
              edges={model?.edges ?? []}
              onRenameElement={onSaveElementTitle}
            />
            <footer style={{ padding: '8px 12px', borderTop: '1px solid #2a2f3a', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#0f1115' }}>
              <button onClick={() => { setMode('list'); setSelectedId(null); setModel(null); }} style={buttonStyle}>Voltar</button>
              <button
                onClick={() => { if (model) openEditModel(model); }}
                style={buttonStyle}
                disabled={!model}
              >
                Editar modelo
              </button>
              <button
                onClick={() => {
                  if (!selectedId) return;
                  const xml = window.prompt('XML draw.io:');
                  if (xml) importDrawio(selectedId, xml).catch((err) => setError(err.message));
                }}
                style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}
              >
                Importar draw.io
              </button>
              <button
                onClick={() => { if (selectedId) openDrawio(selectedId); }}
                style={{ ...buttonStyle, background: '#0d9488', color: '#fff' }}
              >
                Abrir draw.io
              </button>
              <button onClick={onDelete} style={dangerButtonStyle}>Excluir</button>
            </footer>
          </div>
        </ReactFlowProvider>
      )}

      {editingModel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={onSaveModelEdit} style={{ background: '#1a1d27', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, width: 440 }}>
            <h3 style={{ margin: 0 }}>Editar modelo</h3>
            <input
              type="text"
              placeholder="Título do modelo"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              style={{ ...inputStyle, width: '100%' }}
              autoFocus
            />
            <textarea
              placeholder="Descrição (opcional)"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            />
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as ModelStatus)}
              style={{ ...inputStyle, width: '100%' }}
            >
              <option value="draft">Rascunho</option>
              <option value="final">Final</option>
            </select>
            <select
              value={editFolderId ?? ''}
              onChange={(e) => setEditFolderId(e.target.value ? e.target.value : null)}
              style={{ ...inputStyle, width: '100%' }}
            >
              <option value="">Sem pasta</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setEditingModel(null)} style={buttonStyle}>Cancelar</button>
              <button type="submit" style={primaryButtonStyle} disabled={savingModel}>
                {savingModel ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
