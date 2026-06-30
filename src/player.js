import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';

const SPEED       = 5;
const SPRINT_MULT = 1.5;
const JUMP_VEL    = 8;
const GRAVITY     = -20;

// プレイヤーのAABBサイズ（幅×高さ×奥行き）
const PLAYER_W = 0.5;
const PLAYER_H = 1.9;
const PLAYER_D = 0.5;

let group, head, hair, body, armL, armR, legL, legR;
let hammerHandle, hammerHead;
let velY    = 0;
let onGround = true;
let animTime = 0;

// 衝突判定用 Box3（再利用してGCを抑える）
const _playerBox = new THREE.Box3();
const _center    = new THREE.Vector3();
const _size      = new THREE.Vector3(PLAYER_W, PLAYER_H, PLAYER_D);

function isColliding(px, py, pz, collidableBoxes) {
  _center.set(px, py + PLAYER_H / 2, pz);
  _playerBox.setFromCenterAndSize(_center, _size);
  for (const box of collidableBoxes) {
    if (_playerBox.intersectsBox(box)) return true;
  }
  return false;
}

export function create(scene) {
  group = new THREE.Group();

  const skin     = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const hairMat  = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
  const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x666688 });
  const limbMat  = new THREE.MeshLambertMaterial({ color: 0x888899 });
  const woodMat  = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x999999 });

  head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
  head.position.y = 1.65;
  head.castShadow = true;

  hair = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.55), hairMat);
  hair.position.y = 1.93;
  hair.castShadow = true;

  body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.3), bodyMat);
  body.position.y = 1.0;
  body.castShadow = true;

  armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), limbMat);
  armL.position.set(-0.4, 1.0, 0);
  armL.castShadow = true;

  armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), limbMat);
  armR.position.set(0.4, 1.0, 0);
  armR.castShadow = true;

  legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.25), limbMat);
  legL.position.set(-0.15, 0.3, 0);
  legL.castShadow = true;

  legR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.25), limbMat);
  legR.position.set(0.15, 0.3, 0);
  legR.castShadow = true;

  hammerHandle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), woodMat);
  hammerHandle.position.set(0.55, 1.0, 0);
  hammerHandle.castShadow = true;

  hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.15), metalMat);
  hammerHead.position.set(0.55, 1.3, 0);
  hammerHead.castShadow = true;

  group.add(head, hair, body, armL, armR, legL, legR, hammerHandle, hammerHead);
  group.position.set(0, 0, 0);
  scene.add(group);

  return group;
}

export function update(delta, inputState, cameraYaw, collidableBoxes) {
  const { forward, backward, left, right, jump, sprint } = inputState;
  const speed = sprint ? SPEED * SPRINT_MULT : SPEED;

  let moveX = 0;
  let moveZ = 0;

  if (forward)  { moveX -= Math.sin(cameraYaw); moveZ -= Math.cos(cameraYaw); }
  if (backward) { moveX += Math.sin(cameraYaw); moveZ += Math.cos(cameraYaw); }
  if (left)     { moveX -= Math.cos(cameraYaw); moveZ += Math.sin(cameraYaw); }
  if (right)    { moveX += Math.cos(cameraYaw); moveZ -= Math.sin(cameraYaw); }

  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  const isMoving = len > 0;

  if (isMoving) {
    const nx = (moveX / len) * speed * delta;
    const nz = (moveZ / len) * speed * delta;

    // X軸・Z軸を独立して試す（壁ずりを可能にする）
    const prevX = group.position.x;
    group.position.x += nx;
    if (isColliding(group.position.x, group.position.y, group.position.z, collidableBoxes)) {
      group.position.x = prevX;
    }

    const prevZ = group.position.z;
    group.position.z += nz;
    if (isColliding(group.position.x, group.position.y, group.position.z, collidableBoxes)) {
      group.position.z = prevZ;
    }

    // 移動した場合のみキャラクター向きを更新
    const movedX = group.position.x - prevX;
    const movedZ = group.position.z - prevZ;
    if (Math.abs(movedX) + Math.abs(movedZ) > 0.0001) {
      const targetAngle = Math.atan2(moveX, moveZ);
      group.rotation.y += (targetAngle - group.rotation.y) * 0.2;
    }
  }

  // ジャンプ・重力
  if (jump && onGround) {
    velY = JUMP_VEL;
    onGround = false;
  }

  velY += GRAVITY * delta;
  group.position.y += velY * delta;

  // 地形追従（getTerrainHeightで現在位置の地面高さを取得）
  const groundY = getTerrainHeight(group.position.x, group.position.z);
  if (group.position.y <= groundY) {
    group.position.y = groundY;
    velY = 0;
    onGround = true;
  }

  // 歩行アニメ
  if (isMoving) {
    animTime += delta * speed * 2.5;
    const swing = Math.sin(animTime) * 0.6;
    armL.rotation.x =  swing;
    armR.rotation.x = -swing;
    legL.rotation.x = -swing;
    legR.rotation.x =  swing;
  } else {
    armL.rotation.x *= 0.8;
    armR.rotation.x *= 0.8;
    legL.rotation.x *= 0.8;
    legR.rotation.x *= 0.8;
  }

  return group.position;
}
