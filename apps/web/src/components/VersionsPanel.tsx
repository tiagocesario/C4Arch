import type { ModelVersion } from '../services/api';

interface VersionsPanelProps {
  versions: ModelVersion[];
  loading: boolean;
  canRestore: boolean;
  onClose: () => void;
  onRestore: (version: ModelVersion) => void;
}

const buttonStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#1f2937',
  color: '#e8eaed',
  cursor: 'pointer',
  fontSize: 13,
};

const overlayStyle = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle = {
  background: '#1a1d24',
  border: '1px solid #2a2f3a',
  borderRadius: 8,
  padding: 16,
  width: 'min(640px, 90vw)',
  maxHeight: '80vh',
  overflow: 'auto',
};

/** Histórico de versões com restauração por snapshot/hash. */
export function VersionsPanel({
  versions,
  loading,
  canRestore,
  onClose,
  onRestore,
}: VersionsPanelProps) {
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Versões do modelo</h3>
        {loading && <p>Carregando...</p>}
        {!loading && versions.length === 0 && <p>Nenhuma versão encontrada.</p>}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {versions.map((version) => (
            <li
              key={version.id}
              style={{
                borderBottom: '1px solid #2a2f3a',
                padding: '8px 0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  v{version.version} — {version.kind}
                </div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>
                  {new Date(version.created_at).toLocaleString('pt-BR')}
                  {version.label ? ` · ${version.label}` : ''}
                  {version.content_hash ? ` · ${version.content_hash.slice(0, 16)}…` : ''}
                </div>
              </div>
              {canRestore && (
                <button onClick={() => onRestore(version)} style={buttonStyle}>
                  Restaurar
                </button>
              )}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button onClick={onClose} style={buttonStyle}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
