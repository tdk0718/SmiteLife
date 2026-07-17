// 敵に与えたダメージを 3D 位置に追従するフローティング数値として表示するモジュール。
// enemy.js から spawn() を呼び、main.js のループから update(camera, renderer) を毎フレーム呼ぶ。
import * as THREE from 'three';

const LIFE = 0.9;      // 表示秒数
const RISE = 1.1;      // 上昇量（ワールド単位）

let container = null;
const items = [];      // { el, pos:Vector3, age }
const _v = new THREE.Vector3();

function ensureContainer() {
  if (container) return;
  container = document.createElement('div');
  container.id = 'damage-text-layer';
  container.style.cssText =
    'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:19;';
  document.body.appendChild(container);
}

// worldPos: THREE.Vector3, amount: 数値, opts: { crit:bool }
export function spawn(worldPos, amount, { crit = false } = {}) {
  ensureContainer();
  const el = document.createElement('div');
  const val = Math.max(1, Math.round(amount));
  el.textContent = crit ? `${val}!` : `${val}`;
  el.style.cssText =
    'position:absolute;transform:translate(-50%,-50%);font-weight:800;' +
    'font-family:system-ui,sans-serif;white-space:nowrap;' +
    'text-shadow:1px 1px 2px #000,-1px -1px 2px #000;will-change:transform,opacity;' +
    (crit
      ? 'color:#ffdd33;font-size:26px;'
      : 'color:#ff6a4a;font-size:20px;');
  container.appendChild(el);
  // 少し横にばらけさせて重なりを防ぐ
  const pos = worldPos.clone();
  pos.x += (Math.random() - 0.5) * 0.4;
  pos.z += (Math.random() - 0.5) * 0.4;
  items.push({ el, pos, age: 0 });
}

export function update(delta, camera, renderer) {
  if (items.length === 0) return;
  const w = renderer.domElement.clientWidth;
  const h = renderer.domElement.clientHeight;

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.age += delta;
    if (it.age >= LIFE) {
      it.el.remove();
      items.splice(i, 1);
      continue;
    }
    const t = it.age / LIFE;
    // 経過とともに上昇
    _v.copy(it.pos);
    _v.y += RISE * t;
    _v.project(camera);

    // カメラ後方なら隠す
    if (_v.z > 1) { it.el.style.display = 'none'; continue; }
    it.el.style.display = 'block';

    const sx = (_v.x * 0.5 + 0.5) * w;
    const sy = (-_v.y * 0.5 + 0.5) * h;
    it.el.style.left = `${sx}px`;
    it.el.style.top = `${sy}px`;
    it.el.style.opacity = String(1 - t * t); // 終盤でフェードアウト
  }
}
