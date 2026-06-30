import * as THREE from 'three';
import { keys, consumePress } from './input.js';
import * as CameraController from './camera.js';
import * as Player from './player.js';
import * as SceneBuilder from './scene.js';
import * as Inventory from './inventory.js';
import * as Gather from './gather.js';
import * as Stats from './stats.js';
import * as Enemy from './enemy.js';
import * as Progression from './progression.js';
import * as Crafting from './crafting.js';
import * as PlacedObjects from './placedObjects.js';
import * as Fish from './fish.js';
import * as Weather from './weather.js';
import * as Projectile from './projectile.js';

const crosshairEl = document.getElementById('crosshair');
let prevPlacementMode = false;

const DODGE_STAMINA = 25;

const canvas = document.getElementById('canvas');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ab8e8);
scene.fog = new THREE.FogExp2(0x9fcce8, 0.0055);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

CameraController.create(camera, canvas);
const world = SceneBuilder.create(scene);
world._catchFish = Fish.catchFish;
const enemies = Enemy.create(scene);
Player.create(scene);
Fish.init(scene);
Weather.init(scene);
Projectile.init(scene, (msg) => Inventory.showPickup(msg));

// ── UI 初期化（scene 確定後） ──────────────────────
Inventory.init();
Stats.init();
Progression.init();
Crafting.init();
PlacedObjects.init(scene, (msg) => Inventory.showPickup(msg));
enemies.setToast((msg) => Inventory.showPickup(msg));

Inventory.setOnPlaceItem((itemId) => {
  Inventory.toggle();
  PlacedObjects.enterPlacementMode(itemId);
});

Inventory.setEquipChangeHandler((itemId) => {
  Player.setHandItem(itemId);
});

PlacedObjects.setOnWorkbenchCraft(() => Crafting.toggle());
PlacedObjects.setOnBedNearby((delta) => {
  if (!Stats.isDead()) Stats.eat(0, 4 * delta); // 4 HP/sec
});
PlacedObjects.setOnBedWarp((pos) => Player.warpTo(pos));

// 設置物のインタラクトヒント表示用 HUD
const hintEl = document.getElementById('interact-hint');

// テイム動物HUD
const tamedHudEl = (() => {
  const el = document.createElement('div');
  el.id = 'tamed-hud';
  el.style.cssText = 'position:fixed;bottom:80px;left:12px;font-size:13px;color:#fff;text-shadow:1px 1px 2px #000;pointer-events:none;';
  document.body.appendChild(el);
  return el;
})();

const respawnBtn = document.getElementById('respawn-btn');
if (respawnBtn) {
  respawnBtn.addEventListener('click', () => {
    Stats.respawn();
    Player.respawn();
  });
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 投擲アイテムの優先順位（装備中 > 投擲ダメージ降順）
const THROW_PRIORITY = [
  'stone_block','stone_axe','stone_pickaxe','stone','stone_knife','flint',
  'iron_ore','copper_ore','coal','plank','wooden_fence','pillar','torch',
  'wood','floor_board','wall_panel','straw',
  'meat','raw_fish','cooked_meat','cooked_fish',
];

function pickThrowItem(equipped) {
  if (equipped && Inventory.has(equipped)) return equipped;
  for (const id of THROW_PRIORITY) {
    if (Inventory.has(id)) return id;
  }
  return null;
}

let lastTime = performance.now();

function loop() {
  requestAnimationFrame(loop);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // UI 系トグル
  if (consumePress('inventory')) Inventory.toggle();
  if (consumePress('status'))    Progression.toggleStatus();
  if (consumePress('craft'))     Crafting.toggle();
  if (consumePress('useFood'))   Inventory.consumeFirstEdible();

  const attackPressed   = consumePress('attack');
  const interactPressed = consumePress('interact');
  const throwPressed    = consumePress('throw');
  const qPressed        = consumePress('dodge');
  const dodgePressed    = qPressed;
  const cancelPressed   = qPressed;

  const dead = Stats.isDead();

  const moving    = !dead && (keys.forward || keys.backward);
  const sprinting = moving && keys.sprint && Stats.canSprint();

  const inputState = dead
    ? { forward: false, backward: false, jump: false, sprint: false }
    : { forward: keys.forward, backward: keys.backward, jump: keys.jump, sprint: sprinting };

  if (!dead) CameraController.rotate(delta, keys.left, keys.right);

  if (!dead && dodgePressed && !Player.isDodging() && !PlacedObjects.isInPlacementMode()) {
    if (Stats.spendStamina(DODGE_STAMINA)) {
      Player.startDodge(CameraController.getYaw(), inputState);
    }
  }

  const playerPos = Player.update(delta, inputState, CameraController.getYaw(), world.collidableBoxes, world.terrainCollider);

  Stats.setInvulnerable(Player.isDodging());

  world.update(playerPos);
  Fish.update(delta);
  Weather.update(delta, playerPos);
  world._fish = Fish.getFish();
  enemies.update(delta, playerPos, world);

  // ── 投擲処理 ──────────────────────────────────────
  if (!dead && throwPressed && !PlacedObjects.isInPlacementMode()) {
    const equipped = Inventory.getEquipped();
    const throwId  = pickThrowItem(equipped);
    if (throwId) {
      Inventory.remove(throwId, 1);
      const throwOrigin = playerPos.clone().add(new THREE.Vector3(0, 1.5, 0));
      Projectile.throwItem(throwId, throwOrigin, Player.getFacing(), 0.32);
      Inventory.showPickup(`↗ ${Inventory.ITEMS[throwId]?.name ?? throwId} を投げた`);
    } else {
      Inventory.showPickup('投げられるアイテムがない');
    }
  }

  // プロジェクタイル更新（ヒット処理）
  const projHits = Projectile.update(delta, enemies.getEnemies());
  for (const { enemy, damage } of projHits) {
    enemies.damageEnemy(enemy, damage);
  }

  // 設置モード切替に合わせてカメラ・クロスヘアを更新
  const nowPlacement = PlacedObjects.isInPlacementMode();
  if (nowPlacement !== prevPlacementMode) {
    prevPlacementMode = nowPlacement;
    CameraController.setPlacementFP(nowPlacement);
    if (crosshairEl) crosshairEl.style.display = nowPlacement ? 'block' : 'none';
  }
  if (nowPlacement && crosshairEl) {
    const { snapped, valid } = PlacedObjects.getPlacementState();
    crosshairEl.dataset.state = snapped ? 'snapped' : valid ? 'valid' : 'invalid';
  }

  const playerFacing  = Player.getFacing();
  const placementRay  = nowPlacement ? CameraController.getPlacementRay() : null;
  PlacedObjects.update(delta, playerPos, playerFacing, dead ? false : attackPressed, cancelPressed, placementRay, world.terrainCollider);

  const hint = PlacedObjects.getInteractHint();
  if (hintEl) hintEl.textContent = hint || '';

  const equipped = Inventory.getEquipped();
  const attackConsumed = !dead && PlacedObjects.tryInteract(
    attackPressed, interactPressed, playerPos, playerFacing, equipped
  );

  // ── 弓での矢発射 ──────────────────────────────────
  let bowShot = false;
  if (!dead && attackPressed && !attackConsumed && equipped === 'bow' && !PlacedObjects.isInPlacementMode()) {
    if (Inventory.has('arrow')) {
      Inventory.remove('arrow', 1);
      const origin = playerPos.clone().add(new THREE.Vector3(0, 1.5, 0));
      Projectile.throwItem('arrow', origin, Player.getFacing(), 0.06, 26);
      Inventory.showPickup('🏹 矢を放った！');
    } else {
      Inventory.showPickup('🏹 矢がない！石と木で作ろう');
    }
    bowShot = true;
  }

  if (!dead) {
    Gather.update(delta, attackPressed && !attackConsumed && !bowShot, playerPos, world, enemies);
  }

  // テイム動物 HUD 更新
  const tamed = enemies.getTamedAnimals();
  if (tamed.length > 0) {
    tamedHudEl.innerHTML = tamed.map(w =>
      `🐺 Lv.${w.tamedLevel} HP: ${Math.max(0, w.hp)}/${w.maxHp}  XP: ${w.tamedXp}`
    ).join('<br>');
  } else {
    tamedHudEl.innerHTML = '';
  }

  Stats.update(delta, { sprinting });
  CameraController.update(playerPos);

  renderer.render(scene, camera);
}

loop();
