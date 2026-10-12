import { describe, expect, it } from 'vitest';
import { parseEffectsStg } from '@crusaders/converter';

// Synthetic sample in the effects.stg syntax (no original data).
const SAMPLE = `
# comment
BEGIN SHAPE CHIP_1          # a chip
    SET numpolys 2
    SPRITE
    texture Chip00
    OUTER     255 255 255    200
    CENTER    250 240 230    180
    INNER     255 255 255    255
END

BEGIN FLASH CHIP_1
    ROTATING_SHAPE CHIP_1
	 SET StartHeight 6
	 SET DeltaHeight 0
         SET HeightAcceleration -5
	 SET StartWidth 4
         SET rotationspeed 3
         SET Attack .1
         SET Sustain 1
         SET Decay .5
    MOVE    2 1 -2   # x y z
    GRAVITY  0  -1  0
    RANDOMIZE_SIZE  5
    RANDOMIZE_MOVE  1  .5 1
    SPAWN_MULTI TRAIL  .04
    SPAWN_LEVEL 2
END

BEGIN MULTI	CHIPS	   0
 ADD FLASH    CHIP_1    0 # first
 ADD FLASH    CHIP_1    .25
END
BEGIN MULTI	CHIPS	   1
 ADD FLASH    CHIP_1    0
END
`;

describe('effects.stg parser', () => {
  it('reads shapes, flashes and named effects with their variants and delays', () => {
    const t = parseEffectsStg(SAMPLE);
    expect(t.shapes['CHIP_1']).toMatchObject({ texture: 'chip00', center: [250, 240, 230, 180], sphere: false });
    expect(t.flashes['CHIP_1']).toMatchObject({
      shape: 'CHIP_1', rotating: true, startHeight: 6, heightAcceleration: -5, startWidth: 4, rotationSpeed: 3,
      attack: 0.1, sustain: 1, decay: 0.5, move: [2, 1, -2], gravity: [0, -1, 0], randomizeSize: 5, randomizeMove: [1, 0.5, 1],
      spawnMulti: { name: 'TRAIL', interval: 0.04, level: 2 },
    });
    expect(t.multis['CHIPS']).toEqual({ 0: [['CHIP_1', 0], ['CHIP_1', 0.25]], 1: [['CHIP_1', 0]] });
  });
});
