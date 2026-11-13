import { useEffect, useMemo, useState } from 'react';
import {
  downloadModelExport,
  fetchModelPreview,
  listExportFormats,
  type ExportFormatInfo,
} from '../services/collaboration';

interface ExportPanelProps {
  modelId: string;
  modelTitle: string;
  onClose: () => void;
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

export function ExportPanel({ modelId, modelTitle, onClose }: ExportPanelProps) {
  const [formats, setFormats] = useState<ExportFormatInfo[]>([]);
  const [selected, setSelected] = useState('svg');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [legend, setLegend] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let active = true;
    listExportFormats(modelId)
      .then((response) => {
        if (!active) return;
        setFormats(response.formats);
        const first =
          response.formats.find((item) => item.format === 'svg') ?? response.formats[0];
        if (first) setSelected(first.format);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [modelId]);

  const selectedFormat = useMemo(
    () => formats.find((item) => item.format === selected) ?? null,
    [formats, selected]
  );
  const supportsPreview = selectedFormat?.previewUrl !== null && selectedFormat?.previewUrl !== undefined;

  useEffect(() => {
    if (!supportsPreview || (selected !== 'svg' && selected !== 'png')) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    fetchModelPreview(modelId, selected, { theme, legend })
      .then((url) => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [modelId, selected, theme, legend, supportsPreview]);

  const download = async () => {
    if (!selectedFormat || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const safeTitle = modelTitle.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'modelo';
      await downloadModelExport(modelId, selectedFormat.format, {
        theme,
        legend,
        filename: `${safeTitle}.${selectedFormat.extension}`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
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
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1d24',
          border: '1px solid #2a2f3a',
          borderRadius: 10,
          padding: 16,
          width: 'min(900px, 94vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Exportar modelo</h3>
          <button onClick={onClose} style={buttonStyle}>Fechar</button>
        </header>

        {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', gap: 16, minHeight: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {formats.map((item) => (
              <button
                key={item.format}
                onClick={() => setSelected(item.format)}
                style={{
                  ...buttonStyle,
                  textAlign: 'left',
                  background: selected === item.format ? '#312e81' : '#1f2937',
                  borderColor: selected === item.format ? '#6366f1' : '#374151',
                }}
              >
                {item.label}
                <span style={{ display: 'block', fontSize: 11, color: '#9ca3af' }}>
                  .{item.extension}
                </span>
              </button>
            ))}
            {formats.length === 0 && !error && (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Carregando formatos...</span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Tema
                <select
                  value={theme}
                  onChange={(event) => setTheme(event.target.value === 'dark' ? 'dark' : 'light')}
                  style={{ ...buttonStyle, background: '#0f1115' }}
                >
                  <option value="light">Claro</option>
                  <option value="dark">Escuro</option>
                </select>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={legend}
                  onChange={(event) => setLegend(event.target.checked)}
                />
                Incluir legenda
              </label>
            </div>

            <div
              style={{
                flex: 1,
                minHeight: 220,
                border: '1px solid #2a2f3a',
                borderRadius: 8,
                background: theme === 'dark' ? '#0f172a' : '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto',
                padding: 8,
              }}
            >
              {loading && <span style={{ color: '#9ca3af', fontSize: 13 }}>Gerando preview...</span>}
              {!loading && previewUrl && (
                <img
                  src={previewUrl}
                  alt={`Preview ${selected}`}
                  style={{ maxWidth: '100%', maxHeight: '52vh', objectFit: 'contain' }}
                />
              )}
              {!loading && !previewUrl && (
                <span style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
                  {supportsPreview
                    ? 'Preview indisponível.'
                    : 'Este formato não tem preview; use o download.'}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => void download()}
                disabled={!selectedFormat || downloading}
                style={{ ...buttonStyle, background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' }}
              >
                {downloading ? 'Baixando...' : `Baixar ${selectedFormat?.extension ?? ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
