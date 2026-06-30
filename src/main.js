import * as THREE from 'three';
import { keys } from './input.js';
import * as CameraController from './camera.js';
import * as Player from './player.js';
import * as SceneBuilder from './scene.js';

const canvas = document.getElementById('canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 150);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

CameraController.create(camera, canvas);
const { collidableBoxes } = SceneBuilder.create(scene);
Player.create(scene);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastTime = performance.now();

function loop() {
  requestAnimationFrame(loop);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const playerPos = Player.update(delta, keys, CameraController.getYaw(), collidableBoxes);
  CameraController.update(playerPos);

  renderer.render(scene, camera);
}

loop();
