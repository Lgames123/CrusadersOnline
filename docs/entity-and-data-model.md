# Entity and Data Model: Schemas, Types & Data Structures

## 1. Objective

Define the unified data models used across the server, client, and shared protocols for characters, items, enemies, and world entities.

---

## 2. Core TypeScript Interfaces (`shared/src/types/`)

### 2.1 Entity Identifiers
```typescript
export type EntityId = number;
export type AccountId = string;
export type CharacterId = string;

export enum EntityType {
  PLAYER = 1,
  MONSTER = 2,
  NPC = 3,
  PROJECTILE = 4,
  ITEM_DROP = 5,
  TRIGGER_ZONE = 6
}
```

### 2.2 Character Attributes & State
```typescript
export interface CharacterAttributes {
  might: number;        // Physical attack power
  intelligence: number; // Mana pool & spell damage
  endurance: number;    // Health pool & physical resistance
  speed: number;        // Movement speed & attack recovery
}

export interface EntityTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface CharacterState {
  id: CharacterId;
  entityId: EntityId;
  name: string;
  level: number;
  xp: number;
  currentHp: number;
  maxHp: number;
  currentMana: number;
  maxMana: number;
  attributes: CharacterAttributes;
  transform: EntityTransform;
}
```

### 2.3 Item & Inventory Model
```typescript
export enum ItemType {
  WEAPON_1H = 'WEAPON_1H',
  WEAPON_2H = 'WEAPON_2H',
  SHIELD = 'SHIELD',
  HELMET = 'HELMET',
  CHEST = 'CHEST',
  LEGS = 'LEGS',
  POTION = 'POTION',
  QUEST = 'QUEST'
}

export interface ItemDefinition {
  id: string;
  name: string;
  type: ItemType;
  baseDamage?: number;
  damageType?: 'SLASH' | 'BASH' | 'FIRE';
  armorBonus?: number;
  statBonuses?: Partial<CharacterAttributes>;
  valueGold: number;
}

export interface InventorySlot {
  slotIndex: number;
  item: ItemDefinition;
  quantity: number;
}
```

---

## 3. Network Packet Snapshot Model

```typescript
export interface EntitySnapshot {
  entityId: EntityId;
  type: EntityType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  animState: number; // 0=IDLE, 1=WALK, 2=RUN, 3=ATTACK_1, 4=HURT, 5=DEAD
  currentHp: number;
  maxHp: number;
}

export interface WorldSnapshotPacket {
  tick: number;
  serverTime: number;
  entities: EntitySnapshot[];
}
```
