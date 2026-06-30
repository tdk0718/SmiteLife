import * as Stats from './stats.js';
import { applySlowEffect } from './stats.js';

// アイテム定義
//   edible: 食べられる（hunger/hp 効果）
//   tool:   装備できる道具。category と一致する採取で効果UP、attackBonus で攻撃力UP
export const ITEMS = {
  // 素材
  wood:       { name: '木材',   icon: '🪵' },
  straw:      { name: '藁',     icon: '🌾' },
  stone:      { name: '石',     icon: '🪨' },
  flint:      { name: '火打石', icon: '🔺' },
  iron_ore:   { name: '鉄鉱石', icon: '⚙️' },
  copper_ore: { name: '銅鉱石', icon: '🟠' },
  coal:       { name: '石炭',   icon: '⚫' },
  // 食料
  meat:       { name: '生肉',   icon: '🍖', edible: true, hunger: 25, hp: -5,
                desc: '空腹+25 / 体力-5' },
  // 道具
  stone_axe:     { name: '石斧',       icon: '🪓', tool: true, category: 'tree', gatherMult: 2, attackBonus: 1,
                   desc: '木の採取が2倍 / 攻撃+1' },
  stone_pickaxe: { name: '石のツルハシ', icon: '⛏️', tool: true, category: 'rock', gatherMult: 2, attackBonus: 1,
                   desc: '岩の採取が2倍 / 攻撃+1' },
  stone_knife:   { name: '石ナイフ',   icon: '🔪', tool: true, category: null, gatherMult: 1, attackBonus: 2,
                   desc: '攻撃+2' },
  fire_starter:  { name: '火打ち道具', icon: '🔥', tool: true, category: null, gatherMult: 1, attackBonus: 0,
                   desc: '火を起こす道具' },
  torch:         { name: '松明',       icon: '🕯️', tool: true, category: null, gatherMult: 1, attackBonus: 0,
                   desc: '暗がりを照らす' },
  bow:           { name: '弓',         icon: '🏹', tool: true, category: null, gatherMult: 1, attackBonus: 0,
                   ranged: true, desc: '矢があれば遠距離攻撃できる（F キーで発射）' },
  arrow:         { name: '矢',         icon: '🪃', desc: '石と木で作る矢。弓で使用（1本ずつ消費）' },
  // 料理
  cooked_meat:   { name: '焼き肉',     icon: '🍗', edible: true, hunger: 40, hp: 8,
                   desc: '空腹+40 / 体力+8' },
  // 素材（追加）
  fur:           { name: '毛皮',       icon: '🦺' },
  stone_block:   { name: '石ブロック', icon: '🧱' },
  raw_fish:      { name: '生魚',       icon: '🐟', edible: true, hunger: 15, hp: -2,  desc: '空腹+15 / 体力-2 (焼くと良い)' },
  cooked_fish:   { name: '焼き魚',     icon: '🍣', edible: true, hunger: 30, hp: 6,   desc: '空腹+30 / 体力+6' },
  mushroom:           { name: '食用キノコ', icon: '🍄', edible: true, hunger: 12, hp: 3,   desc: '空腹+12 / 体力+3' },
  toxic_mushroom:     { name: '毒キノコ',   icon: '🍄', edible: true, hunger: 8,  hp: -18, desc: '空腹+8 / 体力-18 (危険!)' },
  anesthetic_mushroom:{ name: '麻酔キノコ', icon: '🍄', edible: true, hunger: 10, hp: -3,  slow: true, desc: '空腹+10 / 体力-3 / 15秒間動きが鈍くなる' },
  medicine_mushroom:  { name: '薬キノコ',   icon: '🍄', edible: true, hunger: 5,  hp: 22,  desc: '空腹+5 / 体力+22 (強力な回復)' },
  // 加工素材
  straw_rope:    { name: '藁ロープ',   icon: '🪢' },
  plank:         { name: '板材',       icon: '🪵', desc: '加工された木材（斧かナイフが必要）' },
  wooden_fence:  { name: '木の柵',     icon: '🪵', desc: '藁ロープと板材で作る柵' },
  // 建築素材
  pillar:        { name: '木の柱',     icon: '🪵', desc: '積み重ねられる木の柱' },
  wall_panel:    { name: '木の壁材',   icon: '🪵', desc: '縦横に接続できる木製壁（1m×1.2m）' },
  roof_panel:    { name: '屋根材',     icon: '🏠', desc: '斜めに張る屋根パネル（縦横に接続可）' },
  door:            { name: 'ドア',           icon: '🚪', desc: 'ドア枠付き壁に取り付けるドア' },
  door_frame_wall: { name: 'ドア枠付き壁',   icon: '🚪', desc: 'ドアを取り付けられる壁（1m×1.2m）' },
  floor_board:     { name: '床材',           icon: '🪵', desc: '床に敷く板' },
  workbench:       { name: '作業台',         icon: '🪚', desc: '木材で作った作業台。クラフトに使う' },
  bed:             { name: 'ベッド',         icon: '🛏️', desc: '藁と木材で作るベッド。近くで休憩、複数でワープ可能' },
};

const counts = {};
let open = false;
let equipped = null;
let equipChangeHandler = null;
let onPlaceItem = null;
export function setOnPlaceItem(fn) { onPlaceItem = fn; }

let hudEl, panelEl, gridEl, toastEl, toastTimer = null;

export function init() {
  hudEl   = document.getElementById('inv-hud');
  panelEl = document.getElementById('inventory-panel');
  gridEl  = document.getElementById('inventory-grid');
  toastEl = document.getElementById('pickup-toast');

  if (gridEl) {
    gridEl.addEventListener('click', (e) => {
      const placeBtn = e.target.closest('.inv-place-btn');
      if (placeBtn && placeBtn.dataset.id) {
        onPlaceItem?.(placeBtn.dataset.id);
        return;
      }
      const slot = e.target.closest('.inv-slot');
      if (slot && slot.dataset.id) use(slot.dataset.id);
    });
  }
  render();
}

// --- 所持数操作 ---
export function add(id, qty = 1) {
  if (!ITEMS[id]) return;
  counts[id] = (counts[id] || 0) + qty;
  render();
}
export function count(id) { return counts[id] || 0; }
export function has(id, qty = 1) { return (counts[id] || 0) >= qty; }
export function remove(id, qty = 1) {
  if (!has(id, qty)) return false;
  counts[id] -= qty;
  if (counts[id] <= 0 && equipped === id) setEquipped(null);
  render();
  return true;
}

// --- 装備 ---
export function getEquipped() { return equipped; }
export function setEquipChangeHandler(fn) { equipChangeHandler = fn; }
function setEquipped(id) {
  equipped = id;
  if (equipChangeHandler) equipChangeHandler(equipped);
}
export function equip(id) {
  const item = ITEMS[id];
  if (!item || !item.tool || (counts[id] || 0) <= 0) return;
  setEquipped(equipped === id ? null : id);
  showPickup(equipped ? `${item.icon} ${item.name} を装備` : '装備を外した');
  render();
}

// スロットクリック: 食べ物は食べる / 道具は装備
function use(id) {
  const item = ITEMS[id];
  if (!item) return;
  if (item.edible) { consume(id); return; }
  if (item.tool) { equip(id); return; }
}

// 食べる
export function consume(id) {
  const item = ITEMS[id];
  if (!item || !item.edible || (counts[id] || 0) <= 0 || Stats.isDead()) return false;
  counts[id] -= 1;
  Stats.eat(item.hunger || 0, item.hp || 0);
  if (item.slow) applySlowEffect(15);
  let msg = `${item.icon} ${item.name} を食べた`;
  if (item.hp < 0) msg += `（体力 ${item.hp}）`;
  showPickup(msg);
  render();
  return true;
}

export function consumeFirstEdible() {
  for (const id of Object.keys(ITEMS)) {
    if (ITEMS[id].edible && (counts[id] || 0) > 0) return consume(id);
  }
  showPickup('食べられる物がない');
  return false;
}

// --- 表示 ---
export function toggle() {
  open = !open;
  if (panelEl) panelEl.style.display = open ? 'flex' : 'none';
}
export function isOpen() { return open; }

export function showPickup(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1500);
}

export function refresh() { render(); }

function render() {
  if (hudEl) {
    const owned = Object.keys(counts).filter((id) => counts[id] > 0);
    hudEl.innerHTML = owned.length
      ? owned.map((id) => `<span>${ITEMS[id].icon} ${counts[id]}</span>`).join('')
      : '<span class="empty">アイテムなし</span>';
  }

  if (gridEl) {
    const owned = Object.keys(counts).filter((id) => counts[id] > 0);
    if (!owned.length) {
      gridEl.innerHTML = '<div class="inv-empty">まだアイテムがありません。<br>木や岩を F キーで採取して集めましょう。</div>';
      return;
    }
    // placeable IDs (defined in placedObjects, avoid circular import by listing here)
    const PLACEABLE = new Set(['wood','straw','stone','torch','coal','stone_block','wooden_fence','pillar','wall_panel','roof_panel','door','door_frame_wall','floor_board','workbench','bed']);
    gridEl.innerHTML = owned.map((id) => {
      const item = ITEMS[id];
      const isEquipped = equipped === id;
      let hint = '';
      if (item.edible) hint = `<div class="inv-eat">クリックで食べる<br>${item.desc || ''}</div>`;
      else if (item.tool) hint = `<div class="inv-eat">クリックで${isEquipped ? '解除' : '装備'}<br>${item.desc || ''}</div>`;
      const placeBtn = PLACEABLE.has(id)
        ? `<button class="inv-place-btn" data-id="${id}">📦 置く</button>`
        : '';
      return `
        <div class="inv-slot${item.edible || item.tool ? ' edible' : ''}${isEquipped ? ' equipped' : ''}" data-id="${id}">
          <div class="inv-icon">${item.icon}</div>
          <div class="inv-name">${item.name}${isEquipped ? ' <span class="eq-badge">装備中</span>' : ''}</div>
          <div class="inv-count">×${counts[id]}</div>
          ${hint}${placeBtn}
        </div>`;
    }).join('');
  }
}
