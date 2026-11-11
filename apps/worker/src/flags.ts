/** Feature flags da Onda 1 usadas pelo worker. */
export const FLAG_MODES = ['off', 'shadow', 'on'] as const;
export type FlagMode = (typeof FLAG_MODES)[number];

export function parseFlagMode(
  name: string,
  raw: string | undefined,
  fallback: FlagMode = 'off'
): FlagMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return fallback;
  if ((FLAG_MODES as readonly string[]).includes(value)) return value as FlagMode;
  console.warn(
    `[flags] ${name}="${raw}" inválido; usando "${fallback}" (valores aceitos: off|shadow|on).`
  );
  return fallback;
}

export const flags = {
  versionHash: parseFlagMode('VERSION_HASH', process.env.VERSION_HASH),
  projectorShadow: parseFlagMode('PROJECTOR_SHADOW', process.env.PROJECTOR_SHADOW),
};

export function describeFlags(): Record<string, FlagMode> {
  return {
    VERSION_HASH: flags.versionHash,
    PROJECTOR_SHADOW: flags.projectorShadow,
  };
}
