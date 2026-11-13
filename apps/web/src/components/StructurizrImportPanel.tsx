import { useRef, useState } from 'react';
import {
  importStructurizrIntoModel,
  importStructurizrWorkspace,
  type StructurizrImportResult,
} from '../services/collaboration';

interface StructurizrImportPanelProps {
  /** Quando ausente, cria um novo modelo na organização. */
  modelId?: string | null;
  orgId: string;
  c4Types?: string[];
  onClose: () => void;
  onImported: (result: { modelId: string; import: StructurizrImportResult }) => void;
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid #374151',
  background: '#0f1115',
  color: '#e5e7eb',
  font: '13px inherit',
};

const buttonStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #374151',
  background: '#1f2937',
  color: '#e5e7eb',
  cursor: 'pointer',
  fontSize: 13,
};

export function StructurizrImportPanel({
  modelId,
  orgId,
  c4Types = ['system-context', 'container', 'component', 'system-landscape', 'dynamic', 'deployment'],
  onClose,
  onImported,
}: StructurizrImportPanelProps) {
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [c4Type, setC4Type] = useState('container');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [format, setFormat] = useState<'auto' | 'json' | 'dsl'>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const loadFile = async (file: File) => {
    try {
      const text = await file.text();
      setContent(text);
      if (!title.trim()) setTitle(file.name.replace(/\.(json|dsl)$/i, ''));
      if (/\.json$/i.test(file.name)) setFormat('json');
      else if (/\.dsl$/i.test(file.name)) setFormat('dsl');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submit = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const resolvedFormat = format === 'auto' ? undefined : format;
      if (modelId) {
        const result = await importStructurizrIntoModel(modelId, {
          content,
          format: resolvedFormat,
          mode,
          title: title.trim() || undefined,
          c4Type,
        });
        onImported({ modelId, import: result.import });
      } else {
        if (!orgId) throw new Error('Organização não selecionada');
        const created = await importStructurizrWorkspace({
          orgId,
          content,
          title: title.trim() || undefined,
          c4Type,
          format: resolvedFormat,
        });
        onImported({ modelId: created.id, import: created.import });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1d24',
          border: '1px solid #2a2f3a',
          borderRadius: 10,
          padding: 16,
          width: 'min(760px, 96vw)',
          maxHeight: '90vh',
          overflow: 'auto',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>
            {modelId ? 'Importar Structurizr no modelo' : 'Novo modelo a partir do Structurizr'}
          </h3>
          <button onClick={onClose} style={buttonStyle}>Fechar</button>
        </header>
        <p style={{ color: '#9ca3af', fontSize: 13 }}>
          Aceita workspace JSON ou DSL. Relações, hierarquia e views são convertidas para o
          modelo canônico; posições ausentes recebem autolayout.
        </p>

        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>
            Título
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Detectado do workspace"
              style={{ ...inputStyle, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>
            Tipo C4
            <select
              value={c4Type}
              onChange={(event) => setC4Type(event.target.value)}
              style={{ ...inputStyle, marginTop: 4 }}
            >
              {c4Types.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>
            Formato
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as typeof format)}
              style={{ ...inputStyle, marginTop: 4 }}
            >
              <option value="auto">Detectar</option>
              <option value="json">JSON</option>
              <option value="dsl">DSL</option>
            </select>
          </label>
          {modelId && (
            <label style={{ fontSize: 12, color: '#9ca3af' }}>
              Modo
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value === 'merge' ? 'merge' : 'replace')}
                style={{ ...inputStyle, marginTop: 4 }}
              >
                <option value="replace">Substituir conteúdo</option>
                <option value="merge">Mesclar por identifier</option>
              </select>
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => fileInput.current?.click()} style={buttonStyle}>
            Escolher arquivo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,.dsl,.txt,application/json,text/plain"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
            }}
          />
          <span style={{ fontSize: 12, color: '#7b8290', alignSelf: 'center' }}>
            ou cole o conteúdo abaixo
          </span>
        </div>

        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          spellCheck={false}
          placeholder={'workspace "Minha arquitetura" {\n  model {\n    usuario = person "Usuário"\n    ...\n  }\n}'}
          style={{ ...inputStyle, fontFamily: 'Consolas, monospace', resize: 'vertical' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={buttonStyle}>Cancelar</button>
          <button
            onClick={() => void submit()}
            disabled={busy || !content.trim()}
            style={{ ...buttonStyle, background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' }}
          >
            {busy ? 'Importando...' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
