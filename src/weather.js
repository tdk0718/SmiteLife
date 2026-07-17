import * as THREE from 'three';
import { getLightFactor } from './daynight.js';

const RAIN_COUNT = 1500;
const RAIN_AREA  = 70;
const RAIN_TOP   = 22;
const RAIN_SPEED = 20;

const SKY_COL = {
  clear:    new THREE.Color(0x7ab8e8),
  overcast: new THREE.Color(0x8a96a8),
  rain:     new THREE.Color(0x5c6878),
};
const FOG_COL = {
  clear:    new THREE.Color(0x9fcce8),
  overcast: new THREE.Color(0xa0aab8),
  rain:     new THREE.Color(0x6a7888),
};
const FOG_DENSITY = { clear: 0.0055, overcast: 0.0075, rain: 0.014 };

// 夜の空・霧の色（昼夜の明るさに応じて天候色とブレンド）
const NIGHT_SKY = new THREE.Color(0x0b1226);
const NIGHT_FOG = new THREE.Color(0x0a1120);
const _skyTgt = new THREE.Color();
const _fogTgt = new THREE.Color();

// 天気の遷移順と持続時間[秒]
const STATES   = ['clear', 'overcast', 'rain', 'overcast'];
const DURATION = {
  clear:    [80, 180],
  overcast: [20,  50],
  rain:     [30,  80],
};

let _scene   = null;
let rainPos  = null;
let rainMesh = null;
const clouds  = [];
let stateIdx = 0;
let timer    = 0;

function curState() { return STATES[stateIdx % STATES.length]; }
function randDur(s) { const [a, b] = DURATION[s]; return a + Math.random() * (b - a); }

export function isRaining() { return curState() === 'rain'; }

export function init(scene) {
  _scene = scene;

  // ─ 雨（LineSegments: 短い縦線） ──────────────
  const v = new Float32Array(RAIN_COUNT * 6); // 線1本=頂点2つ×xyz
  for (let i = 0; i < RAIN_COUNT; i++) {
    const x = (Math.random() - 0.5) * RAIN_AREA;
    const y = Math.random() * RAIN_TOP;
    const z = (Math.random() - 0.5) * RAIN_AREA;
    const s = i * 6;
    v[s]   = x;       v[s+1] = y;          v[s+2] = z;
    v[s+3] = x+0.05;  v[s+4] = y - 0.45;  v[s+5] = z;
  }
  const geo = new THREE.BufferGeometry();
  rainPos = new THREE.BufferAttribute(v, 3);
  geo.setAttribute('position', rainPos);
  rainMesh = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0x99bbdd, transparent: true, opacity: 0.0 }),
  );
  rainMesh.frustumCulled = false;
  scene.add(rainMesh);

  // ─ 雲（平たい円柱メッシュ） ──────────────────
  for (let i = 0; i < 7; i++) {
    const r = 10 + Math.random() * 14;
    const cloud = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.12, 2 + Math.random() * 3, 10),
      new THREE.MeshLambertMaterial({
        color: i % 2 ? 0xccd8e8 : 0xdde8f4,
        transparent: true,
        opacity: 0.0,
      }),
    );
    cloud.position.set(
      (Math.random() - 0.5) * 120,
      42 + Math.random() * 18,
      (Math.random() - 0.5) * 120,
    );
    cloud.userData.wx = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.4);
    cloud.userData.wz = (Math.random() - 0.5) * 0.5;
    scene.add(cloud);
    clouds.push(cloud);
  }

  timer = randDur('clear');
}

export function update(delta, playerPos) {
  if (!_scene) return;

  // 天気ステート管理
  timer -= delta;
  if (timer <= 0) {
    stateIdx = (stateIdx + 1) % STATES.length;
    timer = randDur(curState());
  }

  const cs = curState();

  // 空と霧の色・濃度をなめらかに変化（昼夜の明るさで暗くする）
  const brightness = 0.08 + getLightFactor() * 0.92;
  _skyTgt.copy(SKY_COL[cs]).lerp(NIGHT_SKY, 1 - brightness);
  _fogTgt.copy(FOG_COL[cs]).lerp(NIGHT_FOG, 1 - brightness);
  _scene.background.lerp(_skyTgt, delta * 0.6);
  if (_scene.fog) {
    _scene.fog.color.lerp(_fogTgt, delta * 0.6);
    _scene.fog.density += (FOG_DENSITY[cs] - _scene.fog.density) * Math.min(1, delta * 0.5);
  }

  // 雲の透明度・移動
  const tgtCloud = cs === 'clear' ? 0.0 : cs === 'overcast' ? 0.55 : 0.82;
  for (const c of clouds) {
    c.material.opacity += (tgtCloud - c.material.opacity) * Math.min(1, delta * 0.4);
    c.visible = c.material.opacity > 0.01;
    c.position.x += c.userData.wx * delta;
    c.position.z += c.userData.wz * delta;
    // プレイヤーから離れすぎたら反対側に戻す
    if (Math.abs(c.position.x - playerPos.x) > 80) {
      c.position.x = playerPos.x + (Math.random() - 0.5) * 80;
      c.position.z = playerPos.z + (Math.random() - 0.5) * 80;
    }
    if (Math.abs(c.position.z - playerPos.z) > 80) {
      c.position.x = playerPos.x + (Math.random() - 0.5) * 80;
      c.position.z = playerPos.z + (Math.random() - 0.5) * 80;
    }
  }

  // 雨粒の透明度・落下
  const tgtRain = cs === 'rain' ? 0.65 : 0.0;
  rainMesh.material.opacity += (tgtRain - rainMesh.material.opacity) * Math.min(1, delta * 1.5);
  rainMesh.visible = rainMesh.material.opacity > 0.01;

  if (rainMesh.visible) {
    rainMesh.position.set(playerPos.x, 0, playerPos.z);
    const v = rainPos.array;
    for (let i = 0; i < RAIN_COUNT; i++) {
      const s = i * 6;
      v[s+1] -= RAIN_SPEED * delta;
      v[s+4] -= RAIN_SPEED * delta;
      if (v[s+4] < -3) {
        const nx = (Math.random() - 0.5) * RAIN_AREA;
        const nz = (Math.random() - 0.5) * RAIN_AREA;
        v[s]   = nx;       v[s+1] = RAIN_TOP;         v[s+2] = nz;
        v[s+3] = nx+0.05;  v[s+4] = RAIN_TOP - 0.45;  v[s+5] = nz;
      }
    }
    rainPos.needsUpdate = true;
  }
}
