import * as THREE from 'three';
import * as Inventory from './inventory.js';
import * as Player from './player.js';
import * as Stats from './stats.js';
import * as Progression from './progression.js';

const ATTACK_RANGE = 2.8;
const ATTACK_ARC = Math.cos(Math.PI / 3); // 正面±60度以内
const ATTACK_COOLDOWN = 0.45;

let cooldown = 0;

// 1回のヒットごとにドロップする内容
function rollDrops(type, sizeScale = 1.0) {
  const sc = sizeScale;
  const mul = (base) => Math.max(1, Math.round(base * sc));
  if (type === 'wood') {
    return [
      { id: 'wood',  qty: mul(2 + Math.floor(Math.random() * 3)) },  // 2〜4
      { id: 'straw', qty: Math.max(1, Math.round((1 + Math.floor(Math.random() * 2)) * sc)) },
    ];
  }
  if (type === 'iron_rock') {
    return [
      { id: 'stone',    qty: mul(1 + Math.floor(Math.random() * 2)) },
      { id: 'iron_ore', qty: mul(1 + Math.floor(Math.random() * 2)) },
    ];
  }
  if (type === 'copper_rock') {
    return [
      { id: 'stone',      qty: mul(1 + Math.floor(Math.random() * 2)) },
      { id: 'copper_ore', qty: mul(1 + Math.floor(Math.random() * 2)) },
    ];
  }
  if (type === 'coal_rock') {
    const drops = [{ id: 'coal', qty: mul(2 + Math.floor(Math.random() * 3)) }];
    if (Math.random() < 0.25) drops.push({ id: 'flint', qty: 1 });
    return drops;
  }
  if (type === 'flint_rock') {
    const drops = [{ id: 'flint', qty: mul(1 + Math.floor(Math.random() * 2)) }];
    if (Math.random() < 0.3) drops.push({ id: 'stone', qty: 1 });
    return drops;
  }
  if (type === 'mushroom') return [{ id: 'mushroom', qty: 1 }];
  if (type === 'toxic_mushroom') return [{ id: 'toxic_mushroom', qty: 1 }];
  if (type === 'anesthetic_mushroom') return [{ id: 'anesthetic_mushroom', qty: 1 }];
  if (type === 'medicine_mushroom') return [{ id: 'medicine_mushroom', qty: 1 }];
  if (type === 'grass') return [{ id: 'straw', qty: 1 + Math.floor(Math.random() * 2) }];
  // generic stone
  const drops = [{ id: 'stone', qty: mul(2 + Math.floor(Math.random() * 3)) }];
  if (Math.random() < 0.12) drops.push({ id: 'flint', qty: 1 });
  return drops;
}

export function update(delta, attackPressed, playerPos, world, enemies) {
  if (cooldown > 0) cooldown -= delta;
  if (!attackPressed || cooldown > 0 || Inventory.isOpen() || Stats.isDead()) return;
  if (!Stats.tryAttack()) { Inventory.showPickup('スタミナが足りない！'); return; }

  Player.triggerAttack();

  const facing = Player.getFacing();
  const fx = Math.sin(facing);
  const fz = Math.cos(facing);

  const inArc = (obj) => {
    const dx = obj.position.x - playerPos.x;
    const dz = obj.position.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > ATTACK_RANGE || dist < 1e-4) return -1;
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    return dot < ATTACK_ARC ? -1 : dist;
  };

  let bestWolf = null, bestNode = null, bestFish = null;
  let bestDist = Infinity;

  if (enemies) {
    for (const enemy of enemies.getEnemies()) {
      const d = inArc(enemy);
      if (d >= 0 && d < bestDist) { bestDist = d; bestWolf = enemy; bestNode = null; bestFish = null; }
    }
  }
  for (const node of world.getResourceNodes()) {
    const d = inArc(node);
    if (d >= 0 && d < bestDist) { bestDist = d; bestNode = node; bestWolf = null; bestFish = null; }
  }
  const fishList = world._fish || [];
  for (const fish of fishList) {
    if (!fish.alive) continue;
    const d = inArc(fish);
    if (d >= 0 && d < bestDist) { bestDist = d; bestFish = fish; bestWolf = null; bestNode = null; }
  }

  const equipped = Inventory.getEquipped();
  const equippedItem = equipped ? Inventory.ITEMS[equipped] : null;
  const attackBonus = equippedItem?.attackBonus || 0;

  if (bestFish) {
    cooldown = ATTACK_COOLDOWN;
    world._catchFish?.(bestFish);
    return;
  }

  if (bestWolf) {
    cooldown = ATTACK_COOLDOWN;
    enemies.damageEnemy(bestWolf, (Progression.getAttack?.() || 1) + attackBonus);
    return;
  }

  if (!bestNode) { cooldown = ATTACK_COOLDOWN; return; }

  const nodeType = bestNode.type;
  const isTree = nodeType === 'wood';
  const isRock = ['stone','iron_rock','copper_rock','coal_rock','flint_rock'].includes(nodeType);
  let dmg = 1, cdMult = 1.0;
  const isBarehanded = !equippedItem?.tool;
  if (equippedItem?.tool) {
    if (equippedItem.category === 'tree' && isTree) {
      dmg = equippedItem.gatherMult || 2; cdMult = 0.38;
    } else if (equippedItem.category === 'rock' && isRock) {
      dmg = equippedItem.gatherMult || 2; cdMult = 0.38;
    } else {
      cdMult = 0.72;
    }
  }
  // 素手で木や岩を採取すると小ダメージ
  if (isBarehanded && (isTree || isRock)) {
    Stats.damage(1);
    Inventory.showPickup('✋ 素手での採取は痛い！');
  }
  cooldown = ATTACK_COOLDOWN * cdMult;

  world.damageNode(bestNode, dmg);

  // 破壊前後にかかわらず毎ヒットでドロップ
  const drops = rollDrops(nodeType, bestNode.sizeScale || 1.0);
  const parts = [];
  for (const d of drops) {
    Inventory.add(d.id, d.qty);
    parts.push(`${Inventory.ITEMS[d.id].icon} ${Inventory.ITEMS[d.id].name} ×${d.qty}`);
  }
  Inventory.showPickup(`入手: ${parts.join('  ')}`);
}
