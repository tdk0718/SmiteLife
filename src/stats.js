// プレイヤーの体力・空腹度・スタミナを管理するモジュール
// 最大HP/防御力はレベルアップ（progression.js）から動的に設定される。

const HUNGER_MAX  = 100;
const STAMINA_MAX = 100;

const HUNGER_DECAY        = 0.7;
const HUNGER_SPRINT_EXTRA = 1.3;
const STARVE_DAMAGE       = 4;

const STAMINA_REGEN        = 20;
const STAMINA_SPRINT_DRAIN = 24;
const ATTACK_STAMINA_COST  = 18;
const EXHAUST_RECOVER       = 25;

const state = {
  hp: 100,
  maxHp: 100,
  hunger: HUNGER_MAX,
  stamina: STAMINA_MAX,
  defense: 0,
  exhausted: false,
  invulnerable: false,
  dead: false,
};

let slowTimer = 0; // 麻酔効果の残り秒数

export function applySlowEffect(seconds) { slowTimer = seconds; }
export function getSpeedMult() { return slowTimer > 0 ? 0.30 : 1.0; }

let hpFill, hungerFill, staminaFill, hpText, hungerText, staminaText;
let overlayEl, damageFlashEl;

export function init() {
  hpFill      = document.getElementById('hp-fill');
  hungerFill  = document.getElementById('hunger-fill');
  staminaFill = document.getElementById('stamina-fill');
  hpText      = document.getElementById('hp-text');
  hungerText  = document.getElementById('hunger-text');
  staminaText = document.getElementById('stamina-text');
  overlayEl   = document.getElementById('death-overlay');
  damageFlashEl = document.getElementById('damage-flash');
  render();
}

// ダメージを受けた時に画面全体を一瞬赤くフラッシュさせる
// intensity: 0〜1（大ダメージほど濃く）
function flashDamage(intensity = 1) {
  if (!damageFlashEl) return;
  const peak = 0.5 + 0.5 * Math.max(0, Math.min(1, intensity));
  // いったん瞬時に赤くしてから、フェードアウト
  damageFlashEl.style.transition = 'none';
  damageFlashEl.style.opacity = String(peak);
  void damageFlashEl.offsetWidth; // リフローを強制してtransitionを効かせる
  damageFlashEl.style.transition = 'opacity 0.5s ease-out';
  damageFlashEl.style.opacity = '0';
}

export function isDead() { return state.dead; }

export function snapshot() {
  return {
    hp: state.hp, maxHp: state.maxHp, hunger: state.hunger,
    stamina: state.stamina, defense: state.defense, dead: state.dead,
  };
}

export function serialize() {
  return { hp: state.hp, maxHp: state.maxHp, hunger: state.hunger };
}
export function deserialize({ hp, maxHp, hunger } = {}) {
  if (maxHp  !== undefined) state.maxHp  = maxHp;
  if (hp     !== undefined) state.hp     = Math.min(hp, state.maxHp);
  if (hunger !== undefined) state.hunger = Math.min(hunger, HUNGER_MAX);
  render();
}

// --- レベルアップ連携 ---
export function setMaxHp(newMax, healToFull = false) {
  const delta = newMax - state.maxHp;
  state.maxHp = newMax;
  if (healToFull) state.hp = newMax;
  else if (delta > 0) state.hp = Math.min(newMax, state.hp + delta); // 増えた分だけ回復
  state.hp = Math.min(state.hp, state.maxHp);
  render();
}

export function setDefense(v) { state.defense = v; }

// --- スタミナ ---
export function canSprint() { return !state.dead && !state.exhausted && state.stamina > 0; }
export function canAttack() { return !state.dead && !state.exhausted && state.stamina > 0; }

export function tryAttack() {
  if (!canAttack()) return false;
  spend(ATTACK_STAMINA_COST);
  return true;
}

// 汎用スタミナ消費（回避などに使用）
export function spendStamina(amount) {
  if (state.dead || state.stamina < amount) return false;
  spend(amount);
  return true;
}

function spend(amount) {
  state.stamina = Math.max(0, state.stamina - amount);
  if (state.stamina <= 0) state.exhausted = true;
  render();
}

// --- 無敵（回避中のiフレーム） ---
export function setInvulnerable(v) { state.invulnerable = v; }

// --- ダメージ/回復 ---
export function damage(amount) {
  if (state.dead || state.invulnerable || amount <= 0) return;
  const eff = Math.max(1, amount - state.defense); // 防御で軽減（最低1）
  state.hp = Math.max(0, state.hp - eff);
  flashDamage(Math.min(1, eff / 25)); // 画面を赤くフラッシュ
  if (state.hp <= 0) { state.hp = 0; state.dead = true; }
  render();
}

export function eat(hungerAmount = 0, hpAmount = 0) {
  state.hunger = Math.min(HUNGER_MAX, state.hunger + hungerAmount);
  state.hp = Math.max(0, Math.min(state.maxHp, state.hp + hpAmount));
  if (state.hp <= 0) state.dead = true;
  render();
}

export function respawn() {
  state.hp = state.maxHp;
  state.hunger = HUNGER_MAX;
  state.stamina = STAMINA_MAX;
  state.exhausted = false;
  state.invulnerable = false;
  state.dead = false;
  render();
}

export function update(delta, { sprinting = false } = {}) {
  if (state.dead) return;
  if (slowTimer > 0) slowTimer = Math.max(0, slowTimer - delta);

  if (sprinting) {
    state.stamina = Math.max(0, state.stamina - STAMINA_SPRINT_DRAIN * delta);
    if (state.stamina <= 0) state.exhausted = true;
  } else {
    state.stamina = Math.min(STAMINA_MAX, state.stamina + STAMINA_REGEN * delta);
  }
  if (state.exhausted && state.stamina >= EXHAUST_RECOVER) state.exhausted = false;

  const hungerLoss = (HUNGER_DECAY + (sprinting ? HUNGER_SPRINT_EXTRA : 0)) * delta;
  state.hunger = Math.max(0, state.hunger - hungerLoss);

  if (state.hunger <= 0) state.hp = Math.max(0, state.hp - STARVE_DAMAGE * delta);

  if (state.hp <= 0) { state.hp = 0; state.dead = true; }

  render();
}

function setBar(fill, text, value, max, label) {
  if (!fill) return;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  fill.style.width = `${pct}%`;
  if (text) text.textContent = `${label} ${Math.ceil(value)}/${Math.round(max)}`;
}

function render() {
  setBar(hpFill, hpText, state.hp, state.maxHp, 'HP');
  setBar(hungerFill, hungerText, state.hunger, HUNGER_MAX, '空腹');
  setBar(staminaFill, staminaText, state.stamina, STAMINA_MAX, 'スタミナ');

  if (staminaFill) {
    staminaFill.style.background = state.exhausted
      ? 'linear-gradient(90deg,#7a3b1e,#b5651d)'
      : 'linear-gradient(90deg,#1d8fb5,#39c0e0)';
  }
  if (overlayEl) overlayEl.style.display = state.dead ? 'flex' : 'none';
}
