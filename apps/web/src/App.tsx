import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  listModels,
  createModel,
  deleteModel,
  getModel,
  updateModel,
  getModelDAS,
  updateModelDAS,
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
  listAppDependencies,
  downloadAppLibrary,
  listServices,
  createService,
  updateService,
  deleteService,
  listServiceDependencies,
  importDrawio,
  openDrawioEditor,
  getDrawioEditorUrl,
  getDrawioPreviewUrl,
} from './services/api';
import { Canvas } from './components/Canvas';
import * as ws from './services/ws';
import type {
  Model,
  ModelDetail,
  Folder,
  AppObject,
  ServiceObject,
  ModelStatus,
  SessionUser,
  AssetDependency,
  C4ModelType,
} from './services/types';
import { C4_MODEL_TYPES } from './services/types';
import type { UserRole } from './types/user';
import UserManagement from './pages/UserManagement';
import GroupManagement from './pages/GroupManagement';

type Mode = 'list' | 'edit' | 'users' | 'groups' | 'folders' | 'apps' | 'services';

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // headings
  html = html.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // horizontal rule
  html = html.replace(/^---$/gm, '<hr/>');
  // tables: convert simple markdown tables
  html = html.replace(/((?:^\|.+\|$\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter((r) => r.trim());
    if (rows.length === 0) return block;
    const isSep = (r: string) => /^\|[\s\-:|]+\|$/.test(r.trim());
    const header = rows[0];
    const bodyRows = rows.slice(isSep(rows[1]) ? 2 : 1);
    const parseRow = (r: string) =>
      r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const ths = parseRow(header).map((c) => `<th>${c}</th>`).join('');
    const trs = bodyRows.map((r) => `<tr>${parseRow(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });
  // paragraphs: wrap remaining lines
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = '<p>' + html + '</p>';
  // clean up empty p
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

const ROLE_LABEL: Record<UserRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

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

const C4_TYPE_LABEL: Record<C4ModelType, string> = {
  'system-context': 'Contexto do sistema',
  container: 'Container',
  component: 'Componente',
  code: 'Código',
  'system-landscape': 'System landscape',
  dynamic: 'Dinâmico',
  deployment: 'Implantação',
};

const C4_TYPE_HELP: Record<C4ModelType, string> = {
  'system-context': 'Um software system em foco, com pessoas e sistemas externos.',
  container: 'Apps, serviços e data stores que compõem um software system.',
  component: 'Componentes dentro de um container específico.',
  code: 'Classes, interfaces e tabelas de um componente (use sob demanda).',
  'system-landscape': 'People e software systems de uma organização/empresa.',
  dynamic: 'Interações em runtime para uma feature ou caso de uso.',
  deployment: 'Instâncias de systems/containers em um ambiente de deployment.',
};

interface AssetDraft {
  kind: 'app' | 'service';
  id?: string;
  name: string;
  description: string;
  protocol: string;
  port: string;
}

const EMPTY_ASSET_DRAFT: AssetDraft = {
  kind: 'app',
  name: '',
  description: '',
  protocol: 'http',
  port: '',
};

interface DependencyTarget {
  kind: 'app' | 'service';
  id: string;
  name: string;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('list');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [dasModel, setDasModel] = useState<Model | null>(null);
  const [dasContent, setDasContent] = useState<string>('');
  const [dasLoading, setDasLoading] = useState(false);
  const [dasSaving, setDasSaving] = useState(false);
  const [dasViewMode, setDasViewMode] = useState<'edit' | 'preview'>('preview');
  const [dasPreviewUrl, setDasPreviewUrl] = useState<string | null>(null);

  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [booting, setBooting] = useState(true);
  const [orgId, setOrgId] = useState('');
  const [orgName, setOrgName] = useState('');
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  // Papel vindo de `memberships` via /api/auth/me. Usado só para a UI; o
  // servidor revalida a permissão em cada rota.
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);

  const [folders, setFolders] = useState<Folder[]>([]);
  const [apps, setApps] = useState<AppObject[]>([]);
  const [services, setServices] = useState<ServiceObject[]>([]);

  const [showCreateModel, setShowCreateModel] = useState(false);
  const [newModelTitle, setNewModelTitle] = useState('');
  const [newModelDescription, setNewModelDescription] = useState('');
  const [newModelFolderId, setNewModelFolderId] = useState<string | null>(null);
  const [newModelC4Type, setNewModelC4Type] = useState<C4ModelType>('container');
  const [newModelC4Scope, setNewModelC4Scope] = useState('');
  const [newModelParentId, setNewModelParentId] = useState<string | null>(null);
  const [newModelParentFilter, setNewModelParentFilter] = useState('');
  const [linkToExisting, setLinkToExisting] = useState(false);
  const [openDrawioAfterCreate, setOpenDrawioAfterCreate] = useState(true);

  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<ModelStatus>('draft');
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [editC4Type, setEditC4Type] = useState<C4ModelType>('container');
  const [editC4Scope, setEditC4Scope] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  const [assetDraft, setAssetDraft] = useState<AssetDraft | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);

  const [dependencyTarget, setDependencyTarget] = useState<DependencyTarget | null>(null);
  const [dependencies, setDependencies] = useState<AssetDependency[]>([]);
  const [dependenciesLoading, setDependenciesLoading] = useState(false);
  const [dependenciesError, setDependenciesError] = useState<string | null>(null);

  const [previewModel, setPreviewModel] = useState<Model | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [viewingFolderId, setViewingFolderId] = useState<string | null>(null);
  const sortedFolders = [...folders].sort((a, b) => {
    const pa = a.parentId ?? '';
    const pb = b.parentId ?? '';
    if (pa !== pb) return pa.localeCompare(pb);
    return a.name.localeCompare(b.name);
  });

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
        setCurrentUser(session.user);
        setCurrentRole(session.org?.role ?? null);
        setOrgName(session.org?.name ?? '');
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

  // Se o próprio owner for rebaixado em outra sessão (ou por ele mesmo), a
  // tela de gestão deixa de ser acessível imediatamente na UI.
  useEffect(() => {
    if (loggedIn && mode === 'users' && currentRole !== 'owner') {
      setMode('list');
    }
  }, [loggedIn, mode, currentRole]);

  function clearSession() {
    localStorage.removeItem('c4arch_token');
    localStorage.removeItem('c4arch_session');
    ws.setToken(null);
    setLoggedIn(false);
    setOrgId('');
    setOrgName('');
    setCurrentUser(null);
    setCurrentRole(null);
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
      setCurrentUser(session.user);
      setCurrentRole(session.org?.role ?? null);
      setOrgName(session.org?.name ?? '');
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
      // Garante que o seletor de modelo pai mostre também os modelos recém-criados.
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    setNewModelTitle('');
    setNewModelDescription('');
    setNewModelFolderId(null);
    setNewModelC4Type('container');
    setNewModelC4Scope('');
    setNewModelParentId(null);
    setNewModelParentFilter('');
    setLinkToExisting(false);
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
        parentId: linkToExisting ? newModelParentId : null,
        title,
        description: newModelDescription.trim() || null,
        status: 'draft',
        c4Type: newModelC4Type,
        c4Scope: newModelC4Scope.trim() || null,
      });
      setModels((previous) => [created, ...previous]);
      setShowCreateModel(false);
      setError(null);
      // O botão "Editor C4" foi ocultado; o fluxo abre apenas o draw.io.
      setMode('list');
      setSelectedId(null);
      setModel(null);

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
    setEditC4Type(target.c4Type ?? 'container');
    setEditC4Scope(target.c4Scope ?? '');
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
        c4Type: editC4Type,
        c4Scope: editC4Scope.trim() || null,
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
    // Abre a aba antes do await para não ser bloqueada como popup.
    const popup = window.open('about:blank', '_blank');
    getDrawioEditorUrl(id)
      .then((url) => {
        if (popup && !popup.closed) {
          popup.location.replace(url);
          try {
            popup.opener = null;
          } catch {
            // Alguns navegadores bloqueiam a alteração após a navegação.
          }
        } else {
          window.location.assign(url);
        }
      })
      .catch((err) => {
        if (popup && !popup.closed) popup.close();
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  async function openPreview(target: Model) {
    setPreviewModel(target);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const detail = await getModel(target.id);
      setPreviewModel({ ...target, ...detail });
      if (!detail.drawioXml || !detail.drawioXml.trim()) {
        setPreviewError('Este modelo ainda não possui um desenho salvo no draw.io.');
        return;
      }
      setPreviewUrl(getDrawioPreviewUrl(detail.drawioXml));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewModel(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  async function onDeleteModel(target: Model) {
    if (!window.confirm('Excluir "' + target.title + '"? Esta ação não pode ser desfeita.')) return;
    try {
      await deleteModel(target.id);
      setModels((previous) => previous.filter((item) => item.id !== target.id));
      if (selectedId === target.id) {
        setSelectedId(null);
        setModel(null);
        setMode('list');
      }
      if (previewModel?.id === target.id) {
        closePreview();
      }
      setError(null);
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete() {
    if (!selectedId) return;
    const target = model ?? models.find((item) => item.id === selectedId);
    if (target) await onDeleteModel(target);
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

  // -------------------------------------------------------------------------
  // Apps, serviços e dependências
  // -------------------------------------------------------------------------

  function openCreateAsset(kind: 'app' | 'service') {
    setAssetDraft({ ...EMPTY_ASSET_DRAFT, kind });
    setError(null);
  }

  function openEditAsset(kind: 'app' | 'service', asset: AppObject | ServiceObject) {
    setAssetDraft({
      kind,
      id: asset.id,
      name: asset.name,
      description: asset.description ?? '',
      protocol: kind === 'service' ? ((asset as ServiceObject).protocol ?? 'http') : 'http',
      port:
        kind === 'service' && (asset as ServiceObject).port != null
          ? String((asset as ServiceObject).port)
          : '',
    });
    setError(null);
  }

  async function saveAsset(e: FormEvent) {
    e.preventDefault();
    if (!assetDraft) return;
    const name = assetDraft.name.trim();
    if (!name) {
      setError('Informe o nome.');
      return;
    }
    if (!orgId) {
      setError('Organização não encontrada.');
      return;
    }

    const portValue = assetDraft.port.trim() ? Number(assetDraft.port) : null;
    if (portValue !== null && (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535)) {
      setError('Porta inválida (1–65535).');
      return;
    }

    setSavingAsset(true);
    try {
      if (assetDraft.kind === 'app') {
        const payload = {
          name,
          description: assetDraft.description.trim() || null,
        };
        if (assetDraft.id) await updateApp(assetDraft.id, payload);
        else await createApp({ orgId, ...payload });
        setApps(await listApps(orgId));
      } else {
        const payload = {
          name,
          description: assetDraft.description.trim() || null,
          protocol: assetDraft.protocol.trim() || 'http',
          port: portValue,
        };
        if (assetDraft.id) await updateService(assetDraft.id, payload);
        else await createService({ orgId, ...payload });
        setServices(await listServices(orgId));
      }
      setAssetDraft(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAsset(false);
    }
  }

  async function openDependencies(kind: 'app' | 'service', asset: AppObject | ServiceObject) {
    setDependencyTarget({ kind, id: asset.id, name: asset.name });
    setDependencies([]);
    setDependenciesError(null);
    setDependenciesLoading(true);
    try {
      const rows =
        kind === 'app'
          ? await listAppDependencies(asset.id)
          : await listServiceDependencies(asset.id);
      setDependencies(rows);
    } catch (err) {
      setDependenciesError(err instanceof Error ? err.message : String(err));
    } finally {
      setDependenciesLoading(false);
    }
  }

  const filteredModels = models.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
    const matchesFolder = folderFilter === 'all' ? true : item.folderId === folderFilter;
    return matchesSearch && matchesFolder;
  });

  // Candidatos para vincular como modelo pai: busca por título, sem depender
  // de abrir o <select> nativo.
  const parentCandidates = models.filter((m) => {
    const term = newModelParentFilter.trim().toLowerCase();
    return !term || m.title.toLowerCase().includes(term);
  });

  const folderName = (id?: string | null) => folders.find((folder) => folder.id === id)?.name ?? 'Sem pasta';
  const isWriter = currentRole === 'owner' || currentRole === 'editor';

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
        {loggedIn && currentRole && (
          <span
            title="Perfil na organização (definido em memberships)"
            style={{
              ...smallMuted,
              color: '#c7d2fe',
              border: '1px solid #2a2f3a',
              borderRadius: 999,
              padding: '3px 9px',
            }}
          >
            {currentUser?.email} · {ROLE_LABEL[currentRole]}
          </span>
        )}
        {loggedIn && (
          <button onClick={clearSession} style={buttonStyle}>Sair</button>
        )}
      </header>

      {!loggedIn ? (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', background: 'linear-gradient(135deg, #0f1115 0%, #1a1d27 100%)' }}>
            <div style={{ maxWidth: 420, textAlign: 'center' }}>
              <svg viewBox="0 0 320 200" width="100%" height="auto" style={{ marginBottom: 16 }}>
                <rect x="20" y="20" width="80" height="40" rx="6" fill="#438DD5" stroke="#3C7FC0" />
                <text x="60" y="45" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="system-ui">System</text>
                <rect x="120" y="20" width="80" height="40" rx="6" fill="#85BBF0" stroke="#3C7FC0" />
                <text x="160" y="45" textAnchor="middle" fill="#1f2937" fontSize="11" fontFamily="system-ui">Container</text>
                <rect x="220" y="20" width="80" height="40" rx="6" fill="#b4d9f7" stroke="#3C7FC0" />
                <text x="260" y="45" textAnchor="middle" fill="#1f2937" fontSize="11" fontFamily="system-ui">Component</text>
                <circle cx="60" cy="130" r="18" fill="#238636" />
                <text x="60" y="135" textAnchor="middle" fill="#fff" fontSize="10" fontFamily="system-ui">Actor</text>
                <line x1="60" y1="60" x2="60" y2="112" stroke="#7b8290" strokeWidth="1.5" markerEnd="url(#arrow)" />
                <line x1="100" y1="40" x2="120" y2="40" stroke="#7b8290" strokeWidth="1.5" />
                <line x1="200" y1="40" x2="220" y2="40" stroke="#7b8290" strokeWidth="1.5" />
                <defs>
                  <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill="#7b8290" />
                  </marker>
                </defs>
              </svg>
              <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>C4Arch</h2>
              <p style={{ margin: 0, color: '#7b8290', fontSize: 14 }}>
                Modele arquitetura C4 viva em equipe, com persistência e edição em tempo real.
              </p>
            </div>
          </div>
          <div style={{ width: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', borderLeft: '1px solid #2a2f3a', background: '#1a1d27' }}>
            <form onSubmit={loginUser} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Entrar</h3>
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
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <nav style={{ width: 180, padding: '12px 8px', borderRight: '1px solid #2a2f3a', display: 'flex', flexDirection: 'column', gap: '6px', background: '#111318' }}>
            <button onClick={() => setMode('list')} style={{ ...buttonStyle, background: mode === 'list' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Modelos</button>
            <button onClick={() => setMode('folders')} style={{ ...buttonStyle, background: mode === 'folders' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Pastas</button>
            <button onClick={() => setMode('apps')} style={{ ...buttonStyle, background: mode === 'apps' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Apps</button>
            <button onClick={() => setMode('services')} style={{ ...buttonStyle, background: mode === 'services' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Serviços</button>
            {currentRole === 'owner' && (
              <button onClick={() => setMode('users')} style={{ ...buttonStyle, background: mode === 'users' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Usuários</button>
            )}
            {currentRole === 'owner' && (
              <button onClick={() => setMode('groups')} style={{ ...buttonStyle, background: mode === 'groups' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Perfis/Grupos</button>
            )}
          </nav>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>

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
                {isWriter && (
                  <button onClick={openCreateModel} style={primaryButtonStyle}>+ Novo modelo</button>
                )}
              </div>

              {showCreateModel && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
                  <div
                    style={{
                      background: '#1a1d27',
                      padding: 20,
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      width: 'min(440px, 94vw)',
                      maxHeight: '90vh',
                      overflowY: 'auto',
                    }}
                  >
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
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                      <span>Tipo de diagrama C4</span>
                      <select
                        value={newModelC4Type}
                        onChange={(e) => setNewModelC4Type(e.target.value as C4ModelType)}
                        style={{ ...inputStyle, width: '100%' }}
                      >
                        {C4_MODEL_TYPES.map((type) => (
                          <option key={type} value={type}>{C4_TYPE_LABEL[type]}</option>
                        ))}
                      </select>
                      <span style={smallMuted}>{C4_TYPE_HELP[newModelC4Type]}</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Escopo (ex.: sistema de vendas)"
                      value={newModelC4Scope}
                      onChange={(e) => setNewModelC4Scope(e.target.value)}
                      style={{ ...inputStyle, width: '100%' }}
                    />
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={linkToExisting}
                        onChange={(e) => {
                          setLinkToExisting(e.target.checked);
                          if (!e.target.checked) setNewModelParentId(null);
                        }}
                      />
                      Vincular a um modelo existente (novo tipo de diagrama)
                    </label>
                    {linkToExisting && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input
                          type="text"
                          placeholder="Filtrar modelo existente..."
                          value={newModelParentFilter}
                          onChange={(e) => setNewModelParentFilter(e.target.value)}
                          style={{ ...inputStyle, width: '100%' }}
                        />
                        <div
                          style={{
                            maxHeight: 170,
                            overflowY: 'auto',
                            border: '1px solid #2a2f3a',
                            borderRadius: 6,
                            background: '#0f1115',
                          }}
                        >
                          {parentCandidates.length === 0 ? (
                            <div style={{ padding: 8, fontSize: 12, color: '#7b8290' }}>
                              {models.length === 0
                                ? 'Nenhum modelo carregado. Feche e abra novamente o cadastro.'
                                : 'Nenhum modelo encontrado para a busca.'}
                            </div>
                          ) : (
                            parentCandidates.map((m) => (
                              <button
                                type="button"
                                key={m.id}
                                onClick={() => {
                                  setNewModelParentId(m.id);
                                  setNewModelParentFilter(m.title);
                                }}
                                style={{
                                  display: 'block',
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '6px 8px',
                                  background: newModelParentId === m.id ? '#2a2f3a' : 'transparent',
                                  color: '#e8eaed',
                                  border: 'none',
                                  borderBottom: '1px solid #1f242e',
                                  cursor: 'pointer',
                                  fontSize: 13,
                                }}
                              >
                                {m.title}{' '}
                                <span style={{ color: '#93c5fd', fontSize: 11 }}>
                                  {C4_TYPE_LABEL[m.c4Type] ?? m.c4Type}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                        {newModelParentId ? (
                          <span style={smallMuted}>
                            Selecionado: {models.find((m) => m.id === newModelParentId)?.title ?? 'modelo'}.
                            Não é permitido repetir o mesmo tipo de diagrama.
                          </span>
                        ) : (
                          <span style={smallMuted}>Digite o nome para filtrar e clique em um modelo da lista.</span>
                        )}
                      </div>
                    )}
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
                    onClick={() => openPreview(item)}
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
                        <div style={smallMuted}>
                          {C4_TYPE_LABEL[item.c4Type] ?? item.c4Type}
                          {item.c4Scope ? ` · ${item.c4Scope}` : ''}
                          {item.parentId ? ` · vinculado a ${models.find((m) => m.id === item.parentId)?.title ?? 'modelo'}` : ''}
                          {' · '}{folderName(item.folderId)} · clique para visualizar o draw.io
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {isWriter && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openDrawio(item.id); }}
                            style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}
                            title="Abrir o editor draw.io em uma nova aba"
                          >
                            draw.io
                          </button>
                        )}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setDasModel(item);
                            setDasContent('');
                            setDasPreviewUrl(null);
                            setDasViewMode('preview');
                            setDasLoading(true);
                            try {
                              const [content, detail] = await Promise.all([
                                getModelDAS(item.id),
                                getModel(item.id),
                              ]);
                              setDasContent(content);
                              if (detail.drawioXml) setDasPreviewUrl(getDrawioPreviewUrl(detail.drawioXml));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            } finally {
                              setDasLoading(false);
                            }
                          }}
                          style={{ ...buttonStyle, background: '#0d9488', color: '#fff' }}
                          title="Visualizar/editar o DAS do modelo"
                        >
                          DAS
                        </button>
                        {isWriter && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditModel(item); }}
                            style={buttonStyle}
                          >
                            Editar
                          </button>
                        )}
                        {isWriter && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeleteModel(item); }}
                            style={dangerButtonStyle}
                            title="Excluir este modelo"
                          >
                            Excluir
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {filteredModels.length === 0 && <div style={{ color: '#7b8290' }}>Sem modelos. Clique em "+ Novo modelo".</div>}
              </div>
            </>
          )}

          {mode === 'users' && currentUser && currentRole && (
            <div style={{ padding: '16px' }}>
              <UserManagement
                orgId={orgId}
                orgName={orgName}
                currentUserId={currentUser.id}
                currentRole={currentRole}
                onSelfRoleChange={(nextRole) => setCurrentRole(nextRole)}
              />
            </div>
          )}

          {mode === 'groups' && currentRole && (
            <div style={{ padding: '16px' }}>
              <GroupManagement
                orgId={orgId}
                orgName={orgName}
                currentRole={currentRole}
              />
            </div>
          )}

          {mode === 'folders' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ marginTop: 0 }}>Pastas</h2>
              {isWriter && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input id="folder-name" placeholder="Nome da pasta" style={inputStyle} />
                  <select id="folder-parent" style={inputStyle}>
                    <option value="">Pasta raiz</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      const name = (document.getElementById('folder-name') as HTMLInputElement)?.value;
                      const parentId = (document.getElementById('folder-parent') as HTMLSelectElement)?.value || null;
                      if (!name) return;
                      await createFolder({ orgId, name, parentId });
                      setFolders(await listFolders(orgId));
                      const input = document.getElementById('folder-name') as HTMLInputElement;
                      if (input) input.value = '';
                    }}
                    style={primaryButtonStyle}
                  >
                    Criar
                  </button>
                </div>
              )}
              <div style={{ display: 'grid', gap: 8 }}>
                {sortedFolders.map((folder) => {
                  const linkedModels = models.filter((item) => item.folderId === folder.id);
                  const expanded = viewingFolderId === folder.id;
                  return (
                    <div key={folder.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, marginLeft: (folder.parentId ? 24 : 0) }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div
                          onClick={() => setViewingFolderId(expanded ? null : folder.id)}
                          style={{ cursor: 'pointer', flex: 1, minWidth: 180 }}
                          title="Clique para listar os modelos vinculados"
                        >
                          <div style={{ fontWeight: 600 }}>
                            {folder.name}{' '}
                            <span style={{ fontSize: 11, color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 999, padding: '1px 6px' }}>
                              {linkedModels.length} {linkedModels.length === 1 ? 'modelo' : 'modelos'}
                            </span>
                          </div>
                          <div style={smallMuted}>{folder.id}</div>
                          {folder.parentId && (
                            <div style={{ ...smallMuted, fontSize: 11 }}>
                              Subpasta de: {folders.find((f) => f.id === folder.parentId)?.name ?? folder.parentId}
                            </div>
                          )}
                        </div>
                    {isWriter && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
                        <select
                          defaultValue={folder.parentId ?? ''}
                          onChange={async (e) => {
                            const newParent = e.target.value || null;
                            if (newParent === folder.parentId) return;
                            try {
                              await updateFolder(folder.id, { parentId: newParent });
                              setFolders(await listFolders(orgId));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          style={inputStyle}
                          title="Mover para pasta pai"
                        >
                          <option value="">Pasta raiz</option>
                          {folders
                            .filter((f) => f.id !== folder.id)
                            .map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
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
                    )}
                    </div>
                      {expanded && (
                        <div style={{ marginTop: 12, borderTop: '1px solid #2a2f3a', paddingTop: 12, display: 'grid', gap: 8 }}>
                          {linkedModels.length === 0 && (
                            <div style={smallMuted}>Nenhum modelo vinculado a esta pasta.</div>
                          )}
                          {linkedModels.map((item) => (
                            <div
                              key={item.id}
                              style={{ background: '#0f1115', border: '1px solid #2a2f3a', borderRadius: 6, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                            >
                              <div>
                                <div style={{ fontWeight: 600 }}>{item.title}</div>
                                <div style={smallMuted}>
                                  {C4_TYPE_LABEL[item.c4Type] ?? item.c4Type}
                                  {item.c4Scope ? ` · ${item.c4Scope}` : ''}
                                  {' · '}{statusLabel[item.status]}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  onClick={() => openPreview(item)}
                                  style={buttonStyle}
                                >
                                  Visualizar
                                </button>
                                {isWriter && (
                                  <button
                                    onClick={() => openDrawio(item.id)}
                                    style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}
                                  >
                                    draw.io
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setDasModel(item);
                                    setDasContent('');
                                    setDasPreviewUrl(null);
                                    setDasViewMode('preview');
                                    setDasLoading(true);
                                    Promise.all([getModelDAS(item.id), getModel(item.id)])
                                      .then(([content, detail]) => {
                                        setDasContent(content);
                                        if (detail.drawioXml) setDasPreviewUrl(getDrawioPreviewUrl(detail.drawioXml));
                                      })
                                      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                                      .finally(() => setDasLoading(false));
                                  }}
                                  style={{ ...buttonStyle, background: '#0d9488', color: '#fff' }}
                                >
                                  DAS
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {folders.length === 0 && <div style={{ color: '#7b8290' }}>Nenhuma pasta.</div>}
              </div>
            </div>
          )}

          {mode === 'apps' && (
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Aplicações</h2>
                {isWriter && (
                  <button onClick={() => openCreateAsset('app')} style={primaryButtonStyle}>
                    + Nova aplicação
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      await downloadAppLibrary(orgId);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                  style={buttonStyle}
                  title="Baixa o XML da biblioteca c4arch para importar no draw.io"
                >
                  Baixar biblioteca c4arch
                </button>
              </div>
              <p style={smallMuted}>
                Apps são containers C4 reutilizáveis: ao inserir na biblioteca do draw.io, o objeto
                fica vinculado ao catálogo e acompanha as edições.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {apps.map((item) => (
                  <div key={item.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={smallMuted}>{item.description || 'Sem descrição'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={() => openDependencies('app', item)} style={buttonStyle}>
                        Modelos dependentes
                      </button>
                      {isWriter && (
                        <>
                          <button onClick={() => openEditAsset('app', item)} style={buttonStyle}>
                            Editar
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm('Excluir a aplicação "' + item.name + '"?')) return;
                              try {
                                await deleteApp(item.id);
                                setApps(await listApps(orgId));
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              }
                            }}
                            style={dangerButtonStyle}
                          >
                            Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {apps.length === 0 && <div style={{ color: '#7b8290' }}>Nenhuma aplicação.</div>}
              </div>
            </div>
          )}

          {mode === 'services' && (
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <h2 style={{ margin: 0 }}>Serviços</h2>
                {isWriter && (
                  <button onClick={() => openCreateAsset('service')} style={primaryButtonStyle}>
                    + Novo serviço
                  </button>
                )}
              </div>
              <p style={smallMuted}>
                Serviços são containers C4 reutilizáveis no draw.io. Protocolo, porta e descrição
                são propagados para todos os modelos que usam o serviço.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {services.map((item) => (
                  <div key={item.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={smallMuted}>
                        {item.protocol}{item.port ? `:${item.port}` : ''} — {item.description || 'Sem descrição'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={() => openDependencies('service', item)} style={buttonStyle}>
                        Modelos dependentes
                      </button>
                      {isWriter && (
                        <>
                          <button onClick={() => openEditAsset('service', item)} style={buttonStyle}>
                            Editar
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm('Excluir o serviço "' + item.name + '"?')) return;
                              try {
                                await deleteService(item.id);
                                setServices(await listServices(orgId));
                              } catch (err) {
                                setError(err instanceof Error ? err.message : String(err));
                              }
                            }}
                            style={dangerButtonStyle}
                          >
                            Excluir
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {services.length === 0 && <div style={{ color: '#7b8290' }}>Nenhum serviço.</div>}
              </div>
            </div>
          )}
          </div>
        </div>
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
              readOnly={!isWriter}
            />
            <footer style={{ padding: '8px 12px', borderTop: '1px solid #2a2f3a', display: 'flex', gap: 8, justifyContent: 'flex-end', background: '#0f1115' }}>
              <button onClick={() => { setMode('list'); setSelectedId(null); setModel(null); }} style={buttonStyle}>Voltar</button>
              {!isWriter && <span style={{ ...smallMuted, alignSelf: 'center' }}>Somente leitura</span>}
              {isWriter && (
                <>
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
                </>
              )}
            </footer>
          </div>
        </ReactFlowProvider>
      )}

      {previewModel && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
          onClick={closePreview}
        >
          <div
            style={{ background: '#111827', border: '1px solid #2a2f3a', borderRadius: 10, width: 'min(1100px, 96vw)', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #2a2f3a', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0 }}>{previewModel.title}</h3>
                <div style={smallMuted}>
                  {C4_TYPE_LABEL[previewModel.c4Type] ?? previewModel.c4Type}
                  {previewModel.c4Scope ? ` · ${previewModel.c4Scope}` : ''}
                  {' · '}Preview draw.io (somente leitura)
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {isWriter && (
                  <button onClick={() => openDrawio(previewModel.id)} style={primaryButtonStyle}>Abrir editor draw.io</button>
                )}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...buttonStyle, textDecoration: 'none' }}
                  >
                    Nova aba
                  </a>
                )}
                <button onClick={closePreview} style={buttonStyle}>Fechar</button>
              </div>
            </div>
            <div style={{ flex: 1, background: '#fff', position: 'relative', minHeight: 0 }}>
              {previewLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1f2937' }}>
                  Carregando desenho...
                </div>
              )}
              {!previewLoading && previewError && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#1f2937', padding: 24, textAlign: 'center', gap: 12 }}>
                  <div>{previewError}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {isWriter && (
                      <button onClick={() => openDrawio(previewModel.id)} style={primaryButtonStyle}>Criar/editar no draw.io</button>
                    )}
                  </div>
                </div>
              )}
              {!previewLoading && previewUrl && (
                <iframe
                  src={previewUrl}
                  title={'Preview draw.io: ' + previewModel.title}
                  style={{ width: '100%', height: '100%', border: 0 }}
                  referrerPolicy="no-referrer"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {dasModel && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}
          onClick={() => setDasModel(null)}
        >
          <div
            style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 10, width: 'min(900px, 96vw)', height: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2f3a', display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 style={{ margin: 0 }}>DAS — {dasModel.title}</h3>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    if (!dasModel) return;
                    setDasLoading(true);
                    try {
                      const [content, detail] = await Promise.all([
                        getModelDAS(dasModel.id),
                        getModel(dasModel.id),
                      ]);
                      setDasContent(content);
                      if (detail.drawioXml) setDasPreviewUrl(getDrawioPreviewUrl(detail.drawioXml));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setDasLoading(false);
                    }
                  }}
                  style={buttonStyle}
                >
                  Regenerar
                </button>
                <button
                  onClick={() => {
                    const w = window.open('', '_blank');
                    if (!w) return;
                    const imgTag = dasPreviewUrl ? `<div style="text-align:center;margin-bottom:16px;"><img src="${dasPreviewUrl}" alt="Diagrama" style="max-width:100%;border:1px solid #ccc;"/></div>` : '';
                    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${dasModel?.title ?? 'DAS'}</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111;}h1,h2,h3{color:#1f2937;}table{border-collapse:collapse;width:100%;margin:8px 0;}th,td{border:1px solid #ccc;padding:6px;font-size:12px;}th{background:#f3f4f6;}code{background:#f3f4f6;padding:1px 4px;border-radius:3px;}hr{border:none;border-top:1px solid #ccc;margin:12px 0;}@media print{body{margin:12px;}}</style></head><body>${imgTag}${markdownToHtml(dasContent)}</body></html>`;
                    w.document.write(html);
                    w.document.close();
                    w.focus();
                    setTimeout(() => { w.print(); }, 300);
                  }}
                  style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}
                  title="Exportar o DAS como PDF (imprimir/salvar PDF)"
                >
                  Exportar PDF
                </button>
                <button
                  onClick={async () => {
                    if (!dasModel) return;
                    setDasSaving(true);
                    try {
                      await updateModelDAS(dasModel.id, dasContent);
                      setError(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setDasSaving(false);
                    }
                  }}
                  style={primaryButtonStyle}
                  disabled={dasSaving}
                >
                  {dasSaving ? 'Salvando...' : 'Salvar'}
                </button>
                <button onClick={() => setDasModel(null)} style={buttonStyle}>Fechar</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid #2a2f3a' }}>
              <button onClick={() => setDasViewMode('preview')} style={{ ...buttonStyle, background: dasViewMode === 'preview' ? '#2a2f3a' : 'transparent' }}>Visualizar</button>
              <button onClick={() => setDasViewMode('edit')} style={{ ...buttonStyle, background: dasViewMode === 'edit' ? '#2a2f3a' : 'transparent' }}>Editar</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, padding: 12, overflow: 'auto' }}>
              {dasLoading ? (
                <div style={{ color: '#7b8290' }}>Carregando DAS...</div>
              ) : dasViewMode === 'edit' ? (
                <textarea
                  value={dasContent}
                  onChange={(e) => setDasContent(e.target.value)}
                  style={{ width: '100%', height: '100%', background: '#0f1115', color: '#e8eaed', border: '1px solid #2a2f3a', borderRadius: 6, padding: 10, fontFamily: 'monospace', fontSize: 12, resize: 'none' }}
                />
              ) : (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
                  <div
                    className="das-preview"
                    style={{ background: '#ffffff', color: '#1f2937', width: '210mm', maxWidth: '100%', minHeight: '297mm', padding: '20mm', boxShadow: '0 2px 12px rgba(0,0,0,0.4)', borderRadius: 4, lineHeight: 1.6, fontSize: 12, fontFamily: 'system-ui, sans-serif' }}
                  >
                    {dasPreviewUrl && (
                      <div style={{ marginBottom: 16, textAlign: 'center' }}>
                        <img src={dasPreviewUrl} alt="Diagrama draw.io" style={{ maxWidth: '100%', border: '1px solid #ccc' }} />
                      </div>
                    )}
                    <div dangerouslySetInnerHTML={{ __html: markdownToHtml(dasContent) }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {assetDraft && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 }}>
          <form onSubmit={saveAsset} style={{ background: '#1a1d27', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, width: 440 }}>
            <h3 style={{ margin: 0 }}>
              {assetDraft.id ? 'Editar' : assetDraft.kind === 'app' ? 'Nova aplicação' : 'Novo serviço'}
            </h3>
            <input
              type="text"
              placeholder={assetDraft.kind === 'app' ? 'Nome da aplicação' : 'Nome do serviço'}
              value={assetDraft.name}
              onChange={(e) => setAssetDraft({ ...assetDraft, name: e.target.value })}
              style={{ ...inputStyle, width: '100%' }}
              autoFocus
            />
            <textarea
              placeholder="Descrição curta (aparece no objeto C4)"
              value={assetDraft.description}
              onChange={(e) => setAssetDraft({ ...assetDraft, description: e.target.value })}
              rows={3}
              style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
            />
            {assetDraft.kind === 'service' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Protocolo (http, https, grpc...)"
                  value={assetDraft.protocol}
                  onChange={(e) => setAssetDraft({ ...assetDraft, protocol: e.target.value })}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <input
                  type="number"
                  min={1}
                  max={65535}
                  placeholder="Porta"
                  value={assetDraft.port}
                  onChange={(e) => setAssetDraft({ ...assetDraft, port: e.target.value })}
                  style={{ ...inputStyle, width: 110 }}
                />
              </div>
            )}
            <p style={smallMuted}>
              As alterações são propagadas para todos os modelos que usam este
              {assetDraft.kind === 'app' ? ' app' : ' serviço'}.
            </p>
            {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAssetDraft(null)} style={buttonStyle}>Cancelar</button>
              <button type="submit" style={primaryButtonStyle} disabled={savingAsset}>
                {savingAsset ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {dependencyTarget && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050, padding: 16 }}
          onClick={() => setDependencyTarget(null)}
        >
          <div
            style={{ background: '#111827', border: '1px solid #2a2f3a', borderRadius: 10, width: 'min(760px, 96vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2f3a', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>Modelos dependentes</h3>
                <div style={smallMuted}>
                  {dependencyTarget.kind === 'app' ? 'Aplicação' : 'Serviço'}: {dependencyTarget.name}
                </div>
              </div>
              <button onClick={() => setDependencyTarget(null)} style={{ ...buttonStyle, marginLeft: 'auto' }}>
                Fechar
              </button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', display: 'grid', gap: 8 }}>
              {dependenciesLoading && <div style={smallMuted}>Consultando modelos...</div>}
              {!dependenciesLoading && dependenciesError && (
                <div style={{ color: '#f87171' }}>{dependenciesError}</div>
              )}
              {!dependenciesLoading && !dependenciesError && dependencies.length === 0 && (
                <div style={smallMuted}>
                  Nenhum modelo usa este {dependencyTarget.kind === 'app' ? 'app' : 'serviço'} ainda.
                  Insira o objeto pela biblioteca “Aplicações e Serviços” no draw.io.
                </div>
              )}
              {!dependenciesLoading && !dependenciesError && dependencies.map((dep) => (
                <div key={dep.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{dep.title}</div>
                    <div style={smallMuted}>
                      {C4_TYPE_LABEL[dep.c4Type] ?? dep.c4Type}
                      {dep.c4Scope ? ` · ${dep.c4Scope}` : ''}
                      {' · '}{dep.folderName || 'Sem pasta'}
                    </div>
                    <div style={{ ...smallMuted, marginTop: 4 }}>
                      {dep.occurrences} ocorrência(s)
                      {dep.viaElements ? ' · vínculo REST' : ''}
                      {dep.viaDrawio ? ' · objeto draw.io' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setDependencyTarget(null);
                      openPreview(dep);
                    }}
                    style={buttonStyle}
                  >
                    Abrir preview
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editingModel && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <form
            onSubmit={onSaveModelEdit}
            style={{
              background: '#1a1d27',
              padding: 20,
              borderRadius: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              width: 'min(440px, 94vw)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
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
              value={editC4Type}
              onChange={(e) => setEditC4Type(e.target.value as C4ModelType)}
              style={{ ...inputStyle, width: '100%' }}
            >
              {C4_MODEL_TYPES.map((type) => (
                <option key={type} value={type}>{C4_TYPE_LABEL[type]}</option>
              ))}
            </select>
            <div style={smallMuted}>{C4_TYPE_HELP[editC4Type]}</div>
            <input
              type="text"
              placeholder="Escopo C4 (ex.: sistema de vendas)"
              value={editC4Scope}
              onChange={(e) => setEditC4Scope(e.target.value)}
              style={{ ...inputStyle, width: '100%' }}
            />
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
