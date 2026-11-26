import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  createExternalSystem,
  createModelIntegration,
  deleteExternalSystem,
  deleteModelIntegration,
  listExternalSystems,
  listModelIntegrations,
  syncModelIntegration,
  updateExternalSystem,
  updateModelIntegration,
} from '../services/api';
import type {
  ExternalSystem,
  IntegrationAuthType,
  IntegrationFormat,
  IntegrationMethod,
  IntegrationSyncResult,
  Model,
  ModelExternalBinding,
} from '../services/types';

interface IntegrationsPageProps {
  orgId: string;
  models: Model[];
  currentRole: string | null;
}

const inputStyle: CSSProperties = {
  padding: '8px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#1a1d27',
  color: '#e8eaed',
  fontSize: 13,
};

const primaryButtonStyle: CSSProperties = {
  padding: '8px 12px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

const buttonStyle: CSSProperties = {
  padding: '6px 10px',
  background: '#2a2f3a',
  color: '#e8eaed',
  border: '1px solid #2a2f3a',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
};

const cardStyle: CSSProperties = {
  border: '1px solid #2a2f3a',
  borderRadius: 8,
  padding: 12,
  background: '#141821',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const muted = { color: '#8b93a3', fontSize: 12 } as const;

const AUTH_LABEL: Record<IntegrationAuthType, string> = {
  none: 'Sem autenticação',
  bearer: 'Bearer token',
  basic: 'Basic (usuário + token)',
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Falha na operação';
}

export function IntegrationsPage({ orgId, models, currentRole }: IntegrationsPageProps) {
  const isWriter = currentRole === 'owner' || currentRole === 'editor';
  const isOwner = currentRole === 'owner';

  const [systems, setSystems] = useState<ExternalSystem[]>([]);
  const [loadingSystems, setLoadingSystems] = useState(false);
  const [systemsError, setSystemsError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<IntegrationAuthType>('none');
  const [authUser, setAuthUser] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [headersText, setHeadersText] = useState('{}');
  const [enabled, setEnabled] = useState(true);
  const [savingSystem, setSavingSystem] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);

  const [selectedModelId, setSelectedModelId] = useState('');
  const [bindings, setBindings] = useState<ModelExternalBinding[]>([]);
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [bindingsError, setBindingsError] = useState<string | null>(null);

  const [newSystemId, setNewSystemId] = useState('');
  const [newDrawioUrl, setNewDrawioUrl] = useState('');
  const [newDasUrl, setNewDasUrl] = useState('');
  const [newMethod, setNewMethod] = useState<IntegrationMethod>('PUT');
  const [newFormat, setNewFormat] = useState<IntegrationFormat>('json');
  const [savingBinding, setSavingBinding] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<IntegrationSyncResult[] | null>(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  const availableSystems = useMemo(
    () =>
      systems.filter(
        (system) => !bindings.some((binding) => binding.externalSystemId === system.id)
      ),
    [systems, bindings]
  );

  const loadSystems = async () => {
    if (!orgId) return;
    setLoadingSystems(true);
    setSystemsError(null);
    try {
      setSystems(await listExternalSystems(orgId));
    } catch (err) {
      setSystemsError(errorMessage(err));
    } finally {
      setLoadingSystems(false);
    }
  };

  const loadBindings = async (modelId: string) => {
    if (!modelId) {
      setBindings([]);
      return;
    }
    setLoadingBindings(true);
    setBindingsError(null);
    try {
      setBindings(await listModelIntegrations(modelId));
    } catch (err) {
      setBindingsError(errorMessage(err));
      setBindings([]);
    } finally {
      setLoadingBindings(false);
    }
  };

  useEffect(() => {
    void loadSystems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (!selectedModelId && models.length > 0) {
      setSelectedModelId(models[0].id);
    }
  }, [models, selectedModelId]);

  useEffect(() => {
    void loadBindings(selectedModelId);
    setSyncReport(null);
  }, [selectedModelId]);

  useEffect(() => {
    if (availableSystems.length > 0 && !availableSystems.some((s) => s.id === newSystemId)) {
      setNewSystemId(availableSystems[0].id);
    }
  }, [availableSystems, newSystemId]);

  const resetSystemForm = () => {
    setEditingId(null);
    setName('');
    setBaseUrl('');
    setAuthType('none');
    setAuthUser('');
    setAuthToken('');
    setHeadersText('{}');
    setEnabled(true);
    setSystemError(null);
  };

  const startEditSystem = (system: ExternalSystem) => {
    setEditingId(system.id);
    setName(system.name);
    setBaseUrl(system.baseUrl ?? '');
    setAuthType(system.authType);
    setAuthUser(system.authUser ?? '');
    setAuthToken('');
    setHeadersText(JSON.stringify(system.headers ?? {}, null, 2));
    setEnabled(system.enabled);
    setSystemError(null);
  };

  const parseHeaders = (): Record<string, string> | null => {
    const trimmed = headersText.trim();
    if (!trimmed) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('headers deve ser um JSON válido');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers deve ser um objeto de strings');
    }
    return parsed as Record<string, string>;
  };

  const saveSystem = async () => {
    setSystemError(null);
    if (!name.trim()) {
      setSystemError('Informe o nome do sistema externo');
      return;
    }
    let headers: Record<string, string> | null;
    try {
      headers = parseHeaders();
    } catch (err) {
      setSystemError(errorMessage(err));
      return;
    }

    setSavingSystem(true);
    try {
      const payload = {
        orgId,
        name: name.trim(),
        baseUrl: baseUrl.trim() || null,
        authType,
        authUser: authUser.trim() || null,
        authToken: authToken ? authToken : undefined,
        headers: headers ?? {},
        enabled,
      };
      if (editingId) {
        await updateExternalSystem(editingId, payload);
      } else {
        await createExternalSystem(payload);
      }
      resetSystemForm();
      await loadSystems();
    } catch (err) {
      setSystemError(errorMessage(err));
    } finally {
      setSavingSystem(false);
    }
  };

  const removeSystem = async (system: ExternalSystem) => {
    if (!window.confirm(`Remover o sistema "${system.name}" e todos os vínculos?`)) return;
    setSystemsError(null);
    try {
      await deleteExternalSystem(system.id);
      if (editingId === system.id) resetSystemForm();
      await loadSystems();
      await loadBindings(selectedModelId);
    } catch (err) {
      setSystemsError(errorMessage(err));
    }
  };

  const addBinding = async () => {
    if (!selectedModelId || !newSystemId) return;
    setBindingError(null);
    setSyncReport(null);
    setSavingBinding(true);
    try {
      await createModelIntegration(selectedModelId, {
        externalSystemId: newSystemId,
        drawioUrl: newDrawioUrl.trim() || null,
        dasUrl: newDasUrl.trim() || null,
        method: newMethod,
        format: newFormat,
        enabled: true,
      });
      setNewDrawioUrl('');
      setNewDasUrl('');
      await loadBindings(selectedModelId);
      await loadSystems();
    } catch (err) {
      setBindingError(errorMessage(err));
    } finally {
      setSavingBinding(false);
    }
  };

  const syncBinding = async (binding: ModelExternalBinding) => {
    setBindingError(null);
    setSyncReport(null);
    try {
      const result = await syncModelIntegration(binding.modelId, binding.id);
      setSyncReport(result.results);
      await loadBindings(selectedModelId);
    } catch (err) {
      setBindingError(errorMessage(err));
    }
  };

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>
      <div>
        <h2 style={{ margin: 0 }}>Integrações</h2>
        <p style={{ ...muted, marginTop: 6, maxWidth: 760 }}>
          Configure as APIs de outros sistemas e vincule, por modelo, a URL que recebe o desenho
          draw.io e a URL que recebe o DAS. Ao salvar o modelo, inserir/editar componentes ou
          atualizar o DAS, o C4Arch envia as alterações automaticamente para essas URLs.
        </p>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Sistemas externos</h3>
        {systemsError && <div style={{ color: '#f87171', fontSize: 13 }}>{systemsError}</div>}
        {loadingSystems ? (
          <span style={muted}>Carregando sistemas...</span>
        ) : systems.length === 0 ? (
          <span style={muted}>Nenhum sistema externo configurado.</span>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {systems.map((system) => (
              <div key={system.id} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{system.name}</strong>
                  <span style={{ ...muted, color: system.enabled ? '#34d399' : '#f87171' }}>
                    {system.enabled ? 'ativo' : 'inativo'}
                  </span>
                </div>
                <span style={muted}>{system.baseUrl || 'Sem URL base'}</span>
                <span style={muted}>
                  {AUTH_LABEL[system.authType]} · {system.bindingCount} vínculo(s)
                </span>
                {isWriter && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" style={buttonStyle} onClick={() => startEditSystem(system)}>
                      Editar
                    </button>
                    {isOwner && (
                      <button
                        type="button"
                        style={{ ...buttonStyle, color: '#fca5a5' }}
                        onClick={() => void removeSystem(system)}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isWriter && (
          <div style={{ ...cardStyle, gap: 10 }}>
            <strong>{editingId ? 'Editar sistema externo' : 'Novo sistema externo'}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Nome
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Portal de documentação"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                URL base (opcional)
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://sistema.interno/api"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Autenticação
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as IntegrationAuthType)}
                  style={inputStyle}
                >
                  {Object.entries(AUTH_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Usuário (basic)
                <input
                  value={authUser}
                  onChange={(e) => setAuthUser(e.target.value)}
                  style={inputStyle}
                  disabled={authType !== 'basic'}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Token / senha
                <input
                  type="password"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={editingId ? 'Deixe vazio para manter' : ''}
                  style={inputStyle}
                  disabled={authType === 'none'}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Headers extras (JSON)
                <textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  rows={3}
                  style={{ ...inputStyle, fontFamily: 'monospace' }}
                />
              </label>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Sistema habilitado
            </label>
            {systemError && <div style={{ color: '#f87171', fontSize: 13 }}>{systemError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={{ ...primaryButtonStyle, opacity: savingSystem ? 0.7 : 1 }}
                disabled={savingSystem}
                onClick={() => void saveSystem()}
              >
                {savingSystem ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Adicionar sistema'}
              </button>
              {editingId && (
                <button type="button" style={buttonStyle} onClick={resetSystemForm}>
                  Cancelar edição
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Vínculos por modelo</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            style={{ ...inputStyle, minWidth: 320 }}
          >
            <option value="">Selecione um modelo</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.title}
              </option>
            ))}
          </select>
          {selectedModel && <span style={muted}>{selectedModel.c4Type}</span>}
        </div>

        {bindingsError && <div style={{ color: '#f87171', fontSize: 13 }}>{bindingsError}</div>}
        {bindingError && <div style={{ color: '#f87171', fontSize: 13 }}>{bindingError}</div>}
        {syncReport && (
          <div style={{ ...cardStyle, gap: 4 }}>
            <strong style={{ fontSize: 13 }}>Resultado do último envio manual</strong>
            {syncReport.length === 0 && <span style={muted}>Nenhum vínculo habilitado.</span>}
            {syncReport.map((result) => (
              <div key={result.bindingId} style={{ fontSize: 12 }}>
                <span style={{ color: '#c7d2fe' }}>{result.externalSystemName}</span>
                {result.deliveries.map((delivery) => (
                  <div key={delivery.target} style={{ color: delivery.ok ? '#34d399' : '#f87171' }}>
                    {delivery.target}:{' '}
                    {delivery.skipped
                      ? 'sem alterações'
                      : delivery.ok
                        ? `enviado (HTTP ${delivery.status ?? 200})`
                        : delivery.error || 'falha'}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {selectedModelId && isWriter && availableSystems.length > 0 && (
          <div style={{ ...cardStyle, gap: 8 }}>
            <strong>Novo vínculo</strong>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Sistema externo
                <select
                  value={newSystemId}
                  onChange={(e) => setNewSystemId(e.target.value)}
                  style={inputStyle}
                >
                  {availableSystems.map((system) => (
                    <option key={system.id} value={system.id}>
                      {system.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Método HTTP
                <select
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value as IntegrationMethod)}
                  style={inputStyle}
                >
                  <option value="PUT">PUT</option>
                  <option value="POST">POST</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                URL do draw.io
                <input
                  value={newDrawioUrl}
                  onChange={(e) => setNewDrawioUrl(e.target.value)}
                  placeholder="https://sistema.interno/api/modelos/123/drawio"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                URL do DAS
                <input
                  value={newDasUrl}
                  onChange={(e) => setNewDasUrl(e.target.value)}
                  placeholder="https://sistema.interno/api/modelos/123/das"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                Formato do corpo
                <select
                  value={newFormat}
                  onChange={(e) => setNewFormat(e.target.value as IntegrationFormat)}
                  style={inputStyle}
                >
                  <option value="json">JSON (evento + conteúdo)</option>
                  <option value="raw">Conteúdo puro (XML/Markdown)</option>
                </select>
              </label>
            </div>
            <div>
              <button
                type="button"
                style={{ ...primaryButtonStyle, opacity: savingBinding ? 0.7 : 1 }}
                disabled={savingBinding || (!newDrawioUrl.trim() && !newDasUrl.trim())}
                onClick={() => void addBinding()}
              >
                {savingBinding ? 'Vinculando...' : 'Vincular modelo'}
              </button>
            </div>
          </div>
        )}

        {selectedModelId && isWriter && availableSystems.length === 0 && systems.length > 0 && (
          <span style={muted}>Todos os sistemas configurados já estão vinculados a este modelo.</span>
        )}

        {loadingBindings ? (
          <span style={muted}>Carregando vínculos...</span>
        ) : bindings.length === 0 ? (
          <span style={muted}>Nenhum vínculo para este modelo.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bindings.map((binding) => (
              <BindingEditor
                key={binding.id}
                binding={binding}
                canEdit={isWriter}
                onChanged={() => {
                  void loadBindings(selectedModelId);
                  void loadSystems();
                }}
                onSync={() => void syncBinding(binding)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BindingEditor({
  binding,
  canEdit,
  onChanged,
  onSync,
}: {
  binding: ModelExternalBinding;
  canEdit: boolean;
  onChanged: () => void;
  onSync: () => void;
}) {
  const [drawioUrl, setDrawioUrl] = useState(binding.drawioUrl ?? '');
  const [dasUrl, setDasUrl] = useState(binding.dasUrl ?? '');
  const [method, setMethod] = useState<IntegrationMethod>(binding.method);
  const [format, setFormat] = useState<IntegrationFormat>(binding.format);
  const [enabled, setEnabled] = useState(binding.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrawioUrl(binding.drawioUrl ?? '');
    setDasUrl(binding.dasUrl ?? '');
    setMethod(binding.method);
    setFormat(binding.format);
    setEnabled(binding.enabled);
  }, [binding]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await updateModelIntegration(binding.modelId, binding.id, {
        drawioUrl: drawioUrl.trim() || null,
        dasUrl: dasUrl.trim() || null,
        method,
        format,
        enabled,
      });
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remover o vínculo com "${binding.externalSystemName}"?`)) return;
    setError(null);
    try {
      await deleteModelIntegration(binding.modelId, binding.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const statusColor =
    binding.lastSyncStatus === 'ok'
      ? '#34d399'
      : binding.lastSyncStatus === 'error'
        ? '#f87171'
        : binding.lastSyncStatus === 'partial'
          ? '#fbbf24'
          : '#8b93a3';

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong>{binding.externalSystemName}</strong>
        <span style={{ ...muted, color: statusColor }}>
          {binding.lastSyncAt
            ? `último envio ${new Date(binding.lastSyncAt).toLocaleString()} · ${
                binding.lastSyncStatus ?? 'desconhecido'
              }`
            : 'nunca enviado'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          URL do draw.io
          <input
            value={drawioUrl}
            onChange={(e) => setDrawioUrl(e.target.value)}
            style={inputStyle}
            disabled={!canEdit}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          URL do DAS
          <input
            value={dasUrl}
            onChange={(e) => setDasUrl(e.target.value)}
            style={inputStyle}
            disabled={!canEdit}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Método HTTP
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as IntegrationMethod)}
            style={inputStyle}
            disabled={!canEdit}
          >
            <option value="PUT">PUT</option>
            <option value="POST">POST</option>
            <option value="PATCH">PATCH</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          Formato do corpo
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as IntegrationFormat)}
            style={inputStyle}
            disabled={!canEdit}
          >
            <option value="json">JSON (evento + conteúdo)</option>
            <option value="raw">Conteúdo puro (XML/Markdown)</option>
          </select>
        </label>
      </div>

      {binding.lastSyncError && (
        <div style={{ color: '#fca5a5', fontSize: 12, whiteSpace: 'pre-wrap' }}>
          {binding.lastSyncError}
        </div>
      )}
      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!canEdit}
          />
          Habilitado
        </label>
        {canEdit && (
          <>
            <button
              type="button"
              style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button type="button" style={buttonStyle} onClick={onSync}>
              Enviar agora
            </button>
            <button
              type="button"
              style={{ ...buttonStyle, color: '#fca5a5', marginLeft: 'auto' }}
              onClick={() => void remove()}
            >
              Remover vínculo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
