export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function copyVec3(out: Vec3, v: Readonly<Vec3>): Vec3 {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
  return out;
}

export function distanceXZ(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
