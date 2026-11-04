import { ReactFlow, useReactFlow, type Node, type Edge, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useState } from 'react';
import { sendOp, disconnect, connected } from '../services/ws';
import type { Element, Edge as CEdge } from '../services/types';

const typeStyle = {
  system: { background: '#1f2937', border: '#374151', color: '#e5e7eb' },
  container: { background: '#111827', border: '#1d4ed8', color: '#e5e7eb' },
  actor: { background: '#064e3b', border: '#0d9488', color: '#e5e7eb' },
  component: { background: '#4c1d95', border: '#7c3aed', color: '#f3f4f6' },
};

const kindLabel = (t: string) =>
  (t === 'actor' ? 'Ator' : t === 'system' ? 'Sistema' : t === 'container' ? 'Container' : t === 'component' ? 'Componente' : t);

interface CanvasProps {
  modelId: string;
  elements: Element[];
  edges: CEdge[];
  onRenameElement: (id: string, title: string) => void;
}

export function Canvas({ modelId, elements, edges, onRenameElement }: CanvasProps) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);

  const applyModel = useCallback((elems: Element[], es: CEdge[]) => {
    const list = new Map<string, Node>();
    for (const e of elems) {
      list.set(e.id, {
        id: e.id,
        type: 'input',
        position: { x: e.position_x ?? 0, y: e.position_y ?? 0 },
        data: { label: e.title, desc: e.description ?? '', kind: kindLabel(e.type) },
        style: typeStyle[e.type] ?? typeStyle.system,
      });
    }
    setNodes(() => Array.from(list.values()));
    setRfEdges(() =>
      es.map((e) => ({
        id: e.id,
        source: e.fromId ?? e.id,
        target: e.toId ?? e.id,
        data: { label: e.label ?? '', type: e.type },
      }))
    );
  }, []);

  useEffect(() => {
    applyModel(elements, edges);
    if (fitView) fitView({ padding: 0.25 });
  }, [elements, edges, fitView, applyModel]);

  const onConnect = useCallback((connection: any) => {
    sendOp({
      type: 'patch',
      modelId,
      patch: {
        op: 'createEdge',
        data: { fromId: connection.source, toId: connection.target, type: 'call', label: '' },
      },
    });
  }, [modelId]);

  const onNodeChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position) {
          const el = elements.find((e) => e.id === ch.id);
          if (!el) continue;
          sendOp({
            type: 'patch',
            modelId,
            patch: {
              op: 'updateElement',
              data: { id: el.id, positionX: ch.position.x, positionY: ch.position.y },
            },
          });
        }
        if (ch.type === 'remove') {
          const el = elements.find((e) => e.id === ch.id);
          if (el) {
            sendOp({ type: 'patch', modelId, patch: { op: 'deleteElement', data: el.id } });
          }
        }
      }
    },
    [elements, modelId]
  );

  const onNodeDoubleClick = useCallback((_event: any, node: Node) => {
    const el = elements.find((e) => e.id === node.id);
    if (!el) return;
    const next = prompt('Título do elemento:', el.title);
    if (next === null) return;
    onRenameElement(node.id, next.trim() || el.title);
  }, [elements, onRenameElement]);

  useEffect(() => {
    return () => disconnect();
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0f1115' }}>
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        onConnect={onConnect}
        onNodesChange={onNodeChange}
        onNodeDoubleClick={onNodeDoubleClick}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      />
      <div style={{ position: 'absolute', top: 12, left: 12, font: '12px monospace', color: '#7b8290' }}>
        WS: {connected ? 'online' : 'offline'}
      </div>
      <button
        onClick={disconnect}
        style={{ position: 'absolute', top: 12, right: 12, padding: '6px 10px', background: '#2a2f3a', color: '#e8eaed', border: 'none', borderRadius: 6, cursor: 'pointer' }}
      >
        Desconectar
      </button>
    </div>
  );
}
