import type { C4ModelType } from '../services/types';

/** Rótulos curtos usados em selects e etiquetas de diagrama. */
export const C4_TYPE_LABEL: Record<C4ModelType, string> = {
  'system-context': 'Contexto do sistema',
  container: 'Container',
  component: 'Componente',
  code: 'Código',
  'system-landscape': 'System landscape',
  dynamic: 'Dinâmico',
  deployment: 'Implantação',
};

/** Texto de ajuda exibido ao escolher o tipo de diagrama. */
export const C4_TYPE_HELP: Record<C4ModelType, string> = {
  'system-context': 'Um software system em foco, com pessoas e sistemas externos.',
  container: 'Apps, serviços e data stores que compõem um software system.',
  component: 'Componentes dentro de um container específico.',
  code: 'Classes, interfaces e tabelas de um componente (use sob demanda).',
  'system-landscape': 'People e software systems de uma organização/empresa.',
  dynamic: 'Interações em runtime para uma feature ou caso de uso.',
  deployment: 'Instâncias de systems/containers em um ambiente de deployment.',
};
