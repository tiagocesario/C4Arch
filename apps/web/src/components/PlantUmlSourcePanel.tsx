import { useEffect, useState } from 'react';
import {
  fetchModelExportText,
  importPlantUmlIntoModel,
  renderPlantUmlPreview,
} from '../services/collaboration';

interface PlantUmlSourcePanelProps {
  modelId: string;
  modelTitle: string;
  canEdit: boolean;
  onClose: () => void;
  onApplied: () => void;
}

const buttonStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #374151',
  background: '#1f2937',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 13,
};

/**
 * Mostra o modelo como código C4-PlantUML e permite reaplicar o texto no
 * modelo canônico, com pré-visualização do desenho renderizado ao lado.
 */
export function PlantUmlSourcePanel({
  modelId,
  modelTitle,
  canEdit,
  onClose,
  onApplied,
}: PlantUmlSourcePanelProps) {
  const [source, setSource] = useState('');
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const dirty = source !== baseline;

  async function loadSource() {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const text = await fetchModelExportText(modelId, 'plantuml');
      setSource(text);
      setBaseline(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSource();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Pré-visualização com debounce; requisições antigas são abortadas.
  useEffect(() => {
    if (!source.trim()) {
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const url = await renderPlantUmlPreview(source, controller.signal);
        if (cancelled) {
          URL.revokeObjectURL(url);
        } else {
          setPreviewUrl(url);
        }
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : String(err));
          setPreviewUrl(null);
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(handle);
    };
  }, [source]);

  // Libera a URL de objeto da pré-visualização ao substituí-la ou desmontar.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function applySource() {
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await importPlantUmlIntoModel(modelId, {
        content: source,
        mode: 'replace',
      });
      setBaseline(source);
      setStatus(
        `Modelo atualizado: ${result.import.elements} elementos, ` +
          `${result.import.relationships} relações, ${result.import.views} visões.`
      );
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (dirty && !window.confirm('Descartar as alterações de PlantUML não aplicadas?')) return;
    onClose();
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: 16,
      }}
      onClick={close}
    >
      <div
        style={{
          background: '#1a1d24',
          border: '1px solid #2a2f3a',
          borderRadius: 10,
          padding: 16,
          width: 'min(1280px, 96vw)',
          height: '88vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>PlantUML · {modelTitle}</h3>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              Código C4-PlantUML do modelo. Edite e aplique para atualizar o canvas. A pré-visualização renderiza o diagrama.
            </span>
          </div>
          <button onClick={close} style={buttonStyle}>Fechar</button>
        </header>

        {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
        {status && <div style={{ color: '#4ade80', fontSize: 12 }}>{status}</div>}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Código</span>
            <textarea
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setStatus(null);
              }}
              readOnly={!canEdit || loading}
              spellCheck={false}
              aria-label="Código PlantUML do modelo"
              placeholder={'@startuml\n!include <C4/C4_Container>\nPerson(usuario, "Usuário")\n@enduml'}
              style={{
                flex: 1,
                minHeight: 0,
                width: '100%',
                resize: 'none',
                fontFamily: 'Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.5,
                color: '#e5e7eb',
                background: '#0f1115',
                border: '1px solid #374151',
                borderRadius: 8,
                padding: 10,
              }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Pré-visualização</span>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                background: '#0f1115',
                border: '1px solid #374151',
                borderRadius: 8,
                padding: 8,
                overflow: 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {previewLoading && <span style={{ fontSize: 12, color: '#9ca3af' }}>Renderizando...</span>}
              {!previewLoading && previewError && (
                <span style={{ fontSize: 12, color: '#f87171' }}>{previewError}</span>
              )}
              {!previewLoading && !previewError && previewUrl && (
                <img
                  src={previewUrl}
                  alt="Pré-visualização do diagrama PlantUML"
                  style={{ maxWidth: '100%', maxHeight: '100%' }}
                />
              )}
              {!previewLoading && !previewError && !previewUrl && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>Sem conteúdo para renderizar.</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {loading ? 'Carregando código PlantUML...' : dirty ? 'Alterações não aplicadas' : 'Sincronizado com o modelo'}
            {!canEdit && ' · somente leitura'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void loadSource()} disabled={loading || saving} style={buttonStyle}>
              Recarregar
            </button>
            <button
              onClick={() => void applySource()}
              disabled={!canEdit || loading || saving || !dirty}
              style={{ ...buttonStyle, background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' }}
            >
              {saving ? 'Aplicando...' : 'Aplicar no modelo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
