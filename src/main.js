import * as THREE from "three";
import { keys, consumePress } from "./input.js";
import * as CameraController from "./camera.js";
import * as Player from "./player.js";
import * as SceneBuilder from "./scene.js";
import * as Inventory from "./inventory.js";
import * as Gather from "./gather.js";
import * as Stats from "./stats.js";
import * as Enemy from "./enemy.js";
import * as Progression from "./progression.js";
import * as Crafting from "./crafting.js";
import * as PlacedObjects from "./placedObjects.js";
import * as Storage from "./storage.js";
import * as Fish from "./fish.js";
import * as Weather from "./weather.js";
import * as Projectile from "./projectile.js";
import * as DamageText from "./damageText.js";
import * as Save from "./save.js";
import * as DayNight from "./daynight.js";

const crosshairEl = document.getElementById("crosshair");
let prevPlacementMode = false;
let isBowAiming = false;
let isFireAiming = false;
let prevFPMode = false;
let fireChargeTime = 0; // Rキーを押し続けている秒数（チャージ量）

const DODGE_STAMINA = 25;
const FIRE_MAGIC_STAMINA = 35;
const FIRE_MAX_CHARGE_TIME = 1.5; // この秒数でチャージ最大
const ENEMY_WHISTLE_COOLDOWN = 18;
let enemyWhistleCooldown = 0;

// 燃えている木ノードの管理
const burningNodes = new Map(); // node → { group, light, burnTimer, damageTimer }

function igniteNode(node) {
  if (burningNodes.has(node) || !node.alive) return;
  const g = new THREE.Group();
  const colors = [0xff4400, 0xff8800, 0xffcc00];
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: colors[i % 3],
      transparent: true,
      opacity: 0.9,
    });
    const h = 0.5 + Math.random() * 0.7;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, h, 6), mat);
    const a = (i / 7) * Math.PI * 2;
    cone.position.set(Math.cos(a) * 0.3, h * 0.5, Math.sin(a) * 0.3);
    cone.rotation.y = Math.random() * Math.PI;
    g.add(cone);
  }
  const light = new THREE.PointLight(0xff5500, 2.5, 9);
  light.position.y = 1.5;
  g.add(light);
  node.group.add(g);
  burningNodes.set(node, { group: g, light, burnTimer: 0, damageTimer: 0 });
}

const canvas = document.getElementById("canvas");

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

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);

CameraController.create(camera, canvas);
const world = SceneBuilder.create(scene);
world._catchFish = Fish.catchFish;
DayNight.init(world.sunLight, world.hemiLight);
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

// ── セーブデータ読み込み ──────────────────────────
Save.setEnemies(enemies); // テイム動物の保存/復元用にインスタンスを登録
{
  const loaded = Save.load();
  if (loaded) {
    // 装備アイテムを手に反映（init後に装備が復元されるため遅延実行）
    const eq = Inventory.getEquipped();
    if (eq) Player.setHandItem(eq);
    setTimeout(
      () => Inventory.showPickup("💾 セーブデータを引き継ぎました"),
      500
    );
  } else {
    // 初回起動: スタート地点にデフォルトの家（柵付き）を建てる
    PlacedObjects.buildStarterHouse();
    setTimeout(
      () =>
        Inventory.showPickup("🏠 目の前に家が建っている！柵のゲートから入ろう"),
      500
    );
  }
}

// レベルアップ時にオートセーブ
Progression.setOnLevelUp(() => Save.save());
// ページを閉じる/リロード前にもセーブ
window.addEventListener("beforeunload", () => Save.save());

Inventory.setOnPlaceItem((itemId) => {
  Inventory.toggle();
  PlacedObjects.enterPlacementMode(itemId);
});

Inventory.setEquipChangeHandler((itemId) => {
  Player.setHandItem(itemId);
});

// 作業台/旋盤のクラフトは設置物のアイテムボックスを材料に使う
PlacedObjects.setOnWorkbenchCraft((obj) =>
  Crafting.openMenu("workbench", obj?.box ?? null)
);
PlacedObjects.setOnBedNearby((delta) => {
  if (!Stats.isDead()) Stats.eat(0, 4 * delta); // 4 HP/sec
});
PlacedObjects.setOnBedWarp((pos) => Player.warpTo(pos));

// 設置物のインタラクトヒント表示用 HUD
const hintEl = document.getElementById("interact-hint");

// テイム動物HUD
const tamedHudEl = (() => {
  const el = document.createElement("div");
  el.id = "tamed-hud";
  el.style.cssText =
    "position:fixed;right:12px;bottom:80px;max-width:min(360px,42vw);font-size:13px;color:#fff;text-align:right;text-shadow:1px 1px 2px #000;pointer-events:none;";
  document.body.appendChild(el);
  return el;
})();

// テイム動物ステータスパネル（Lキー）
const petOverlayEl = document.getElementById("pet-overlay");
const petBodyEl = document.getElementById("pet-body");
let petStatusOpen = false;
let petTarget = null;

if (petBodyEl) {
  petBodyEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pet-select-btn");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    const tamed = enemies.getTamedAnimals();
    if (Number.isInteger(idx) && tamed[idx]) {
      petTarget = tamed[idx];
      renderPetPanel(tamed);
    }
  });
}

function renderPetDetail(info, animal) {
  if (!info) return "";
  const playerPos = Player.getPosition();
  const distance = animal
    ? Math.round(
        Math.hypot(
          animal.position.x - playerPos.x,
          animal.position.z - playerPos.z
        )
      )
    : 0;
  const xpLine = `<div class="status-row"><span>経験値</span><b>${info.xp} / ${
    info.xpForNext
  }（次まで ${Math.max(0, info.xpForNext - info.xp)}）</b></div>`;
  return `
    <div class="status-grid">
      <div class="status-row"><span>名前</span><b>${info.icon} ${
    info.name
  }</b></div>
      <div class="status-row"><span>性別</span><b>${
        info.sex === "♀" ? "♀ メス" : "♂ オス"
      }</b></div>
      <div class="status-row"><span>状態</span><b>${info.status}</b></div>
      <div class="status-row"><span>距離</span><b>約 ${distance}m</b></div>
      <div class="status-row"><span>レベル</span><b>Lv.${info.level}</b></div>
      <div class="status-row"><span>体力</span><b>${info.hp} / ${
    info.maxHp
  }</b></div>
      <div class="status-row"><span>攻撃力</span><b>${info.dmg}</b></div>
      <div class="status-row"><span>移動速度</span><b>${info.speed.toFixed(
        1
      )}</b></div>
      <div class="status-row"><span>体格</span><b>${info.scalePct}%</b></div>
      ${xpLine}
    </div>
    <div class="status-note">仲間が敵を倒すと経験値を得て成長します（体力・攻撃力・体格が向上）。<br>Lv.4以上のオスとメスが近くに揃うとメスが妊娠し、2日後に赤ちゃんが生まれます。</div>`;
}

function renderPetPanel(tamed) {
  if (!petBodyEl) return;
  if (!tamed.length) {
    petBodyEl.innerHTML =
      '<div class="status-note">テイムした動物がいません。</div>';
    return;
  }
  if (!petTarget || !tamed.includes(petTarget)) petTarget = tamed[0];
  const selectedIndex = tamed.indexOf(petTarget);
  const selector = tamed
    .map((animal, idx) => {
      const info = enemies.getTamedInfo(animal);
      const active = idx === selectedIndex ? " active" : "";
      const sex = info.sex === "♀" ? "♀" : "♂";
      return `<button class="pet-select-btn${active}" data-index="${idx}">${info.icon}${sex} Lv.${info.level} HP ${info.hp}/${info.maxHp}</button>`;
    })
    .join("");
  petBodyEl.innerHTML = `
    <div class="pet-layout">
      <div class="pet-list">${selector}</div>
      <div class="pet-detail">${renderPetDetail(
        enemies.getTamedInfo(petTarget),
        petTarget
      )}</div>
    </div>`;
}

function togglePetStatus() {
  if (petStatusOpen) {
    petStatusOpen = false;
    petTarget = null;
    if (petOverlayEl) petOverlayEl.style.display = "none";
    return;
  }
  const tamed = enemies.getTamedAnimals();
  if (tamed.length === 0) {
    Inventory.showPickup("🐺 テイムした動物がいない");
    return;
  }
  petStatusOpen = true;
  petTarget = tamed.includes(petTarget) ? petTarget : tamed[0];
  if (petOverlayEl) petOverlayEl.style.display = "flex";
  renderPetPanel(tamed);
}

const respawnBtn = document.getElementById("respawn-btn");
if (respawnBtn) {
  respawnBtn.addEventListener("click", () => {
    isBowAiming = false;
    isFireAiming = false;
    Stats.respawn();
    const bedPos = PlacedObjects.getNearestBedPosition(Player.getPosition());
    Player.respawn(bedPos); // ベッドがあればそこで、なければ原点
    if (bedPos) Inventory.showPickup("🛏 ベッドで復活した");
  });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 投擲アイテムの優先順位（装備中 > 投擲ダメージ降順）
const THROW_PRIORITY = [
  "stone_block",
  "stone_axe",
  "stone_pickaxe",
  "stone",
  "stone_knife",
  "flint",
  "iron_ore",
  "copper_ore",
  "coal",
  "plank",
  "wooden_fence",
  "pillar",
  "torch",
  "wood",
  "floor_board",
  "wall_panel",
  "straw",
  "meat",
  "raw_fish",
  "cooked_meat",
  "cooked_fish",
];

function pickThrowItem(equipped) {
  // 1) I 画面で「投げる」に選択したアイテムを最優先
  const selected = Inventory.getThrowSelected();
  if (selected && Inventory.has(selected)) return selected;
  // 2) 装備中アイテムが投げられるなら次点
  if (equipped && Inventory.isThrowable(equipped) && Inventory.has(equipped))
    return equipped;
  // 3) 優先順位順にフォールバック
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
  if (consumePress("inventory")) Inventory.toggle();
  if (consumePress("status")) Progression.toggleStatus();
  if (consumePress("craft")) Crafting.toggle();
  if (consumePress("useFood")) Inventory.consumeFirstEdible();
  if (consumePress("petStatus")) togglePetStatus();
  if (consumePress("petOrder")) {
    if (enemies.getTamedAnimals().length > 0) {
      const mode = enemies.toggleTamedOrder();
      Inventory.showPickup(
        mode === "attack"
          ? "🗡 仲間への命令: 攻撃を許可（敵を見つけたら戦う）"
          : "🕊 仲間への命令: 攻撃禁止（そばで待機する）"
      );
      Save.save();
    } else {
      Inventory.showPickup("🐺 命令できる仲間がいない");
    }
  }
  if (consumePress("petMove")) {
    if (enemies.getTamedAnimals().length > 0) {
      const mode = enemies.toggleTamedMove();
      Inventory.showPickup(
        mode === "follow"
          ? "🐾 仲間への命令: 追従モード（そばについてくる）"
          : "🌏 仲間への命令: 放浪モード（その場周辺で自由に過ごす）"
      );
      Save.save();
    } else {
      Inventory.showPickup("🐺 命令できる仲間がいない");
    }
  }

  // アイテムボックスUIが開いている間は F / Q で閉じる（攻撃・回避の誤発動を防ぐ）
  if (Storage.isOpen()) {
    const closeByAttack = consumePress("attack");
    const closeByCancel = consumePress("dodge");
    if (closeByAttack || closeByCancel) Storage.close();
  }

  const dead = Stats.isDead();
  const equipped = Inventory.getEquipped();
  if (enemyWhistleCooldown > 0) enemyWhistleCooldown -= delta;

  // ── 弓の狙い判定（Fキー長押し → 一人称狙い、離すと発射）──────────────
  let bowFireTriggered = false;
  if (
    equipped === "bow" &&
    !dead &&
    !PlacedObjects.isInPlacementMode() &&
    !Storage.isOpen()
  ) {
    if (keys.attack) {
      if (!isBowAiming) isBowAiming = true;
    } else if (isBowAiming) {
      isBowAiming = false;
      bowFireTriggered = true;
    }
  } else if (isBowAiming) {
    isBowAiming = false; // 弓を外したか死亡 → 強制解除
  }

  // ── 炎魔法の狙い判定（Rキー長押し → 一人称狙い＆チャージ、離すと発射）──────
  let fireMagicTriggered = false;
  let fireMagicCharge = 0;
  if (!dead && !PlacedObjects.isInPlacementMode() && !isBowAiming) {
    if (keys.castFire) {
      if (!isFireAiming) {
        isFireAiming = true;
        fireChargeTime = 0;
      }
      fireChargeTime += delta; // 長押しで力をためる
    } else if (isFireAiming) {
      isFireAiming = false;
      fireMagicTriggered = true;
      fireMagicCharge = Math.min(1, fireChargeTime / FIRE_MAX_CHARGE_TIME);
      fireChargeTime = 0;
    }
  } else if (isFireAiming) {
    isFireAiming = false; // 強制解除
    fireChargeTime = 0;
  }

  const attackPressed = consumePress("attack"); // justPressed を消費（弓狙い中も）
  const interactPressed = consumePress("interact");
  const throwPressed = consumePress("throw");
  consumePress("castFire"); // justPressed をクリア（hold 判定に移行）
  const placeRotateLeftPressed = consumePress("placeRotateLeft");
  const placeRotateRightPressed = consumePress("placeRotateRight");
  const qPressed = consumePress("dodge");
  const dodgePressed = qPressed;
  const cancelPressed = qPressed;

  const moving = !dead && (keys.forward || keys.backward);
  const sprinting = moving && keys.sprint && Stats.canSprint();

  const inputState = dead
    ? { forward: false, backward: false, jump: false, sprint: false }
    : {
        forward: keys.forward,
        backward: keys.backward,
        jump: keys.jump,
        sprint: sprinting,
      };

  if (!dead) CameraController.rotate(delta, keys.left, keys.right);

  if (
    !dead &&
    dodgePressed &&
    !Player.isDodging() &&
    !PlacedObjects.isInPlacementMode()
  ) {
    if (Stats.spendStamina(DODGE_STAMINA)) {
      Player.startDodge(CameraController.getYaw(), inputState);
    }
  }

  const placedBoxes = PlacedObjects.getPlacedBoxes();
  const playerPos = Player.update(
    delta,
    inputState,
    CameraController.getYaw(),
    world.collidableBoxes,
    world.terrainCollider,
    placedBoxes
  );

  Stats.setInvulnerable(Player.isDodging());

  world.update(playerPos);
  Fish.update(delta);
  DayNight.update(delta);
  Weather.update(delta, playerPos);
  world._fish = Fish.getFish();
  enemies.update(delta, playerPos, world);

  // ── 投擲処理 ──────────────────────────────────────
  if (
    !dead &&
    throwPressed &&
    !uiOpen &&
    !PlacedObjects.isInPlacementMode() &&
    !isBowAiming
  ) {
    const throwId = pickThrowItem(equipped);
    if (throwId) {
      Inventory.remove(throwId, 1);
      const throwOrigin = playerPos.clone().add(new THREE.Vector3(0, 1.5, 0));
      Projectile.throwItem(throwId, throwOrigin, Player.getFacing(), 0.32);
      Inventory.showPickup(
        `↗ ${Inventory.ITEMS[throwId]?.name ?? throwId} を投げた`
      );
    } else {
      Inventory.showPickup("投げられるアイテムがない");
    }
  }

  // ── 炎魔法発射（Rキーを離した瞬間）────────────────────────────────────
  if (!dead && fireMagicTriggered) {
    // チャージ量に応じてスタミナ消費も増加
    const cost = Math.round(FIRE_MAGIC_STAMINA * (1 + fireMagicCharge));
    if (Stats.spendStamina(cost)) {
      const origin = playerPos.clone().add(new THREE.Vector3(0, 1.45, 0));
      // 一人称狙いモードから離した場合は十字線方向、それ以外は正面方向
      const ray = CameraController.getPlacementRay();
      if (ray)
        Projectile.castFireballDir(origin, ray.direction, fireMagicCharge);
      else Projectile.castFireball(origin, Player.getFacing(), fireMagicCharge);
      Player.triggerAttack();
      Inventory.showPickup(
        fireMagicCharge > 0.6
          ? "🔥 特大の炎魔法を放った！"
          : "🔥 炎魔法を放った！"
      );
    } else {
      Inventory.showPickup("🔥 スタミナが足りない");
    }
  }

  // プロジェクタイル更新（ヒット処理）
  const { hits: projHits, fireballImpacts } = Projectile.update(
    delta,
    enemies.getEnemies()
  );
  for (const { enemy, damage } of projHits) {
    enemies.damageEnemy(enemy, damage);
  }
  // 炎が着弾した位置周辺の木を着火
  for (const { pos, radius } of fireballImpacts) {
    for (const node of world.getResourceNodes()) {
      if (node.type !== "wood" || !node.alive) continue;
      const dist = Math.hypot(pos.x - node.position.x, pos.z - node.position.z);
      if (dist <= radius) igniteNode(node);
    }
  }

  // 設置モード切替 + 弓・炎狙いモードを合わせた FP 管理
  const nowPlacement = PlacedObjects.isInPlacementMode();
  const needsFP = nowPlacement || isBowAiming || isFireAiming;
  if (needsFP !== prevFPMode) {
    CameraController.setPlacementFP(needsFP);
    Player.setVisible(!needsFP); // 一人称時はモデルを非表示（頭の見切れ防止）
    prevFPMode = needsFP;
  }
  // クロスヘア表示（設置モード or 弓/炎狙いモード）
  if (crosshairEl) {
    crosshairEl.style.display = needsFP ? "block" : "none";
    if (isBowAiming || isFireAiming) {
      crosshairEl.dataset.state = "bow"; // 白色クロスヘア
    } else if (nowPlacement) {
      const { snapped, valid } = PlacedObjects.getPlacementState();
      crosshairEl.dataset.state = snapped
        ? "snapped"
        : valid
        ? "valid"
        : "invalid";
    }
  }

  const playerFacing = Player.getFacing();
  const placementRay = nowPlacement ? CameraController.getPlacementRay() : null;
  const placeRotateStep =
    (placeRotateRightPressed ? 1 : 0) - (placeRotateLeftPressed ? 1 : 0);
  PlacedObjects.update(
    delta,
    playerPos,
    playerFacing,
    dead ? false : attackPressed,
    cancelPressed,
    placeRotateStep,
    placementRay,
    world.terrainCollider
  );

  if (isBowAiming) {
    if (hintEl) hintEl.textContent = "🏹 [F を離す] 矢を放つ";
  } else if (isFireAiming) {
    const chargePct = Math.round(
      Math.min(1, fireChargeTime / FIRE_MAX_CHARGE_TIME) * 100
    );
    const filled = Math.round(chargePct / 10);
    const bar = "█".repeat(filled) + "░".repeat(10 - filled);
    if (hintEl)
      hintEl.textContent = `🔥 チャージ ${bar} ${chargePct}%${
        chargePct >= 100 ? " MAX" : ""
      }  [R を離す]`;
  } else {
    const hint = PlacedObjects.getInteractHint();
    if (hintEl) hintEl.textContent = hint || "";
  }

  // 設置モード中の F は「設置確定」専用。tryInteract / Gather には流さない
  // （nowPlacement はフレーム開始時の設置モード状態）
  const attackForWorld =
    attackPressed && !isBowAiming && !nowPlacement && !uiOpen;
  const attackConsumed =
    !dead &&
    PlacedObjects.tryInteract(
      attackPressed && !isBowAiming && !isFireAiming,
      interactPressed,
      playerPos,
      playerFacing,
      equipped
    );

  let whistleConsumed = false;
  if (
    !dead &&
    equipped === "enemy_whistle" &&
    attackPressed &&
    !attackConsumed &&
    !isBowAiming &&
    !isFireAiming &&
    !PlacedObjects.isInPlacementMode()
  ) {
    if (enemyWhistleCooldown > 0) {
      Inventory.showPickup(
        `📯 笛はまだ吹けない（あと${Math.ceil(enemyWhistleCooldown)}秒）`
      );
    } else {
      enemyWhistleCooldown = ENEMY_WHISTLE_COOLDOWN;
      Player.triggerAttack();
      enemies.callEnemyHorde(playerPos, world);
    }
    whistleConsumed = true;
  }

  // ── 弓での矢発射（Fキーを離した瞬間）────────────────────────────
  if (!dead && bowFireTriggered) {
    if (Inventory.has("arrow")) {
      Inventory.remove("arrow", 1);
      const origin = playerPos.clone().add(new THREE.Vector3(0, 1.5, 0));
      Projectile.throwItem("arrow", origin, Player.getFacing(), 0.06, 26);
      Inventory.showPickup("🏹 矢を放った！");
    } else {
      Inventory.showPickup("🏹 矢がない！石と木で作ろう");
    }
  }

  if (!dead) {
    Gather.update(
      delta,
      attackPressed &&
        !attackConsumed &&
        !whistleConsumed &&
        !isBowAiming &&
        !isFireAiming,
      playerPos,
      world,
      enemies
    );
  }

  // 燃えている木の更新（炎アニメ＋定期ダメージ）
  for (const [node, burn] of [...burningNodes]) {
    if (!node.alive || !node.group.parent) {
      node.group.remove(burn.group);
      burningNodes.delete(node);
      continue;
    }
    burn.burnTimer += delta;
    burn.damageTimer += delta;
    burn.light.intensity = 2.0 + Math.sin(burn.burnTimer * 7) * 0.9;
    if (burn.damageTimer >= 1.8) {
      burn.damageTimer = 0;
      world.damageNode(node, 2);
      if (!node.alive) {
        node.group.remove(burn.group);
        burningNodes.delete(node);
      }
    }
  }

  // テイム動物 HUD 更新
  const tamed = enemies.getTamedAnimals();
  if (tamed.length > 0) {
    const orderLabel =
      enemies.getTamedOrder() === "attack" ? "🗡 攻撃を許可" : "🕊 攻撃禁止";
    const moveLabel =
      enemies.getTamedMove() === "follow" ? "🐾 追従" : "🌏 放浪";
    tamedHudEl.innerHTML =
      `<b>命令 [P]: ${orderLabel} / [O]: ${moveLabel}</b><br>` +
      tamed
        .map((w) => {
          const icon = w.type?.icon ?? "🐺";
          const sex = w.sex === "female" ? "♀" : "♂";
          if (w.baby) {
            const m = Math.floor(w.starveTimer / 60);
            const s = String(Math.floor(w.starveTimer % 60)).padStart(2, "0");
            return `${icon}🍼 赤ちゃん${sex} HP: ${Math.max(0, w.hp)}/${
              w.maxHp
            }  餓死まで ${m}:${s}`;
          }
          let line = `${icon}${sex} Lv.${w.tamedLevel} HP: ${Math.max(
            0,
            w.hp
          )}/${w.maxHp}  XP: ${w.tamedXp}`;
          if (w.pregnant)
            line += `  🤰出産まで約${Math.ceil(w.pregnancyTimer / 60)}分`;
          return line;
        })
        .join("<br>");
  } else {
    tamedHudEl.innerHTML = "";
  }

  // テイム動物ステータスパネルを開いている間はリアルタイム更新
  if (petStatusOpen) {
    if (tamed.length === 0) {
      // 対象が死亡/消滅したら閉じる
      petStatusOpen = false;
      petTarget = null;
      if (petOverlayEl) petOverlayEl.style.display = "none";
    } else {
      renderPetPanel(tamed);
    }
  }

  Stats.update(delta, { sprinting });
  CameraController.update(playerPos);
  DamageText.update(delta, camera, renderer);

  renderer.render(scene, camera);
}

loop();
