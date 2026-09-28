// 灰盒演示用的敌人与嵌片布局；正式内容待九战敌人设计定稿后替换。
import type { EnemyDef, InstalledInsert, PlayerState } from '../engine';

export const DEMO_ENEMY: EnemyDef = {
  id: 'crystal-mole',
  name: '晶背鼹鼠',
  maxHp: 80,
  fallbackDefend: 4,
  script: [
    { parts: [{ kind: 'attack', amount: 6 }] },
    { parts: [{ kind: 'charge', amount: 5 }] },
    { parts: [{ kind: 'attack', amount: 6 }] },
    { parts: [{ kind: 'attack', amount: 4 }, { kind: 'defend', amount: 4 }] },
    { parts: [{ kind: 'attack', amount: 8 }] },
  ],
};

export const DEMO_PLAYER: PlayerState = { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 };

const cells = (...rc: [number, number][]) => rc.map(([r, c]) => ({ r, c }));

export const DEMO_INSERTS: InstalledInsert[] = [
  { id: 'i1', type: 'blade', cells: cells([5, 1], [6, 0], [6, 1], [6, 2]) }, // T
  { id: 'i2', type: 'blastPowder', cells: cells([2, 5], [2, 6], [3, 5], [3, 6]) }, // O
  { id: 'i3', type: 'flammable', cells: cells([7, 3], [7, 4], [7, 5], [7, 6]) }, // I
  { id: 'i4', type: 'emberClay', cells: cells([0, 1], [1, 1], [2, 1], [2, 2]) }, // L
];
