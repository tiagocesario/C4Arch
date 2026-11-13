import { escapeHtml, markdownToHtml } from '../utils/markdown';

export interface DasEditorSection {
  key: string;
  label: string;
  description: string;
  body: string;
}

interface DasEditorProps {
  modelTitle: string;
  content: string;
  viewMode: 'edit' | 'preview';
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  sections: DasEditorSection[];
  emptySections: number;
  activeIndex: number;
  previewUrl: string | null;
  onClose: () => void;
  onSave: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
  onSelectSection: (index: number) => void;
  onEditSection: (value: string) => void;
  onViewModeChange: (mode: 'edit' | 'preview') => void;
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

const primaryButtonStyle = { ...buttonStyle, background: '#238636', color: '#fff' };
const smallMuted = { fontSize: 12, color: '#7b8290' };

/** Editor do DAS em seções Markdown, com preview e exportação por impressão. */
export function DasEditor({
  modelTitle,
  content,
  viewMode,
  loading,
  saving,
  dirty,
  sections,
  emptySections,
  activeIndex,
  previewUrl,
  onClose,
  onSave,
  onRegenerate,
  onDiscard,
  onSelectSection,
  onEditSection,
  onViewModeChange,
}: DasEditorProps) {
  const activeItem = sections[activeIndex] ?? sections[0];

  const print = () => {
    const win = window.open('', '_blank');
    if (!win) return;
    const imageTag = previewUrl
      ? `<div style="margin-bottom:16px;"><iframe src="${escapeHtml(previewUrl)}" title="Diagrama draw.io" style="width:100%;height:380px;border:1px solid #ccc;"></iframe></div>`
      : '';
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(modelTitle)}</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111;line-height:1.5;}h1{font-size:22px;}h1,h2,h3{color:#1f2937;line-height:1.25;}h2{font-size:17px;margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}h3{font-size:14px;margin:16px 0 6px;}p{margin:8px 0;}table{border-collapse:collapse;width:100%;margin:10px 0 16px;}th,td{border:1px solid #d1d5db;padding:6px 8px;font-size:11px;line-height:1.35;text-align:left;vertical-align:top;}th{background:#f3f4f6;}tr:nth-child(even) td{background:#fafafa;}blockquote{margin:0 0 16px;padding:8px 12px;border-left:4px solid #93c5fd;background:#eff6ff;}ul{margin:8px 0;padding-left:22px;}li{margin:2px 0;}code{background:#f3f4f6;padding:1px 4px;border-radius:3px;}hr{border:none;border-top:1px solid #d1d5db;margin:16px 0;}@media print{body{margin:12px;}h2,h3{break-after:avoid;}table{break-inside:auto;}tr{break-inside:avoid;}}</style></head><body>${imageTag}${markdownToHtml(content)}</body></html>`;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 300);
  };

  if (!activeItem) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1d27',
          border: '1px solid #2a2f3a',
          borderRadius: 10,
          width: 'min(1280px, 97vw)',
          height: 'min(88vh, 920px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            onSave();
          }
        }}
        tabIndex={-1}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #2a2f3a',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <h3 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              DAS — {modelTitle}
            </h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={'das-badge ' + (dirty ? 'das-badge-warn' : 'das-badge-ok')}>
                {saving ? 'Salvando...' : dirty ? 'Alterações não salvas' : 'Salvo'}
              </span>
              <span className="das-badge">{sections.length} seções</span>
              {emptySections > 0 && (
                <span className="das-badge das-badge-warn">{emptySections} sem conteúdo</span>
              )}
            </div>
          </div>
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            <button onClick={onRegenerate} style={buttonStyle} disabled={loading || saving}>
              Regenerar
            </button>
            <button
              onClick={print}
              style={{ ...buttonStyle, background: '#4f46e5', color: '#fff' }}
              title="Exportar o DAS como PDF (imprimir/salvar PDF)"
            >
              Exportar PDF
            </button>
            <button onClick={onSave} style={primaryButtonStyle} disabled={saving || !dirty}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
            <button onClick={onClose} style={buttonStyle}>
              Fechar
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid #2a2f3a',
            alignItems: 'center',
          }}
        >
          <button
            onClick={() => onViewModeChange('preview')}
            style={{ ...buttonStyle, background: viewMode === 'preview' ? '#2a2f3a' : 'transparent' }}
          >
            Visualizar
          </button>
          <button
            onClick={() => onViewModeChange('edit')}
            style={{ ...buttonStyle, background: viewMode === 'edit' ? '#2a2f3a' : 'transparent' }}
          >
            Editar
          </button>
          <span style={{ ...smallMuted, marginLeft: 'auto' }}>
            Ctrl+S salva · Markdown nas seções · alterações em memória
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 12, overflow: 'auto' }}>
          {loading ? (
            <div style={{ color: '#7b8290' }}>Carregando DAS...</div>
          ) : viewMode === 'edit' ? (
            <div className="das-editor-grid">
              <aside className="das-editor-sidebar" aria-label="Seções do DAS">
                <div className="das-editor-sidebar-head">
                  <strong>Seções do documento</strong>
                  <span className="das-editor-sidebar-meta">
                    {sections.length} seções
                    {emptySections > 0 ? ` · ${emptySections} pendentes` : ' · completo'}
                  </span>
                </div>
                <nav className="das-editor-section-list">
                  {sections.map((item, index) => {
                    const filled = item.body.trim().length > 0;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={'das-section-item' + (index === activeIndex ? ' is-active' : '')}
                        onClick={() => onSelectSection(index)}
                        title={item.label}
                      >
                        <span className="das-section-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="das-section-label">{item.label}</span>
                        <span
                          className={'das-section-dot' + (filled ? ' is-filled' : '')}
                          title={filled ? 'Seção preenchida' : 'Seção sem conteúdo'}
                        />
                      </button>
                    );
                  })}
                </nav>
              </aside>

              <form
                className="das-editor-main"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSave();
                }}
              >
                <div className="das-editor-section-head">
                  <span className="das-editor-eyebrow">
                    Seção {activeIndex + 1} de {sections.length}
                  </span>
                  <h4>{activeItem.label}</h4>
                  <p>{activeItem.description} Aceita Markdown (tabelas, listas, negrito e código).</p>
                </div>

                {!activeItem.body.trim() && (
                  <div className="das-editor-alert">
                    Esta seção está sem conteúdo. Você ainda pode salvar, mas o documento ficará incompleto.
                  </div>
                )}

                <textarea
                  className="das-editor-textarea"
                  value={activeItem.body}
                  onChange={(event) => onEditSection(event.target.value)}
                  placeholder={`Descreva ${activeItem.label.toLowerCase()}...`}
                  spellCheck
                />

                <div className="das-editor-meta">
                  <span>{activeItem.body.length} caracteres</span>
                  <span>
                    {activeItem.body.trim() ? activeItem.body.trim().split(/\s+/).length : 0} palavras
                  </span>
                  <span>{activeItem.body ? activeItem.body.split('\n').length : 0} linhas</span>
                  <span className={dirty ? 'das-status-dirty' : 'das-status-saved'}>
                    {saving ? 'Salvando...' : dirty ? 'Alterações não salvas' : 'Salvo'}
                  </span>
                </div>

                <div className="das-editor-actions">
                  <button type="button" style={buttonStyle} onClick={onDiscard} disabled={!dirty || saving}>
                    Descartar alterações
                  </button>
                  <button type="submit" style={primaryButtonStyle} disabled={saving || !dirty}>
                    {saving ? 'Salvando...' : 'Salvar DAS'}
                  </button>
                </div>
              </form>

              <aside className="das-editor-drawer" aria-label="Painel da seção">
                <h4>Painel da seção</h4>
                <div className="das-drawer-block">
                  <span className="das-drawer-label">Identificação</span>
                  <strong>{activeItem.label}</strong>
                </div>
                <div className="das-drawer-block">
                  <span className="das-drawer-label">Status da seção</span>
                  <span className={'das-badge ' + (activeItem.body.trim() ? 'das-badge-ok' : 'das-badge-warn')}>
                    {activeItem.body.trim() ? 'Preenchida' : 'Pendente'}
                  </span>
                </div>
                <div className="das-drawer-block">
                  <span className="das-drawer-label">Documento</span>
                  <span className={'das-badge ' + (dirty ? 'das-badge-warn' : 'das-badge-ok')}>
                    {dirty ? 'Alterações não salvas' : 'Salvo'}
                  </span>
                </div>
                <div className="das-drawer-block">
                  <span className="das-drawer-label">Seções pendentes</span>
                  <span>
                    {emptySections} de {sections.length}
                  </span>
                </div>
                <div className="das-drawer-tip">
                  <strong>Orientações</strong>
                  <ul>
                    <li>Edite uma seção por vez; o texto é mantido em memória até salvar.</li>
                    <li>Use Markdown para tabelas, listas, negrito e blocos de código.</li>
                    <li>Seções vazias são sinalizadas, mas não bloqueiam o salvamento.</li>
                    <li>Fechar com alterações pendentes pede confirmação.</li>
                  </ul>
                </div>
                <div className="das-drawer-legend">
                  <span>
                    <i className="das-section-dot is-filled" /> preenchida
                  </span>
                  <span>
                    <i className="das-section-dot" /> pendente
                  </span>
                </div>
              </aside>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
              <div
                className="das-preview"
                style={{
                  background: '#ffffff',
                  color: '#1f2937',
                  width: '210mm',
                  maxWidth: '100%',
                  minHeight: '297mm',
                  padding: '20mm',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                  borderRadius: 4,
                  lineHeight: 1.6,
                  fontSize: 12,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                {previewUrl && (
                  <div style={{ marginBottom: 16 }}>
                    <iframe
                      src={previewUrl}
                      title="Diagrama draw.io"
                      style={{ width: '100%', height: 360, border: '1px solid #ccc', borderRadius: 4, background: '#fff' }}
                    />
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
