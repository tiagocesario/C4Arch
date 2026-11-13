import type { C4ModelType } from '../services/types';
import { C4_MODEL_TYPES } from '../services/types';
import { C4_TYPE_LABEL } from '../utils/c4';

export interface ImportResult {
  name: string;
  ok: boolean;
  error?: string;
}

export type ImportSource = 'files' | 'folder' | 'drive' | 'urls';

export interface FolderOption {
  id: string;
  name: string;
  depth: number;
}

interface ImportModelsPanelProps {
  source: ImportSource;
  files: File[];
  links: string;
  folderId: string | null;
  type: C4ModelType | 'auto';
  folderOptions: FolderOption[];
  importing: boolean;
  progress: string;
  results: ImportResult[];
  error: string | null;
  onSourceChange: (source: ImportSource) => void;
  onFilesChange: (files: File[]) => void;
  onLinksChange: (links: string) => void;
  onFolderChange: (folderId: string | null) => void;
  onTypeChange: (type: C4ModelType | 'auto') => void;
  onClose: () => void;
  onSubmit: () => void;
}

const inputStyle = {
  padding: '8px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#0f1115',
  color: '#e8eaed',
  font: '13px inherit',
};

const buttonStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid #2a2f3a',
  background: '#1f2937',
  color: '#e8eaed',
  cursor: 'pointer',
  fontSize: 13,
};

const smallMuted = { fontSize: 12, color: '#7b8290' };

const SOURCES: Array<[ImportSource, string]> = [
  ['files', 'Arquivos'],
  ['folder', 'Pasta local'],
  ['drive', 'Google Drive'],
  ['urls', 'Outras URLs'],
];

/** Importação em lote de draw.io por arquivo, pasta, Drive ou URL. */
export function ImportModelsPanel({
  source,
  files,
  links,
  folderId,
  type,
  folderOptions,
  importing,
  progress,
  results,
  error,
  onSourceChange,
  onFilesChange,
  onLinksChange,
  onFolderChange,
  onTypeChange,
  onClose,
  onSubmit,
}: ImportModelsPanelProps) {
  const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilesChange(Array.from(event.target.files ?? []));
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
        zIndex: 1150,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1d27',
          border: '1px solid #2a2f3a',
          borderRadius: 10,
          width: 'min(720px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Importar modelos</h3>
            <div style={smallMuted}>
              Importe um ou vários arquivos <code>.drawio</code>/<code>.xml</code> de pasta
              local, Google Drive ou outra URL. Cada arquivo vira um modelo com DAS gerado
              automaticamente.
            </div>
          </div>
          <button onClick={onClose} style={buttonStyle} disabled={importing}>
            Fechar
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SOURCES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => onSourceChange(value)}
              style={{
                ...buttonStyle,
                background: source === value ? '#4f46e5' : 'transparent',
                color: source === value ? '#fff' : '#e8eaed',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {(source === 'files' || source === 'folder') && (
          <div style={{ display: 'grid', gap: 6 }}>
            {source === 'files' ? (
              <input
                key="import-files"
                type="file"
                multiple
                accept=".drawio,.xml,application/xml,text/xml"
                onChange={selectFiles}
                style={{ color: '#e8eaed' }}
              />
            ) : (
              <input
                key="import-folder"
                type="file"
                multiple
                onChange={selectFiles}
                ref={(element) => {
                  if (element) {
                    element.setAttribute('webkitdirectory', '');
                    element.setAttribute('directory', '');
                  }
                }}
                style={{ color: '#e8eaed' }}
              />
            )}
            <div style={smallMuted}>
              {files.length > 0
                ? `${files.length} arquivo(s) selecionado(s).`
                : 'Selecione um ou vários arquivos. Formatos: .drawio, .xml.'}
            </div>
          </div>
        )}

        {(source === 'drive' || source === 'urls') && (
          <div style={{ display: 'grid', gap: 6 }}>
            <textarea
              value={links}
              onChange={(event) => onLinksChange(event.target.value)}
              rows={5}
              placeholder={
                source === 'drive'
                  ? 'https://drive.google.com/file/d/<id>/view\n(um link por linha; o arquivo precisa estar compartilhado como "Qualquer pessoa com o link")'
                  : 'https://exemplo.com/diagrama.drawio\n(uma URL por linha)'
              }
              style={{ ...inputStyle, width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={smallMuted}>
              {source === 'drive'
                ? 'A importação lê arquivos individuais do Drive via link público. Pastas do Drive devem ser sincronizadas localmente e importadas pela aba "Pasta local".'
                : 'O servidor baixa cada URL e valida se o conteúdo é XML draw.io.'}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={smallMuted}>Pasta de destino</span>
            <select
              value={folderId ?? ''}
              onChange={(event) => onFolderChange(event.target.value || null)}
              style={inputStyle}
            >
              <option value="">Sem pasta</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {'\u00a0'.repeat(folder.depth * 2)}{folder.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={smallMuted}>Tipo de diagrama</span>
            <select
              value={type}
              onChange={(event) => onTypeChange(event.target.value as C4ModelType | 'auto')}
              style={inputStyle}
            >
              <option value="auto">Detectar pelo nome do arquivo</option>
              {C4_MODEL_TYPES.map((item) => (
                <option key={item} value={item}>
                  {C4_TYPE_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {progress && <div style={{ color: '#93c5fd' }}>{progress}</div>}

        {results.length > 0 && (
          <div
            style={{
              maxHeight: 170,
              overflowY: 'auto',
              border: '1px solid #2a2f3a',
              borderRadius: 6,
              padding: 8,
              display: 'grid',
              gap: 4,
              fontSize: 12,
            }}
          >
            {results.map((result, index) => (
              <div
                key={`${result.name}-${index}`}
                style={{ color: result.ok ? '#86efac' : '#fca5a5' }}
              >
                {result.ok ? '✓' : '✗'} {result.name}
                {result.error ? ` — ${result.error}` : ''}
              </div>
            ))}
          </div>
        )}

        {error && <div style={{ color: '#f87171' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={buttonStyle} disabled={importing}>
            Cancelar
          </button>
          <button
            onClick={onSubmit}
            style={{ ...buttonStyle, background: '#4f46e5', color: '#fff', opacity: importing ? 0.7 : 1 }}
            disabled={importing}
          >
            {importing ? 'Importando...' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
