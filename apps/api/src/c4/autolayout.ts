/**
 * Autolayout determinístico para o modelo canônico/legado (Onda 2, item 9).
 *
 * O layout é separado do modelo: este módulo calcula posições a partir da
 * topologia e do tipo C4 dos elementos. O mesmo algoritmo é usado pela API
 * (para persistir o resultado em `model_view_layout`/`elements`) e pelos
 * exportadores (para diagramas que não têm posições salvas).
 */

export interface AutoLayoutNode {
  id: string;
  type: string;
  title?: string | null;
}

export interface AutoLayoutEdge {
  from: string;
  to: string;
}

export interface AutoLayoutOptions {
  direction?: 'TB' | 'LR';
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
}

export interface AutoLayoutPosition {
  id: string;
  x: number;
  y: number;
}

const TYPE_RANK: Record<string, number> = {
  actor: 0,
  person: 0,
  system: 1,
  software_system: 1,
  container: 2,
  component: 3,
  deployment_node: 4,
  infrastructure_node: 5,
};

const DEFAULT_OPTIONS: Required<AutoLayoutOptions> = {
  direction: 'LR',
  nodeWidth: 180,
  nodeHeight: 80,
  gapX: 90,
  gapY: 40,
};

/**
 * Calcula posições em camadas. A camada base vem do nível C4 (pessoa, sistema,
 * container, componente); arestas podem empurrar um elemento para uma camada
 * posterior, mas nunca para trás, o que mantém o fluxo legível mesmo com ciclos.
 */
export function computeAutoLayout(
  nodes: AutoLayoutNode[],
  edges: AutoLayoutEdge[],
  options: AutoLayoutOptions = {}
): AutoLayoutPosition[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (nodes.length === 0) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rank = new Map<string, number>();
  for (const node of nodes) {
    rank.set(node.id, TYPE_RANK[node.type] ?? 2);
  }

  const validEdges = edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to));
  // Relaxação limitada: cada iteração avança no máximo uma camada. O limite
  // evita loop infinito em um grafo com ciclos.
  for (let round = 0; round < nodes.length; round += 1) {
    let changed = false;
    for (const edge of validEdges) {
      if (edge.from === edge.to) continue;
      const sourceRank = rank.get(edge.from) ?? 0;
      const targetRank = rank.get(edge.to) ?? 0;
      if (targetRank <= sourceRank) {
        rank.set(edge.to, Math.min(sourceRank + 1, nodes.length - 1));
        changed = true;
      }
    }
    if (!changed) break;
  }

  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of validEdges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const layers = new Map<number, AutoLayoutNode[]>();
  for (const node of nodes) {
    const layer = rank.get(node.id) ?? 0;
    const bucket = layers.get(layer) ?? [];
    bucket.push(node);
    layers.set(layer, bucket);
  }

  const sortedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0]);
  const positions: AutoLayoutPosition[] = [];

  for (const [layer, bucket] of sortedLayers) {
    bucket.sort((a, b) => {
      const degreeDiff = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
      if (degreeDiff !== 0) return degreeDiff;
      const titleA = (a.title ?? a.id).toLowerCase();
      const titleB = (b.title ?? b.id).toLowerCase();
      return titleA.localeCompare(titleB) || a.id.localeCompare(b.id);
    });

    for (let index = 0; index < bucket.length; index += 1) {
      const node = bucket[index];
      const x =
        opts.direction === 'LR'
          ? layer * (opts.nodeWidth + opts.gapX)
          : index * (opts.nodeWidth + opts.gapX);
      const y =
        opts.direction === 'LR'
          ? index * (opts.nodeHeight + opts.gapY)
          : layer * (opts.nodeHeight + opts.gapY);
      positions.push({ id: node.id, x, y });
    }
  }

  // Centraliza cada camada em relação à camada mais alta, para o desenho não
  // ficar com um formato de escada.
  const counts = new Map<number, number>();
  for (const [layer, bucket] of sortedLayers) counts.set(layer, bucket.length);
  const maxCount = Math.max(...counts.values());
  for (const [layer, bucket] of sortedLayers) {
    const offset = (maxCount - bucket.length) / 2;
    if (offset === 0) continue;
    for (const position of positions) {
      const node = byId.get(position.id);
      if (!node) continue;
      if ((rank.get(node.id) ?? 0) !== layer) continue;
      if (opts.direction === 'LR') {
        position.y += offset * (opts.nodeHeight + opts.gapY);
      } else {
        position.x += offset * (opts.nodeWidth + opts.gapX);
      }
    }
  }

  // Normaliza para começar em (0,0). Sem isso, um modelo só com sistemas
  // começaria na camada 1 e a exportação abriria com espaço vazio à esquerda.
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  for (const position of positions) {
    position.x -= minX;
    position.y -= minY;
  }

  return positions;
}

export function hasStoredLayout(nodes: Array<{ position_x?: number | null; position_y?: number | null }>): boolean {
  return nodes.some((node) => (node.position_x ?? 0) !== 0 || (node.position_y ?? 0) !== 0);
}
