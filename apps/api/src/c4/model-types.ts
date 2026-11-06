/**
 * Tipos de diagrama do C4 model suportados pelo C4Arch.
 * Fonte: skill `.opencode/skills/c4-model` e <https://c4model.com/diagrams>.
 */
export const C4_MODEL_TYPES = [
  'system-context',
  'container',
  'component',
  'code',
  'system-landscape',
  'dynamic',
  'deployment',
] as const;

export type C4ModelType = (typeof C4_MODEL_TYPES)[number];

export const DEFAULT_C4_MODEL_TYPE: C4ModelType = 'container';

export function isC4ModelType(value: unknown): value is C4ModelType {
  return (
    typeof value === 'string' &&
    (C4_MODEL_TYPES as readonly string[]).includes(value)
  );
}

export const C4_MODEL_TYPE_LABEL: Record<C4ModelType, string> = {
  'system-context': 'Contexto do sistema',
  container: 'Container',
  component: 'Componente',
  code: 'Código',
  'system-landscape': 'System landscape',
  dynamic: 'Dinâmico',
  deployment: 'Implantação',
};
