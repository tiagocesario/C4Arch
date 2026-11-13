import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createModelComment,
  deleteModelComment,
  listModelComments,
  updateModelComment,
  type ModelComment,
} from '../services/collaboration';

interface CommentsPanelProps {
  modelId: string;
  selectedElementId: string | null;
  elements: Array<{ id: string; title: string }>;
  isWriter: boolean;
  onClose: () => void;
  onCommentsChange?: (comments: ModelComment[]) => void;
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

export function CommentsPanel({
  modelId,
  selectedElementId,
  elements,
  isWriter,
  onClose,
  onCommentsChange,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<ModelComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [saving, setSaving] = useState(false);

  const elementTitle = useMemo(() => {
    const map = new Map(elements.map((element) => [element.id, element.title]));
    return (id: string | null) => (id ? map.get(id) ?? 'Elemento removido' : null);
  }, [elements]);

  const publish = useCallback(
    (next: ModelComment[]) => {
      setComments(next);
      onCommentsChange?.(next);
    },
    [onCommentsChange]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listModelComments(modelId);
      publish(response.comments);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [modelId, publish]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const text = content.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createModelComment(modelId, {
        content: text,
        elementId: selectedElementId,
      });
      publish([...comments, created]);
      setContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleResolved = async (comment: ModelComment) => {
    try {
      const updated = await updateModelComment(modelId, comment.id, {
        resolved: !comment.resolved,
      });
      publish(comments.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (comment: ModelComment) => {
    if (!window.confirm('Excluir este comentário?')) return;
    try {
      await deleteModelComment(modelId, comment.id);
      publish(comments.filter((item) => item.id !== comment.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const visible = onlySelected && selectedElementId
    ? comments.filter((comment) => comment.elementId === selectedElementId)
    : comments;
  const unresolved = comments.filter((comment) => !comment.resolved).length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <aside
        style={{
          width: 'min(420px, 96vw)',
          height: '100%',
          background: '#141820',
          borderLeft: '1px solid #2a2f3a',
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
          boxSizing: 'border-box',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0 }}>Comentários</h3>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>
              {comments.length} total · {unresolved} em aberto
            </div>
          </div>
          <button onClick={onClose} style={buttonStyle}>Fechar</button>
        </header>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '12px 0', fontSize: 12, color: '#9ca3af' }}>
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(event) => setOnlySelected(event.target.checked)}
            disabled={!selectedElementId}
          />
          Somente o elemento selecionado
          {selectedElementId ? ` (${elementTitle(selectedElementId)})` : ''}
        </label>

        {error && (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{error}</div>
        )}

        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <p style={{ color: '#9ca3af' }}>Carregando...</p>}
          {!loading && visible.length === 0 && (
            <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum comentário ainda.</p>
          )}
          {visible.map((comment) => (
            <article
              key={comment.id}
              style={{
                border: '1px solid #2a2f3a',
                borderRadius: 8,
                padding: 10,
                background: comment.resolved ? '#101720' : '#1a1d24',
                opacity: comment.resolved ? 0.75 : 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{comment.author.name}</strong>
                <span style={{ fontSize: 11, color: '#7b8290' }}>
                  {new Date(comment.createdAt).toLocaleString('pt-BR')}
                </span>
              </div>
              {comment.elementId && (
                <div style={{ fontSize: 11, color: '#93c5fd', margin: '2px 0' }}>
                  em {elementTitle(comment.elementId)}
                </div>
              )}
              <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {comment.content}
              </p>
              {isWriter && (
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => void toggleResolved(comment)} style={{ ...buttonStyle, fontSize: 11 }}>
                    {comment.resolved ? 'Reabrir' : 'Resolver'}
                  </button>
                  <button
                    onClick={() => void remove(comment)}
                    style={{ ...buttonStyle, fontSize: 11, color: '#fca5a5' }}
                  >
                    Excluir
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>

        {isWriter ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>
              {selectedElementId
                ? `Comentando em ${elementTitle(selectedElementId)}`
                : 'Comentário geral do modelo'}
            </div>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={3}
              maxLength={5000}
              placeholder="Escreva um comentário..."
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                onClick={() => void submit()}
                disabled={saving || !content.trim()}
                style={{ ...buttonStyle, background: '#4f46e5', borderColor: '#4f46e5', color: '#fff' }}
              >
                {saving ? 'Enviando...' : 'Comentar'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12, fontSize: 12, color: '#7b8290' }}>
            Somente leitura: você não pode comentar neste modelo.
          </div>
        )}
      </aside>
    </div>
  );
}
