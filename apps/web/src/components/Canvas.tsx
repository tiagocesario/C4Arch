import {
  ReactFlow,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge as RFEdge,
  type NodeChange,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { sendOp, sendPresence, connected, setOnConnectionChange } from '../services/ws';
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
  /** `viewer` só visualiza: nenhuma alteração é enviada ao Yjs/REST. */
  readOnly?: boolean;
  /** Elemento selecionado; usado para ancorar comentários no canvas. */
  onSelectElement?: (id: string | null) => void;
  /** Elementos com comentários abertos recebem destaque. */
  commentedElementIds?: string[];
}

export function Canvas({
  modelId,
  elements,
  edges,
  onRenameElement,
  readOnly = false,
  onSelectElement,
  commentedElementIds,
}: CanvasProps) {
  const { fitView } = useReactFlow();
  const [wsConnected, setWsConnected] = useState(connected);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<RFEdge[]>([]);
  const lastFitModelId = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastPresenceSent = useRef(0);

  useEffect(() => {
    setOnConnectionChange(setWsConnected);
    return () => setOnConnectionChange(() => {});
  }, []);

  const applyModel = useCallback((elems: Element[], es: CEdge[]) => {
    const commented = new Set(commentedElementIds ?? []);
    const list = new Map<string, Node>();
    for (const e of elems) {
      list.set(e.id, {
        id: e.id,
        type: 'default',
        position: { x: e.positionX ?? 0, y: e.positionY ?? 0 },
        data: { label: e.title, desc: e.description ?? '', kind: kindLabel(e.type) },
        style: {
          ...(typeStyle[e.type] ?? typeStyle.system),
          ...(commented.has(e.id) ? { boxShadow: '0 0 0 2px #fbbf24' } : {}),
        },
      });
    }
    setNodes(() => Array.from(list.values()));
    setRfEdges(() =>
      es.map((e) => ({
        id: e.id,
        source: e.fromId,
        target: e.toId,
        label: e.label ?? '',
        data: { type: e.type },
      }))
    );
  }, [commentedElementIds]);

  useEffect(() => {
    applyModel(elements, edges);
  }, [elements, edges, applyModel]);

  // fitView apenas uma vez por modelo; caso contrário o viewport "pula" a cada
  // atualização recebida em tempo real.
  useEffect(() => {
    if (lastFitModelId.current === modelId) return;
    if (elements.length === 0) return;
    lastFitModelId.current = modelId;
    requestAnimationFrame(() => fitView({ padding: 0.25 }));
  }, [modelId, elements.length, fitView]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;
      sendOp({
        type: 'patch',
        modelId,
        patch: {
          op: 'createEdge',
          data: { fromId: connection.source, toId: connection.target, type: 'call', label: '' },
        },
      });
    },
    [modelId, readOnly]
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      if (readOnly) return;

      for (const change of changes) {
        if (change.type === 'position' && change.position && change.dragging === false) {
          sendOp({
            type: 'patch',
            modelId,
            patch: {
              op: 'updateElement',
              data: { id: change.id, positionX: change.position.x, positionY: change.position.y },
            },
          });
        }
        if (change.type === 'remove') {
          sendOp({
            type: 'patch',
            modelId,
            patch: { op: 'deleteElement', data: change.id },
          });
        }
      }
    },
    [modelId, readOnly]
  );

  const onNodeDoubleClick = useCallback(
    (_event: unknown, node: Node) => {
      if (readOnly) return;
      const element = elements.find((e) => e.id === node.id);
      if (!element) return;
      const next = window.prompt('Título do elemento:', element.title);
      if (next === null) return;
      onRenameElement(node.id, next.trim() || element.title);
    },
    [elements, onRenameElement, readOnly]
  );

  const onMouseMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    if (now - lastPresenceSent.current < 120) return;
    lastPresenceSent.current = now;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    sendPresence({
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top),
    });
  }, []);

  const onMouseLeave = useCallback(() => {
    lastPresenceSent.current = 0;
    sendPresence(null);
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#0f1115' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        onConnect={readOnly ? undefined : onConnect}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={readOnly ? undefined : onNodeDoubleClick}
        onNodeClick={onSelectElement ? (_event, node) => onSelectElement(node.id) : undefined}
        onPaneClick={onSelectElement ? () => onSelectElement(null) : undefined}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesFocusable={!readOnly}
        fitView
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      />
      {(!wsConnected || readOnly) && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '4px 8px',
            background: 'rgba(17, 24, 39, 0.85)',
            border: '1px solid #2a2f3a',
            borderRadius: 6,
            font: '12px monospace',
            color: wsConnected ? '#9ca3af' : '#fbbf24',
          }}
        >
          {!wsConnected ? 'Tempo real: reconectando…' : 'somente leitura'}
        </div>
      )}
    </div>
  );
}
