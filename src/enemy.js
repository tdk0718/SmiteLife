import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';
import * as Stats from './stats.js';
import * as Inventory from './inventory.js';
import * as Progression from './progression.js';
import { pickEnemyTypeAt, pickLevel, ENEMY_TYPES, LEVEL_TIERS } from './enemyTypes.js';
import { getBurningFirePositions, getObstacles } from './placedObjects.js';
import { getBaits, consumeBait } from './projectile.js';
import * as DamageText from './damageText.js';
import { DAY_LENGTH } from './daynight.js';

const MAX_ENEMIES    = 10;
const SPAWN_INTERVAL = 4;
const SPAWN_MIN_DIST = 22;
const SPAWN_MAX_DIST = 34;
const DESPAWN_DIST   = 90;
const FIRE_FEAR_DIST = 9;
const PLAYER_FIRE_SAFE = 7;
const WATER_Y         = -0.10; // この高さ未満は水
const WATER_SURFACE_Y = -0.28; // 水中でのフロート高さ（水面付近）
const WATER_REP_RANGE =  1.8;  // 水域を検知するサンプル距離
const WATER_REP_STR   =  2.2;  // 水域回避力（追跡時は半減）
const TAMED_FIGHT_RANGE = 10; // テイム動物が戦いに参加する範囲
const TAMED_WANDER_RADIUS = 6;  // プレイヤーの周囲この範囲をうろうろする
const TAMED_LEASH_MAX     = 11; // この距離より離れたらプレイヤーの元へ戻る
const TAMED_ROAM_RADIUS   = 12; // 放浪モード時に自分の周囲をうろつく範囲
const STUCK_CHECK_SEC     = 0.5;  // スタック判定の間隔
const STUCK_MIN_MOVE      = 0.15; // この距離未満しか動けていなければスタック

// ── 繁殖・赤ちゃん ───────────────────────────────
const BREED_LEVEL      = 4;              // 繁殖に必要なテイムレベル
const BREED_RANGE      = 10;             // オスメスがこの距離内で繁殖成立
const PREGNANCY_TIME   = DAY_LENGTH * 2; // 妊娠期間: 2日で出産
const BREED_COOLDOWN   = DAY_LENGTH;     // 出産後、次の妊娠までのクールダウン
const BABY_STARVE_TIME = 20 * 60;        // 餌を与えないと20分で餓死
const BABY_GROW_TIME   = DAY_LENGTH;     // 1日かけて大人に成長
const BABY_SCALE       = 0.45;           // Lv.1個体より小さい
const BABY_BAIT_RANGE  = 14;             // 赤ちゃんが餌を見つけられる距離
const EGG_HATCH_TIME   = 8 * 60;         // 卵の孵化時間

function sexLabel(e) { return e.sex === 'female' ? '♀' : '♂'; }
function randomSex()  { return Math.random() < 0.5 ? 'male' : 'female'; }

// テイム動物レベルテーブル（Lv1〜5の基準値。これ以降は計算式で無限に成長する）
const TAMED_XP_THRESH = [0, 50, 130, 300, 700]; // Lv2〜5に必要な累計XP
const TAMED_STATS = [
  { level: 1, hp: 15, dmg: 6,  speed: 4.8, scale: 1.00 },
  { level: 2, hp: 28, dmg: 10, speed: 5.2, scale: 1.18 },
  { level: 3, hp: 45, dmg: 16, speed: 5.7, scale: 1.36 },
  { level: 4, hp: 68, dmg: 25, speed: 6.2, scale: 1.56 },
  { level: 5, hp: 100, dmg: 38, speed: 6.8, scale: 1.80 },
];

// レベルに応じたステータス（レベルキャップなし）。表にない高レベルは指数的に増加。
function tamedStatsFor(level) {
  if (level <= TAMED_STATS.length) return TAMED_STATS[level - 1];
  const over = level - TAMED_STATS.length;               // Lv5を超えた分
  const last = TAMED_STATS[TAMED_STATS.length - 1];
  return {
    level,
    hp:    Math.round(last.hp  * Math.pow(1.22, over)),
    dmg:   Math.round(last.dmg * Math.pow(1.20, over)),
    speed: Math.min(9.5, last.speed + over * 0.15),      // 速度は暴走防止に上限
    scale: Math.min(3.2, last.scale + over * 0.10),      // 体格も上限（巨大化しすぎ防止）
  };
}

// そのレベルに到達するために必要な累計XP（レベルキャップなし）
function tamedXpForLevel(level) {
  if (level <= 1) return 0;
  if (level <= TAMED_XP_THRESH.length) return TAMED_XP_THRESH[level - 1];
  const over = level - TAMED_XP_THRESH.length;           // Lv5を超えた分
  const last = TAMED_XP_THRESH[TAMED_XP_THRESH.length - 1]; // Lv5 = 700
  return Math.round(last * Math.pow(1.6, over));
}

const _raycaster = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);

function groundHeight(x, z, terrainCollider) {
  if (terrainCollider) {
    _raycaster.set(new THREE.Vector3(x, 200, z), _down);
    _raycaster.firstHitOnly = true;
    _raycaster.far = 500;
    const hit = _raycaster.intersectObject(terrainCollider, false)[0];
    if (hit) return hit.point.y;
  }
  return getTerrainHeight(x, z);
}

// 4方向サンプリングで水域から離れる方向ベクトルを返す（getTerrainHeightは軽量）
// 水に面していなければ null を返す
function calcWaterRepulsion(x, z) {
  const S = WATER_REP_RANGE;
  let rx = 0, rz = 0;
  if (getTerrainHeight(x,     z - S) < WATER_Y) rz += 1;
  if (getTerrainHeight(x,     z + S) < WATER_Y) rz -= 1;
  if (getTerrainHeight(x - S, z    ) < WATER_Y) rx += 1;
  if (getTerrainHeight(x + S, z    ) < WATER_Y) rx -= 1;
  const len = Math.hypot(rx, rz);
  return len > 0 ? { rx: rx / len, rz: rz / len } : null;
}

export function create(scene) {
  const enemies = [];
  let spawnTimer = SPAWN_INTERVAL * 0.5;
  let breedTimer = 5; // 繁殖判定の間隔タイマー
  let tamedOrder = 'attack'; // 仲間への全体命令: 'attack'（攻撃する・デフォルト） | 'passive'（攻撃しない）
  let tamedMove  = 'follow'; // 仲間への移動命令: 'follow'（追従・デフォルト） | 'roam'（放浪）
  let _toastFn = null;

  // 資源ノード（木・岩）と設置物から押し出して、すり抜けを防ぐ
  function pushOutOfObstacles(e, world) {
    const er = 0.40 * e.baseScale;
    for (const node of (world?.getResourceNodes?.() ?? [])) {
      if (!node.alive) continue;
      const nt = node.type;
      if (nt === 'grass' || nt === 'mushroom' || nt === 'toxic_mushroom') continue;
      const ndx = e.position.x - node.position.x, ndz = e.position.z - node.position.z;
      if (Math.abs(ndx) > 5 || Math.abs(ndz) > 5) continue;
      const sc = node.sizeScale || 1.0;
      const nr = nt === 'wood' ? 0.22 + 0.28 * sc : 0.35 * sc;
      const nd = Math.hypot(ndx, ndz);
      if (nd < er + nr && nd > 0.001) { const f = (er + nr - nd) / nd; e.position.x += ndx * f; e.position.z += ndz * f; }
    }
    for (const obs of getObstacles()) {
      const odx = e.position.x - obs.x, odz = e.position.z - obs.z;
      if (Math.abs(odx) > 4 || Math.abs(odz) > 4) continue;
      const od = Math.hypot(odx, odz);
      if (od < er + obs.r && od > 0.001) { const f = (er + obs.r - od) / od; e.position.x += odx * f; e.position.z += odz * f; }
    }
  }

  function toast(msg) { _toastFn?.(msg); }
  function setToast(fn) { _toastFn = fn; }

  function spawnEnemyAt(x, z, options = {}) {
    const y = getTerrainHeight(x, z);
    const type  = pickEnemyTypeAt(x, z); // 場所に応じた出現分布
    const tier  = pickLevel();
    const sex   = randomSex();

    const { group, legs, body, belly } = type.build(sex);
    group.position.set(x, y, z);
    group.scale.setScalar(tier.sizeScale);
    scene.add(group);

    const maxHp = Math.max(1, Math.round(type.hp * tier.hpMult));
    enemies.push({
      type,
      tier,
      group,
      legs:  legs  || [],
      body:  body  || null,
      belly: belly || null,
      bodyBaseY:   body ? body.position.y : 0.58,
      position:    group.position,
      baseScale:   tier.sizeScale,
      hp:          maxHp,
      maxHp,
      damage:      Math.max(1, Math.round(type.damage     * tier.dmgMult)),
      speedChase:  type.speedChase * tier.speedMult,
      speedWander: type.speedWander,
      xp:          Math.round((type.xp || 0) * tier.xpMult),
      alive:       true,
      aggro:       !!options.aggro && !type.passive,
      attackCd:    0,
      animTime:    0,
      wander:      new THREE.Vector3(x, y, z),
      wanderTimer: 0,
      // 性別
      sex,
      fleeTimer:   0,
      // テイム関連
      affection:   0,
      tamed:       false,
      tamedLevel:  1,
      tamedXp:     0,
      eatCooldown: 0,
      // 繁殖関連
      pregnant:       false,
      pregnancyTimer: 0,
      breedCd:        0,
      baby:           false,
      starveTimer:    0,
      growTimer:      0,
    });
    return enemies[enemies.length - 1];
  }

  function spawnEnemy(playerPos) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    return spawnEnemyAt(x, z);
  }

  function callEnemyHorde(playerPos, world, count = 18) {
    const terrainCollider = world?.terrainCollider ?? null;
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 16 + Math.random() * 18;
      let x = playerPos.x + Math.cos(angle) * dist;
      let z = playerPos.z + Math.sin(angle) * dist;

      // 水中や急な低地に偏った場合は、少しずらして陸地候補を探す。
      for (let j = 0; j < 5 && groundHeight(x, z, terrainCollider) < WATER_Y; j++) {
        const retryA = angle + (Math.random() - 0.5) * 1.4;
        const retryD = 18 + Math.random() * 20;
        x = playerPos.x + Math.cos(retryA) * retryD;
        z = playerPos.z + Math.sin(retryA) * retryD;
      }

      const enemy = spawnEnemyAt(x, z, { aggro: true });
      if (enemy) {
        enemy.wander.set(playerPos.x, 0, playerPos.z);
        spawned++;
      }
    }
    if (spawned > 0) toast(`📯 笛の音に引かれて周囲の敵が集まってきた！ (${spawned}体)`);
    return spawned;
  }

  function removeEnemy(enemy) {
    scene.remove(enemy.group);
    enemy.group.traverse((c) => { if (c.isMesh) c.geometry.dispose(); });
    enemy.alive = false;
  }

  // テイム動物の外観（金の首輪。狼は毛色だけ友好的な色に変える）を適用する
  function applyTamedAppearance(animal) {
    if (animal.type.id === 'wolf') {
      const tamedFurMat = new THREE.MeshLambertMaterial({ color: 0xa0a8c8 });
      // 毛皮メッシュのみ着色（目・鼻などのパーツは保持）
      animal.group.traverse((c) => {
        if (c.isMesh && c.userData.fur) c.material = tamedFurMat;
      });
    }
    const collarDef = animal.type.collar ?? { y: 0.74, z: 0.50, r: 0.17 };
    const collarMat = new THREE.MeshLambertMaterial({ color: 0xd4a020 });
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(collarDef.r, collarDef.r, 0.07, 10),
      collarMat
    );
    collar.position.set(0, collarDef.y, collarDef.z);
    collar.rotation.x = -0.3; // 首の前傾に沿わせる
    animal.group.add(collar);
  }

  // 動物をテイムする
  function tameAnimal(animal) {
    animal.tamed = true;
    animal.tamedLevel = 1;
    animal.tamedXp = 0;
    animal.aggro = false;
    const stats = TAMED_STATS[0];
    animal.hp    = stats.hp;
    animal.maxHp = stats.hp;
    // テイム時点の体格を基準として記録（レベルアップで拡大する）
    animal.tamedBaseScale = animal.baseScale;

    applyTamedAppearance(animal);

    toast(`${animal.type.icon} ${animal.type.name}${sexLabel(animal)} がテイムされた！仲間になった！(Lv.${animal.tamedLevel} HP:${animal.maxHp})`);
  }

  // ── 繁殖・出産 ─────────────────────────────────
  const eggs = []; // { type, mesh, timer, x, z }

  function markPregnant(female) {
    female.pregnant = true;
    female.pregnancyTimer = PREGNANCY_TIME;
    // お腹をふっくらさせる（bellyメッシュ優先、なければ体全体）
    const bellyTarget = female.belly ?? female.body;
    if (bellyTarget) {
      female._preScale = female._preScale ?? bellyTarget.scale.clone();
      bellyTarget.scale.copy(female._preScale).multiplyScalar(1.3);
    }
    const icon = female.type.icon;
    toast(female.type.oviparous
      ? `🥚 ${icon} メスの${female.type.name}が卵を宿した！（2日後に産卵）`
      : `💕 ${icon} メスの${female.type.name}が妊娠した！（2日後に出産）`);
  }

  function spawnEgg(mother) {
    const eggMat = new THREE.MeshLambertMaterial({ color: 0xf2ead6 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.20, 8, 6), eggMat);
    mesh.scale.set(1, 1.3, 1);
    const x = mother.position.x, z = mother.position.z;
    mesh.position.set(x, getTerrainHeight(x, z) + 0.2, z);
    mesh.castShadow = true;
    scene.add(mesh);
    eggs.push({ type: mother.type, mesh, timer: EGG_HATCH_TIME, x, z });
  }

  // 赤ちゃんを産む（テイム済み・レベル1未満の小さな個体）
  function spawnBaby(type, pos) {
    const tier = LEVEL_TIERS[0];
    const sex  = randomSex();
    const { group, legs, body, belly } = type.build(sex);
    const a = Math.random() * Math.PI * 2;
    const x = pos.x + Math.cos(a) * 0.8;
    const z = pos.z + Math.sin(a) * 0.8;
    group.position.set(x, getTerrainHeight(x, z), z);
    group.scale.setScalar(BABY_SCALE);
    scene.add(group);

    const baby = {
      type, tier, group,
      legs:  legs || [],
      body:  body || null,
      belly: belly || null,
      bodyBaseY:   body ? body.position.y : 0.58,
      position:    group.position,
      baseScale:   BABY_SCALE,
      hp:          8,
      maxHp:       8,
      damage:      1,
      speedChase:  type.speedChase,
      speedWander: type.speedWander,
      xp:          0,
      alive:       true,
      aggro:       false,
      attackCd:    0,
      animTime:    0,
      wander:      new THREE.Vector3(x, 0, z),
      wanderTimer: 0,
      sex,
      fleeTimer:   0,
      affection:   100,
      tamed:       true,
      tamedLevel:  1,
      tamedXp:     0,
      tamedBaseScale: tier.sizeScale,
      eatCooldown: 0,
      pregnant:       false,
      pregnancyTimer: 0,
      breedCd:        0,
      baby:           true,
      starveTimer:    BABY_STARVE_TIME,
      growTimer:      0,
    };
    applyTamedAppearance(baby);
    enemies.push(baby);
    return baby;
  }

  function giveBirth(mother) {
    mother.pregnant = false;
    mother.pregnancyTimer = 0;
    mother.breedCd = BREED_COOLDOWN;
    const bellyTarget = mother.belly ?? mother.body;
    if (bellyTarget && mother._preScale) bellyTarget.scale.copy(mother._preScale);
    const icon = mother.type.icon, name = mother.type.name;
    if (mother.type.oviparous) {
      spawnEgg(mother);
      toast(`🥚 ${icon} ${name}が卵を産んだ！しばらくすると孵化する`);
    } else {
      spawnBaby(mother.type, mother.position);
      toast(`👶 ${icon} ${name}の赤ちゃんが生まれた！20分以内に餌（肉や魚を投げる）を与えないと死んでしまう`);
    }
  }

  // テイム動物のレベルアップ確認（レベルキャップなし・一度に複数レベルも対応）
  function checkTamedLevelUp(wolf) {
    let leveled = false;
    while (wolf.tamedXp >= tamedXpForLevel(wolf.tamedLevel + 1)) {
      wolf.tamedLevel += 1;
      leveled = true;
    }
    if (!leveled) return;

    const stats = tamedStatsFor(wolf.tamedLevel);
    // ステータス向上
    wolf.maxHp = stats.hp;
    wolf.hp    = Math.min(wolf.hp + Math.floor(stats.hp * 0.3), wolf.maxHp);
    // 体格の向上（テイム時の体格を基準に拡大）
    const base = wolf.tamedBaseScale ?? wolf.baseScale;
    wolf.baseScale = base * stats.scale;
    wolf.group.scale.setScalar(wolf.baseScale);
    toast(`${wolf.type.icon} 仲間の${wolf.type.name}が Lv.${wolf.tamedLevel} に成長した！（HP:${wolf.maxHp} / ATK:${stats.dmg} / 体格${Math.round(stats.scale * 100)}%）`);
  }

  function update(delta, playerPos, world) {
    const terrainCollider = world?.terrainCollider ?? null;
    const playerDead = Stats.isDead();
    const currentBaits = getBaits();

    spawnTimer -= delta;
    if (spawnTimer <= 0) {
      spawnTimer = SPAWN_INTERVAL;
      // テイム済みを除いた敵数でスポーン制限
      const hostileCount = enemies.filter(e => e.alive && !e.tamed).length;
      if (hostileCount < MAX_ENEMIES) spawnEnemy(playerPos);
    }

    const fires = getBurningFirePositions();
    let playerNearFire = false;
    for (const fp of fires) {
      if (Math.hypot(playerPos.x - fp.x, playerPos.z - fp.z) < PLAYER_FIRE_SAFE) {
        playerNearFire = true; break;
      }
    }

    // ── 卵の孵化 ─────────────────────────────────
    for (let i = eggs.length - 1; i >= 0; i--) {
      const egg = eggs[i];
      egg.timer -= delta;
      // 揺れ演出（孵化間近ほど大きく）
      egg.mesh.rotation.z = Math.sin(performance.now() / 120) * Math.min(0.25, 30 / Math.max(1, egg.timer));
      if (egg.timer <= 0) {
        scene.remove(egg.mesh);
        egg.mesh.geometry.dispose();
        spawnBaby(egg.type, new THREE.Vector3(egg.x, 0, egg.z));
        toast(`🐣 ${egg.type.icon} 卵が孵化した！赤ちゃんが生まれた！`);
        eggs.splice(i, 1);
      }
    }

    // ── 繁殖判定（数秒おき） ─────────────────────
    // テイム済み・Lv4以上のオスとメスが近くに揃っているとメスが妊娠する
    breedTimer -= delta;
    if (breedTimer <= 0) {
      breedTimer = 3;
      const tamedAdults = enemies.filter(e => e.alive && e.tamed && !e.baby);
      for (const f of tamedAdults) {
        if (f.sex !== 'female' || f.pregnant || f.breedCd > 0 || f.tamedLevel < BREED_LEVEL) continue;
        const mate = tamedAdults.find(m =>
          m.sex === 'male' && m.type.id === f.type.id && m.tamedLevel >= BREED_LEVEL &&
          Math.hypot(m.position.x - f.position.x, m.position.z - f.position.z) < BREED_RANGE
        );
        if (mate) markPregnant(f);
      }
    }

    // 今フレームで敵が倒した場合の処理用バッファ
    const killEvents = []; // { killer: tamedWolf, killed: enemy, xp }

    for (const e of enemies) {
      if (!e.alive) continue;
      const t = e.type;

      const dx = playerPos.x - e.position.x;
      const dz = playerPos.z - e.position.z;
      const distToPlayer = Math.hypot(dx, dz);

      if (distToPlayer > DESPAWN_DIST && !e.tamed) { removeEnemy(e); continue; }

      // ────────────────────────────────────────────────
      // テイム動物の AI
      // ────────────────────────────────────────────────
      if (e.tamed) {
        // 妊娠・出産の進行
        if (e.breedCd > 0) e.breedCd -= delta;
        if (e.pregnant) {
          e.pregnancyTimer -= delta;
          if (e.pregnancyTimer <= 0) giveBirth(e);
        }

        // 赤ちゃん: 空腹（餓死）と成長の進行
        let baitGoal = null;
        if (e.baby) {
          e.starveTimer -= delta;
          if (e.starveTimer <= 0) {
            toast(`💀 ${e.type.icon} 赤ちゃんが餓死してしまった…もっと餌が必要だった`);
            removeEnemy(e);
            continue;
          }
          e.growTimer += delta;
          const g = Math.min(1, e.growTimer / BABY_GROW_TIME);
          e.baseScale = (BABY_SCALE + (1 - BABY_SCALE) * g) * (e.tamedBaseScale ?? 1);
          e.group.scale.setScalar(e.baseScale);
          if (g >= 1) {
            e.baby = false;
            const st = TAMED_STATS[0];
            e.hp = e.maxHp = st.hp;
            toast(`🎉 ${e.type.icon} 赤ちゃんが立派な大人に成長した！`);
          }
          // 餌（投げられた肉や魚）を探す
          if (e.eatCooldown > 0) {
            e.eatCooldown -= delta;
          } else {
            let bestBd = BABY_BAIT_RANGE;
            for (const b of currentBaits) {
              const bd = Math.hypot(b.pos.x - e.position.x, b.pos.z - e.position.z);
              if (bd < bestBd) { bestBd = bd; baitGoal = b; }
            }
          }
        }

        const stats = tamedStatsFor(e.tamedLevel);
        let dirX = 0, dirZ = 0, speed = 0, moving = false;

        // 近くの敵を探す（赤ちゃんは戦わない。「攻撃しない」命令中も戦わない）
        let fightTarget = null, fightDist = TAMED_FIGHT_RANGE;
        if (!e.baby && tamedOrder === 'attack') {
          for (const other of enemies) {
            if (!other.alive || other.tamed || other === e) continue;
            const od = Math.hypot(other.position.x - e.position.x, other.position.z - e.position.z);
            if (od < fightDist) { fightDist = od; fightTarget = other; }
          }
        }

        if (baitGoal) {
          const bdx = baitGoal.pos.x - e.position.x;
          const bdz = baitGoal.pos.z - e.position.z;
          const bd  = Math.hypot(bdx, bdz);
          if (bd < 0.9) {
            consumeBait(baitGoal);
            e.eatCooldown = 2.0;
            e.starveTimer = BABY_STARVE_TIME;
            toast(`🍼 ${e.type.icon} 赤ちゃんが餌を食べた（満腹になった）`);
          } else {
            dirX = bdx / bd; dirZ = bdz / bd;
            speed = stats.speed * 0.8; moving = true;
          }
        } else if (fightTarget) {
          const fdx = fightTarget.position.x - e.position.x;
          const fdz = fightTarget.position.z - e.position.z;
          if (fightDist > t.attackRange) {
            dirX = fdx / fightDist; dirZ = fdz / fightDist;
            speed = stats.speed; moving = true;
          } else {
            e.attackCd -= delta;
            if (e.attackCd <= 0) {
              e.attackCd = t.attackCd;
              fightTarget.hp -= stats.dmg;
              // ヒットフィードバック
              fightTarget.group.scale.setScalar(fightTarget.baseScale * 0.88);
              const _ft = fightTarget;
              setTimeout(() => { if (_ft.alive) _ft.group.scale.setScalar(_ft.baseScale); }, 80);

              if (fightTarget.hp <= 0) {
                killEvents.push({ killer: e, killed: fightTarget });
              }
            }
            e.group.rotation.y = Math.atan2(fdx, fdz);
          }
        } else if (tamedMove === 'follow' && distToPlayer > TAMED_LEASH_MAX) {
          // 追従モード: 離れすぎたらプレイヤーの元へ戻る
          dirX = dx / distToPlayer; dirZ = dz / distToPlayer;
          speed = stats.speed * 0.9; moving = true;
          e.wanderTimer = 0; // 戻ったらすぐ新しい徘徊先を選ぶ
        } else {
          // うろうろする（追従: プレイヤー周辺 / 放浪: 自分の現在地周辺）
          const roam = tamedMove === 'roam';
          e.wanderTimer -= delta;
          if (e.wanderTimer <= 0) {
            e.wanderTimer = roam ? 2.5 + Math.random() * 4 : 1.5 + Math.random() * 2.5;
            const cx = roam ? e.position.x : playerPos.x;
            const cz = roam ? e.position.z : playerPos.z;
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * (roam ? TAMED_ROAM_RADIUS : TAMED_WANDER_RADIUS);
            let wx = cx + Math.cos(a) * r;
            let wz = cz + Math.sin(a) * r;
            // 水域が目標になったら中心寄り/反対側に修正
            if (getTerrainHeight(wx, wz) < WATER_Y) {
              if (roam) {
                wx = cx - Math.cos(a) * r * 0.7;
                wz = cz - Math.sin(a) * r * 0.7;
              } else {
                wx = cx + Math.cos(a) * r * 0.4;
                wz = cz + Math.sin(a) * r * 0.4;
              }
            }
            e.wander.set(wx, 0, wz);
          }
          const wx = e.wander.x - e.position.x, wz = e.wander.z - e.position.z;
          const wlen = Math.hypot(wx, wz);
          if (wlen > 0.5) {
            dirX = wx / wlen; dirZ = wz / wlen;
            speed = stats.speed * 0.55; moving = true; // 散歩ペース
          }
        }

        // スタック回避中は進行方向を横向きに上書き
        if (e.avoidTimer > 0) {
          e.avoidTimer -= delta;
          if (moving && e.avoidDir) { dirX = e.avoidDir.x; dirZ = e.avoidDir.z; }
        }

        if (moving) {
          e.position.x += dirX * speed * delta;
          e.position.z += dirZ * speed * delta;
          pushOutOfObstacles(e, world); // 設置物・木・岩をすり抜けない

          // スタック検知: 前進しているのに0.5秒間ほぼ動けていなければ方向転換
          e.stuckTimer = (e.stuckTimer ?? 0) + delta;
          if (!e.stuckPos) e.stuckPos = new THREE.Vector3(e.position.x, 0, e.position.z);
          if (e.stuckTimer >= STUCK_CHECK_SEC) {
            const movedDist = Math.hypot(e.position.x - e.stuckPos.x, e.position.z - e.stuckPos.z);
            if (movedDist < STUCK_MIN_MOVE) {
              // 横〜斜め後ろのランダム方向へしばらく回避移動する
              const ang = Math.atan2(dirX, dirZ)
                + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random() * 0.9);
              e.avoidDir = { x: Math.sin(ang), z: Math.cos(ang) };
              e.avoidTimer = 0.7 + Math.random() * 0.5;
              e.wanderTimer = 0; // 回避後は目的地を選び直す
            }
            e.stuckTimer = 0;
            e.stuckPos.set(e.position.x, 0, e.position.z);
          }

          e.group.rotation.y = Math.atan2(dirX, dirZ);
          e.animTime += delta * speed * 3.5;
          const swing = Math.sin(e.animTime) * 0.7;
          if (e.legs.length === 4) {
            e.legs[0].rotation.x =  swing;
            e.legs[1].rotation.x = -swing;
            e.legs[2].rotation.x = -swing;
            e.legs[3].rotation.x =  swing;
          }
          if (e.body) {
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58), delta * 8);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 6);
          }
        } else {
          // 停止中はスタック計測をリセット
          e.stuckTimer = 0;
          if (e.stuckPos) e.stuckPos.set(e.position.x, 0, e.position.z);
          for (const leg of e.legs) leg.rotation.x *= 0.85;
          if (e.body) {
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58), delta * 5);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 5);
          }
          if (e.attackCd > 0) e.attackCd -= delta;
        }

        e.position.y = groundHeight(e.position.x, e.position.z, terrainCollider);
        continue; // 以降の敵AIはスキップ
      }

      // ────────────────────────────────────────────────
      // 通常敵の AI
      // ────────────────────────────────────────────────

      // 火への恐怖チェック
      let fleeFromFire = false, fleeX = 0, fleeZ = 0;
      if (t.fearsFire && fires.length > 0) {
        for (const fp of fires) {
          const fd = Math.hypot(e.position.x - fp.x, e.position.z - fp.z);
          if (fd < FIRE_FEAR_DIST) {
            const fx = e.position.x - fp.x, fz = e.position.z - fp.z;
            const flen = Math.hypot(fx, fz) || 1;
            fleeX += fx / flen; fleeZ += fz / flen;
            fleeFromFire = true;
          }
        }
        if (fleeFromFire) {
          e.aggro = false;
          const fl = Math.hypot(fleeX, fleeZ) || 1;
          fleeX /= fl; fleeZ /= fl;
        }
      }

      // 餌チェック: 近くに餌があれば誘引
      let baitTarget = null;
      if (!fleeFromFire && e.eatCooldown <= 0) {
        for (const b of currentBaits) {
          const bd = Math.hypot(b.pos.x - e.position.x, b.pos.z - e.position.z);
          if (bd < t.detectRange * 0.9) { baitTarget = b; break; }
        }
      }
      if (e.eatCooldown > 0) e.eatCooldown -= delta;

      // 攻撃されて逃走中（牛などの臆病な動物）
      if (e.fleeTimer > 0) e.fleeTimer -= delta;

      // アグロ判定（passive な動物は自分からは襲わない）
      if (!playerDead && !playerNearFire && !fleeFromFire && !baitTarget && !t.passive && e.fleeTimer <= 0 && distToPlayer <= t.detectRange) e.aggro = true;
      if (playerDead || playerNearFire || fleeFromFire || baitTarget || distToPlayer > t.leashRange) {
        if (!baitTarget) e.aggro = false;
      }

      let dirX = 0, dirZ = 0, speed = 0, moving = false;

      if (fleeFromFire) {
        dirX = fleeX; dirZ = fleeZ;
        speed = t.fireFleeSpeed || e.speedChase * 1.3;
        moving = true;
      } else if (e.fleeTimer > 0 && distToPlayer > 0.01) {
        // プレイヤーから逃げる
        dirX = -dx / distToPlayer; dirZ = -dz / distToPlayer;
        speed = e.speedChase * 1.15;
        moving = true;
        e.aggro = false;
      } else if (baitTarget) {
        // 餌へ向かう
        const bdx = baitTarget.pos.x - e.position.x;
        const bdz = baitTarget.pos.z - e.position.z;
        const bd  = Math.hypot(bdx, bdz);
        if (bd < 0.9) {
          // 餌を食べる
          consumeBait(baitTarget);
          e.eatCooldown = 2.5;
          if (t.tameable) {
            e.affection = Math.min(100, e.affection + (t.tameAffection ?? 20));
            if (e.affection >= 100) {
              tameAnimal(e);
            } else {
              toast(`${t.icon} ${t.name}${sexLabel(e)} が餌を食べた（好感度 ${e.affection}/100）`);
            }
          }
        } else {
          dirX = bdx / bd; dirZ = bdz / bd;
          speed = e.speedWander * 1.3;
          moving = true;
          e.aggro = false;
        }
      } else if (e.aggro) {
        if (distToPlayer > t.attackRange) {
          dirX = dx / distToPlayer; dirZ = dz / distToPlayer;
          speed = e.speedChase; moving = true;
        } else {
          e.attackCd -= delta;
          if (e.attackCd <= 0) {
            e.attackCd = t.attackCd;
            // テイム動物が近くにいればその動物がダメージを受ける（赤ちゃんはかばえない）
            const protector = enemies.find(w =>
              w.alive && w.tamed && !w.baby &&
              Math.hypot(w.position.x - e.position.x, w.position.z - e.position.z) < t.attackRange * 1.8
            );
            if (protector) {
              protector.hp -= e.damage;
              toast(`${protector.type.icon} 仲間の${protector.type.name}が身を挺してかばった！（残りHP: ${Math.max(0, protector.hp)}）`);
              if (protector.hp <= 0) {
                toast(`💔 仲間の${protector.type.name}が倒れた…`);
                removeEnemy(protector);
              }
            } else {
              Stats.damage(e.damage);
            }
          }
          e.group.rotation.y = Math.atan2(dx, dz);
        }
      } else {
        e.wanderTimer -= delta;
        if (e.wanderTimer <= 0) {
          e.wanderTimer = 2 + Math.random() * 3;
          const a = Math.random() * Math.PI * 2;
          const r = 4 + Math.random() * 6;
          let wx = e.position.x + Math.cos(a) * r;
          let wz = e.position.z + Math.sin(a) * r;
          // 水域へのワンダー目標は陸地側に反転
          if (getTerrainHeight(wx, wz) < WATER_Y) {
            wx = e.position.x - Math.cos(a) * r * 0.7;
            wz = e.position.z - Math.sin(a) * r * 0.7;
          }
          e.wander.set(wx, 0, wz);
        }
        const wx = e.wander.x - e.position.x, wz = e.wander.z - e.position.z;
        const wlen = Math.hypot(wx, wz);
        if (wlen > 0.5) { dirX = wx / wlen; dirZ = wz / wlen; speed = e.speedWander; moving = true; }
      }

      const inWater = e.position.y < WATER_SURFACE_Y + 0.05;

      if (moving) {
        // 水域回避: 陸上かつ水際なら斥力を加算（追跡時は半減）
        if (!inWater) {
          const rep = calcWaterRepulsion(e.position.x, e.position.z);
          if (rep) {
            const str = e.aggro ? WATER_REP_STR * 0.45 : WATER_REP_STR;
            dirX += rep.rx * str;
            dirZ += rep.rz * str;
            const dl = Math.hypot(dirX, dirZ);
            if (dl > 0) { dirX /= dl; dirZ /= dl; }
          }
        }

        const waterMult = inWater ? 0.40 : 1.0;
        e.position.x += dirX * speed * waterMult * delta;
        e.position.z += dirZ * speed * waterMult * delta;
        e.group.rotation.y = Math.atan2(dirX, dirZ);

        pushOutOfObstacles(e, world);

        if (inWater) {
          // 水泳アニメ: ドッグパドル
          e.animTime += delta * 4.5;
          const paddle = Math.sin(e.animTime) * 0.55;
          if (e.legs.length === 4) {
            e.legs[0].rotation.x =  paddle;
            e.legs[1].rotation.x = -paddle * 0.7;
            e.legs[2].rotation.x = -paddle;
            e.legs[3].rotation.x =  paddle * 0.7;
          }
          if (e.body) {
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58) - 0.32 + Math.sin(e.animTime * 1.3) * 0.05, delta * 5);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0.32, delta * 4);
          }
        } else {
          const isRunning = e.aggro || fleeFromFire;
          const swingAmt = isRunning ? 0.90 : 0.45;
          e.animTime += delta * speed * (isRunning ? 4.8 : 3.0);
          const swing = Math.sin(e.animTime) * swingAmt;
          if (e.legs.length === 4) {
            e.legs[0].rotation.x =  swing;
            e.legs[1].rotation.x = -swing;
            e.legs[2].rotation.x = -swing;
            e.legs[3].rotation.x =  swing;
          }
          if (e.body) {
            if (isRunning) {
              e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58) + Math.abs(Math.sin(e.animTime * 2)) * 0.07, delta * 12);
              e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, -0.18, delta * 8);
            } else {
              e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58), delta * 6);
              e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 6);
            }
          }
        }
      } else {
        for (const leg of e.legs) leg.rotation.x *= 0.8;
        if (e.body) {
          if (inWater) {
            e.animTime += delta * 2;
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58) - 0.32 + Math.sin(e.animTime * 1.3) * 0.04, delta * 4);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0.28, delta * 4);
          } else {
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, (e.bodyBaseY ?? 0.58), delta * 6);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 6);
          }
        }
        if (e.attackCd > 0) e.attackCd -= delta;
      }

      // 水中では水面付近でフロート、陸上では地形に追従
      const terrH = groundHeight(e.position.x, e.position.z, terrainCollider);
      e.position.y = terrH < WATER_SURFACE_Y ? WATER_SURFACE_Y : terrH;
    }

    // テイム動物が倒した敵の処理
    for (const ev of killEvents) {
      const { killer, killed } = ev;
      if (!killed.alive) continue; // 既に倒されている場合はスキップ
      const parts = [];
      for (const d of killed.type.drops || []) {
        const qty = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
        Inventory.add(d.id, qty);
        const item = Inventory.ITEMS[d.id];
        if (item) parts.push(`${item.icon}${item.name}×${qty}`);
      }
      // 経験値は主人ではなく、倒した動物自身が獲得する
      killer.tamedXp += killed.xp;
      checkTamedLevelUp(killer);
      toast(`${killer.type.icon} 仲間の${killer.type.name}が ${killed.tier?.label ?? ''} ${killed.type.name}を倒した！ ${parts.join(' ')} (仲間 +${killed.xp}EXP)`);
      removeEnemy(killed);
    }

    // 死亡済みの敵を配列から除去（残すと配列が無限に成長する）
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].alive) enemies.splice(i, 1);
    }
  }

  function damageEnemy(enemy, dmg) {
    if (!enemy || !enemy.alive) return false;
    enemy.hp -= dmg;
    if (!enemy.tamed) {
      if (enemy.type.fleeOnHurt) enemy.fleeTimer = 7; // 臆病な動物は反撃せず逃げる
      else enemy.aggro = true;
    }

    // 与えたダメージを頭上に表示
    const headPos = new THREE.Vector3(
      enemy.position.x,
      enemy.position.y + 1.3 * enemy.baseScale,
      enemy.position.z,
    );
    DamageText.spawn(headPos, dmg, { crit: dmg >= 25 });

    enemy.group.scale.setScalar(enemy.baseScale * 0.9);
    setTimeout(() => { if (enemy.alive) enemy.group.scale.setScalar(enemy.baseScale); }, 90);

    if (enemy.hp > 0) return false;

    const parts = [];
    for (const d of enemy.type.drops || []) {
      const qty = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      Inventory.add(d.id, qty);
      const item = Inventory.ITEMS[d.id];
      if (item) parts.push(`${item.icon} ${item.name} ×${qty}`);
    }
    const xp = enemy.xp;
    Progression.addXp(xp);
    const lvLabel = enemy.tier?.label ?? '';
    Inventory.showPickup(`${lvLabel} ${enemy.type.name}を倒した！  ${parts.join('  ')}  (+${xp}EXP)`);

    removeEnemy(enemy);
    return true;
  }

  function getEnemies() { return enemies.filter(e => e.alive); }

  // テイム済み動物一覧（HUD用）
  function getTamedAnimals() { return enemies.filter(e => e.alive && e.tamed); }

  // 指定位置から最も近いテイム動物を返す（maxDist以内、いなければnull）
  function getNearestTamed(pos, maxDist = 4) {
    let nearest = null, nearestDist = maxDist;
    for (const e of enemies) {
      if (!e.alive || !e.tamed) continue;
      const d = Math.hypot(e.position.x - pos.x, e.position.z - pos.z);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  // テイム動物の詳細ステータス（Lキーのパネル表示用）
  function getTamedInfo(wolf) {
    if (!wolf || !wolf.tamed) return null;
    const lv    = wolf.tamedLevel;
    const stats = tamedStatsFor(lv);

    // 状態表示（赤ちゃん / 妊娠中 / 通常）
    let status = '通常';
    if (wolf.baby) {
      const growPct  = Math.round(Math.min(1, wolf.growTimer / BABY_GROW_TIME) * 100);
      const starveMin = Math.floor(wolf.starveTimer / 60);
      const starveSec = String(Math.floor(wolf.starveTimer % 60)).padStart(2, '0');
      status = `🍼 赤ちゃん（成長 ${growPct}% / 餓死まで ${starveMin}:${starveSec}）`;
    } else if (wolf.pregnant) {
      status = `🤰 妊娠中（出産まで 約${Math.ceil(wolf.pregnancyTimer / 60)}分）`;
    }

    return {
      name:     wolf.type?.name ?? '仲間',
      icon:     wolf.type?.icon ?? '🐺',
      sex:      sexLabel(wolf),
      status,
      level:    lv,
      maxLevel: null,   // レベルキャップなし
      isMax:    false,  // 上限なしなので常に成長中
      hp:       Math.max(0, Math.round(wolf.hp)),
      maxHp:    wolf.maxHp,
      dmg:      stats.dmg,
      speed:    stats.speed,
      scalePct: Math.round(stats.scale * 100),
      xp:       wolf.tamedXp,
      xpForNext: tamedXpForLevel(lv + 1), // 次のレベルに必要な累計XP
    };
  }

  // ── セーブ/ロード（テイム動物のみ） ──────────────────
  function serialize() {
    return enemies
      .filter(e => e.alive && e.tamed)
      .map(e => ({
        typeId:        e.type.id,
        tierLevel:     e.tier.level,
        tamedLevel:    e.tamedLevel,
        tamedXp:       e.tamedXp,
        hp:            e.hp,
        maxHp:         e.maxHp,
        x: e.position.x, y: e.position.y, z: e.position.z,
        tamedBaseScale: e.tamedBaseScale,
        sex:            e.sex,
        pregnant:       e.pregnant,
        pregnancyTimer: e.pregnancyTimer,
        breedCd:        e.breedCd,
        baby:           e.baby,
        starveTimer:    e.starveTimer,
        growTimer:      e.growTimer,
      }));
  }

  function deserialize(list = []) {
    for (const s of list) {
      const type = ENEMY_TYPES[s.typeId];
      if (!type) continue;
      const tier = LEVEL_TIERS[(s.tierLevel || 1) - 1] || LEVEL_TIERS[0];
      const sex  = s.sex === 'male' || s.sex === 'female' ? s.sex : randomSex();
      const { group, legs, body, belly } = type.build(sex);
      const x = s.x, y = s.y, z = s.z;
      group.position.set(x, y, z);
      scene.add(group);

      const wolf = {
        type, tier, group,
        legs:  legs || [],
        body:  body || null,
        belly: belly || null,
        bodyBaseY:   body ? body.position.y : 0.58,
        position:    group.position,
        baseScale:   tier.sizeScale,
        hp:          s.hp    ?? tamedStatsFor(s.tamedLevel || 1).hp,
        maxHp:       s.maxHp ?? tamedStatsFor(s.tamedLevel || 1).hp,
        damage:      Math.max(1, Math.round(type.damage * tier.dmgMult)),
        speedChase:  type.speedChase * tier.speedMult,
        speedWander: type.speedWander,
        xp:          Math.round((type.xp || 0) * tier.xpMult),
        alive:       true,
        aggro:       false,
        attackCd:    0,
        animTime:    0,
        wander:      new THREE.Vector3(x, y, z),
        wanderTimer: 0,
        affection:   0,
        tamed:       true,
        tamedLevel:  s.tamedLevel || 1,
        tamedXp:     s.tamedXp || 0,
        tamedBaseScale: s.tamedBaseScale ?? tier.sizeScale,
        eatCooldown: 0,
        sex,
        fleeTimer:      0,
        pregnant:       !!s.pregnant,
        pregnancyTimer: s.pregnancyTimer || 0,
        breedCd:        s.breedCd || 0,
        baby:           !!s.baby,
        starveTimer:    s.starveTimer || 0,
        growTimer:      s.growTimer || 0,
      };
      applyTamedAppearance(wolf);
      if (wolf.baby) {
        // 赤ちゃんは成長度に応じた小さな体格
        const g = Math.min(1, wolf.growTimer / BABY_GROW_TIME);
        wolf.baseScale = (BABY_SCALE + (1 - BABY_SCALE) * g) * wolf.tamedBaseScale;
        if (wolf.starveTimer <= 0) wolf.starveTimer = BABY_STARVE_TIME;
      } else {
        // レベルに応じた体格を反映
        const stats = tamedStatsFor(wolf.tamedLevel);
        wolf.baseScale = wolf.tamedBaseScale * stats.scale;
      }
      group.scale.setScalar(wolf.baseScale);
      // 妊娠中の見た目を復元
      const bellyTarget = wolf.belly ?? wolf.body;
      if (wolf.pregnant && bellyTarget) {
        wolf._preScale = bellyTarget.scale.clone();
        bellyTarget.scale.multiplyScalar(1.3);
      }
      enemies.push(wolf);
    }
  }

  // ── 仲間への全体命令（攻撃する/しない） ──────────────
  function getTamedOrder() { return tamedOrder; }
  function setTamedOrder(order) {
    if (order === 'attack' || order === 'passive') tamedOrder = order;
  }
  function toggleTamedOrder() {
    tamedOrder = tamedOrder === 'attack' ? 'passive' : 'attack';
    return tamedOrder;
  }

  // ── 仲間への移動命令（追従/放浪） ──────────────────
  function getTamedMove() { return tamedMove; }
  function setTamedMove(mode) {
    if (mode === 'follow' || mode === 'roam') tamedMove = mode;
  }
  function toggleTamedMove() {
    tamedMove = tamedMove === 'follow' ? 'roam' : 'follow';
    return tamedMove;
  }

  return {
    update, damageEnemy, getEnemies, getTamedAnimals, getNearestTamed, getTamedInfo,
    callEnemyHorde,
    getTamedOrder, setTamedOrder, toggleTamedOrder,
    getTamedMove, setTamedMove, toggleTamedMove,
    serialize, deserialize, setToast,
  };
}
