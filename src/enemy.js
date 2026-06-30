import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';
import * as Stats from './stats.js';
import * as Inventory from './inventory.js';
import * as Progression from './progression.js';
import { pickEnemyType, pickLevel } from './enemyTypes.js';
import { getBurningFirePositions, getObstacles } from './placedObjects.js';
import { getBaits, consumeBait } from './projectile.js';

const MAX_ENEMIES    = 6;
const SPAWN_INTERVAL = 5;
const SPAWN_MIN_DIST = 22;
const SPAWN_MAX_DIST = 34;
const DESPAWN_DIST   = 90;
const FIRE_FEAR_DIST = 9;
const PLAYER_FIRE_SAFE = 7;
const TAMED_FIGHT_RANGE = 10; // テイム動物が戦いに参加する範囲
const TAMED_FOLLOW_DIST = 4;  // この距離を超えたらプレイヤーを追う

// テイム動物レベルテーブル
const TAMED_XP_THRESH = [0, 50, 130, 300, 700]; // Lv2〜5に必要な累計XP
const TAMED_STATS = [
  { level: 1, hp: 15, dmg: 6,  speed: 4.8 },
  { level: 2, hp: 28, dmg: 10, speed: 5.2 },
  { level: 3, hp: 45, dmg: 16, speed: 5.7 },
  { level: 4, hp: 68, dmg: 25, speed: 6.2 },
  { level: 5, hp: 100, dmg: 38, speed: 6.8 },
];

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

export function create(scene) {
  const enemies = [];
  let spawnTimer = SPAWN_INTERVAL * 0.5;
  let _toastFn = null;

  function toast(msg) { _toastFn?.(msg); }
  function setToast(fn) { _toastFn = fn; }

  function spawnEnemy(playerPos) {
    const type  = pickEnemyType();
    const tier  = pickLevel();
    const angle = Math.random() * Math.PI * 2;
    const dist  = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
    const x = playerPos.x + Math.cos(angle) * dist;
    const z = playerPos.z + Math.sin(angle) * dist;
    const y = getTerrainHeight(x, z);

    const { group, legs, body } = type.build();
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
      position:    group.position,
      baseScale:   tier.sizeScale,
      hp:          maxHp,
      maxHp,
      damage:      Math.max(1, Math.round(type.damage     * tier.dmgMult)),
      speedChase:  type.speedChase * tier.speedMult,
      speedWander: type.speedWander,
      xp:          Math.round((type.xp || 0) * tier.xpMult),
      alive:       true,
      aggro:       false,
      attackCd:    0,
      animTime:    0,
      wander:      new THREE.Vector3(x, y, z),
      wanderTimer: 0,
      // テイム関連（狼のみ有効）
      affection:   0,
      tamed:       false,
      tamedLevel:  1,
      tamedXp:     0,
      eatCooldown: 0,
    });
  }

  function removeEnemy(enemy) {
    scene.remove(enemy.group);
    enemy.group.traverse((c) => { if (c.isMesh) c.geometry.dispose(); });
    enemy.alive = false;
  }

  // 狼をテイムする
  function tameWolf(wolf) {
    wolf.tamed = true;
    wolf.tamedLevel = 1;
    wolf.tamedXp = 0;
    wolf.aggro = false;
    const stats = TAMED_STATS[0];
    wolf.hp    = stats.hp;
    wolf.maxHp = stats.hp;

    // 外観変更（友好的な色 + 金の首輪）
    const tamedBodyMat = new THREE.MeshLambertMaterial({ color: 0xa0a8c8 });
    const collarMat    = new THREE.MeshLambertMaterial({ color: 0xd4a020 });
    wolf.group.traverse((c) => {
      if (c.isMesh) c.material = tamedBodyMat;
    });
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.07, 8),
      collarMat
    );
    collar.position.set(0, 0.74, 0.58);
    wolf.group.add(collar);

    toast(`🐺 狼がテイムされた！仲間になった！(Lv.${wolf.tamedLevel} HP:${wolf.maxHp})`);
  }

  // テイム動物のレベルアップ確認
  function checkTamedLevelUp(wolf) {
    const nextLv = wolf.tamedLevel + 1;
    if (nextLv > TAMED_STATS.length) return;
    const xpNeeded = TAMED_XP_THRESH[nextLv - 1];
    if (wolf.tamedXp >= xpNeeded) {
      wolf.tamedLevel = nextLv;
      const stats = TAMED_STATS[nextLv - 1];
      wolf.maxHp = stats.hp;
      wolf.hp    = Math.min(wolf.hp + Math.floor(stats.hp * 0.3), wolf.maxHp);
      toast(`🐺 仲間の狼が Lv.${wolf.tamedLevel} になった！（HP:${wolf.maxHp} / ATK:${stats.dmg}）`);
    }
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
        const stats = TAMED_STATS[Math.min(e.tamedLevel - 1, TAMED_STATS.length - 1)];
        let dirX = 0, dirZ = 0, speed = 0, moving = false;

        // 近くの敵を探す
        let fightTarget = null, fightDist = TAMED_FIGHT_RANGE;
        for (const other of enemies) {
          if (!other.alive || other.tamed || other === e) continue;
          const od = Math.hypot(other.position.x - e.position.x, other.position.z - e.position.z);
          if (od < fightDist) { fightDist = od; fightTarget = other; }
        }

        if (fightTarget) {
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
        } else {
          // プレイヤーに追従
          if (distToPlayer > TAMED_FOLLOW_DIST) {
            dirX = dx / distToPlayer; dirZ = dz / distToPlayer;
            speed = stats.speed * 0.85; moving = true;
          }
        }

        if (moving) {
          e.position.x += dirX * speed * delta;
          e.position.z += dirZ * speed * delta;
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
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, 0.58, delta * 8);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 6);
          }
        } else {
          for (const leg of e.legs) leg.rotation.x *= 0.85;
          if (e.body) {
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, 0.58, delta * 5);
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

      // アグロ判定
      if (!playerDead && !playerNearFire && !fleeFromFire && !baitTarget && distToPlayer <= t.detectRange) e.aggro = true;
      if (playerDead || playerNearFire || fleeFromFire || baitTarget || distToPlayer > t.leashRange) {
        if (!baitTarget) e.aggro = false;
      }

      let dirX = 0, dirZ = 0, speed = 0, moving = false;

      if (fleeFromFire) {
        dirX = fleeX; dirZ = fleeZ;
        speed = t.fireFleeSpeed || e.speedChase * 1.3;
        moving = true;
      } else if (baitTarget) {
        // 餌へ向かう
        const bdx = baitTarget.pos.x - e.position.x;
        const bdz = baitTarget.pos.z - e.position.z;
        const bd  = Math.hypot(bdx, bdz);
        if (bd < 0.9) {
          // 餌を食べる
          consumeBait(baitTarget);
          e.eatCooldown = 2.5;
          if (t.id === 'wolf') {
            e.affection = Math.min(100, e.affection + 20);
            if (e.affection >= 100) {
              tameWolf(e);
            } else {
              toast(`🐺 狼が餌を食べた（好感度 ${e.affection}/100）`);
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
            // テイム狼が近くにいれば狼がダメージを受ける
            const protector = enemies.find(w =>
              w.alive && w.tamed &&
              Math.hypot(w.position.x - e.position.x, w.position.z - e.position.z) < t.attackRange * 1.8
            );
            if (protector) {
              protector.hp -= e.damage;
              toast(`🐺 仲間の狼が身を挺してかばった！（残りHP: ${Math.max(0, protector.hp)}）`);
              if (protector.hp <= 0) {
                toast('💔 仲間の狼が倒れた…');
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
          e.wander.set(e.position.x + Math.cos(a) * r, 0, e.position.z + Math.sin(a) * r);
        }
        const wx = e.wander.x - e.position.x, wz = e.wander.z - e.position.z;
        const wlen = Math.hypot(wx, wz);
        if (wlen > 0.5) { dirX = wx / wlen; dirZ = wz / wlen; speed = e.speedWander; moving = true; }
      }

      if (moving) {
        const inWater = e.position.y < -0.55;
        const waterMult = inWater ? 0.45 : (e.position.y < 0 ? 0.72 : 1.0);
        e.position.x += dirX * speed * waterMult * delta;
        e.position.z += dirZ * speed * waterMult * delta;
        e.group.rotation.y = Math.atan2(dirX, dirZ);

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
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, 0.58 + Math.abs(Math.sin(e.animTime * 2)) * 0.07, delta * 12);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, -0.18, delta * 8);
          } else {
            e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, 0.58, delta * 6);
            e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 6);
          }
        }
      } else {
        for (const leg of e.legs) leg.rotation.x *= 0.8;
        if (e.body) {
          e.body.position.y = THREE.MathUtils.lerp(e.body.position.y, 0.58, delta * 6);
          e.body.rotation.x = THREE.MathUtils.lerp(e.body.rotation.x, 0, delta * 6);
        }
        if (e.attackCd > 0) e.attackCd -= delta;
      }

      e.position.y = groundHeight(e.position.x, e.position.z, terrainCollider);
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
      killer.tamedXp += killed.xp;
      checkTamedLevelUp(killer);
      Progression.addXp(Math.floor(killed.xp * 0.5)); // プレイヤーにも半分XP
      toast(`🐺 仲間の狼が ${killed.tier?.label ?? ''} ${killed.type.name}を倒した！ ${parts.join(' ')} (+${killed.xp}EXP)`);
      removeEnemy(killed);
    }
  }

  function damageEnemy(enemy, dmg) {
    if (!enemy || !enemy.alive) return false;
    enemy.hp -= dmg;
    if (!enemy.tamed) enemy.aggro = true;

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

  return { update, damageEnemy, getEnemies, getTamedAnimals, setToast };
}
