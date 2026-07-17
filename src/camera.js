import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';

const DISTANCE     = 8;
const HEIGHT       = 3;
const LERP         = 0.1;
const ROTATE_SPEED = 2.2;
const FP_EYE_HEIGHT = 1.65;

let yaw   = 0;
let pitch = 0.3;
let isDragging = false;
let lastX = 0;
let lastY = 0;
let camera = null;
let initialized = false;
let fpMode = false;
const targetPos  = new THREE.Vector3();
const currentPos = new THREE.Vector3();

export function create(cam, domElement) {
  camera = cam;
  initialized = false;

  domElement.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    yaw -= dx * 0.005;
    pitch = Math.max(0.05, Math.min(1.2, pitch + dy * 0.005));
  });

  domElement.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('touchend', () => { isDragging = false; });

  window.addEventListener('touchmove', (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - lastX;
    const dy = e.touches[0].clientY - lastY;
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
    yaw -= dx * 0.005;
    pitch = Math.max(0.05, Math.min(1.2, pitch + dy * 0.005));
  }, { passive: true });
}

export function update(target) {
  if (fpMode) {
    // 一人称設置視点：プレイヤーの目の高さにカメラを置く
    // プレイヤーの facing は cameraYaw + PI なので、カメラも -sin/-cos 方向を向く
    const fpAngle = -(pitch - 0.3) * 1.2; // pitch 0.3 = 水平
    camera.position.set(target.x, target.y + FP_EYE_HEIGHT, target.z);
    const lookDist = 20;
    const hLen = Math.cos(fpAngle);
    camera.lookAt(
      target.x - Math.sin(yaw) * hLen * lookDist,
      target.y + FP_EYE_HEIGHT + Math.sin(fpAngle) * lookDist,
      target.z - Math.cos(yaw) * hLen * lookDist,
    );
    return;
  }

  const x = target.x + DISTANCE * Math.sin(yaw) * Math.cos(pitch);
  const y = target.y + HEIGHT   + DISTANCE * Math.sin(pitch);
  const z = target.z + DISTANCE * Math.cos(yaw) * Math.cos(pitch);

  targetPos.set(x, y, z);
  if (!initialized) {
    currentPos.copy(targetPos);
    initialized = true;
  } else {
    currentPos.lerp(targetPos, LERP);
  }
  // 地形へのめり込み防止（丘の斜面などでカメラが地中に潜らないように）
  const minY = getTerrainHeight(currentPos.x, currentPos.z) + 0.4;
  if (currentPos.y < minY) currentPos.y = minY;
  camera.position.copy(currentPos);
  camera.lookAt(target.x, target.y + 1, target.z);
}

// 設置モード切替。有効化：FP へ。無効化：TP へなめらかに戻す。
export function setPlacementFP(enabled) {
  if (enabled) {
    fpMode = true;
  } else {
    fpMode = false;
    if (camera) currentPos.copy(camera.position); // FP 位置から TP へ lerp
    initialized = true;
  }
}

export function isPlacementFP() { return fpMode; }

// 画面中央の視線レイ（設置モード用）
export function getPlacementRay() {
  if (!camera) return null;
  const fpAngle = -(pitch - 0.3) * 1.2;
  const hLen = Math.cos(fpAngle);
  const dir = new THREE.Vector3(
    -Math.sin(yaw) * hLen,
    Math.sin(fpAngle),
    -Math.cos(yaw) * hLen,
  ).normalize();
  return { origin: camera.position.clone(), direction: dir };
}

export function getYaw() { return yaw; }

export function rotate(delta, left, right) {
  if (left)  yaw += ROTATE_SPEED * delta;
  if (right) yaw -= ROTATE_SPEED * delta;
}
