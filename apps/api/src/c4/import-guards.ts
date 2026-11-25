export type PlantUmlImportMode = 'replace' | 'merge';

export interface PlantUmlImportGuardInput {
  /** Elementos reconhecidos no diagrama. */
  elements: readonly unknown[];
  /** Relações que o parser não conseguiu interpretar. */
  unrecognizedRelationships?: readonly string[];
  /** `replace` substitui o conteúdo atual; `merge` preserva os elementos existentes. */
  mode: PlantUmlImportMode;
  /** Indica se a importação ocorre em um modelo já existente. */
  hasExistingModel: boolean;
}

export interface PlantUmlImportGuardResult {
  ok: boolean;
  error?: string;
}

/**
 * Valida se uma importação PlantUML pode ser aplicada sem perder dados.
 *
 * Uma relação não interpretada torna o resultado parcial e sempre cancela a
 * importação. Um diagrama vazio só é aceito na criação de um novo modelo: em
 * um modelo existente, `replace` apagaria todo o conteúdo sem que o diagrama
 * pudesse reconstruí-lo.
 */
export function validatePlantUmlImport(
  input: PlantUmlImportGuardInput
): PlantUmlImportGuardResult {
  const unrecognizedCount = input.unrecognizedRelationships?.length ?? 0;
  if (unrecognizedCount > 0) {
    return {
      ok: false,
      error:
        `Foram encontradas ${unrecognizedCount} relações PlantUML não suportadas. ` +
        'A importação foi cancelada para não persistir um diagrama incompleto. ' +
        (input.hasExistingModel
          ? 'O modelo atual não foi alterado.'
          : 'Nenhum conteúdo foi alterado.'),
    };
  }

  if (
    input.hasExistingModel &&
    input.mode === 'replace' &&
    input.elements.length === 0
  ) {
    return {
      ok: false,
      error:
        'Nenhum elemento C4 foi reconhecido no código PlantUML. ' +
        'Use as macros C4 (Person, System, Container, Component) ou declarações ' +
        'PlantUML com alias (actor, rectangle, component, node...). ' +
        'O modelo atual não foi alterado.',
    };
  }

  return { ok: true };
}
