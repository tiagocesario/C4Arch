/**
 * Feature flags da Onda 1 no frontend.
 *
 * São resolvidas em tempo de build pelo Vite (`VITE_*`). O padrão é `off`,
 * então a UI atual continua igual até a flag ser ligada.
 */
export const FLAG_MODES = ['off', 'shadow', 'on'] as const;
export type FlagMode = (typeof FLAG_MODES)[number];

export function parseFlagMode(name: string, raw: string | undefined, fallback: FlagMode = 'off'): FlagMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if ((FLAG_MODES as readonly string[]).includes(value)) return value as FlagMode;
  console.warn(
    `[flags] ${name}="${raw}" inválido; usando "${fallback}" (valores aceitos: off|shadow|on).`
  );
  return fallback;
}

export const flags = {
  canonicalViews: parseFlagMode('VITE_CANONICAL_VIEWS', import.meta.env.VITE_CANONICAL_VIEWS),
  dasOverrides: parseFlagMode('VITE_DAS_OVERRIDES', import.meta.env.VITE_DAS_OVERRIDES),
  versionHash: parseFlagMode('VITE_VERSION_HASH', import.meta.env.VITE_VERSION_HASH),
};

export function describeFlags(): Record<string, FlagMode> {
  return {
    VITE_CANONICAL_VIEWS: flags.canonicalViews,
    VITE_DAS_OVERRIDES: flags.dasOverrides,
    VITE_VERSION_HASH: flags.versionHash,
  };
}
