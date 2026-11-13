import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
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
  addModelDiagram,
  importModel,
} from './services/api';
import { Canvas } from './components/Canvas';
import { AppHeader } from './components/AppHeader';
import { CommentsPanel } from './components/CommentsPanel';
import { DasEditor } from './components/DasEditor';
import { ExportPanel } from './components/ExportPanel';
import { ImportModelsPanel } from './components/ImportModelsPanel';
import type { ImportResult, ImportSource } from './components/ImportModelsPanel';
import { InspectionsPanel } from './components/InspectionsPanel';
import { LoginScreen } from './components/LoginScreen';
import { PresenceBar } from './components/PresenceBar';
import { StructurizrImportPanel } from './components/StructurizrImportPanel';
import { VersionsPanel } from './components/VersionsPanel';
import { autoLayoutViewModel, type ModelComment } from './services/collaboration';
import { inspectModel, type InspectionReport } from './services/api';
import {
  listModelVersions,
  getModelVersion,
  restoreModelVersion,
  type ModelVersion,
} from './services/api';
import * as ws from './services/ws';
import { parseHashRoute, replaceHashRoute } from './router';
import { escapeHtml, markdownToHtml } from './utils/markdown';
import { buildDasFromSections, firstDiagramXml, parseDasSections } from './utils/das';
import { nameFromImportUrl, normalizeText, stripFileExtension } from './utils/text';
import { C4_TYPE_HELP, C4_TYPE_LABEL } from './utils/c4';
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

type Mode = 'files' | 'edit' | 'users' | 'groups' | 'catalog' | 'domains';

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
  const [mode, setMode] = useState<Mode>('files');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [dasModel, setDasModel] = useState<Model | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showInspections, setShowInspections] = useState(false);
  const [inspectionReport, setInspectionReport] = useState<InspectionReport | null>(null);
  const [inspectionsLoading, setInspectionsLoading] = useState(false);
  const [domainRules, setDomainRules] = useState<Array<{ id: string; domain: string; role: string; enabled: boolean }>>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newDomainRole, setNewDomainRole] = useState('viewer');
  const [dasContent, setDasContent] = useState<string>('');
  const [dasBaselineContent, setDasBaselineContent] = useState<string>('');
  const [dasLoading, setDasLoading] = useState(false);
  const [dasSaving, setDasSaving] = useState(false);
  const [dasViewMode, setDasViewMode] = useState<'edit' | 'preview'>('edit');
  const [dasActiveSection, setDasActiveSection] = useState(0);
  const [dasPreviewUrl, setDasPreviewUrl] = useState<string | null>(null);

  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [booting, setBooting] = useState(true);
  // Deep link presente na URL no primeiro carregamento. Enquanto ele não for
  // aplicado, o efeito de persistência não pode sobrescrever o hash com a
  // tela padrão (senão `#/catalog` ou `#/models/:id` seriam perdidos).
  const pendingHashRef = useRef<string | null>(
    typeof window !== 'undefined' && window.location.hash.length > 1
      ? window.location.hash
      : null
  );
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
  const [fileCreateType, setFileCreateType] = useState<'folder' | 'model'>('folder');
  const [creatingModel, setCreatingModel] = useState(false);
  const [createModelError, setCreateModelError] = useState<string | null>(null);
  const [newModelTitle, setNewModelTitle] = useState('');
  const [newModelDescription, setNewModelDescription] = useState('');
  const [newModelFolderId, setNewModelFolderId] = useState<string | null>(null);
  const [newModelC4Type, setNewModelC4Type] = useState<C4ModelType>('container');
  const [newModelC4Scope, setNewModelC4Scope] = useState('');
  const [newModelParentId, setNewModelParentId] = useState<string | null>(null);
  const [newModelParentFilter, setNewModelParentFilter] = useState('');
  const [linkToExisting, setLinkToExisting] = useState(false);
  const [openDrawioAfterCreate, setOpenDrawioAfterCreate] = useState(true);

  const [showImportModels, setShowImportModels] = useState(false);
  const [importSource, setImportSource] = useState<ImportSource>('files');
  const [importFolderId, setImportFolderId] = useState<string | null>(null);
  const [importType, setImportType] = useState<C4ModelType | 'auto'>('auto');
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importLinks, setImportLinks] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<ModelStatus>('draft');
  const [editFolderId, setEditFolderId] = useState<string | null>(null);
  const [editC4Type, setEditC4Type] = useState<C4ModelType>('container');
  const [editC4Scope, setEditC4Scope] = useState('');
  const [savingModel, setSavingModel] = useState(false);

  const [assetDraft, setAssetDraft] = useState<AssetDraft | null>(null);
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'app' | 'service'>('all');
  const [savingAsset, setSavingAsset] = useState(false);

  const [dependencyTarget, setDependencyTarget] = useState<DependencyTarget | null>(null);
  const [dependencies, setDependencies] = useState<AssetDependency[]>([]);
  const [dependenciesLoading, setDependenciesLoading] = useState(false);
  const [dependenciesError, setDependenciesError] = useState<string | null>(null);

  const [previewModel, setPreviewModel] = useState<Model | null>(null);
  const [previewDiagramType, setPreviewDiagramType] = useState<C4ModelType>('container');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Colaboração, comentários e interoperabilidade (Ondas 2/3).
  const [showComments, setShowComments] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showStructurizrImport, setShowStructurizrImport] = useState(false);
  const [structurizrTargetModelId, setStructurizrTargetModelId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [modelComments, setModelComments] = useState<ModelComment[]>([]);
  const [presenceUsers, setPresenceUsers] = useState<ws.PresenceUser[]>([]);
  const [autoLayoutBusy, setAutoLayoutBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [folderSearch, setFolderSearch] = useState('');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const toggleFolderView = (id: string) => {
    setExpandedFolderIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // Ordena as pastas em árvore (pai seguido dos filhos) para que a hierarquia
  // fique visível e estável após mover uma subpasta para a raiz.
  const folderTree = (() => {
    const byParent = new Map<string, Folder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? '';
      const siblings = byParent.get(key) ?? [];
      siblings.push(folder);
      byParent.set(key, siblings);
    }
    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => a.name.localeCompare(b.name));
    }
    const ordered: Folder[] = [];
    const seen = new Set<string>();
    const walk = (parentKey: string) => {
      for (const folder of byParent.get(parentKey) ?? []) {
        if (seen.has(folder.id)) continue;
        seen.add(folder.id);
        ordered.push(folder);
        walk(folder.id);
      }
    };
    walk('');
    // Pastas órfãs (pai removido/inexistente) aparecem no final como raiz.
    for (const folder of folders) {
      if (!seen.has(folder.id)) {
        seen.add(folder.id);
        ordered.push(folder);
      }
    }
    return ordered;
  })();

  const folderDepth = (folder: Folder): number => {
    let depth = 0;
    let current: Folder | undefined = folder;
    const visited = new Set<string>();
    while (current?.parentId) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      const parent = folders.find((f) => f.id === current!.parentId);
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    return depth;
  };

  const descendantIds = (rootId: string): Set<string> => {
    const result = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const folder of folders) {
        if (folder.parentId === current && !result.has(folder.id)) {
          result.add(folder.id);
          stack.push(folder.id);
        }
      }
    }
    return result;
  };

  const filteredFolders = (() => {
    const term = normalizeText(folderSearch);
    if (!term) return folderTree;
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const keep = new Set<string>();
    for (const folder of folders) {
      if (!normalizeText(folder.name).includes(term)) continue;
      // Mantém ancestrais e descendentes visíveis para preservar o contexto
      // da hierarquia ao filtrar por parte do nome.
      let current: Folder | undefined = folder;
      const guard = new Set<string>();
      while (current && !guard.has(current.id)) {
        guard.add(current.id);
        keep.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      for (const descendantId of descendantIds(folder.id)) {
        keep.add(descendantId);
      }
    }
    return folderTree.filter((folder) => keep.has(folder.id));
  })();

  // Pastas visiveis conforme a expansao (raiz e subpastas): um no aparece
  // apenas se todos os seus ancestrais estiverem expandidos (ou em busca).
  const visibleFolders = filteredFolders.filter((folder) => {
    if (folderSearch.trim() !== '') return true;
    let current: Folder | undefined = folder;
    while (current?.parentId) {
      const parent = folders.find((f) => f.id === current!.parentId);
      if (!parent) break;
      if (!expandedFolderIds.has(parent.id)) return false;
      current = parent;
    }
    return true;
  });

  // Resolve o nome da pasta. precisa existir antes de `filteredModels`.
  function folderName(id?: string | null): string {
    return folders.find((folder) => folder.id === id)?.name ?? 'Sem pasta';
  }

  // -------------------------------------------------------------------------
  // Bootstrap / sessão
  // -------------------------------------------------------------------------

  async function refreshModels() {
    const list = await listModels();
    setModels(list);
    return list;
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
      localStorage.setItem('c4arch_token', urlToken);
      urlParams.delete('token');
      const next = urlParams.toString();
      window.history.replaceState({}, '', window.location.pathname + (next ? '?' + next : ''));
    }

    let cancelled = false;

    (async () => {
      const token = localStorage.getItem('c4arch_token');
      if (!token) {
        ws.setToken(null);
        setBooting(false);
        return;
      }
      // Lê a tela salva ANTES de qualquer setState. O efeito de persistência
      // dispara assim que `loggedIn` vira true e, sem isso, sobrescreveria o
      // estado salvo com `list`/`null` antes da restauração.
      let savedView: {
        // Aceita os modos antigos 'apps'/'services' para migrar a visão salva
        // para a tela unificada de catálogo.
        mode?: Mode | 'list' | 'folders' | 'apps' | 'services';
        selectedId?: string | null;
        previewModelId?: string | null;
        previewDiagramType?: C4ModelType | null;
      } = {};
      try {
        savedView = JSON.parse(localStorage.getItem('c4arch_view') || '{}') ?? {};
      } catch {
        savedView = {};
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
        if (cancelled) return;
        setModels(list);
        // Restaura a tela/modelo aberto antes do F5.
        const previewTarget = savedView.previewModelId
          ? list.find((item) => item.id === savedView.previewModelId)
          : undefined;
        if (previewTarget) {
          await openPreview(
            previewTarget,
            (savedView.previewDiagramType ?? previewTarget.c4Type) as C4ModelType
          );
        } else if (
          savedView.selectedId &&
          list.some((item) => item.id === savedView.selectedId)
        ) {
          await openModel(savedView.selectedId);
        } else if (
          savedView.mode &&
          savedView.mode !== 'files' &&
          savedView.mode !== 'edit'
        ) {
          const restored = savedView.mode;
          setMode(
            restored === 'list' || restored === 'folders'
              ? 'files'
              : restored === 'apps' || restored === 'services'
                ? 'catalog'
                : restored
          );
        }
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

  // Mantém o catálogo atualizado ao abrir as telas, inclusive após um
  // backfill/importação feita em outra sessão.
  useEffect(() => {
    if (!loggedIn || !orgId) return;
    if (mode === 'catalog') {
      listApps(orgId).then(setApps).catch(() => undefined);
      listServices(orgId).then(setServices).catch(() => undefined);
    }
  }, [mode, loggedIn, orgId]);

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
    ws.join(selectedId, {
      viewKey: model?.c4Type ?? 'container',
      user: currentUser ? { name: currentUser.name || currentUser.email } : null,
    });
  }, [selectedId, model?.c4Type, currentUser]);

  useEffect(() => {
    ws.setOnPresence((id, _viewKey, users) => {
      if (id === selectedId) setPresenceUsers(users);
    });
    ws.setOnRealtimeError((message) => setError(message));
    return () => {
      ws.setOnPresence(null);
      ws.setOnRealtimeError(null);
    };
  }, [selectedId]);

  useEffect(() => {
    setSelectedElementId(null);
    setModelComments([]);
    setPresenceUsers([]);
  }, [selectedId]);

  // Persiste a tela/modelo atual para sobreviver ao F5. Só grava depois do
  // bootstrap terminar, para não apagar a tela salva durante a restauração.
  useEffect(() => {
    if (!loggedIn || booting) return;
    if (mode === 'edit' && !selectedId) return;
    // Não apaga um deep link antes de o efeito de rota aplicá-lo.
    if (pendingHashRef.current) return;
    try {
      localStorage.setItem(
        'c4arch_view',
        JSON.stringify({
          mode,
          selectedId,
          previewModelId: previewModel?.id ?? null,
          previewDiagramType: previewModel ? previewDiagramType : null,
        })
      );
    } catch {
      // ignora
    }
  }, [loggedIn, booting, mode, selectedId, previewModel, previewDiagramType]);

  // Deep link (`#/models/<id>`) e navegação por hash. A URL é atualizada com
  // `replaceState` para não poluir o histórico com cada troca de aba.
  useEffect(() => {
    if (!loggedIn || booting) return;
    const apply = () => {
      const hash = window.location.hash;
      pendingHashRef.current = null;
      if (!hash || hash === '#' || hash === '#/') return;
      const route = parseHashRoute(hash);
      if (route.modelId) {
        void openModel(route.modelId);
      } else {
        setMode(route.mode);
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
    // `openModel` e `setMode` são estáveis o suficiente para este efeito, que
    // só deve reagir ao login e a mudanças manuais de hash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn, booting]);

  useEffect(() => {
    if (!loggedIn) return;
    // O hash inicial é a fonte da rota até o efeito de deep link aplicá-lo.
    if (pendingHashRef.current) return;
    replaceHashRoute(mode, selectedId);
  }, [loggedIn, mode, selectedId]);

  // (limpeza feita em clearSession)

  // Se o próprio owner for rebaixado em outra sessão (ou por ele mesmo), a
  // tela de gestão deixa de ser acessível imediatamente na UI.
  useEffect(() => {
    if (loggedIn && mode === 'users' && currentRole !== 'owner') {
      setMode('files');
    }
  }, [loggedIn, mode, currentRole]);

  useEffect(() => {
    if (!loggedIn || mode !== 'domains' || !orgId) return;
    const token = localStorage.getItem('c4arch_token');
    fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/auth/domains?orgId=' + encodeURIComponent(orgId), {
      headers: { Authorization: 'Bearer ' + (token ?? '') },
    })
      .then((r) => r.json())
      .then((data) => setDomainRules(Array.isArray(data) ? data : []))
      .catch(() => setDomainRules([]));
  }, [loggedIn, mode, orgId]);

  function clearSession() {
    localStorage.removeItem('c4arch_token');
    localStorage.removeItem('c4arch_session');
    localStorage.removeItem('c4arch_view');
    ws.setToken(null);
    setLoggedIn(false);
    setOrgId('');
    setOrgName('');
    setCurrentUser(null);
    setCurrentRole(null);
    setModels([]);
    setSelectedId(null);
    setModel(null);
    setMode('files');
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
    setCreatingModel(false);
    setCreateModelError(null);
    setShowCreateModel(true);
  }

  async function onCreateModelFromModal() {
    setCreateModelError(null);

    const linkParentId = linkToExisting ? newModelParentId : null;
    if (linkToExisting && !linkParentId) {
      setCreateModelError('Selecione o modelo existente na lista.');
      return;
    }

    const title = newModelTitle.trim();
    if (!linkParentId && !title) {
      setCreateModelError('Informe o título do modelo.');
      return;
    }

    // Abre a aba antes do await para não ser bloqueada como popup.
    const popup = openDrawioAfterCreate ? window.open('about:blank', '_blank') : null;

    setCreatingModel(true);
    try {
      let targetId: string;

      if (linkParentId) {
        // Vincula o novo tipo de diagrama ao MESMO modelo, sem criar outro.
        const updated = await addModelDiagram(linkParentId, newModelC4Type);
        setModels((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
        targetId = updated.id;
      } else {
        const currentOrgId = await ensureOrgId();
        if (!currentOrgId) {
          popup?.close();
          setCreateModelError('Organização não encontrada. Faça login novamente.');
          return;
        }
        const created = await createModel({
          orgId: currentOrgId,
          folderId: newModelFolderId,
          title,
          description: newModelDescription.trim() || null,
          status: 'draft',
          c4Type: newModelC4Type,
          c4Scope: newModelC4Scope.trim() || null,
        });
        setModels((previous) => [created, ...previous]);
        targetId = created.id;
      }

      setShowCreateModel(false);
      setError(null);
      // O botão "Editor C4" foi ocultado; o fluxo abre apenas o draw.io.
      setMode('files');
      setSelectedId(null);
      setModel(null);

      const diagramType = linkParentId ? newModelC4Type : undefined;
      if (openDrawioAfterCreate) {
        const url = await getDrawioEditorUrl(targetId, diagramType);
        if (popup && !popup.closed) {
          popup.location.href = url;
        } else {
          await openDrawioEditor(targetId, diagramType);
        }
      } else {
        popup?.close();
      }
      await refreshModels();
    } catch (err) {
      popup?.close();
      const message = err instanceof Error ? err.message : String(err);
      setCreateModelError(message);
      setError(message);
    } finally {
      setCreatingModel(false);
    }
  }

  function openImportModels() {
    setImportSource('files');
    setImportFolderId(null);
    setImportType('auto');
    setImportFiles([]);
    setImportLinks('');
    setImportResults([]);
    setImportError(null);
    setImportProgress('');
    setShowImportModels(true);
  }

  function closeImportModels() {
    if (importing) return;
    setShowImportModels(false);
  }

  async function runImportModels() {
    setImportError(null);
    setImportResults([]);

    const items: {
      name: string;
      title?: string;
      xml?: string;
      url?: string;
      source: string;
    }[] = [];

    try {
      if (importSource === 'files' || importSource === 'folder') {
        const supportedFiles = importFiles.filter((file) => /\.(drawio|xml)$/i.test(file.name));
        if (supportedFiles.length === 0) {
          throw new Error('Selecione um ou mais arquivos .drawio/.xml.');
        }
        for (const file of supportedFiles) {
          const xml = await file.text();
          if (!xml.trimStart().startsWith('<')) {
            throw new Error(`${file.name}: o conteúdo não parece ser XML draw.io.`);
          }
          const relativePath =
            (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          items.push({
            name: file.name,
            title: stripFileExtension(file.name),
            xml,
            source: relativePath,
          });
        }
      } else {
        const links = importLinks
          .split(/[\r\n,;]+/)
          .map((link) => link.trim())
          .filter(Boolean);
        if (links.length === 0) {
          throw new Error(
            importSource === 'drive'
              ? 'Cole um ou mais links de arquivos do Google Drive.'
              : 'Cole uma ou mais URLs de arquivos draw.io.'
          );
        }
        for (const link of links) {
          if (!/^https?:\/\//i.test(link)) {
            throw new Error(`URL inválida: ${link}`);
          }
          items.push({ name: nameFromImportUrl(link), url: link, source: link });
        }
      }

      if (items.length > 100) {
        throw new Error('Importe no máximo 100 arquivos por vez.');
      }

      setImporting(true);
      const results: ImportResult[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setImportProgress(`Importando ${index + 1} de ${items.length}: ${item.name}`);
        try {
          const created = await importModel({
            orgId,
            folderId: importFolderId,
            title: item.title,
            name: item.name,
            description: `Importado de ${item.source}`,
            c4Type: importType === 'auto' ? undefined : importType,
            xml: item.xml,
            url: item.url,
            source: item.source,
          });
          setModels((previous) =>
            previous.some((model) => model.id === created.id) ? previous : [created, ...previous]
          );
          results.push({ name: item.name, ok: true });
        } catch (err) {
          results.push({
            name: item.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        setImportResults([...results]);
      }

      setImportProgress('');
      setImportFiles([]);
      setImportLinks('');
      try {
        setModels(await listModels());
      } catch {
        // mantém a lista otimista
      }
      // Os componentes do XML recém-importado podem ter entrado no catálogo.
      try {
        setApps(await listApps(orgId));
      } catch {
        // mantém a lista atual
      }
      try {
        setServices(await listServices(orgId));
      } catch {
        // mantém a lista atual
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setImportProgress('');
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

  function openDrawio(id: string, diagramType?: string) {
    // Abre a aba antes do await para não ser bloqueada como popup.
    const popup = window.open('about:blank', '_blank');
    getDrawioEditorUrl(id, diagramType)
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

  function modelDiagramTypes(m: Model): C4ModelType[] {
    const types = [m.c4Type, ...(m.diagrams ?? []).map((d) => d.c4Type)];
    return Array.from(new Set(types.filter(Boolean))) as C4ModelType[];
  }

  async function loadPreviewDiagram(target: Model, dt: C4ModelType) {
    setPreviewDiagramType(dt);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const detail = await getModel(target.id);
      setPreviewModel({ ...target, ...detail });
      const xml =
        dt === detail.c4Type
          ? detail.drawioXml
          : (detail.diagrams ?? []).find((d) => d.c4Type === dt)?.drawioXml;
      if (!xml || !xml.trim()) {
        setPreviewError('Este tipo de diagrama ainda não possui um desenho salvo no draw.io.');
        return;
      }
      setPreviewUrl(getDrawioPreviewUrl(xml));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function openPreview(target: Model, diagramType?: C4ModelType) {
    const dt = diagramType ?? target.c4Type ?? 'container';
    setPreviewModel(target);
    await loadPreviewDiagram(target, dt);
  }

  async function evolveDiagram(target: Model, nextType: C4ModelType) {
    try {
      const updated = await addModelDiagram(target.id, nextType);
      setModels((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
      setPreviewModel((previous) => (previous && previous.id === updated.id ? { ...previous, ...updated } : previous));
      await loadPreviewDiagram(updated, nextType);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        setMode('files');
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

  const searchTerm = normalizeText(search);
  const filteredModels = models.filter((item) => {
    const matchesSearch =
      !searchTerm ||
      normalizeText(item.title).includes(searchTerm) ||
      normalizeText(folderName(item.folderId)).includes(searchTerm);
    const matchesFolder = folderFilter === 'all' ? true : item.folderId === folderFilter;
    return matchesSearch && matchesFolder;
  });

  // Lista única de aplicações e serviços. O tipo é exibido como etiqueta e
  // usado nas ações de edição/exclusão/dependências.
  const catalogItems = [
    ...apps.map((item) => ({ kind: 'app' as const, item })),
    ...services.map((item) => ({ kind: 'service' as const, item })),
  ]
    .filter(({ kind }) => catalogFilter === 'all' || catalogFilter === kind)
    .sort((a, b) => a.item.name.localeCompare(b.item.name, 'pt-BR', { sensitivity: 'base' }));

  // Candidatos para vincular como modelo pai: busca por título, sem depender
  // de abrir o <select> nativo.
  const parentCandidates = models.filter((m) => {
    const term = newModelParentFilter.trim().toLowerCase();
    return !term || m.title.toLowerCase().includes(term);
  });

  const isWriter = currentRole === 'owner' || currentRole === 'editor';

  const activeViewKey = model?.c4Type ?? 'container';
  const commentedElementIds = useMemo(
    () =>
      [...new Set(modelComments.map((comment) => comment.elementId).filter((id): id is string => !!id))],
    [modelComments]
  );

  const dasParsed = useMemo(() => parseDasSections(dasContent), [dasContent]);
  const dasSectionItems = useMemo(
    () => [
      {
        key: 'preamble',
        label: 'Informações do documento',
        description: 'Título, versão, status e metadados iniciais do DAS.',
        body: dasParsed.preamble,
      },
      ...dasParsed.sections.map((section) => ({
        key: `section-${section.heading}`,
        label: section.heading,
        description: `Conteúdo da seção "${section.heading}".`,
        body: section.body,
      })),
    ],
    [dasParsed]
  );
  const dasEmptySections = dasSectionItems.filter((item) => !item.body.trim()).length;
  const dasActiveIndex = Math.min(dasActiveSection, Math.max(dasSectionItems.length - 1, 0));
  const dasDirty = dasContent !== dasBaselineContent;

  if (booting) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0f1115', color: '#7b8290' }}>
        Carregando sessão...
      </div>
    );
  }

  async function saveDas() {
    if (!dasModel || dasSaving) return;
    setDasSaving(true);
    try {
      await updateModelDAS(dasModel.id, dasContent);
      setDasBaselineContent(dasContent);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDasSaving(false);
    }
  }

  function closeDasEditor() {
    if (dasDirty && !window.confirm('Existem alterações não salvas no DAS. Deseja fechar mesmo assim?')) {
      return;
    }
    setDasModel(null);
  }

  async function regenerateDas() {
    if (!dasModel) return;
    if (dasDirty && !window.confirm('Existem alterações não salvas no DAS. Regenerar irá substituí-las pelo documento gerado. Deseja continuar?')) {
      return;
    }
    setDasLoading(true);
    try {
      const [content, detail] = await Promise.all([getModelDAS(dasModel.id), getModel(dasModel.id)]);
      setDasContent(content);
      setDasBaselineContent(content);
      setDasActiveSection(0);
      if (firstDiagramXml(detail)) setDasPreviewUrl(getDrawioPreviewUrl(firstDiagramXml(detail)!));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDasLoading(false);
    }
  }

  function updateDasSection(value: string) {
    if (dasActiveIndex === 0) {
      setDasContent(buildDasFromSections(value, dasParsed.sections));
      return;
    }
    const nextSections = dasParsed.sections.map((section, index) =>
      index === dasActiveIndex - 1 ? { ...section, body: value } : section
    );
    setDasContent(buildDasFromSections(dasParsed.preamble, nextSections));
  }

  async function handleAutoLayout() {
    if (!selectedId || autoLayoutBusy) return;
    setAutoLayoutBusy(true);
    try {
      const result = await autoLayoutViewModel(selectedId, activeViewKey, 'LR');
      // Mantém o Yjs coerente com o layout gravado no Postgres, para que o
      // próximo update em tempo real não devolva as posições antigas.
      for (const position of result.positions) {
        ws.sendOp({
          type: 'patch',
          modelId: selectedId,
          patch: {
            op: 'updateElement',
            data: { id: position.id, positionX: position.x, positionY: position.y },
          },
        });
      }
      const detail = await getModel(selectedId);
      setModel(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoLayoutBusy(false);
    }
  }

  async function handleStructurizrImported(importedModelId: string) {
    setShowStructurizrImport(false);
    try {
      const [detail, list] = await Promise.all([getModel(importedModelId), listModels()]);
      setModels(list);
      setModel(detail);
      setSelectedId(importedModelId);
      setMode('edit');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f1115', color: '#e8eaed' }}>
      <AppHeader
        loggedIn={loggedIn}
        role={currentRole}
        email={currentUser?.email}
        onLogout={clearSession}
      />

      {!loggedIn ? (
        <LoginScreen
          email={email}
          password={password}
          error={error}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onSubmit={loginUser}
        />
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <nav style={{ width: 180, padding: '12px 8px', borderRight: '1px solid #2a2f3a', display: 'flex', flexDirection: 'column', gap: '6px', background: '#111318' }}>
            <button onClick={() => setMode('files')} style={{ ...buttonStyle, background: mode === 'files' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Arquivos</button>
            <button onClick={() => setMode('catalog')} style={{ ...buttonStyle, background: mode === 'catalog' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Catálogo</button>
            {currentRole === 'owner' && (
              <button onClick={() => setMode('users')} style={{ ...buttonStyle, background: mode === 'users' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Usuários</button>
            )}
            {currentRole === 'owner' && (
              <button onClick={() => setMode('groups')} style={{ ...buttonStyle, background: mode === 'groups' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Perfis/Grupos</button>
            )}
            {currentRole === 'owner' && (
              <button onClick={() => setMode('domains')} style={{ ...buttonStyle, background: mode === 'domains' ? '#2a2f3a' : 'transparent', border: '1px solid #2a2f3a', width: '100%' }}>Domínios SSO</button>
            )}
          </nav>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>

          {error && mode !== 'edit' && (
            <div style={{ padding: '8px 16px', color: '#f87171', borderBottom: '1px solid #2a2f3a' }}>
              {error}
              <button onClick={() => setError(null)} style={{ ...buttonStyle, marginLeft: 8, color: '#93c5fd', background: 'transparent' }}>OK</button>
            </div>
          )}

          {mode === 'domains' && currentRole === 'owner' && (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
              <h3 style={{ margin: 0 }}>Domínios SSO (Google)</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="dominio.com" style={{ ...inputStyle, flex: 1 }} />
                <select value={newDomainRole} onChange={(e) => setNewDomainRole(e.target.value)} style={inputStyle}>
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                  <option value="owner">owner</option>
                </select>
                <button type="button" style={primaryButtonStyle} onClick={async () => {
                  if (!newDomain.trim() || !orgId) return;
                  const token = localStorage.getItem('c4arch_token');
                  await fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/auth/domains', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token ?? '') },
                    body: JSON.stringify({ orgId, domain: newDomain.trim(), role: newDomainRole }),
                  });
                  setNewDomain('');
                  const r = await fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/auth/domains?orgId=' + encodeURIComponent(orgId), { headers: { Authorization: 'Bearer ' + (token ?? '') } });
                  setDomainRules(await r.json());
                }}>Adicionar</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {domainRules.map((rule) => (
                  <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, border: '1px solid #2a2f3a', borderRadius: 6 }}>
                    <span>{rule.domain} - {rule.role}</span>
                    <button type="button" style={buttonStyle} onClick={async () => {
                      const token = localStorage.getItem('c4arch_token');
                      await fetch((import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/auth/domains/' + rule.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + (token ?? '') } });
                      setDomainRules(domainRules.filter((r) => r.id !== rule.id));
                    }}>Remover</button>
                  </div>
                ))}
                {domainRules.length === 0 && <span style={smallMuted}>Nenhum domínio configurado.</span>}
              </div>
            </div>
          )}

          {mode === 'files' && (
            <>
              <div style={{ padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {isWriter && (
                  <select
                    value={fileCreateType}
                    onChange={(e) => setFileCreateType(e.target.value as 'folder' | 'model')}
                    style={inputStyle}
                    title="Tipo de item a criar"
                  >
                    <option value="folder">Pasta</option>
                    <option value="model">Modelo</option>
                  </select>
                )}
                {isWriter && fileCreateType === 'model' && (
                  <button onClick={openCreateModel} style={primaryButtonStyle}>+ Novo modelo</button>
                )}
                {isWriter && (
                  <button onClick={openImportModels} style={buttonStyle} title="Importar modelos de arquivos, Google Drive ou URL">
                    Importar
                  </button>
                )}
                {isWriter && (
                  <button
                    onClick={() => {
                      setStructurizrTargetModelId(null);
                      setShowStructurizrImport(true);
                    }}
                    style={buttonStyle}
                    title="Criar um modelo a partir de um workspace Structurizr (JSON ou DSL)"
                  >
                    Structurizr
                  </button>
                )}
              </div>

              {showCreateModel && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
                  <form
                    onSubmit={(e) => { e.preventDefault(); onCreateModelFromModal(); }}
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
                    <h3 style={{ margin: 0 }}>{linkToExisting ? 'Novo tipo de diagrama' : 'Novo modelo'}</h3>
                    <input
                      type="text"
                      placeholder={linkToExisting ? 'Título (usa o do modelo existente)' : 'Título do modelo'}
                      value={newModelTitle}
                      onChange={(e) => setNewModelTitle(e.target.value)}
                      disabled={linkToExisting}
                      style={{ ...inputStyle, width: '100%', opacity: linkToExisting ? 0.6 : 1 }}
                      autoFocus={!linkToExisting}
                    />
                    <textarea
                      placeholder="Descrição (opcional)"
                      value={newModelDescription}
                      onChange={(e) => setNewModelDescription(e.target.value)}
                      rows={3}
                      disabled={linkToExisting}
                      style={{ ...inputStyle, width: '100%', resize: 'vertical', opacity: linkToExisting ? 0.6 : 1 }}
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
                      disabled={linkToExisting}
                      style={{ ...inputStyle, width: '100%', opacity: linkToExisting ? 0.6 : 1 }}
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
                                  // Herda a pasta do modelo original.
                                  setNewModelFolderId(m.folderId ?? null);
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
                            Selecionado: {models.find((m) => m.id === newModelParentId)?.title ?? 'modelo'}
                            {' · pasta: '}
                            {folderName(models.find((m) => m.id === newModelParentId)?.folderId)}.
                            Não é permitido repetir o mesmo tipo de diagrama.
                          </span>
                        ) : (
                          <span style={smallMuted}>Digite o nome para filtrar e clique em um modelo da lista.</span>
                        )}
                      </div>
                    )}
                    {!linkToExisting && (
                      <>
                        <span style={smallMuted}>Pasta</span>
                        <select
                          value={newModelFolderId ?? ''}
                          onChange={(e) => setNewModelFolderId(e.target.value ? e.target.value : null)}
                          style={{ ...inputStyle, width: '100%' }}
                        >
                          <option value="">Sem pasta</option>
                          {folderTree.map((folder) => <option key={folder.id} value={folder.id}>{'\u00a0'.repeat(folderDepth(folder) * 2)}{folder.name}</option>)}
                        </select>
                      </>
                    )}
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={openDrawioAfterCreate}
                        onChange={(e) => setOpenDrawioAfterCreate(e.target.checked)}
                      />
                      Abrir draw.io após criar
                    </label>
                    {createModelError && (
                      <div style={{ color: '#f87171', fontSize: 13 }}>{createModelError}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" onClick={() => setShowCreateModel(false)} style={buttonStyle}>Cancelar</button>
                      <button
                        type="submit"
                        style={{ ...primaryButtonStyle, opacity: creatingModel ? 0.7 : 1 }}
                        disabled={creatingModel}
                      >
                        {creatingModel ? 'Salvando...' : linkToExisting ? 'Adicionar tipo' : 'Criar'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

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

          {mode === 'files' && (
            <div style={{ padding: '16px' }}>
              <h2 style={{ marginTop: 0 }}>Pastas</h2>
              <input
                type="text"
                placeholder="Filtrar pasta por nome..."
                value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)}
                style={{ ...inputStyle, width: '100%', maxWidth: 320, marginBottom: 12 }}
              />
              {isWriter && fileCreateType === 'folder' && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input id="folder-name" placeholder="Nome da pasta" style={inputStyle} />
                  <select id="folder-parent" style={inputStyle}>
                    <option value="">Pasta raiz</option>
                    {folderTree.map((f) => (
                      <option key={f.id} value={f.id}>{'\u00a0'.repeat(folderDepth(f) * 2)}{f.name}</option>
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
                {visibleFolders.map((folder) => {
                  const linkedModels = models.filter((item) => item.folderId === folder.id);
                  const expanded =
                    folderSearch.trim() !== ''
                      ? true
                      : expandedFolderIds.has(folder.id);
                  const hasChildren = linkedModels.length > 0 || folders.some((item) => item.parentId === folder.id);
                  return (
                    <div key={folder.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, marginLeft: folderDepth(folder) * 24, borderLeft: folderDepth(folder) > 0 ? '2px solid #3b82f6' : '1px solid #2a2f3a' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div
                          onClick={() => toggleFolderView(folder.id)}
                          style={{ cursor: 'pointer', flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 8 }}
                          title="Clique para expandir/recolher o conteudo da pasta"
                        >
                          <span style={{ color: '#94a3b8', fontFamily: 'monospace', width: 12, textAlign: 'center' }}>
                            {hasChildren ? (expanded ? '\u25BE' : '\u25B8') : '\u2022'}
                          </span>
                          <span style={{ fontSize: 18 }} aria-hidden="true">{expanded ? '\u{1F4C2}' : '\u{1F4C1}'}</span>
                          <span style={{ fontWeight: 600 }}>{folder.name}</span>
                          <span style={{ fontSize: 11, color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 999, padding: '1px 6px' }}>
                            {linkedModels.length} {linkedModels.length === 1 ? 'modelo' : 'modelos'}
                          </span>
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
                            if (!name || !name.trim()) return;
                            try {
                              const updated = await updateFolder(folder.id, { name: name.trim() });
                              setFolders((previous) =>
                                previous.map((item) => (item.id === updated.id ? updated : item))
                              );
                              setFolders(await listFolders(orgId));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          style={buttonStyle}
                        >
                          {'\u270F\uFE0F'} Renomear
                        </button>
                        <select
                          value={folder.parentId ?? ''}
                          onChange={async (e) => {
                            const newParent = e.target.value || null;
                            if (newParent === (folder.parentId ?? null)) return;
                            try {
                              const updated = await updateFolder(folder.id, { parentId: newParent });
                              // Atualiza imediatamente para a hierarquia refletir
                              // o novo pai, e depois confirma com o servidor.
                              setFolders((previous) =>
                                previous.map((item) => (item.id === updated.id ? updated : item))
                              );
                              setFolders(await listFolders(orgId));
                              setError(null);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          style={inputStyle}
                          title="Mover para pasta pai"
                        >
                          <option value="">Pasta raiz</option>
                          {folderTree
                            .filter(
                              (f) =>
                                f.id !== folder.id && !descendantIds(folder.id).has(f.id)
                            )
                            .map((f) => (
                              <option key={f.id} value={f.id}>{'\u00a0'.repeat(folderDepth(f) * 2)}{f.name}</option>
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
                          {'\u{1F5D1}\uFE0F'} Excluir
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
                                <div style={{ fontWeight: 600 }}>{'\u{1F4C4}'} {item.title}</div>
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
                                                       {isWriter && (
                         <button
                           onClick={() => openEditModel(item)}
                           style={buttonStyle}
                         >
                           Editar
                         </button>
                       )}
                       {isWriter && (
                         <button
                           onClick={() => onDeleteModel(item)}
                           style={dangerButtonStyle}
                         >
                           Excluir
                         </button>
                       )}
<button
                                  onClick={() => {
                                    setDasModel(item);
                                    setDasContent('');
                                    setDasBaselineContent('');
                                    setDasPreviewUrl(null);
                                    setDasViewMode('edit');
                                    setDasActiveSection(0);
                                    setDasLoading(true);
                                    Promise.all([getModelDAS(item.id), getModel(item.id)])
                                      .then(([content, detail]) => {
                                        setDasContent(content);
                                        setDasBaselineContent(content);
                                        if (firstDiagramXml(detail)) setDasPreviewUrl(getDrawioPreviewUrl(firstDiagramXml(detail)!));
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
              {models.filter((m) => !m.folderId && (folderSearch.trim() === '' || normalizeText(m.title).includes(normalizeText(folderSearch)))).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ margin: '0 0 8px' }}>Modelos sem pasta</h3>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {models
                      .filter((m) => !m.folderId && (folderSearch.trim() === '' || normalizeText(m.title).includes(normalizeText(folderSearch))))
                      .map((item) => (
                        <div
                          key={item.id}
                          style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
                        >
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {item.title}{' '}
                              <span style={{ fontSize: 11, color: '#93c5fd', border: '1px solid #1d4ed8', borderRadius: 999, padding: '1px 6px' }}>
                                {statusLabel[item.status]}
                              </span>
                            </div>
                            <div style={smallMuted}>
                              {C4_TYPE_LABEL[item.c4Type] ?? item.c4Type}
                              {item.c4Scope ? ' · ' + item.c4Scope : ''}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button onClick={() => openPreview(item)} style={buttonStyle}>
                              Visualizar
                            </button>
                            {isWriter && (
                              <button onClick={() => openDrawio(item.id)} style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}>
                                draw.io
                              </button>
                            )}
                            {isWriter && (
                              <button onClick={() => openEditModel(item)} style={buttonStyle}>
                                Editar
                              </button>
                            )}
                            {isWriter && (
                              <button onClick={() => onDeleteModel(item)} style={dangerButtonStyle}>
                                Excluir
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
                {folders.length === 0 && <div style={{ color: '#7b8290' }}>Nenhuma pasta.</div>}
              </div>
            </div>
          )}

          {mode === 'catalog' && (
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>Catálogo</h2>
                {isWriter && (
                  <button
                    onClick={() => openCreateAsset(catalogFilter === 'service' ? 'service' : 'app')}
                    style={primaryButtonStyle}
                  >
                    + Novo item
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
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                  {[
                    ['all', 'Todos'],
                    ['app', 'Aplicações'],
                    ['service', 'Serviços'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCatalogFilter(value as 'all' | 'app' | 'service')}
                      style={{
                        ...buttonStyle,
                        background: catalogFilter === value ? '#2a2f3a' : 'transparent',
                        border: '1px solid #2a2f3a',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p style={smallMuted}>
                Aplicações e serviços são containers C4 reutilizáveis. O tipo é escolhido no
                momento da criação e as alterações são propagadas para todos os modelos que usam o item.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {catalogItems.map(({ kind, item }) => (
                  <div key={kind + ':' + item.id} style={{ background: '#1a1d27', border: '1px solid #2a2f3a', borderRadius: 8, padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            background: kind === 'app' ? '#1d4ed8' : '#065f46',
                            color: '#fff',
                            borderRadius: 999,
                            padding: '1px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {kind === 'app' ? 'Aplicação' : 'Serviço'}
                        </span>
                        <span style={{ fontWeight: 600 }}>{item.name}</span>
                      </div>
                      <div style={smallMuted}>
                        {kind === 'service'
                          ? `${(item as ServiceObject).protocol}${(item as ServiceObject).port ? ':' + (item as ServiceObject).port : ''} — ${item.description || 'Sem descrição'}`
                          : item.description || 'Sem descrição'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={() => openDependencies(kind, item)} style={buttonStyle}>
                        Modelos dependentes
                      </button>
                      {isWriter && (
                        <>
                          <button onClick={() => openEditAsset(kind, item)} style={buttonStyle}>
                            Editar
                          </button>
                          <button
                            onClick={async () => {
                              const label = kind === 'app' ? 'a aplicação' : 'o serviço';
                              if (!window.confirm('Excluir ' + label + ' "' + item.name + '"?')) return;
                              try {
                                if (kind === 'app') {
                                  await deleteApp(item.id);
                                  setApps(await listApps(orgId));
                                } else {
                                  await deleteService(item.id);
                                  setServices(await listServices(orgId));
                                }
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
                {catalogItems.length === 0 && (
                  <div style={{ color: '#7b8290' }}>
                    {catalogFilter === 'app'
                      ? 'Nenhuma aplicação.'
                      : catalogFilter === 'service'
                        ? 'Nenhum serviço.'
                        : 'Nenhum item no catálogo.'}
                  </div>
                )}
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
              onSelectElement={setSelectedElementId}
              commentedElementIds={commentedElementIds}
            />
            <footer style={{ padding: '8px 12px', borderTop: '1px solid #2a2f3a', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', background: '#0f1115' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
                <button onClick={() => { setMode('files'); setSelectedId(null); setModel(null); }} style={buttonStyle}>Voltar</button>
                <PresenceBar users={presenceUsers} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {!isWriter && <span style={{ ...smallMuted, alignSelf: 'center' }}>Somente leitura</span>}
                {isWriter && (
                  <>
                    <button onClick={() => ws.undo()} style={buttonStyle} title="Desfazer (última alteração)">
                      Desfazer
                    </button>
                    <button onClick={() => ws.redo()} style={buttonStyle} title="Refazer">
                      Refazer
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowComments(true)}
                  style={{
                    ...buttonStyle,
                    borderColor: modelComments.some((comment) => !comment.resolved) ? '#fbbf24' : '#374151',
                  }}
                >
                  Comentários ({modelComments.filter((comment) => !comment.resolved).length})
                </button>
                <button onClick={() => setShowExport(true)} style={buttonStyle}>
                  Exportar
                </button>
                {isWriter && (
                  <>
                    <button onClick={() => void handleAutoLayout()} disabled={autoLayoutBusy} style={buttonStyle}>
                      {autoLayoutBusy ? 'Organizando...' : 'Auto layout'}
                    </button>
                    <button
                      onClick={() => {
                        setStructurizrTargetModelId(selectedId);
                        setShowStructurizrImport(true);
                      }}
                      style={buttonStyle}
                    >
                      Importar Structurizr
                    </button>
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
                    <button
                      onClick={async () => {
                        if (!selectedId) return;
                        setShowVersions(true);
                        setVersionsLoading(true);
                        try {
                          const res = await listModelVersions(selectedId);
                          setVersions(res.versions);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setVersionsLoading(false);
                        }
                      }}
                      style={buttonStyle}
                    >
                      Versões
                    </button>
                    <button
                      onClick={async () => {
                        if (!selectedId) return;
                        setShowInspections(true);
                        setInspectionsLoading(true);
                        try {
                          const report = await inspectModel(selectedId);
                          setInspectionReport(report);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        } finally {
                          setInspectionsLoading(false);
                        }
                      }}
                      style={buttonStyle}
                    >
                      Inspeções
                    </button>
                    <button onClick={onDelete} style={dangerButtonStyle}>Excluir</button>
                  </>
                )}
              </div>
            </footer>
          </div>
        </ReactFlowProvider>
      )}

      {showVersions && (
        <VersionsPanel
          versions={versions}
          loading={versionsLoading}
          canRestore={isWriter}
          onClose={() => setShowVersions(false)}
          onRestore={(version) => {
            if (!selectedId) return;
            if (!window.confirm('Restaurar esta versão? O estado atual será substituído.')) return;
            void (async () => {
              try {
                await restoreModelVersion(selectedId, version.id);
                const detail = await getModel(selectedId);
                setModel(detail);
                setShowVersions(false);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            })();
          }}
        />
      )}

      {showInspections && (
        <InspectionsPanel
          report={inspectionReport}
          loading={inspectionsLoading}
          onClose={() => setShowInspections(false)}
        />
      )}

      {showExport && selectedId && model && (
        <ExportPanel
          modelId={selectedId}
          modelTitle={model.title}
          onClose={() => setShowExport(false)}
        />
      )}

      {showComments && selectedId && (
        <CommentsPanel
          modelId={selectedId}
          selectedElementId={selectedElementId}
          elements={(model?.elements ?? []).map((element) => ({ id: element.id, title: element.title }))}
          isWriter={isWriter}
          onClose={() => setShowComments(false)}
          onCommentsChange={setModelComments}
        />
      )}

      {showStructurizrImport && (
        <StructurizrImportPanel
          modelId={structurizrTargetModelId}
          orgId={orgId}
          c4Types={[...C4_MODEL_TYPES]}
          onClose={() => setShowStructurizrImport(false)}
          onImported={(result) => void handleStructurizrImported(result.modelId)}
        />
      )}

      {showImportModels && (
        <ImportModelsPanel
          source={importSource}
          files={importFiles}
          links={importLinks}
          folderId={importFolderId}
          type={importType}
          folderOptions={folderTree.map((folder) => ({
            id: folder.id,
            name: folder.name,
            depth: folderDepth(folder),
          }))}
          importing={importing}
          progress={importProgress}
          results={importResults}
          error={importError}
          onSourceChange={(next) => {
            setImportSource(next);
            setImportFiles([]);
            setImportLinks('');
            setImportResults([]);
            setImportError(null);
          }}
          onFilesChange={(next) => {
            setImportFiles(next);
            setImportResults([]);
            setImportError(null);
          }}
          onLinksChange={(next) => {
            setImportLinks(next);
            setImportResults([]);
            setImportError(null);
          }}
          onFolderChange={setImportFolderId}
          onTypeChange={setImportType}
          onClose={closeImportModels}
          onSubmit={() => void runImportModels()}
        />
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
                  {C4_TYPE_LABEL[previewDiagramType] ?? previewDiagramType}
                  {previewModel.c4Scope ? ` · ${previewModel.c4Scope}` : ''}
                  {' · '}Preview draw.io (somente leitura)
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                {isWriter && (
                  <button onClick={() => openDrawio(previewModel.id, previewDiagramType)} style={primaryButtonStyle}>Abrir editor draw.io</button>
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
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #2a2f3a', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {modelDiagramTypes(previewModel).map((type) => (
                <button
                  key={type}
                  onClick={() => loadPreviewDiagram(previewModel, type)}
                  style={{
                    ...buttonStyle,
                    background: previewDiagramType === type ? '#4f46e5' : 'transparent',
                    color: previewDiagramType === type ? '#fff' : '#e8eaed',
                    border: '1px solid #2a2f3a',
                  }}
                >
                  {C4_TYPE_LABEL[type] ?? type}
                </button>
              ))}
              {isWriter && (
                <>
                  {!modelDiagramTypes(previewModel).includes('container') && modelDiagramTypes(previewModel).includes('system-context') && (
                    <button onClick={() => evolveDiagram(previewModel, 'container')} style={{ ...primaryButtonStyle, background: '#7c3aed' }}>
                      Evoluir para Container
                    </button>
                  )}
                  {!modelDiagramTypes(previewModel).includes('component') && modelDiagramTypes(previewModel).includes('container') && (
                    <button onClick={() => evolveDiagram(previewModel, 'component')} style={{ ...primaryButtonStyle, background: '#7c3aed' }}>
                      Evoluir para Componente
                    </button>
                  )}
                  {!modelDiagramTypes(previewModel).includes('code') && modelDiagramTypes(previewModel).includes('component') && (
                    <button onClick={() => evolveDiagram(previewModel, 'code')} style={{ ...primaryButtonStyle, background: '#7c3aed' }}>
                      Evoluir para Código
                    </button>
                  )}
                </>
              )}
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
                      <button onClick={() => openDrawio(previewModel.id, previewDiagramType)} style={primaryButtonStyle}>Criar/editar no draw.io</button>
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
        <DasEditor
          modelTitle={dasModel.title}
          content={dasContent}
          viewMode={dasViewMode}
          loading={dasLoading}
          saving={dasSaving}
          dirty={dasDirty}
          sections={dasSectionItems}
          emptySections={dasEmptySections}
          activeIndex={dasActiveIndex}
          previewUrl={dasPreviewUrl}
          onClose={closeDasEditor}
          onSave={() => void saveDas()}
          onRegenerate={() => void regenerateDas()}
          onDiscard={() => setDasContent(dasBaselineContent)}
          onSelectSection={setDasActiveSection}
          onEditSection={updateDasSection}
          onViewModeChange={setDasViewMode}
        />
      )}

      {assetDraft && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1050 }}>
          <form onSubmit={saveAsset} style={{ background: '#1a1d27', padding: 20, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12, width: 440 }}>
            <h3 style={{ margin: 0 }}>
              {assetDraft.id
                ? assetDraft.kind === 'app' ? 'Editar aplicação' : 'Editar serviço'
                : 'Novo item do catálogo'}
            </h3>
            {!assetDraft.id && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9ca3af' }}>
                Tipo
                <select
                  value={assetDraft.kind}
                  onChange={(e) => setAssetDraft({ ...assetDraft, kind: e.target.value as 'app' | 'service' })}
                  style={{ ...inputStyle, width: '100%' }}
                >
                  <option value="app">Aplicação</option>
                  <option value="service">Serviço</option>
                </select>
              </label>
            )}
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
              {folderTree.map((folder) => <option key={folder.id} value={folder.id}>{'\u00a0'.repeat(folderDepth(folder) * 2)}{folder.name}</option>)}
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
