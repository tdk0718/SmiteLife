// 設置物のアイテムボックス（格納庫）UI
// 焚き火・炉・作業台などの機能付き設置物は box（アイテムid→個数）を持ち、
// 機能に関係するアイテムだけを出し入れできる。
import * as Inventory from './inventory.js';
import { RECIPES } from './crafting.js';

// クラフトに使う素材ID一覧（作業台・旋盤のボックスが受け入れる）
const CRAFT_MATERIALS = [...new Set(RECIPES.flatMap((r) => Object.keys(r.cost)))];

// 機能付き設置物のボックス定義。accepts にない物は入れられない。
export const CONTAINERS = {
  wood: {
    label: '🔥 焚き火',
    capacity: 30,
    accepts: ['wood', 'meat', 'raw_fish'],
    note: '薪（木材）が燃料。燃えると一定時間で木炭ができ、肉や魚は焼き上がる',
  },
  furnace: {
    label: '🏭 簡易炉',
    capacity: 30,
    accepts: ['coal', 'charcoal', 'iron_ore', 'copper_ore'],
    note: '燃料（石炭/木炭）と鉱石（鉄/銅）を入れると自動で精錬が進む',
  },
  workbench: {
    label: '🪚 作業台',
    capacity: 60,
    accepts: CRAFT_MATERIALS,
    note: 'クラフトの材料をあらかじめ入れておく。完成品もこのボックスに入る',
  },
  lathe: {
    label: '🛠️ 旋盤',
    capacity: 60,
    accepts: CRAFT_MATERIALS,
    note: 'クラフトの材料をあらかじめ入れておく。完成品もこのボックスに入る',
  },
};

let overlayEl, titleEl, noteEl, statusEl, actionsEl, contentsEl, playerEl, capEl;
let openObj = null;
let hooks = {}; // { getStatus(obj), getActions(obj), onAction(id, obj) } placedObjects が登録

export function setHooks(h) { hooks = h; }

export function init() {
  overlayEl  = document.getElementById('box-overlay');
  titleEl    = document.getElementById('box-title');
  noteEl     = document.getElementById('box-note');
  statusEl   = document.getElementById('box-status');
  actionsEl  = document.getElementById('box-actions');
  contentsEl = document.getElementById('box-contents');
  playerEl   = document.getElementById('box-player');
  capEl      = document.getElementById('box-cap');

  document.getElementById('box-close')?.addEventListener('click', close);

  const onTransferClick = (e) => {
    const btn = e.target.closest('.box-move-btn');
    if (!btn || !openObj) return;
    transfer(btn.dataset.id, btn.dataset.dir, btn.dataset.all === '1');
  };
  contentsEl?.addEventListener('click', onTransferClick);
  playerEl?.addEventListener('click', onTransferClick);

  actionsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.box-action-btn');
    if (!btn || btn.disabled || !openObj) return;
    hooks.onAction?.(btn.dataset.action, openObj);
  });
}

export function isOpen() { return !!openObj; }
export function getOpenObj() { return openObj; }

export function open(obj) {
  if (!CONTAINERS[obj.itemId]) return;
  obj.box = obj.box || {};
  openObj = obj;
  if (overlayEl) overlayEl.style.display = 'flex';
  render();
}

export function close() {
  openObj = null;
  if (overlayEl) overlayEl.style.display = 'none';
}

// 生産の進行などで中身が変わった設置物の表示を更新
export function notifyChanged(obj) {
  if (openObj === obj) render();
}

// 毎フレーム呼ばれる軽量更新（進行状況テキストのみ差し替え）
export function tick() {
  if (!openObj) return;
  if (!openObj.alive) { close(); return; }
  if (statusEl) statusEl.textContent = hooks.getStatus?.(openObj) ?? '';
}

function boxTotal(box) { return Object.values(box).reduce((a, b) => a + b, 0); }

function transfer(id, dir, all) {
  const cfg = CONTAINERS[openObj.itemId];
  const box = openObj.box;
  if (dir === 'in') {
    if (!cfg.accepts.includes(id)) {
      Inventory.showPickup('📦 これはここには入れられない');
      return;
    }
    const space = cfg.capacity - boxTotal(box);
    if (space <= 0) { Inventory.showPickup('📦 ボックスがいっぱいだ'); return; }
    const n = Math.min(all ? Inventory.count(id) : 1, space);
    if (n <= 0 || !Inventory.remove(id, n)) return;
    box[id] = (box[id] || 0) + n;
  } else {
    const n = Math.min(all ? (box[id] || 0) : 1, box[id] || 0);
    if (n <= 0) return;
    box[id] -= n;
    if (box[id] <= 0) delete box[id];
    Inventory.add(id, n);
  }
  render();
}

function itemRow(id, n, dir) {
  const item = Inventory.ITEMS[id];
  if (!item) return '';
  const verb = dir === 'in' ? '入れる' : '取る';
  return `
    <div class="box-row">
      <span class="box-item">${item.icon} ${item.name} ×${n}</span>
      <span class="box-btns">
        <button class="box-move-btn" data-id="${id}" data-dir="${dir}">${verb}</button>
        <button class="box-move-btn" data-id="${id}" data-dir="${dir}" data-all="1">全部</button>
      </span>
    </div>`;
}

function render() {
  if (!openObj) return;
  const cfg = CONTAINERS[openObj.itemId];
  const box = openObj.box;

  if (titleEl)  titleEl.textContent  = `${cfg.label} アイテムボックス`;
  if (noteEl)   noteEl.textContent   = cfg.note;
  if (capEl)    capEl.textContent    = `${boxTotal(box)}/${cfg.capacity}`;
  if (statusEl) statusEl.textContent = hooks.getStatus?.(openObj) ?? '';

  if (actionsEl) {
    const actions = hooks.getActions?.(openObj) ?? [];
    actionsEl.innerHTML = actions.map((a) =>
      `<button class="box-action-btn" data-action="${a.id}" ${a.enabled ? '' : 'disabled'}>${a.label}</button>`
    ).join('');
  }

  if (contentsEl) {
    const ids = Object.keys(box).filter((id) => box[id] > 0);
    contentsEl.innerHTML = ids.length
      ? ids.map((id) => itemRow(id, box[id], 'out')).join('')
      : '<div class="box-empty">（空）</div>';
  }
  if (playerEl) {
    const ids = cfg.accepts.filter((id) => Inventory.count(id) > 0);
    playerEl.innerHTML = ids.length
      ? ids.map((id) => itemRow(id, Inventory.count(id), 'in')).join('')
      : '<div class="box-empty">入れられるアイテムを持っていない</div>';
  }
}
