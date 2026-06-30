import * as THREE from 'three';
import * as Inventory from './inventory.js';
import { getTerrainHeight } from './scene.js';

const FISH_COLORS = [0x4488dd, 0xee9933, 0x33bb88, 0xcc3322, 0x8855cc, 0xddaa44];

let _scene;
const fishes = [];

function buildFishGroup(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.22, 4, 8), mat);
  body.rotation.z = Math.PI / 2;
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 4), mat);
  tail.rotation.z = -Math.PI / 2;
  tail.position.x = 0.19;
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 5, 4),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  eye.position.set(-0.10, 0.028, 0.040);
  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.060, 0.010),
    new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.65 })
  );
  fin.position.set(0, 0.07, 0);
  g.add(body, tail, eye, fin);
  return g;
}

export function init(scene) {
  _scene = scene;
  const waterSpots = [];
  for (let a = 0; a < 32; a++) {
    const angle = (a / 32) * Math.PI * 2;
    for (let r = 28; r <= 120; r += 14) {
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const h = getTerrainHeight(x, z);
      if (h < -0.8) waterSpots.push({ x, z, groundY: h });
    }
  }
  waterSpots.sort(() => Math.random() - 0.5);
  const count = Math.min(18, waterSpots.length);
  for (let i = 0; i < count; i++) {
    const spot = waterSpots[i];
    const color = FISH_COLORS[i % FISH_COLORS.length];
    const mesh = buildFishGroup(color);
    const y = Math.min(spot.groundY + 0.9, -0.28);
    mesh.position.set(spot.x, y, spot.z);
    scene.add(mesh);
    fishes.push({
      group: mesh,
      position: mesh.position,
      orbitCX: spot.x,
      orbitCZ: spot.z,
      orbitR: 3 + Math.random() * 5,
      orbitSpeed: 0.35 + Math.random() * 0.35,
      orbitAngle: Math.random() * Math.PI * 2,
      bobPhase: Math.random() * Math.PI * 2,
      baseGroundY: spot.groundY,
      alive: true,
    });
  }
}

export function update(delta) {
  for (const fish of fishes) {
    if (!fish.alive) continue;
    fish.orbitAngle += fish.orbitSpeed * delta;
    fish.bobPhase   += delta * 1.8;
    const nx = fish.orbitCX + Math.cos(fish.orbitAngle) * fish.orbitR;
    const nz = fish.orbitCZ + Math.sin(fish.orbitAngle) * fish.orbitR;
    const gh = getTerrainHeight(nx, nz);
    if (gh < -0.2) {
      fish.position.x = nx;
      fish.position.z = nz;
      fish.position.y = Math.min(gh + 0.9, -0.28) + Math.sin(fish.bobPhase) * 0.06;
    }
    fish.group.rotation.y = -(fish.orbitAngle + Math.PI / 2);
    fish.group.rotation.z = Math.sin(fish.bobPhase * 0.5) * 0.07;
  }
}

export function getFish() { return fishes.filter(f => f.alive); }

export function catchFish(fish) {
  if (!fish.alive) return;
  fish.alive = false;
  _scene.remove(fish.group);
  Inventory.add('raw_fish', 1);
  Inventory.showPickup('🐟 魚を捕まえた！');
}
