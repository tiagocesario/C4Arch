/** Feature flags da Onda 1 usadas pelo serviço realtime. */
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
  realtimePgState: parseFlagMode('REALTIME_PG_STATE', process.env.REALTIME_PG_STATE),
};

export function describeFlags(): Record<string, FlagMode> {
  return { REALTIME_PG_STATE: flags.realtimePgState };
}
