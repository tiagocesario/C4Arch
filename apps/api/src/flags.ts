/**
 * Feature flags da Onda 1.
 *
 * Todas as flags aceitam `off`, `shadow` ou `on`. O valor padrão é `off`, para
 * que a introdução das flags não mude o comportamento atual.
 *
 * - `off`: caminho legado.
 * - `shadow`: executa o caminho novo em paralelo, sem servir a resposta.
 * - `on`: caminho novo é a fonte da resposta.
 */
export const FLAG_MODES = ['off', 'shadow', 'on'] as const;

export type FlagMode = (typeof FLAG_MODES)[number];

export type FlagEnv = Record<string, string | undefined>;

export interface Flags {
  canonicalModel: FlagMode;
  canonicalViews: FlagMode;
  dasOverrides: FlagMode;
  versionHash: FlagMode;
  realtimePgState: FlagMode;
  projectorShadow: FlagMode;
}

const DEFAULTS: Record<keyof Flags, FlagMode> = {
  canonicalModel: 'off',
  canonicalViews: 'off',
  dasOverrides: 'off',
  versionHash: 'off',
  realtimePgState: 'off',
  projectorShadow: 'off',
};

const ENV_NAMES: Record<keyof Flags, string> = {
  canonicalModel: 'CANONICAL_MODEL',
  canonicalViews: 'CANONICAL_VIEWS',
  dasOverrides: 'DAS_OVERRIDES',
  versionHash: 'VERSION_HASH',
  realtimePgState: 'REALTIME_PG_STATE',
  projectorShadow: 'PROJECTOR_SHADOW',
};

export function parseFlagMode(
  name: string,
  raw: string | undefined,
  fallback: FlagMode = 'off'
): FlagMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if ((FLAG_MODES as readonly string[]).includes(value)) {
    return value as FlagMode;
  }
  console.warn(
    `[flags] ${name}="${raw}" inválido; usando "${fallback}" (valores aceitos: off|shadow|on).`
  );
  return fallback;
}

export function readFlags(env: FlagEnv = process.env): Flags {
  return {
    canonicalModel: parseFlagMode(ENV_NAMES.canonicalModel, env.CANONICAL_MODEL, DEFAULTS.canonicalModel),
    canonicalViews: parseFlagMode(ENV_NAMES.canonicalViews, env.CANONICAL_VIEWS, DEFAULTS.canonicalViews),
    dasOverrides: parseFlagMode(ENV_NAMES.dasOverrides, env.DAS_OVERRIDES, DEFAULTS.dasOverrides),
    versionHash: parseFlagMode(ENV_NAMES.versionHash, env.VERSION_HASH, DEFAULTS.versionHash),
    realtimePgState: parseFlagMode(ENV_NAMES.realtimePgState, env.REALTIME_PG_STATE, DEFAULTS.realtimePgState),
    projectorShadow: parseFlagMode(ENV_NAMES.projectorShadow, env.PROJECTOR_SHADOW, DEFAULTS.projectorShadow),
  };
}

export const flags = readFlags();

/** Formato estável para log de startup e diagnóstico. */
export function describeFlags(value: Flags = flags): Record<string, FlagMode> {
  return {
    CANONICAL_MODEL: value.canonicalModel,
    CANONICAL_VIEWS: value.canonicalViews,
    DAS_OVERRIDES: value.dasOverrides,
    VERSION_HASH: value.versionHash,
    REALTIME_PG_STATE: value.realtimePgState,
    PROJECTOR_SHADOW: value.projectorShadow,
  };
}
