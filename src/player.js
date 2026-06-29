import * as THREE from 'three';

const SPEED = 5;
const SPRINT_MULT = 1.5;
const JUMP_VELOCITY = 8;
const GRAVITY = -20;
const GROUND_Y = 0;

let group, head, hair, body, armL, armR, legL, legR;
let hammerHandle, hammerHead;
let velY = 0;
let isOnGround = true;
let animTime = 0;

export function create(scene) {
  group = new THREE.Group();

  const skin = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  const hairMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x666688 });
  const limbMat = new THREE.MeshLambertMaterial({ color: 0x888899 });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
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
  group.position.y = GROUND_Y;
  scene.add(group);

  return group;
}

export function update(delta, inputState, cameraYaw) {
  const { forward, backward, left, right, jump, sprint } = inputState;
  const speed = sprint ? SPEED * SPRINT_MULT : SPEED;

  let moveX = 0;
  let moveZ = 0;

  if (forward) { moveX -= Math.sin(cameraYaw); moveZ -= Math.cos(cameraYaw); }
  if (backward) { moveX += Math.sin(cameraYaw); moveZ += Math.cos(cameraYaw); }
  if (left) { moveX -= Math.cos(cameraYaw); moveZ += Math.sin(cameraYaw); }
  if (right) { moveX += Math.cos(cameraYaw); moveZ -= Math.sin(cameraYaw); }

  const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
  if (len > 0) {
    moveX = (moveX / len) * speed * delta;
    moveZ = (moveZ / len) * speed * delta;
    group.position.x += moveX;
    group.position.z += moveZ;

    const targetAngle = Math.atan2(moveX, moveZ);
    const diff = targetAngle - group.rotation.y;
    group.rotation.y += diff * 0.2;
  }

  if (jump && isOnGround) {
    velY = JUMP_VELOCITY;
    isOnGround = false;
  }

  velY += GRAVITY * delta;
  group.position.y += velY * delta;

  if (group.position.y <= GROUND_Y) {
    group.position.y = GROUND_Y;
    velY = 0;
    isOnGround = true;
  }

  const isMoving = len > 0;
  if (isMoving) {
    animTime += delta * speed * 2.5;
    const swing = Math.sin(animTime) * 0.6;
    armL.rotation.x = swing;
    armR.rotation.x = -swing;
    legL.rotation.x = -swing;
    legR.rotation.x = swing;
  } else {
    armL.rotation.x *= 0.8;
    armR.rotation.x *= 0.8;
    legL.rotation.x *= 0.8;
    legR.rotation.x *= 0.8;
  }

  return group.position;
}
