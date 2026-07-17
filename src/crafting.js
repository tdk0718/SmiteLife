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
  { result: 'stone_foundation', cost: { stone: 6 } },
  { result: 'straw_rope',    cost: { straw: 3 } },
  { result: 'plank',         cost: { wood: 2 }, requiresTool: ['stone_axe', 'stone_knife'] },
  { result: 'wooden_fence',  cost: { plank: 2, straw_rope: 1 } },
  { result: 'pillar',        cost: { plank: 2 } },
  { result: 'floor_board',   cost: { plank: 2 } },
  { result: 'wall_panel',    cost: { plank: 3 } },
  { result: 'window_wall',   cost: { plank: 3, straw_rope: 1 } },
  { result: 'roof_panel',    cost: { plank: 3 } },
  { result: 'door',            cost: { plank: 3, straw_rope: 1 } },
  { result: 'door_frame_wall', cost: { plank: 3, straw_rope: 1 } },
  { result: 'workbench',       cost: { plank: 4, straw_rope: 2 }, requiresTool: ['stone_axe', 'stone_knife'] },
  { result: 'bed',             cost: { wood: 3, straw: 4 } },
  { result: 'bow',             cost: { wood: 2, straw_rope: 1 } },
  { result: 'arrow',           cost: { stone: 1, wood: 1 }, qty: 3 },
  { result: 'enemy_whistle',    cost: { wood: 1, straw_rope: 1, flint: 1 } },
  { result: 'furnace',         cost: { stone: 8 } },
  // 作業台（または旋盤）でのみ作れる金属レシピ
  { result: 'lathe',         cost: { iron_ingot: 4 },           workbenchOnly: true },
  { result: 'iron_axe',      cost: { iron_ingot: 2, wood: 2 },  workbenchOnly: true },
  { result: 'iron_pickaxe',  cost: { iron_ingot: 2, wood: 2 },  workbenchOnly: true },
  { result: 'iron_hammer',   cost: { iron_ingot: 3, wood: 2 },  workbenchOnly: true },
];

let open = false;
let mode = 'simple'; // 'simple'(Gキー) or 'workbench'(作業台/旋盤)
let overlayEl, listEl, titleEl;
const selQty = new Map(); // レシピごとの生成数選択（デフォルト1）

// 材料の取り出し元。null なら手持ちインベントリ、
// 作業台/旋盤クラフトでは設置物のアイテムボックス（id→個数）が入る。
// 完成品も同じ場所に入る。必要道具（斧など）は常に手持ちから判定する。
let activeBox = null;
function srcCount(id) { return activeBox ? (activeBox[id] || 0) : Inventory.count(id); }
function srcHas(id, n = 1) { return srcCount(id) >= n; }
function srcRemove(id, n) {
  if (!activeBox) return Inventory.remove(id, n);
  if ((activeBox[id] || 0) < n) return false;
  activeBox[id] -= n;
  if (activeBox[id] <= 0) delete activeBox[id];
  return true;
}
function srcAdd(id, n) {
  if (activeBox) activeBox[id] = (activeBox[id] || 0) + n;
  else Inventory.add(id, n);
}

export function init() {
  overlayEl = document.getElementById('craft-overlay');
  listEl    = document.getElementById('craft-list');
  titleEl   = document.getElementById('craft-title');

  if (listEl) {
    listEl.addEventListener('click', (e) => {
      const qtyBtn = e.target.closest('.qty-btn');
      if (qtyBtn && qtyBtn.dataset.result) {
        const id = qtyBtn.dataset.result;
        const recipe = RECIPES.find((r) => r.result === id);
        if (!recipe) return;
        const max = Math.max(1, maxCraftable(recipe));
        const cur = getSelQty(recipe);
        const next = qtyBtn.dataset.delta === 'max' ? max : cur + Number(qtyBtn.dataset.delta);
        selQty.set(id, Math.min(max, Math.max(1, next)));
        render();
        return;
      }
      const btn = e.target.closest('.craft-btn');
      if (btn && btn.dataset.result) {
        const recipe = RECIPES.find((r) => r.result === btn.dataset.result);
        craft(btn.dataset.result, recipe ? getSelQty(recipe) : 1);
      }
    });
  }
  render();
}

export function toggle(m = 'simple') {
  open = !open;
  if (open) {
    mode = m;
    if (m === 'simple') activeBox = null;
  }
  if (overlayEl) overlayEl.style.display = open ? 'flex' : 'none';
  if (open) render();
}
// 作業台/旋盤から開く（常に開いた状態にして金属レシピを表示）
// box: 材料の取り出し元になる設置物のアイテムボックス
export function openMenu(m = 'workbench', box = null) {
  open = true;
  mode = m;
  activeBox = box;
  if (overlayEl) overlayEl.style.display = 'flex';
  render();
}
export function isOpen() { return open; }

function canCraft(recipe) {
  if (recipe.workbenchOnly && mode !== 'workbench') return false;
  const hasMats = Object.entries(recipe.cost).every(([id, n]) => srcHas(id, n));
  if (!hasMats) return false;
  if (recipe.requiresTool) return recipe.requiresTool.some(t => Inventory.has(t));
  return true;
}

// 手持ち（またはボックス内）素材で作れる最大回数
function maxCraftable(recipe) {
  if (!canCraft(recipe)) return 0;
  return Math.min(...Object.entries(recipe.cost).map(([id, n]) => Math.floor(srcCount(id) / n)));
}

function getSelQty(recipe) {
  const max = Math.max(1, maxCraftable(recipe));
  return Math.min(max, Math.max(1, selQty.get(recipe.result) ?? 1));
}

export function craft(resultId, count = 1) {
  const recipe = RECIPES.find((r) => r.result === resultId);
  if (!recipe) return false;
  count = Math.max(1, Math.floor(count));
  if (recipe.workbenchOnly && mode !== 'workbench') {
    Inventory.showPickup('🪚 作業台か旋盤が必要です！');
    return false;
  }
  if (!Object.entries(recipe.cost).every(([id, n]) => srcHas(id, n * count))) {
    Inventory.showPickup(activeBox ? '📦 ボックスの素材が足りない！' : '素材が足りない！');
    return false;
  }
  if (recipe.requiresTool && !recipe.requiresTool.some(t => Inventory.has(t))) {
    const names = recipe.requiresTool.map(t => Inventory.ITEMS[t]?.name || t).join(' / ');
    Inventory.showPickup(`${names} が必要です！`);
    return false;
  }
  for (const [id, n] of Object.entries(recipe.cost)) srcRemove(id, n * count);
  const qty = (recipe.qty ?? 1) * count;
  srcAdd(resultId, qty);
  const item = Inventory.ITEMS[resultId];
  Inventory.showPickup(`${item.icon} ${item.name}${qty > 1 ? ` ×${qty}` : ''} を作った！${activeBox ? '（ボックスに保管）' : ''}`);
  selQty.set(resultId, 1);
  render();
  return true;
}

function costText(recipe) {
  let html = Object.entries(recipe.cost)
    .map(([id, n]) => {
      const item = Inventory.ITEMS[id];
      const owned = srcCount(id);
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
  if (titleEl) {
    titleEl.textContent = mode === 'workbench'
      ? `🪚 作業台クラフト${activeBox ? '（材料はボックスから）' : ''}`
      : '簡易クラフト';
  }
  if (!listEl) return;
  listEl.innerHTML = RECIPES.map((r) => {
    const item = Inventory.ITEMS[r.result];
    const ok = canCraft(r);
    const needsBench = r.workbenchOnly && mode !== 'workbench';
    const badge = r.workbenchOnly ? '<span class="cost ng">🪚 作業台が必要</span>' : '';
    const max = maxCraftable(r);
    const sel = getSelQty(r);
    return `
      <div class="craft-row">
        <div class="craft-info">
          <div class="craft-title">${item.icon} ${item.name}</div>
          <div class="craft-cost">${costText(r)}${badge}</div>
          <div class="craft-desc">${item.desc || ''}</div>
        </div>
        <div class="craft-qty">
          <button class="qty-btn" data-result="${r.result}" data-delta="-1" ${ok && sel > 1 ? '' : 'disabled'}>−</button>
          <span class="qty-val">${sel}</span>
          <button class="qty-btn" data-result="${r.result}" data-delta="1" ${ok && sel < max ? '' : 'disabled'}>＋</button>
          <button class="qty-btn qty-max" data-result="${r.result}" data-delta="max" ${ok && sel < max ? '' : 'disabled'}>最大</button>
        </div>
        <button class="craft-btn" data-result="${r.result}" ${ok ? '' : 'disabled'}>${needsBench ? '作業台で' : sel > 1 ? `作る ×${sel}` : '作る'}</button>
      </div>`;
  }).join('');
}
