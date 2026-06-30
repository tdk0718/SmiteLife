import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';
import * as Stats from './stats.js';

const SPEED       = 5;
const SPRINT_MULT = 1.5;
const JUMP_VEL    = 8;
const GRAVITY     = -20;
const TURN_SPEED  = 12;
const DODGE_SPEED = 12;
const DODGE_DURATION = 0.28;
const STEP_HEIGHT = 0.55; // この高さ以下の設置物は自動でよじ登れる

const WATER_LEVEL    = 0.0;   // 水面 y 座標
const WAIST_HEIGHT   = 0.88;  // 腰の高さ（地面からm）
const SWIM_SPEED     = 2.8;   // 泳ぎ速度
const SWIM_BUOYANCY  = 14;    // 浮力
const SWIM_DRAG      = 0.88;  // 水の抵抗（速度減衰）

// プレイヤーのAABBサイズ（幅×高さ×奥行き）
const PLAYER_W = 0.5;
const PLAYER_H = 1.9;
const PLAYER_D = 0.5;

let group, head, hair, neck, body, hips, armL, armR, legL, legR;
let rightArm;
let handItem = null;
let velY    = 0;
let onGround = true;
let animTime = 0;
let attackTimer = 0;
let dodgeTimer = 0;
let dodgeVelX = 0;
let dodgeVelZ = 0;
let swimTime = 0;
const ATTACK_DURATION = 0.42;

export function isSwimming() {
  if (!group) return false;
  return group.position.y < (WATER_LEVEL - WAIST_HEIGHT);
}

// 衝突判定用 Box3（再利用してGCを抑える）
const _playerBox = new THREE.Box3();
const _center    = new THREE.Vector3();
const _size      = new THREE.Vector3(PLAYER_W, PLAYER_H, PLAYER_D);
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function buildHandMesh(itemId) {
  const g = new THREE.Group();
  const woodMat  = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x9a9080 });
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0xc0c0b8 });
  const fireMat  = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 0.8 });
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
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.055, 0.04), stoneMat);
      head.position.set(0, -0.38, 0);
      g.add(handle, head);
      break;
    }
    case 'stone_knife': {
      const hnd = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.13, 6), woodMat);
      hnd.position.y = -0.065;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.25, 0.018), bladeMat);
      blade.position.y = -0.255;
      g.add(hnd, blade);
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
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.11, 6), fireMat);
      flame.position.y = 0.055;
      g.add(handle, flame);
      break;
    }
    default: break;
  }
  return g;
}

export function setHandItem(itemId) {
  if (!rightArm) return;
  if (handItem) { rightArm.remove(handItem); handItem = null; }
  if (!itemId) return;
  handItem = buildHandMesh(itemId);
  handItem.position.set(0.02, -0.66, 0.06);
  rightArm.add(handItem);
}

// 攻撃モーションを開始する（gather.js から呼ばれる）
export function triggerAttack() {
  attackTimer = ATTACK_DURATION;
}

// キャラクターの向き（rotation.y）を返す
export function getFacing() {
  return group ? group.rotation.y : 0;
}

export function getPosition() {
  return group ? group.position.clone() : new THREE.Vector3(0, 0, 0);
}

export function warpTo(pos) {
  if (!group) return;
  group.position.set(pos.x, pos.y + 0.15, pos.z);
  velY = 0;
}

// spawnPos が指定されればそこで復活、なければ原点
export function respawn(spawnPos) {
  if (!group) return;
  const px = spawnPos ? spawnPos.x : 0;
  const py = spawnPos ? spawnPos.y + 0.20 : getTerrainHeight(0, 0);
  const pz = spawnPos ? spawnPos.z : 0;
  group.position.set(px, py, pz);
  group.rotation.y = Math.PI;
  velY = 0;
  onGround = true;
  attackTimer = 0;
  dodgeTimer = 0;
  dodgeVelX = 0;
  dodgeVelZ = 0;
  armL.rotation.set(0, 0, 0);
  rightArm.rotation.set(0, 0, 0);
  legL.rotation.set(0, 0, 0);
  legR.rotation.set(0, 0, 0);
  group.rotation.z = 0;
  setHandItem(null);
}

export function startDodge(cameraYaw, inputState) {
  if (!group || dodgeTimer > 0) return false;

  let dirX = 0;
  let dirZ = 0;
  if (inputState?.forward)  { dirX -= Math.sin(cameraYaw); dirZ -= Math.cos(cameraYaw); }
  if (inputState?.backward) { dirX += Math.sin(cameraYaw); dirZ += Math.cos(cameraYaw); }

  // 移動入力が無い場合はキャラクター正面へ回避
  const len = Math.hypot(dirX, dirZ);
  if (len > 0.001) {
    dirX /= len; dirZ /= len;
  } else {
    dirX = Math.sin(group.rotation.y);
    dirZ = Math.cos(group.rotation.y);
  }

  dodgeVelX = dirX * DODGE_SPEED;
  dodgeVelZ = dirZ * DODGE_SPEED;
  dodgeTimer = DODGE_DURATION;
  return true;
}

export function isDodging() {
  return dodgeTimer > 0;
}

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
      // 段差を越えられるか試す（設置物に乗るため）
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
    // プレイヤー直上から真下へレイを飛ばし、BVHで高速に地面/静的メッシュを取得
    _rayOrigin.set(x, 200, z);
    _raycaster.set(_rayOrigin, _down);
    _raycaster.firstHitOnly = true;
    _raycaster.far = 500;
    const hit = _raycaster.intersectObject(terrainCollider, false)[0];
    h = hit ? hit.point.y : getTerrainHeight(x, z);
  } else {
    h = getTerrainHeight(x, z);
  }

  // 設置物の上面もグラウンドとして認識（乗り上げ判定）
  if (placedBoxes) {
    const py = group.position.y;
    for (const box of placedBoxes) {
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) {
        const top = box.max.y;
        if (top > h && py + 0.15 >= top) {
          h = top;
        }
      }
    }
  }
  return h;
}

export function create(scene) {
  group = new THREE.Group();

  // ─ マテリアル ──────────────────────────────────────
  const skin    = new THREE.MeshLambertMaterial({ color: 0xf2c49a });
  const skinDark= new THREE.MeshLambertMaterial({ color: 0xe8b888 });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x1e0f04 });
  const shirtMat= new THREE.MeshLambertMaterial({ color: 0x4a5a70 });
  const shirtDk = new THREE.MeshLambertMaterial({ color: 0x3a4a60 });
  const pantsMat= new THREE.MeshLambertMaterial({ color: 0x2e2840 });
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x111010 });
  const eyeMat  = new THREE.MeshLambertMaterial({ color: 0x0a0a18 });
  const scleraMat=new THREE.MeshLambertMaterial({ color: 0xf8f4ee });

  const shadow = (m) => { m.castShadow = true; return m; };

  // ─ 頭 (SphereGeometry r=0.135) ─────────────────────
  head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), skin));
  head.position.set(0, 1.745, 0);

  // 白目
  const eyeWhiteGeo = new THREE.SphereGeometry(0.032, 7, 5);
  const eyeWhiteL = new THREE.Mesh(eyeWhiteGeo, scleraMat);
  eyeWhiteL.position.set(-0.048, 1.762, 0.115);
  eyeWhiteL.scale.z = 0.6;
  const eyeWhiteR = eyeWhiteL.clone(); eyeWhiteR.position.x = 0.048;

  // 瞳
  const eyeGeo = new THREE.SphereGeometry(0.018, 6, 4);
  const eyeL_m = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL_m.position.set(-0.050, 1.762, 0.125);
  eyeL_m.scale.z = 0.5;
  const eyeR_m = eyeL_m.clone(); eyeR_m.position.x = 0.05;

  // 鼻
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 4), skinDark);
  nose.position.set(0, 1.722, 0.132);
  nose.scale.set(1.4, 0.9, 1);

  // 耳
  const earGeo = new THREE.SphereGeometry(0.034, 7, 5);
  const earL_m = new THREE.Mesh(earGeo, skinDark);
  earL_m.position.set(-0.148, 1.742, 0.005);
  earL_m.scale.z = 0.6;
  const earR_m = earL_m.clone(); earR_m.position.x = 0.148;

  // ─ 髪 (複数パーツ) ─────────────────────────────────
  hair = new THREE.Group();
  const hTop  = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.142, 10, 7), hairMat));
  hTop.position.set(0, 1.838, 0); hTop.scale.set(1, 0.58, 1);
  const hBack = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), hairMat));
  hBack.position.set(0, 1.79, -0.085);
  const hSL   = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.068, 7, 5), hairMat));
  hSL.position.set(-0.110, 1.79, 0.015);
  const hSR   = hSL.clone(); hSR.position.x = 0.110;
  const hFront= shadow(new THREE.Mesh(new THREE.SphereGeometry(0.058, 6, 5), hairMat));
  hFront.position.set(0, 1.84, 0.095);
  hair.add(hTop, hBack, hSL, hSR, hFront);

  // ─ 首 (CylinderGeometry) ────────────────────────────
  neck = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.065, 0.10, 9), skin));
  neck.position.set(0, 1.62, 0);

  // ─ 胴体 (CapsuleGeometry) ───────────────────────────
  body = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.28, 4, 10), shirtMat));
  body.position.set(0, 1.28, 0);

  // 胸の切れ目ライン（シャツのV字ライン風）
  const collarMat = new THREE.MeshLambertMaterial({ color: 0xf2c49a });
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.08, 8), collarMat);
  collar.position.set(0, 1.545, 0);

  // ─ 腰 (CylinderGeometry) ─────────────────────────────
  hips = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.148, 0.22, 10), pantsMat));
  hips.position.set(0, 0.88, 0);

  // ─ 肩の球 (視覚的な関節) ───────────────────────────
  const shGeo = new THREE.SphereGeometry(0.082, 9, 7);
  const shL   = shadow(new THREE.Mesh(shGeo, shirtDk));
  shL.position.set(-0.26, 1.52, 0);
  const shR   = shL.clone(); shR.position.x = 0.26;

  // ─ 左腕 Group (pivot = 肩) ───────────────────────────
  armL = new THREE.Group();
  armL.position.set(-0.26, 1.52, 0);
  const aLU = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.060, 0.30, 9), skin));
  aLU.position.y = -0.15;
  const aLElb = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), skin));
  aLElb.position.y = -0.30;
  const aLD = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.052, 0.28, 8), skin));
  aLD.position.y = -0.44;
  const aLHand = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.050, 8, 6), skin));
  aLHand.position.set(0, -0.595, 0.008);
  aLHand.scale.set(1.15, 0.80, 0.72);
  armL.add(aLU, aLElb, aLD, aLHand);

  // ─ 右腕 Group (pivot = 肩) ───────────────────────────
  rightArm = new THREE.Group();
  rightArm.position.set(0.26, 1.52, 0);
  const aRU = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.060, 0.30, 9), skin));
  aRU.position.y = -0.15;
  const aRElb = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), skin));
  aRElb.position.y = -0.30;
  armR = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.052, 0.28, 8), skin));
  armR.position.y = -0.44;
  const aRHand = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.050, 8, 6), skin));
  aRHand.position.set(0, -0.595, 0.008);
  aRHand.scale.set(1.15, 0.80, 0.72);
  rightArm.add(aRU, aRElb, armR, aRHand);

  // ─ 左脚 Group (pivot = 股関節) ──────────────────────
  legL = new THREE.Group();
  legL.position.set(-0.11, 0.77, 0);
  const lLU  = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.092, 0.36, 9), pantsMat));
  lLU.position.y = -0.18;
  const lLKnee = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.076, 9, 7), pantsMat));
  lLKnee.position.y = -0.37;
  const lLD  = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.076, 0.36, 8), pantsMat));
  lLD.position.y = -0.55;
  const lLFoot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.110, 0.068, 0.220), shoeMat));
  lLFoot.position.set(0, -0.76, 0.040);
  legL.add(lLU, lLKnee, lLD, lLFoot);

  // ─ 右脚 Group (pivot = 股関節) ──────────────────────
  legR = new THREE.Group();
  legR.position.set(0.11, 0.77, 0);
  const lRU  = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.092, 0.36, 9), pantsMat));
  lRU.position.y = -0.18;
  const lRKnee = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.076, 9, 7), pantsMat));
  lRKnee.position.y = -0.37;
  const lRD  = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.060, 0.076, 0.36, 8), pantsMat));
  lRD.position.y = -0.55;
  const lRFoot = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.110, 0.068, 0.220), shoeMat));
  lRFoot.position.set(0, -0.76, 0.040);
  legR.add(lRU, lRKnee, lRD, lRFoot);

  group.add(
    head, eyeWhiteL, eyeWhiteR, eyeL_m, eyeR_m,
    nose, earL_m, earR_m,
    hair, neck, collar,
    body, hips,
    shL, shR,
    armL, rightArm,
    legL, legR,
  );
  group.position.set(0, 0, 0);
  group.rotation.y = Math.PI;
  scene.add(group);

  return group;
}

export function update(delta, inputState, cameraYaw, collidableBoxes, terrainCollider, placedBoxes) {
  const { forward, backward, jump, sprint } = inputState;

  // 水泳判定
  const feetY   = group.position.y;
  const inWater = feetY < WATER_LEVEL - 0.05;
  const swimming = feetY < (WATER_LEVEL - WAIST_HEIGHT);

  const baseSpeed = (swimming ? SWIM_SPEED : (sprint ? SPEED * SPRINT_MULT : SPEED)) * Stats.getSpeedMult();

  let moveX = 0;
  let moveZ = 0;

  if (forward)  { moveX -= Math.sin(cameraYaw); moveZ -= Math.cos(cameraYaw); }
  if (backward) { moveX += Math.sin(cameraYaw); moveZ += Math.cos(cameraYaw); }
  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  const isMoving = len > 0;

  if (isMoving) {
    const nx = (moveX / len) * baseSpeed * delta;
    const nz = (moveZ / len) * baseSpeed * delta;
    moveWithCollision(nx, nz, collidableBoxes, placedBoxes);
  }

  if (dodgeTimer > 0) {
    dodgeTimer = Math.max(0, dodgeTimer - delta);
    moveWithCollision(dodgeVelX * delta, dodgeVelZ * delta, collidableBoxes, placedBoxes);
  }

  const facingAngle = cameraYaw + Math.PI;
  group.rotation.y += shortestAngleDelta(group.rotation.y, facingAngle) * Math.min(1, delta * TURN_SPEED);

  if (swimming) {
    // 泳ぎ: 浮力 + 水の抵抗 + ジャンプキーで浮上
    velY += SWIM_BUOYANCY * delta;
    if (jump) velY = Math.max(velY, 2.5);
    velY *= SWIM_DRAG;
    // 水面より上に出ないよう制限
    if (feetY + velY * delta > WATER_LEVEL - WAIST_HEIGHT + 0.3) {
      velY = Math.min(velY, 1.0);
    }
    onGround = false;
  } else {
    // 通常重力
    if (jump && onGround) {
      velY = JUMP_VEL;
      onGround = false;
    }
    velY += GRAVITY * delta;
    if (inWater) velY *= 0.92; // 浅瀬では落下速度を緩める
  }

  group.position.y += velY * delta;

  const groundY = getColliderGroundHeight(group.position.x, group.position.z, terrainCollider, placedBoxes);
  if (group.position.y <= groundY) {
    group.position.y = groundY;
    velY = 0;
    onGround = true;
  }

  if (attackTimer > 0) {
    attackTimer = Math.max(0, attackTimer - delta);
  }

  // アニメーション
  const attackProgress = attackTimer > 0 ? 1 - attackTimer / ATTACK_DURATION : 1;

  if (swimming) {
    // 泳ぎアニメ: 体を前傾、腕を平泳ぎ
    swimTime += delta * 2.5;
    body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, 0.55, delta * 6);
    hips.rotation.x = THREE.MathUtils.lerp(hips.rotation.x, 0.45, delta * 6);
    const stroke = Math.sin(swimTime) * 0.7;
    armL.rotation.x  = THREE.MathUtils.lerp(armL.rotation.x,  stroke * -1, delta * 8);
    armL.rotation.z  = THREE.MathUtils.lerp(armL.rotation.z,  -0.6, delta * 6);
    rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, stroke, delta * 8);
    rightArm.rotation.z = THREE.MathUtils.lerp(rightArm.rotation.z,  0.0, delta * 6);
    const kick = Math.sin(swimTime * 2) * 0.4;
    legL.rotation.x = THREE.MathUtils.lerp(legL.rotation.x,  kick, delta * 10);
    legR.rotation.x = THREE.MathUtils.lerp(legR.rotation.x, -kick, delta * 10);
    group.rotation.z *= 0.9;
    return group.position;
  }

  // 通常アニメに戻す
  body.rotation.x  = THREE.MathUtils.lerp(body.rotation.x,  0, delta * 5);
  hips.rotation.x  = THREE.MathUtils.lerp(hips.rotation.x,  0, delta * 5);
  armL.rotation.z  = THREE.MathUtils.lerp(armL.rotation.z,  0, delta * 5);
  rightArm.rotation.z = THREE.MathUtils.lerp(rightArm.rotation.z, 0, delta * 5);

  if (dodgeTimer > 0) {
    group.rotation.z = Math.sin((1 - dodgeTimer / DODGE_DURATION) * Math.PI) * 0.18;
    armL.rotation.x *= 0.8;
    rightArm.rotation.x *= 0.8;
    legL.rotation.x *= 0.8;
    legR.rotation.x *= 0.8;
  } else {
    group.rotation.z *= 0.8;
  }

  if (isMoving && dodgeTimer <= 0) {
    animTime += delta * baseSpeed * 2.5;
    const swing = Math.sin(animTime) * 0.6;
    armL.rotation.x =  swing;
    if (attackTimer <= 0) rightArm.rotation.x = -swing;
    legL.rotation.x = -swing;
    legR.rotation.x =  swing;
  } else {
    armL.rotation.x *= 0.8;
    if (attackTimer <= 0) rightArm.rotation.x *= 0.8;
    legL.rotation.x *= 0.8;
    legR.rotation.x *= 0.8;
  }

  if (attackTimer > 0) {
    // 0〜0.45: 振り上げ、0.45〜1: 振り下ろし。ハンマー感を出すため大きく前後に振る。
    const t = attackProgress < 0.45
      ? attackProgress / 0.45
      : 1 - (attackProgress - 0.45) / 0.55;
    rightArm.rotation.x = THREE.MathUtils.lerp(-1.3, 1.05, t);
    rightArm.rotation.z = THREE.MathUtils.lerp(0.15, -0.2, t);
  } else {
    rightArm.rotation.z *= 0.8;
  }

  return group.position;
}
