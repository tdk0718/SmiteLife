// 戦闘レベル・経験値・派生ステータス（攻撃力/最大HP/防御力）を管理する。
// 鍛冶スキルなど他のスキルも後でこの仕組みに追加できる。
import * as Stats from './stats.js';
import * as Inventory from './inventory.js';

const combat = {
  level: 1,
  xp: 0,
};

// レベルに必要な経験値（レベルが上がるほど多くなる）
export function xpToNext(level = combat.level) {
  return Math.floor(50 * Math.pow(level, 1.6));
}

// レベルから算出される派生ステータス
export function attackPower(level = combat.level) { return 1 + (level - 1) * 1; }
export function maxHp(level = combat.level)       { return 100 + (level - 1) * 20; }
export function defense(level = combat.level)     { return (level - 1) * 2; }

let levelText, xpFill, xpText, statusOverlay, statusBody;
let statusOpen = false;
let _onLevelUp = null;
export function setOnLevelUp(fn) { _onLevelUp = fn; }

export function serialize() { return { level: combat.level, xp: combat.xp }; }
export function deserialize({ level = 1, xp = 0 } = {}) {
  combat.level = level;
  combat.xp    = xp;
  applyDerived(false); // 正しい maxHp を Stats に反映
  render();
}

export function init() {
  const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  levelText     = $('level-text');
  xpFill        = $('xp-fill');
  xpText        = $('xp-text');
  statusOverlay = $('status-overlay');
  statusBody    = $('status-body');

  applyDerived(false);
  render();
}

export function getCombatLevel() { return combat.level; }
export function getAttack() { return attackPower(); }

// 敵撃破などで経験値を得る
export function addXp(amount) {
  if (amount <= 0) return;
  combat.xp += amount;

  let leveledUp = false;
  while (combat.xp >= xpToNext()) {
    combat.xp -= xpToNext();
    combat.level += 1;
    leveledUp = true;
  }

  if (leveledUp) {
    applyDerived(true); // レベルアップ時は最大HPまで回復
    Inventory.showPickup(`⬆ レベルアップ！ 戦闘Lv.${combat.level}`);
    _onLevelUp?.();
  }
  render();
}

// 派生ステータスを Stats に反映
function applyDerived(healToFull) {
  Stats.setMaxHp(maxHp(), healToFull);
  Stats.setDefense(defense());
}

export function toggleStatus() {
  statusOpen = !statusOpen;
  if (statusOverlay) statusOverlay.style.display = statusOpen ? 'flex' : 'none';
  if (statusOpen) renderStatus();
}

export function isStatusOpen() { return statusOpen; }

function render() {
  if (levelText) levelText.textContent = `Lv.${combat.level}`;
  if (xpFill) {
    const need = xpToNext();
    xpFill.style.width = `${Math.max(0, Math.min(100, (combat.xp / need) * 100))}%`;
    if (xpText) xpText.textContent = `EXP ${combat.xp}/${need}`;
  }
  if (statusOpen) renderStatus();
}

function renderStatus() {
  if (!statusBody) return;
  const s = Stats.snapshot();
  statusBody.innerHTML = `
    <div class="status-grid">
      <div class="status-row"><span>戦闘レベル</span><b>Lv.${combat.level}</b></div>
      <div class="status-row"><span>経験値</span><b>${combat.xp} / ${xpToNext()}</b></div>
      <div class="status-row"><span>攻撃力</span><b>${attackPower()}</b></div>
      <div class="status-row"><span>最大HP</span><b>${maxHp()}</b></div>
      <div class="status-row"><span>防御力</span><b>${defense()}</b></div>
      <div class="status-row"><span>現在HP</span><b>${Math.ceil(s.hp)} / ${Math.round(s.maxHp)}</b></div>
    </div>
    <div class="status-note">🔨 鍛冶レベル: 近日対応予定</div>
  `;
}
