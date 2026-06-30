import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';

const GRAVITY    = -18;
const BAIT_LIFE  = 45;   // 餌の消滅までの秒数
const THROW_SPEED = 14;

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

export function init(scene, toastFn) {
  _scene   = scene;
  _toastFn = toastFn;
}

function toast(msg) { _toastFn?.(msg); }

// 投擲物のビジュアルメッシュ
function buildMesh(itemId) {
  let geo, mat;
  if (itemId === 'stone' || itemId === 'stone_block' || itemId === 'flint') {
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
  });
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
    if (p.age > 10) { _scene.remove(p.mesh); p.alive = false; continue; }

    p.vel.y += GRAVITY * delta;
    p.pos.x += p.vel.x * delta;
    p.pos.y += p.vel.y * delta;
    p.pos.z += p.vel.z * delta;
    p.mesh.position.copy(p.pos);
    if (p.isArrow) {
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
        const dmg = THROW_DAMAGE[p.itemId] ?? 2;
        hits.push({ enemy: e, damage: dmg });
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

  return hits;
}
