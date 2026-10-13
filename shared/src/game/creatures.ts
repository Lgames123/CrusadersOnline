/**
 * The executable's creature template table (.data 0x004ED058, executable-analysis.md §9.1) with
 * models.ctx resolved: per creature type id, its display name, model and texture variant (the
 * appearance word), template weapon and shield (item ids) and cries (sound table 0x004EEA88:
 * impact material 0 bone / 1 flesh / 2-4 other, damage and death Sound.ctx ids). Facts only.
 */
export interface CreatureTemplate {
  name: string;
  /** Converted model (models.ctx file, lower case, no extension). */
  model: string;
  /** Texture variant (models.ctx T line), lower case; null = the model's own. */
  texture: string | null;
  weapon: string | null;
  shield: string | null;
  material: number;
  damageSound: number;
  deathSound: number;
}

export const CREATURE_TEMPLATES: Readonly<Record<number, CreatureTemplate>> = {
  113: { name: "High Guard", model: "male01a", texture: "male01ahighguard", weapon: "long_sword", shield: "metal_shield", material: 1, damageSound: 102, deathSound: 111 },
  114: { name: "Old Guard", model: "male04a", texture: "male04aoldguard", weapon: "long_sword", shield: "metal_shield", material: 1, damageSound: 107, deathSound: 103 },
  116: { name: "Greater Black Knight", model: "male01b", texture: "male01bblackknight", weapon: "broad_sword", shield: "metal_shield", material: 1, damageSound: 208, deathSound: 208 },
  117: { name: "Stocky Male Citizen", model: "male02", texture: "male02citizena", weapon: null, shield: null, material: 1, damageSound: 118, deathSound: 116 },
  118: { name: "Average Male Citizen", model: "male04a", texture: "male04citizena02", weapon: null, shield: null, material: 1, damageSound: 112, deathSound: 117 },
  119: { name: "Thin Male Citizen", model: "male04a", texture: "male04citizena01", weapon: null, shield: null, material: 1, damageSound: 113, deathSound: 115 },
  120: { name: "Thin Female Citizen", model: "skinnylady", texture: "skinnylady", weapon: null, shield: null, material: 1, damageSound: 150, deathSound: 155 },
  121: { name: "Big Female Citizen Red", model: "fatfemale", texture: "fatlady01", weapon: null, shield: null, material: 1, damageSound: 151, deathSound: 154 },
  122: { name: "Hermit Lady", model: "fatfemale", texture: "hermitlady", weapon: null, shield: null, material: 1, damageSound: 150, deathSound: 154 },
  123: { name: "Stoneheart Legionaire", model: "m28_dwarf03average", texture: "dwarf03merchant", weapon: "war_hammer", shield: "metal_shield", material: 1, damageSound: 134, deathSound: 135 },
  124: { name: "Dwarf Ironpick Rebel", model: "m28_dwarf03average", texture: "dwarf03ironpick", weapon: "war_hammer", shield: "metal_shield", material: 1, damageSound: 139, deathSound: 137 },
  125: { name: "Dwarf Ironpick Zealot", model: "m28_dwarf02skinny", texture: "dwarf02zealot", weapon: "battle_axe", shield: "metal_shield", material: 1, damageSound: 133, deathSound: 143 },
  126: { name: "Dwarf Miner", model: "m28_dwarf02skinny", texture: "dwarf02miner", weapon: "pick_axe", shield: null, material: 1, damageSound: 132, deathSound: 141 },
  127: { name: "Dwarf Merchant", model: "m28_dwarf04strong", texture: "dwarf04legionnaire", weapon: null, shield: null, material: 1, damageSound: 138, deathSound: 136 },
  128: { name: "Male Dwarf Citizen", model: "m28_dwarf04strong", texture: null, weapon: null, shield: null, material: 1, damageSound: 132, deathSound: 141 },
  129: { name: "Female Dwarf Citizen A", model: "fdwarf", texture: "fdwarf01", weapon: null, shield: null, material: 1, damageSound: 174, deathSound: 178 },
  130: { name: "Female Dwarf Citizen B", model: "fdwarf", texture: "fdwarf02", weapon: null, shield: null, material: 1, damageSound: 173, deathSound: 176 },
  131: { name: "Ogre Outlaw", model: "male02", texture: "male02ogre", weapon: "battle_axe", shield: null, material: 1, damageSound: 186, deathSound: 190 },
  132: { name: "Dasher Scout", model: "m37tamris", texture: "dasherscout256", weapon: "dasher_hand_bow", shield: null, material: 1, damageSound: 156, deathSound: 159 },
  133: { name: "Dasher Brute", model: "m37tamris", texture: "dasherbrute256", weapon: "dasher_weapon", shield: null, material: 1, damageSound: 158, deathSound: 159 },
  134: { name: "Deceiver", model: "deceiver", texture: "deceiver256", weapon: "mace", shield: null, material: 1, damageSound: 167, deathSound: 165 },
  135: { name: "Ice Titan", model: "male02", texture: "male02icetitan", weapon: "club", shield: null, material: 3, damageSound: 185, deathSound: 189 },
  136: { name: "Ice Elemental", model: "iceelemental", texture: "ice", weapon: null, shield: null, material: 3, damageSound: 204, deathSound: 204 },
  137: { name: "Rock Elemental", model: "iceelemental", texture: "stoneelemental", weapon: null, shield: null, material: 4, damageSound: 204, deathSound: 204 },
  138: { name: "Lava Elemental", model: "iceelemental", texture: "fireelemental", weapon: null, shield: null, material: 4, damageSound: 204, deathSound: 204 },
  139: { name: "Necros Before", model: "necrosbefore", texture: "necrosbef", weapon: null, shield: null, material: 1, damageSound: 130, deathSound: 131 },
  141: { name: "Lich Arch Mage", model: "dark_magecollision", texture: "archmage256", weapon: "morning_star", shield: "metal_shield", material: 0, damageSound: 193, deathSound: 196 },
  142: { name: "Drake Entity", model: "drake", texture: "drake", weapon: "long_sword", shield: null, material: 1, damageSound: 0, deathSound: 103 },
  143: { name: "Dark Mage", model: "dark_magecollision", texture: "darkmage256", weapon: "mace", shield: "metal_shield", material: 1, damageSound: 192, deathSound: 195 },
  144: { name: "Dark Master", model: "dark_mastercollision", texture: "darkmaster256", weapon: "heavy_mace", shield: "metal_shield", material: 1, damageSound: 191, deathSound: 194 },
  145: { name: "Skeleton Warrior", model: "skeletonwarriorcollision", texture: "walking_dead", weapon: "long_sword", shield: "wooden_shield", material: 0, damageSound: 163, deathSound: 164 },
  146: { name: "Skeleton Ghost", model: "skeletonwarriorcollision", texture: "walking_dead_ghost", weapon: "long_sword", shield: "wooden_shield", material: 0, damageSound: 167, deathSound: 171 },
  147: { name: "Shadow", model: "skeletonwarriorcollision", texture: "shadow", weapon: "heavy_mace", shield: "wooden_shield", material: 0, damageSound: 162, deathSound: 170 },
  148: { name: "Dasher Tamris", model: "m37tamris", texture: "dashertamris256", weapon: "dasher_hand_bow", shield: null, material: 1, damageSound: 157, deathSound: 160 },
  149: { name: "Prince Dain", model: "m28_dwarf01dain", texture: "dwarf01dain", weapon: null, shield: null, material: 2, damageSound: 140, deathSound: 142 },
  150: { name: "Necros", model: "necrosaftercollision", texture: "necros_aft", weapon: null, shield: null, material: 0, damageSound: 129, deathSound: 131 },
  151: { name: "Captain Ursan", model: "male01c", texture: "male01acaptainursan", weapon: "long_sword", shield: "metal_shield", material: 2, damageSound: 100, deathSound: 109 },
  152: { name: "Aerin", model: "aerin", texture: "aerin", weapon: null, shield: null, material: 1, damageSound: 150, deathSound: 153 },
  153: { name: "Celestia", model: "celestia", texture: "m33celestia", weapon: null, shield: null, material: 1, damageSound: 126, deathSound: 127 },
  154: { name: "Thin Male Citizen B", model: "male04b", texture: "male04bcitb", weapon: null, shield: null, material: 1, damageSound: 114, deathSound: 122 },
  155: { name: "Spectral Ally", model: "male04b", texture: "male04bghost", weapon: "long_sword", shield: "wooden_shield", material: 1, damageSound: 118, deathSound: 121 },
  156: { name: "Ghost Father", model: "male04b", texture: "male04bghostfather", weapon: null, shield: null, material: 1, damageSound: 118, deathSound: 121 },
  157: { name: "Average Male Citizen B", model: "male01b", texture: "male01bcitizena", weapon: null, shield: null, material: 1, damageSound: 119, deathSound: 123 },
  158: { name: "Big Female Citizen Gold", model: "fatfemale", texture: "fatlady02", weapon: null, shield: null, material: 1, damageSound: 152, deathSound: 153 },
  159: { name: "Big Female Citizen Green", model: "fatfemale", texture: "fatlady03", weapon: null, shield: null, material: 1, damageSound: 151, deathSound: 153 },
  160: { name: "Thin Female Citizen b", model: "skinnylady", texture: "skinnylady02", weapon: null, shield: null, material: 1, damageSound: 150, deathSound: 154 },
  161: { name: "Female Dwarf Citizen C", model: "fdwarf", texture: "fdwarf03", weapon: null, shield: null, material: 1, damageSound: 175, deathSound: 177 },
  162: { name: "Thin Female Citizen c", model: "skinnylady", texture: "skinnylady03", weapon: null, shield: null, material: 1, damageSound: 152, deathSound: 155 },
};

/** Archetype id of a peaceful creature (citizens, guards, merchants) of this type. */
export const npcArchetypeId = (type: number): string => `npc_${type}`;

/**
 * Voice role of a peaceful creature type: the <role> part of its Sound.ctx dialogue files
 * (townsman TM, townswoman TF, High / Old Guard HG / OG, dwarf male / female DM / DF, dasher DU).
 * Named characters (Aerin, Celestia, Tamris, Prince Dain...) speak in their sequences instead.
 */
export const NPC_VOICES: Readonly<Record<number, string>> = {
  113: 'hg', 114: 'og',
  117: 'tm', 118: 'tm', 119: 'tm', 154: 'tm', 157: 'tm',
  120: 'tf', 121: 'tf', 122: 'tf', 158: 'tf', 159: 'tf', 160: 'tf', 162: 'tf',
  123: 'dm', 126: 'dm', 127: 'dm', 128: 'dm',
  129: 'df', 130: 'df', 161: 'df',
  132: 'du', 133: 'du',
};
