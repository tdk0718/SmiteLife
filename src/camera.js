import * as THREE from 'three';

const DISTANCE = 8;
const HEIGHT = 3;
const LERP = 0.1;

let yaw = 0;
let pitch = 0.3;
let isDragging = false;
let lastX = 0;
let lastY = 0;
let camera = null;
const targetPos = new THREE.Vector3();
const currentPos = new THREE.Vector3();

export function create(cam, domElement) {
  camera = cam;

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
  const x = target.x + DISTANCE * Math.sin(yaw) * Math.cos(pitch);
  const y = target.y + HEIGHT + DISTANCE * Math.sin(pitch);
  const z = target.z + DISTANCE * Math.cos(yaw) * Math.cos(pitch);

  targetPos.set(x, y, z);
  currentPos.lerp(targetPos, LERP);
  camera.position.copy(currentPos);
  camera.lookAt(target.x, target.y + 1, target.z);
}

export function getYaw() {
  return yaw;
}
