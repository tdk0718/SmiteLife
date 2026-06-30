import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { getTerrainHeight } from './scene.js';
import * as Stats from './stats.js';

// ── 物理定数 ──────────────────────────────────────────
const SPEED          = 5;
const SPRINT_MULT    = 1.5;
const JUMP_VEL       = 8;
const GRAVITY        = -20;
const TURN_SPEED     = 12;
const DODGE_SPEED    = 12;
const DODGE_DURATION = 0.28;
const STEP_HEIGHT    = 0.55;
const ATTACK_DURATION = 0.75;

const WATER_LEVEL   = 0.0;
const WAIST_HEIGHT  = 0.88;
const SWIM_SPEED    = 2.8;
const SWIM_BUOYANCY = 14;
const SWIM_DRAG     = 0.88;

// プレイヤー AABB
const PLAYER_W = 0.5;
const PLAYER_H = 1.9;
const PLAYER_D = 0.5;

// ── 物理状態 ──────────────────────────────────────────
let group     = null;
let velY      = 0;
let onGround  = true;
let attackTimer  = 0;
let dodgeTimer   = 0;
let dodgeVelX    = 0;
let dodgeVelZ    = 0;
let swimTime     = 0;

// ── FBX / アニメーション状態 ──────────────────────────
let mixer        = null;
const actions    = {};
let currentAction = null;
let modelReady   = false;
let rightHandBone = null;
let handItem     = null;

// アニメーション切り替えで参照する移動状態
let _isMoving    = false;
let _isSprinting = false;
let _isAttacking = false;

// ── 衝突判定用（再利用してGC抑制） ──────────────────────
const _playerBox = new THREE.Box3();
const _center    = new THREE.Vector3();
const _size      = new THREE.Vector3(PLAYER_W, PLAYER_H, PLAYER_D);
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _down      = new THREE.Vector3(0, -1, 0);

// ─────────────────────────────────────────────────────
function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// アニメーションをフェードで切り替える
function switchAction(name, fadeDuration = 0.25) {
  const next = actions[name];
  if (!next || next === currentAction) return;
  if (currentAction) currentAction.fadeOut(fadeDuration);
  next.reset().fadeIn(fadeDuration).play();
  currentAction = next;
}

// ── 手持ちアイテム用ビジュアルメッシュ ──────────────────
function buildHandMesh(itemId) {
  const g       = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  const stoneMat= new THREE.MeshLambertMaterial({ color: 0x9a9080 });
  const bladeMat= new THREE.MeshLambertMaterial({ color: 0xc0c0b8 });
  const fireMat = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 0.8 });
  switch (itemId) {
    case 'stone_axe': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.38, 6), woodMat);
      handle.position.y = -0.19;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.04), stoneMat);
      blade.position.set(0.07, -0.36, 0);
      g.add(handle, blade);
      break;
    }
    case 'stone_pickaxe': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.40, 6), woodMat);
      handle.position.y = -0.20;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.055, 0.04), stoneMat);
      hd.position.set(0, -0.38, 0);
      g.add(handle, hd);
      break;
    }
    case 'stone_knife': {
      const hnd  = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.13, 6), woodMat);
      hnd.position.y = -0.065;
      const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.25, 0.018), bladeMat);
      blade2.position.y = -0.255;
      g.add(hnd, blade2);
      break;
    }
    case 'fire_starter': {
      const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.30, 5), woodMat);
      s1.position.set(-0.025, -0.15, 0); s1.rotation.z = 0.25;
      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 5), woodMat);
      s2.position.set(0.025, -0.14, 0.01); s2.rotation.z = -0.25;
      g.add(s1, s2);
      break;
    }
    case 'torch': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.34, 6), woodMat);
      handle.position.y = -0.17;
      const flame  = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.11, 6), fireMat);
      flame.position.y = 0.055;
      g.add(handle, flame);
      break;
    }
    default: break;
  }
  return g;
}

// ── エクスポート関数 ──────────────────────────────────

export function isSwimming() {
  if (!group) return false;
  return group.position.y < (WATER_LEVEL - WAIST_HEIGHT);
}

export function getPosition() {
  return group ? group.position.clone() : new THREE.Vector3(0, 0, 0);
}

export function getFacing() {
  return group ? group.rotation.y : 0;
}

export function warpTo(pos) {
  if (!group) return;
  group.position.set(pos.x, pos.y + 0.15, pos.z);
  velY = 0;
}

export function respawn(spawnPos) {
  if (!group) return;
  const px = spawnPos ? spawnPos.x : 0;
  const py = spawnPos ? spawnPos.y + 0.20 : getTerrainHeight(0, 0);
  const pz = spawnPos ? spawnPos.z : 0;
  group.position.set(px, py, pz);
  group.rotation.y = Math.PI;
  velY        = 0;
  onGround    = true;
  attackTimer = 0;
  dodgeTimer  = 0;
  dodgeVelX   = 0;
  dodgeVelZ   = 0;
  _isAttacking = false;
  if (actions.idle) {
    Object.values(actions).forEach(a => a.stop());
    actions.idle.play();
    currentAction = actions.idle;
  }
}

export function setHandItem(itemId) {
  if (handItem) {
    if (rightHandBone) rightHandBone.remove(handItem);
    handItem = null;
  }
  if (!itemId) return;
  const mesh = buildHandMesh(itemId);
  // FBX は 0.01 スケール（cm 空間）なのでアイテムを 100 倍して合わせる
  mesh.scale.setScalar(100);
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  mesh.position.set(0, 3, 5); // 右手ボーン内の cm オフセット
  handItem = mesh;
  if (rightHandBone) rightHandBone.add(handItem);
}

export function triggerAttack() {
  attackTimer  = ATTACK_DURATION;
  _isAttacking = true;
  if (actions.attack) {
    // ベースアニメ（歩き/アイドル）はそのままにして、攻撃を上半身オーバーレイで再生
    actions.attack.reset().setEffectiveWeight(1).play();
  }
}

export function startDodge(cameraYaw, inputState) {
  if (!group || dodgeTimer > 0) return false;
  let dirX = 0, dirZ = 0;
  if (inputState?.forward)  { dirX -= Math.sin(cameraYaw); dirZ -= Math.cos(cameraYaw); }
  if (inputState?.backward) { dirX += Math.sin(cameraYaw); dirZ += Math.cos(cameraYaw); }
  const len = Math.hypot(dirX, dirZ);
  if (len > 0.001) { dirX /= len; dirZ /= len; }
  else { dirX = Math.sin(group.rotation.y); dirZ = Math.cos(group.rotation.y); }
  dodgeVelX = dirX * DODGE_SPEED;
  dodgeVelZ = dirZ * DODGE_SPEED;
  dodgeTimer = DODGE_DURATION;
  return true;
}

export function isDodging() { return dodgeTimer > 0; }

// ── 衝突判定 ──────────────────────────────────────────

function isColliding(px, py, pz, boxes1, boxes2) {
  _center.set(px, py + PLAYER_H / 2, pz);
  _playerBox.setFromCenterAndSize(_center, _size);
  for (const box of boxes1) {
    if (_playerBox.intersectsBox(box)) return true;
  }
  if (boxes2) {
    for (const box of boxes2) {
      if (_playerBox.intersectsBox(box)) return true;
    }
  }
  return false;
}

function moveWithCollision(dx, dz, boxes1, boxes2) {
  const tryAxis = (axis, delta) => {
    const prev = axis === 'x' ? group.position.x : group.position.z;
    if (axis === 'x') group.position.x += delta;
    else group.position.z += delta;

    if (isColliding(group.position.x, group.position.y, group.position.z, boxes1, boxes2)) {
      const stepY = group.position.y + STEP_HEIGHT;
      if (!isColliding(group.position.x, stepY, group.position.z, boxes1, boxes2)) {
        group.position.y = stepY;
        velY = 0;
      } else {
        if (axis === 'x') group.position.x = prev;
        else group.position.z = prev;
      }
    }
  };
  tryAxis('x', dx);
  tryAxis('z', dz);
}

function getColliderGroundHeight(x, z, terrainCollider, placedBoxes) {
  let h;
  if (terrainCollider) {
    _rayOrigin.set(x, 200, z);
    _raycaster.set(_rayOrigin, _down);
    _raycaster.firstHitOnly = true;
    _raycaster.far = 500;
    const hit = _raycaster.intersectObject(terrainCollider, false)[0];
    h = hit ? hit.point.y : getTerrainHeight(x, z);
  } else {
    h = getTerrainHeight(x, z);
  }
  if (placedBoxes) {
    const py = group.position.y;
    for (const box of placedBoxes) {
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) {
        const top = box.max.y;
        if (top > h && py + 0.15 >= top) h = top;
      }
    }
  }
  return h;
}

// ── FBX モデル生成 ─────────────────────────────────────
export function create(scene) {
  group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.rotation.y = Math.PI;
  scene.add(group);

  const loader = new FBXLoader();

  loader.load('/chara/model.fbx',
    (fbx) => {
      fbx.scale.setScalar(0.01); // Mixamo FBX は cm 単位
      fbx.castShadow = true;
      fbx.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { m.side = THREE.FrontSide; });
          }
        }
        // 右手ボーンを探す（Mixamo: mixamorigRightHand）
        if (child.isBone && /righthand/i.test(child.name)) {
          rightHandBone = child;
          // setHandItem() が先に呼ばれた場合はここで追加
          if (handItem) rightHandBone.add(handItem);
        }
      });
      group.add(fbx);

      mixer = new THREE.AnimationMixer(fbx);
      // 攻撃アニメ終了 → 攻撃アクションを停止（ベース歩きはそのまま継続）
      mixer.addEventListener('finished', (e) => {
        if (e.action === actions.attack) {
          _isAttacking = false;
          e.action.stop();
        }
      });

      const loadAnim = (url, name, loop = true, upperBodyOnly = false) => {
        loader.load(url, (anim) => {
          const clip = anim.animations[0];
          clip.name  = name;

          clip.tracks = clip.tracks.filter(track => {
            const bone = track.name.split('.')[0];
            const prop = track.name.split('.')[1];
            // Hips の位置トラックを全アニメで除去（ゲームコードが移動を管理するため）
            // ループ時のスナップバックがこれで防げる
            if (/(hip|root)/i.test(bone) && prop === 'position') return false;
            // 攻撃は上半身のみ（下半身ボーンも除去）
            if (upperBodyOnly && /(hip|upleg|leftleg|rightleg|foot|toe)/i.test(bone)) return false;
            return true;
          });

          const action = mixer.clipAction(clip);
          if (!loop) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
          }
          actions[name] = action;
          if (name === 'idle' && !currentAction) {
            action.play();
            currentAction = action;
          }
        });
      };

      loadAnim('/chara/anim_idle.fbx',   'idle');
      loadAnim('/chara/anim_walk.fbx',   'walk');
      loadAnim('/chara/anim_run.fbx',    'run');
      // attack は上半身のみ（下半身を除去してジャンプを防ぐ）
      loadAnim('/chara/anim_attack.fbx', 'attack', false, true);
      loadAnim('/chara/anim_jump.fbx',   'jump',   false);

      modelReady = true;
    },
    undefined,
    (err) => console.error('FBX load error:', err)
  );

  return group;
}

// ── 毎フレーム更新 ────────────────────────────────────
export function update(delta, inputState, cameraYaw, collidableBoxes, terrainCollider, placedBoxes) {
  if (!group) return new THREE.Vector3();

  const { forward, backward, jump, sprint } = inputState;

  const feetY   = group.position.y;
  const inWater = feetY < WATER_LEVEL - 0.05;
  const swimming = feetY < (WATER_LEVEL - WAIST_HEIGHT);

  const baseSpeed = (swimming ? SWIM_SPEED : (sprint ? SPEED * SPRINT_MULT : SPEED)) * Stats.getSpeedMult();

  let moveX = 0, moveZ = 0;
  if (forward)  { moveX -= Math.sin(cameraYaw); moveZ -= Math.cos(cameraYaw); }
  if (backward) { moveX += Math.sin(cameraYaw); moveZ += Math.cos(cameraYaw); }
  const len     = Math.sqrt(moveX * moveX + moveZ * moveZ);
  const isMoving = len > 0;

  _isMoving    = isMoving;
  _isSprinting = isMoving && sprint;

  if (isMoving) {
    const nx = (moveX / len) * baseSpeed * delta;
    const nz = (moveZ / len) * baseSpeed * delta;
    moveWithCollision(nx, nz, collidableBoxes, placedBoxes);
  }

  if (dodgeTimer > 0) {
    dodgeTimer = Math.max(0, dodgeTimer - delta);
    moveWithCollision(dodgeVelX * delta, dodgeVelZ * delta, collidableBoxes, placedBoxes);
  }

  // キャラクターをカメラ方向へ向ける
  const facingAngle = cameraYaw + Math.PI;
  group.rotation.y += shortestAngleDelta(group.rotation.y, facingAngle) * Math.min(1, delta * TURN_SPEED);

  // 垂直移動（水泳 or 通常重力）
  if (swimming) {
    swimTime += delta * 2.5;
    velY += SWIM_BUOYANCY * delta;
    if (jump) velY = Math.max(velY, 2.5);
    velY *= SWIM_DRAG;
    if (feetY + velY * delta > WATER_LEVEL - WAIST_HEIGHT + 0.3) velY = Math.min(velY, 1.0);
    onGround = false;
  } else {
    if (jump && onGround) { velY = JUMP_VEL; onGround = false; }
    velY += GRAVITY * delta;
    if (inWater) velY *= 0.92;
  }

  group.position.y += velY * delta;

  const groundY = getColliderGroundHeight(group.position.x, group.position.z, terrainCollider, placedBoxes);
  if (group.position.y <= groundY) {
    group.position.y = groundY;
    velY      = 0;
    onGround  = true;
  }

  if (attackTimer > 0) attackTimer = Math.max(0, attackTimer - delta);

  // AnimationMixer 更新
  if (mixer) mixer.update(delta);

  // ベースアニメ状態機械（攻撃中も歩き/アイドルは継続して下半身を動かす）
  if (modelReady) {
    if (!onGround && actions.jump) {
      switchAction('jump');
    } else if (isMoving) {
      switchAction(sprint && actions.run ? 'run' : 'walk');
    } else {
      switchAction('idle');
    }
  }

  return group.position;
}
