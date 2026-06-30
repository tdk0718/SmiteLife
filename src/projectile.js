import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';

const GRAVITY    = -18;
const BAIT_LIFE  = 45;   // 餌の消滅までの秒数
const THROW_SPEED = 14;
const FIREBALL_DAMAGE = 16;
const FIREBALL_RADIUS = 2.4;
const FIREBALL_LIFE   = 3.2;

// アイテムごとの投擲ダメージ
export const THROW_DAMAGE = {
  stone: 8, stone_block: 14, flint: 6, coal: 5, iron_ore: 7, copper_ore: 6,
  wood: 4, straw: 2, plank: 5,
  wooden_fence: 5, pillar: 4, floor_board: 3, wall_panel: 4,
  stone_axe: 12, stone_pickaxe: 12, stone_knife: 9, torch: 5,
  meat: 2, raw_fish: 2, cooked_meat: 2, cooked_fish: 2, mushroom: 1, fur: 1,
  arrow: 20,
};

// 餌として機能するアイテム
export const BAIT_ITEMS = new Set(['meat', 'raw_fish', 'cooked_meat', 'cooked_fish']);

let _scene   = null;
let _toastFn = null;
let _nextId  = 0;

const projectiles = [];
const baits = [];
const fireBursts = [];

export function init(scene, toastFn) {
  _scene   = scene;
  _toastFn = toastFn;
}

function toast(msg) { _toastFn?.(msg); }

// 投擲物のビジュアルメッシュ
function buildMesh(itemId) {
  let geo, mat;
  if (itemId === 'fireball') {
    const g = new THREE.Group();
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff5a18, transparent: true, opacity: 0.82 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa22, transparent: true, opacity: 0.34 });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), coreMat);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), flameMat);
    flame.scale.set(1.1, 0.86, 1.35);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), glowMat);
    const light = new THREE.PointLight(0xff7a22, 2.2, 8);
    g.add(glow, flame, core, light);
    g.userData.light = light;
    return g;
  } else if (itemId === 'stone' || itemId === 'stone_block' || itemId === 'flint') {
    geo = new THREE.IcosahedronGeometry(0.13, 0);
    mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  } else if (itemId === 'coal' || itemId === 'iron_ore' || itemId === 'copper_ore') {
    geo = new THREE.IcosahedronGeometry(0.11, 0);
    mat = new THREE.MeshLambertMaterial({ color: itemId === 'coal' ? 0x1a1a1a : 0x7a6040 });
  } else if (itemId === 'wood' || itemId === 'plank') {
    geo = new THREE.BoxGeometry(0.22, 0.10, 0.30);
    mat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  } else if (itemId === 'torch') {
    geo = new THREE.CylinderGeometry(0.04, 0.04, 0.28, 6);
    mat = new THREE.MeshLambertMaterial({ color: 0x7a5020 });
  } else if (itemId === 'arrow') {
    // 矢: 軸 + 石の穂先
    const g = new THREE.Group();
    const shaftMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
    const tipMat   = new THREE.MeshLambertMaterial({ color: 0x888880 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 6), shaftMat);
    shaft.rotation.x = Math.PI / 2; // 進行方向に向ける
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.10, 6), tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 0.31;
    g.add(shaft, tip);
    g.castShadow = true;
    return g;
  } else if (BAIT_ITEMS.has(itemId)) {
    geo = new THREE.SphereGeometry(0.10, 6, 4);
    mat = new THREE.MeshLambertMaterial({ color: itemId.startsWith('cooked') ? 0xd06030 : 0xb84040 });
  } else {
    geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    mat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
  }
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// アイテムを投げる / 矢を射る
// pitchAngle: 仰角（ラジアン）、speed: 速度（デフォルト THROW_SPEED）
export function throwItem(itemId, fromPos, facing, pitchAngle = 0.32, speed = THROW_SPEED) {
  const mesh = buildMesh(itemId);
  const startPos = fromPos.clone().add(new THREE.Vector3(0, 0.1, 0));
  mesh.position.copy(startPos);
  _scene.add(mesh);

  const cosP = Math.cos(pitchAngle);
  const sinP = Math.sin(pitchAngle);
  projectiles.push({
    id: _nextId++,
    itemId,
    mesh,
    pos: startPos.clone(),
    vel: new THREE.Vector3(
      Math.sin(facing) * cosP * speed,
      sinP * speed,
      Math.cos(facing) * cosP * speed,
    ),
    age: 0,
    alive: true,
    isArrow: itemId === 'arrow',
    isFireball: itemId === 'fireball',
  });
}

export function castFireball(fromPos, facing) {
  throwItem('fireball', fromPos, facing, 0.08, 22);
}

function addFireBurst(pos) {
  const g = new THREE.Group();
  const colors = [0xfff1a6, 0xff8a1d, 0xd83a12];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.86,
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12 + Math.random() * 0.08, 0.45 + Math.random() * 0.35, 7), mat);
    const a = (i / 9) * Math.PI * 2;
    const r = 0.18 + Math.random() * 0.42;
    flame.position.set(Math.cos(a) * r, 0.25 + Math.random() * 0.15, Math.sin(a) * r);
    flame.rotation.set(Math.random() * 0.45, 0, -0.35 + Math.random() * 0.7);
    g.add(flame);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.38 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, FIREBALL_RADIUS, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  g.add(ring);
  const light = new THREE.PointLight(0xff6a1a, 3.4, 10);
  light.position.y = 0.8;
  g.add(light);
  g.position.copy(pos);
  _scene.add(g);
  fireBursts.push({ mesh: g, age: 0, life: 0.45, light, ring });
}

// 地面に落下した餌を登録
function addBait(pos, itemId) {
  const mesh = buildMesh(itemId);
  mesh.position.copy(pos);
  _scene.add(mesh);
  // ゆっくり回転させて目立つように
  const bait = {
    id: _nextId++,
    itemId,
    pos: pos.clone(),
    mesh,
    timer: BAIT_LIFE,
    alive: true,
  };
  baits.push(bait);
  return bait;
}

export function getBaits() {
  return baits.filter(b => b.alive);
}

export function consumeBait(bait) {
  if (!bait || !bait.alive) return;
  _scene.remove(bait.mesh);
  bait.alive = false;
}

// 毎フレーム更新。ヒットイベント [{ enemy, damage }] を返す
export function update(delta, enemyList) {
  const hits = [];

  for (const p of projectiles) {
    if (!p.alive) continue;
    p.age += delta;
    if (p.age > (p.isFireball ? FIREBALL_LIFE : 10)) { _scene.remove(p.mesh); p.alive = false; continue; }

    if (p.isFireball) {
      p.vel.y += GRAVITY * 0.08 * delta;
    } else {
      p.vel.y += GRAVITY * delta;
    }
    p.pos.x += p.vel.x * delta;
    p.pos.y += p.vel.y * delta;
    p.pos.z += p.vel.z * delta;
    p.mesh.position.copy(p.pos);
    if (p.isFireball) {
      p.mesh.rotation.y += 9 * delta;
      p.mesh.rotation.z += 5 * delta;
      if (p.mesh.userData.light) {
        p.mesh.userData.light.intensity = 1.6 + Math.sin(p.age * 28) * 0.6;
      }
    } else if (p.isArrow) {
      // 矢は速度方向に向ける
      p.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z);
      p.mesh.rotation.x = Math.atan2(-p.vel.y, Math.hypot(p.vel.x, p.vel.z));
    } else {
      p.mesh.rotation.x += 6 * delta;
      p.mesh.rotation.z += 3 * delta;
    }

    // 地形衝突
    const gy = getTerrainHeight(p.pos.x, p.pos.z);
    if (p.pos.y <= gy + 0.05) {
      _scene.remove(p.mesh);
      p.alive = false;
      if (p.isFireball) {
        const impact = new THREE.Vector3(p.pos.x, gy + 0.05, p.pos.z);
        addFireBurst(impact);
        for (const e of enemyList) {
          if (!e.alive || e.tamed) continue;
          const dist = Math.hypot(impact.x - e.position.x, impact.z - e.position.z);
          if (dist <= FIREBALL_RADIUS * e.baseScale) hits.push({ enemy: e, damage: FIREBALL_DAMAGE });
        }
      }
      if (BAIT_ITEMS.has(p.itemId)) {
        addBait(new THREE.Vector3(p.pos.x, gy + 0.05, p.pos.z), p.itemId);
        toast('🥩 餌を置いた（狼が近づいてくるかも）');
      }
      continue;
    }

    // 敵への命中判定
    for (const e of enemyList) {
      if (!e.alive || e.tamed) continue;
      const dx = p.pos.x - e.position.x;
      const dy = p.pos.y - (e.position.y + 0.55 * e.baseScale);
      const dz = p.pos.z - e.position.z;
      if (Math.hypot(dx, dy, dz) < 0.65 * e.baseScale) {
        if (p.isFireball) {
          addFireBurst(p.pos.clone());
          for (const target of enemyList) {
            if (!target.alive || target.tamed) continue;
            const dist = Math.hypot(p.pos.x - target.position.x, p.pos.z - target.position.z);
            if (dist <= FIREBALL_RADIUS * target.baseScale) hits.push({ enemy: target, damage: FIREBALL_DAMAGE });
          }
        } else {
          const dmg = THROW_DAMAGE[p.itemId] ?? 2;
          hits.push({ enemy: e, damage: dmg });
        }
        _scene.remove(p.mesh);
        p.alive = false;
        break;
      }
    }
  }

  // 餌のタイマー更新
  for (const b of baits) {
    if (!b.alive) continue;
    b.timer -= delta;
    b.mesh.rotation.y += delta * 1.2; // ゆっくり回転
    if (b.timer <= 0) consumeBait(b);
  }

  for (const burst of fireBursts) {
    burst.age += delta;
    const t = Math.min(1, burst.age / burst.life);
    burst.mesh.scale.setScalar(1 + t * 0.5);
    burst.mesh.children.forEach((c) => {
      if (c.material?.transparent) c.material.opacity *= 0.88;
    });
    if (burst.light) burst.light.intensity = Math.max(0, 3.4 * (1 - t));
    if (burst.age >= burst.life) {
      _scene.remove(burst.mesh);
      burst.alive = false;
    }
  }
  for (let i = fireBursts.length - 1; i >= 0; i--) {
    if (fireBursts[i].alive === false) fireBursts.splice(i, 1);
  }

  return hits;
}
