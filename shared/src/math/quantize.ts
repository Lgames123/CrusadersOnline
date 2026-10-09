const TWO_PI = Math.PI * 2;

/** Radians -> uint16 (wraps). */
export function quantizeAngle(rad: number): number {
  const turns = rad / TWO_PI;
  return Math.round((turns - Math.floor(turns)) * 65536) & 0xffff;
}

/** uint16 -> radians in [0, 2π). */
export function dequantizeAngle(q: number): number {
  return (q / 65536) * TWO_PI;
}

/** Pitch is stored as a signed angle in [-π, π) mapped onto uint16. */
export function quantizePitch(rad: number): number {
  return quantizeAngle(rad);
}

export function dequantizePitch(q: number): number {
  const a = dequantizeAngle(q);
  return a >= Math.PI ? a - TWO_PI : a;
}

/** Metres -> int32 millimetres. */
export function quantizePosition(m: number): number {
  return Math.round(m * 1000) | 0;
}

export function dequantizePosition(mm: number): number {
  return mm / 1000;
}
