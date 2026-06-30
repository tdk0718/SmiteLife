// 作業台なしでできる簡易クラフト
import * as Inventory from './inventory.js';

// result は ITEMS のキー。cost は { 素材id: 個数 }。requiresTool: ['tool_id',...] で道具が必要なレシピ。
export const RECIPES = [
  { result: 'stone_axe',     cost: { wood: 2, stone: 3, straw: 1 } },
  { result: 'stone_pickaxe', cost: { wood: 2, stone: 3, straw: 2 } },
  { result: 'stone_knife',   cost: { wood: 1, stone: 2 } },
  { result: 'fire_starter',  cost: { flint: 1, straw: 2, wood: 1 } },
  { result: 'torch',         cost: { wood: 1, straw: 2 } },
  { result: 'stone_block',   cost: { stone: 4 } },
  { result: 'straw_rope',    cost: { straw: 3 } },
  { result: 'plank',         cost: { wood: 2 }, requiresTool: ['stone_axe', 'stone_knife'] },
  { result: 'wooden_fence',  cost: { plank: 2, straw_rope: 1 } },
  { result: 'pillar',        cost: { plank: 2 } },
  { result: 'floor_board',   cost: { plank: 2 } },
  { result: 'wall_panel',    cost: { plank: 3 } },
  { result: 'roof_panel',    cost: { plank: 3 } },
  { result: 'door',            cost: { plank: 3, straw_rope: 1 } },
  { result: 'door_frame_wall', cost: { plank: 3, straw_rope: 1 } },
  { result: 'workbench',       cost: { plank: 4, straw_rope: 2 }, requiresTool: ['stone_axe', 'stone_knife'] },
  { result: 'bed',             cost: { wood: 3, straw: 4 } },
  { result: 'bow',             cost: { wood: 2, straw_rope: 1 } },
  { result: 'arrow',           cost: { stone: 1, wood: 1 }, qty: 3 },
];

let open = false;
let overlayEl, listEl;

export function init() {
  overlayEl = document.getElementById('craft-overlay');
  listEl    = document.getElementById('craft-list');

  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.craft-btn');
      if (btn && btn.dataset.result) craft(btn.dataset.result);
    });
  }
  render();
}

export function toggle() {
  open = !open;
  if (overlayEl) overlayEl.style.display = open ? 'flex' : 'none';
  if (open) render();
}
export function isOpen() { return open; }

function canCraft(recipe) {
  const hasMats = Object.entries(recipe.cost).every(([id, n]) => Inventory.has(id, n));
  if (!hasMats) return false;
  if (recipe.requiresTool) return recipe.requiresTool.some(t => Inventory.has(t));
  return true;
}

export function craft(resultId) {
  const recipe = RECIPES.find((r) => r.result === resultId);
  if (!recipe) return false;
  if (!Object.entries(recipe.cost).every(([id, n]) => Inventory.has(id, n))) {
    Inventory.showPickup('素材が足りない！');
    return false;
  }
  if (recipe.requiresTool && !recipe.requiresTool.some(t => Inventory.has(t))) {
    const names = recipe.requiresTool.map(t => Inventory.ITEMS[t]?.name || t).join(' / ');
    Inventory.showPickup(`${names} が必要です！`);
    return false;
  }
  for (const [id, n] of Object.entries(recipe.cost)) Inventory.remove(id, n);
  const qty = recipe.qty ?? 1;
  Inventory.add(resultId, qty);
  const item = Inventory.ITEMS[resultId];
  Inventory.showPickup(`${item.icon} ${item.name}${qty > 1 ? ` ×${qty}` : ''} を作った！`);
  render();
  return true;
}

function costText(recipe) {
  let html = Object.entries(recipe.cost)
    .map(([id, n]) => {
      const item = Inventory.ITEMS[id];
      const owned = Inventory.count(id);
      const ok = owned >= n;
      return `<span class="cost ${ok ? 'ok' : 'ng'}">${item.icon}${item.name} ${owned}/${n}</span>`;
    })
    .join('');
  if (recipe.requiresTool) {
    const hasAny = recipe.requiresTool.some(t => Inventory.has(t));
    const toolNames = recipe.requiresTool.map(t => Inventory.ITEMS[t]?.name || t).join(' / ');
    html += `<span class="cost ${hasAny ? 'ok' : 'ng'}">🔧 ${toolNames}</span>`;
  }
  return html;
}

function render() {
  if (!listEl) return;
  listEl.innerHTML = RECIPES.map((r) => {
    const item = Inventory.ITEMS[r.result];
    const ok = canCraft(r);
    return `
      <div class="craft-row">
        <div class="craft-info">
          <div class="craft-title">${item.icon} ${item.name}</div>
          <div class="craft-cost">${costText(r)}</div>
          <div class="craft-desc">${item.desc || ''}</div>
        </div>
        <button class="craft-btn" data-result="${r.result}" ${ok ? '' : 'disabled'}>作る</button>
      </div>`;
  }).join('');
}
