import * as THREE from 'three';

// ── 時間の概念 ─────────────────────────────────────
// ゲーム内1日 = 実時間1時間（3600秒）。昼と夜がある。
export const DAY_LENGTH = 3600; // 実秒

const START_HOUR = 8; // ゲーム開始時刻（朝8時）

let elapsed = (START_HOUR / 24) * DAY_LENGTH; // ワールド開始からの経過実秒
let _sun  = null;
let _hemi = null;
let clockIconEl = null;
let clockTextEl = null;

// 太陽の色（昼 / 朝夕 / 夜=月光）
const SUN_DAY    = new THREE.Color(0xfff2cc);
const SUN_DUSK   = new THREE.Color(0xffa860);
const SUN_NIGHT  = new THREE.Color(0x9aabdd);
const _sunColor  = new THREE.Color();

export function init(sunLight, hemiLight) {
  _sun  = sunLight;
  _hemi = hemiLight;
  clockIconEl = document.getElementById('clock-icon');
  clockTextEl = document.getElementById('clock-text');
}

// ゲーム内時刻（0〜24の実数）
export function getGameHours() {
  return ((elapsed % DAY_LENGTH) / DAY_LENGTH) * 24;
}

// 何日目か（1始まり）
export function getDayNumber() {
  return Math.floor(elapsed / DAY_LENGTH) + 1;
}

// 昼の明るさ 0（深夜）〜 1（日中）。5〜7時で夜明け、17〜19時で日没。
export function getLightFactor() {
  const h = getGameHours();
  if (h >= 7 && h <= 17) return 1;
  if (h >= 19 || h <= 5) return 0;
  if (h < 7) return (h - 5) / 2;
  return (19 - h) / 2;
}

export function isNight() { return getLightFactor() < 0.25; }

function timeIcon() {
  const h = getGameHours();
  if (h >= 7 && h < 17)  return '☀️';
  if ((h >= 5 && h < 7) || (h >= 17 && h < 19)) return '🌅';
  return '🌙';
}

export function getTimeString() {
  const h = getGameHours();
  const hh = String(Math.floor(h)).padStart(2, '0');
  const mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function update(delta) {
  elapsed += delta;

  const f = getLightFactor();

  if (_sun) {
    // 太陽の位置: 6時に東から昇り18時に西へ沈む。夜は月光として頭上に固定。
    const h = getGameHours();
    if (f > 0) {
      const ang = ((h - 6) / 12) * Math.PI;
      _sun.position.set(Math.cos(ang) * 90, Math.max(18, Math.sin(ang) * 110), 45);
    } else {
      _sun.position.set(40, 110, 60);
    }
    // 強さ: 夜はわずかな月明かり
    _sun.intensity = 0.10 + f * 1.30;
    // 色: 昼→白系 / 朝夕→オレンジ / 夜→青白い月光
    if (f <= 0) {
      _sunColor.copy(SUN_NIGHT);
    } else if (f < 1) {
      _sunColor.copy(SUN_DUSK).lerp(SUN_DAY, f);
    } else {
      _sunColor.copy(SUN_DAY);
    }
    _sun.color.copy(_sunColor);
  }

  if (_hemi) {
    _hemi.intensity = 0.16 + f * 0.50;
  }

  // 時計HUD
  if (clockTextEl) clockTextEl.textContent = `${getDayNumber()}日目 ${getTimeString()}`;
  if (clockIconEl) clockIconEl.textContent = timeIcon();
}

// ── セーブ/ロード ──────────────────────────────────
export function serialize() { return { elapsed }; }
export function deserialize(data = {}) {
  if (typeof data.elapsed === 'number' && data.elapsed >= 0) elapsed = data.elapsed;
}
