import { BUILTIN_SPELLS } from '@crusaders/shared';

/**
 * Torch Light spell: a white light around the caster (radius from default.ctx S0, in feet). The
 * update 0x004BAE60 adds a light every frame with all three colour components value1 x 25
 * (0x0044BEA0 passes one value as r, g and b): white, never tinted.
 */
export const TORCH_LIGHT_COLOR = 0xffffff;
export const TORCH_LIGHT_INTENSITY = 6;
/** Enhanced lighting: the share of a surface's texture colour the torch adds at its centre. */
export const TORCH_DYNAMIC_INTENSITY = 1.4;
/** Above the feet, around head height. */
export const TORCH_LIGHT_HEIGHT = 2;

/** Light radius (metres) of a Torch Light level (1-3). */
export function torchRadius(level: number): number {
  const row = BUILTIN_SPELLS.torch_light?.[Math.min(3, Math.max(1, level)) - 1];
  return (row?.value1 ?? 15) * 0.3048;
}
