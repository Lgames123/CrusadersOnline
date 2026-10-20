/**
 * Where each armour body texture is painted as armour, for the refined-armour glow: rectangles in
 * texture space, in sixteenths of the texture (0-16, y down: the body textures load flipY = false).
 * A triangle glows when its UV centre lies in one, so whole UV islands light up with no seams;
 * the rest (Drake's skin, his blue cloth, the head) does not. Authored by eye from the textures
 * over each model's UV islands; both armour models (drake02armor, drakearmor05fixed) lay their
 * islands out alike. Neck triangles sit in the face's rows (y < 6.4) and stay unlit.
 */
type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

const CHEST: Rect = [0, 6.5, 10.4, 10.6];
const TORSO: Rect = [0, 10.6, 10.4, 16];
/**
 * The chest piece's shoulder edge (clavicle triangles), laid out along the top of the upper arms'
 * block: near-black there, shown as the plate's rim over each armpit.
 */
const SHOULDERS: Rect = [10.4, 6.5, 13.3, 7.5];
/** Upper arms (x < 13.2), thighs. */
const UPPER_LIMBS: Rect = [10.4, 6.5, 16, 12];
/** Forearm guards (x < 13.2), boots' shafts. */
const LOWER_LIMBS: Rect = [10.4, 12, 16, 16];
/** The strip of the forearms laid out along the texture's top right corner. */
const WRISTS: Rect = [12.4, 0, 16, 1.8];
const ELBOW_PADS: Rect = [10.1, 0, 12.4, 2.1];
const ARM_STRIP: Rect = [8.7, 3.6, 10.1, 6.4];
const HANDS: Rect = [10.1, 3.6, 12.6, 6.4];
const FEET: Rect = [12.4, 1.8, 16, 6.4];
/** Every part but the head (face, hair, neck, ear, mouth). */
const FULL: readonly Rect[] = [CHEST, TORSO, UPPER_LIMBS, LOWER_LIMBS, WRISTS, ELBOW_PADS, ARM_STRIP, HANDS, FEET];

const COVERAGE: Readonly<Record<string, readonly Rect[]>> = {
  // Scale Armor: leather chest piece, scale shirt and skirt, forearm guards, elbow pads, boots;
  // bare upper arms, blue trousers.
  drake02armor2: [CHEST, SHOULDERS, TORSO, LOWER_LIMBS, WRISTS, ELBOW_PADS, FEET],
  // Banded Armor: plates on the torso, bracers, greaves; the sleeves and thighs are cloth padding.
  drake02armor3: [CHEST, SHOULDERS, TORSO, LOWER_LIMBS, WRISTS, ELBOW_PADS],
  // Light Plate Mail: plate head to toe.
  drake02armor4: FULL,
  // Dragon Scale Armor: scales head to toe, and a scaled collar painted on the neck.
  drake02armor5: [...FULL, [0, 4.6, 8.7, 6.4]],
  // Heavy Plate Mail (drakearmor05fixed).
  drake05armor5: FULL,
};

/**
 * Whether the point (u, v) of an armour body texture (0-1, as in the geometry) is armour, or
 * null when that texture has no entry.
 */
export function armorCoverage(texture: string): ((u: number, v: number) => boolean) | null {
  const rects = COVERAGE[texture];
  if (!rects) return null;
  // Inclusive bounds: islands touching the texture's edge (v = 1) count.
  return (u, v) => rects.some(([x0, y0, x1, y1]) => u * 16 >= x0 && u * 16 <= x1 && v * 16 >= y0 && v * 16 <= y1);
}
