import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { getTerrainHeight } from './scene.js';
import * as Stats from './stats.js';

// ── 物理定数 ──────────────────────────────────────────
const SPEED          = 5;
const SPRINT_MULT    = 1.5;
const JUMP_VEL       = 8;
const GRAVITY        = -20;
const TURN_SPEED     = 12;
const DODGE_SPEED    = 12;
const DODGE_DURATION = 0.28;
const STEP_HEIGHT    = 0.55;
const ATTACK_DURATION = 0.75;

const WATER_LEVEL   = 0.0;
const WAIST_HEIGHT  = 0.88;
const SWIM_SPEED    = 2.8;
const SWIM_BUOYANCY = 14;
const SWIM_DRAG     = 0.88;

// プレイヤー AABB
const PLAYER_W = 0.5;
const PLAYER_H = 1.9;
const PLAYER_D = 0.5;

// ── 物理状態 ──────────────────────────────────────────
let group     = null;
let velY      = 0;
let onGround  = true;
let attackTimer  = 0;
let dodgeTimer   = 0;
let dodgeVelX    = 0;
let dodgeVelZ    = 0;
let swimTime     = 0;

// ── FBX / アニメーション状態 ──────────────────────────
let mixer        = null;
const actions    = {};
let currentAction = null;
let modelReady   = false;
let rightHandBone = null;
let handItem     = null;
let fallbackModel = null; // FBX 読込前/失敗時に表示する簡易プレースホルダ

// アニメーション切り替えで参照する移動状態
let _isMoving    = false;
let _isSprinting = false;
let _isAttacking = false;
let _isSwimming  = false;
let _attackAction = null; // 現在再生中の FBX 攻撃アクション

// ── 手続きアニメーション用 ────────────────────────────────
const _pQ = new THREE.Quaternion();
const _pE = new THREE.Euler();
let _boneMap = null; // ロード後に構築するボーン名→オブジェクトマップ

// FBX 読込前/失敗時のフォールバック主人公（簡易ヒューマノイド）。
// model.fbx が正常に読めれば除去される。読めなくても主人公が見えて操作できるようにする。
function buildFallbackHumanoid() {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xe0a878 });
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3a6ea5 });
  const legMat  = new THREE.MeshLambertMaterial({ color: 0x394452 });
  // 胴体
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 8), bodyMat);
  torso.position.y = 1.15; torso.castShadow = true;
  g.add(torso);
  // 頭
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
  head.position.y = 1.72; head.castShadow = true;
  g.add(head);
  // 腕
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.5, 4, 6), skinMat);
    arm.position.set(sx * 0.38, 1.2, 0); arm.castShadow = true;
    g.add(arm);
  }
  // 脚
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.6, 4, 6), legMat);
    leg.position.set(sx * 0.15, 0.5, 0); leg.castShadow = true;
    g.add(leg);
  }
  return g;
}

// THREE.traverse を使わず、undefined/null を無視して安全に全ノードを巡回する
function safeWalk(root, cb) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const o = stack.pop();
    if (!o || seen.has(o)) continue;
    seen.add(o);
    cb(o);
    if (Array.isArray(o.children)) {
      for (const c of o.children) if (c) stack.push(c);
    }
  }
}

// 一部の FBX はボーン階層の children に undefined が混じることがあり、
// THREE の traverse / レンダラが再帰中にクラッシュする（Cannot read properties of undefined）。
// 追加前に不正な子を除去し、スケルトンの欠損ボーンはダミーで埋めて整合を保つ。
function sanitizeFbx(root) {
  // 1) 全ノードの children 配列から undefined/null を物理的に除去（レンダラ含む全 traverse を安全化）
  let removed = 0;
  safeWalk(root, (o) => {
    if (Array.isArray(o.children) && o.children.some(c => c == null)) {
      const clean = o.children.filter(c => c != null);
      removed += o.children.length - clean.length;
      o.children = clean;
    }
  });
  // 2) SkinnedMesh の skeleton.bones に欠損があればダミーBoneで置換（index整合維持・描画クラッシュ防止）
  let missingBones = 0;
  safeWalk(root, (o) => {
    if (o.isSkinnedMesh && o.skeleton && Array.isArray(o.skeleton.bones)) {
      o.skeleton.bones = o.skeleton.bones.map(b => { if (!b) { missingBones++; return new THREE.Bone(); } return b; });
    }
  });
  console.log(`[player] sanitizeFbx: 不正な子ノード除去=${removed}, 欠損ボーン補完=${missingBones}`);
}

function buildBoneMap(root) {
  _boneMap = {};
  safeWalk(root, obj => {
    if (!obj.isBone) return;
    _boneMap[obj.name] = obj; // フルネーム
    // コロン・アンダースコア・パイプ区切りの短縮名でも引けるようにする
    const sep = Math.max(obj.name.lastIndexOf(':'), obj.name.lastIndexOf('_'), obj.name.lastIndexOf('|'));
    if (sep >= 0) {
      const short = obj.name.slice(sep + 1);
      if (!_boneMap[short]) _boneMap[short] = obj;
    }
  });
  console.log('[bone map] first 10 keys:', Object.keys(_boneMap).slice(0, 10));
}

function applyBoneRot(name, x, y, z) {
  if (!_boneMap) return;
  const bone = _boneMap[name];
  if (!bone) return;
  _pE.set(x, y, z);
  bone.quaternion.multiply(_pQ.setFromEuler(_pE));
}

// ── 衝突判定用（再利用してGC抑制） ──────────────────────
const _playerBox = new THREE.Box3();
const _center    = new THREE.Vector3();
const _size      = new THREE.Vector3(PLAYER_W, PLAYER_H, PLAYER_D);
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _down      = new THREE.Vector3(0, -1, 0);

// ─────────────────────────────────────────────────────
function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// アニメーションをフェードで切り替える
function switchAction(name, fadeDuration = 0.25) {
  const next = actions[name];
  if (!next || next === currentAction) return;
  if (currentAction) currentAction.fadeOut(fadeDuration);
  next.reset().fadeIn(fadeDuration).play();
  currentAction = next;
}

// ── 手持ちアイテム用ビジュアルメッシュ ──────────────────
function buildHandMesh(itemId) {
  const g       = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  const stoneMat= new THREE.MeshLambertMaterial({ color: 0x9a9080 });
  const bladeMat= new THREE.MeshLambertMaterial({ color: 0xc0c0b8 });
  const fireMat = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 0.8 });
  switch (itemId) {
    case 'stone_axe': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.38, 6), woodMat);
      handle.position.y = -0.19;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.04), stoneMat);
      blade.position.set(0.07, -0.36, 0);
      g.add(handle, blade);
      break;
    }
    case 'stone_pickaxe': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.40, 6), woodMat);
      handle.position.y = -0.20;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.055, 0.04), stoneMat);
      hd.position.set(0, -0.38, 0);
      g.add(handle, hd);
      break;
    }
    case 'stone_knife': {
      const hnd  = new THREE.Mesh(new THREE.CylinderGeometry(0.020, 0.020, 0.13, 6), woodMat);
      hnd.position.y = -0.065;
      const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.25, 0.018), bladeMat);
      blade2.position.y = -0.255;
      g.add(hnd, blade2);
      break;
    }
    case 'fire_starter': {
      const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.30, 5), woodMat);
      s1.position.set(-0.025, -0.15, 0); s1.rotation.z = 0.25;
      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.28, 5), woodMat);
      s2.position.set(0.025, -0.14, 0.01); s2.rotation.z = -0.25;
      g.add(s1, s2);
      break;
    }
    case 'torch': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.34, 6), woodMat);
      handle.position.y = -0.17;
      const flame  = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.11, 6), fireMat);
      flame.position.y = 0.055;
      g.add(handle, flame);
      break;
    }
    case 'bow': {
      // 弓本体（半円）+ 弦
      const limb = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.015, 6, 14, Math.PI), woodMat);
      limb.rotation.z = Math.PI / 2; // 弧が縦向きになる
      const stringMat = new THREE.MeshLambertMaterial({ color: 0xe8e4d0 });
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.48, 4), stringMat);
      g.add(limb, string);
      break;
    }
    default: break;
  }
  return g;
}

// ── エクスポート関数 ──────────────────────────────────

export function isSwimming() {
  if (!group) return false;
  return group.position.y < (WATER_LEVEL - WAIST_HEIGHT);
}

export function getPosition() {
  return group ? group.position.clone() : new THREE.Vector3(0, 0, 0);
}

export function setVisible(v) { if (group) group.visible = v; }

export function getFacing() {
  return group ? group.rotation.y : 0;
}

// ベッド等の設置物へ移動する際は、その当たり判定(高さ約0.6m)の上に出す
// （内部に置くと衝突判定に埋まって動けなくなる）
const WARP_Y_OFFSET = 0.75;

export function warpTo(pos) {
  if (!group) return;
  group.position.set(pos.x, pos.y + WARP_Y_OFFSET, pos.z);
  velY = 0;
}

export function respawn(spawnPos) {
  if (!group) return;
  const px = spawnPos ? spawnPos.x : 0;
  const py = spawnPos ? spawnPos.y + WARP_Y_OFFSET : getTerrainHeight(0, 0);
  const pz = spawnPos ? spawnPos.z : 0;
  group.position.set(px, py, pz);
  group.rotation.y = Math.PI;
  velY        = 0;
  onGround    = true;
  attackTimer = 0;
  dodgeTimer  = 0;
  dodgeVelX   = 0;
  dodgeVelZ   = 0;
  _isAttacking = false;
  if (actions.idle) {
    Object.values(actions).forEach(a => a.stop());
    actions.idle.play();
    currentAction = actions.idle;
  }
}

export function setHandItem(itemId) {
  if (handItem) {
    if (rightHandBone) rightHandBone.remove(handItem);
    handItem = null;
  }
  if (!itemId) return;
  const mesh = buildHandMesh(itemId);
  // FBX は 0.01 スケール（cm 空間）なのでアイテムを 100 倍して合わせる
  mesh.scale.setScalar(100);
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  mesh.position.set(0, 3, 5); // 右手ボーン内の cm オフセット
  handItem = mesh;
  if (rightHandBone) rightHandBone.add(handItem);
}

export function triggerAttack() {
  attackTimer  = ATTACK_DURATION;
  _isAttacking = true;
  const action = (handItem && actions.melee) ? actions.melee : actions.attack;
  if (!action) return;
  if (_attackAction) _attackAction.stop();
  if (currentAction) currentAction.fadeOut(0.12);
  action.reset().setEffectiveWeight(1).fadeIn(0.12).play();
  _attackAction = action;
  currentAction = action;
}

export function triggerPunch() {
  attackTimer  = ATTACK_DURATION;
  _isAttacking = true;
  const action = actions.punch || actions.attack;
  if (!action) return;
  if (_attackAction) _attackAction.stop();
  if (currentAction) currentAction.fadeOut(0.12);
  action.reset().setEffectiveWeight(1).fadeIn(0.12).play();
  _attackAction = action;
  currentAction = action;
}

export function startDodge(cameraYaw, inputState) {
  if (!group || dodgeTimer > 0) return false;
  let dirX = 0, dirZ = 0;
  if (inputState?.forward)  { dirX -= Math.sin(cameraYaw); dirZ -= Math.cos(cameraYaw); }
  if (inputState?.backward) { dirX += Math.sin(cameraYaw); dirZ += Math.cos(cameraYaw); }
  const len = Math.hypot(dirX, dirZ);
  if (len > 0.001) { dirX /= len; dirZ /= len; }
  else { dirX = Math.sin(group.rotation.y); dirZ = Math.cos(group.rotation.y); }
  dodgeVelX = dirX * DODGE_SPEED;
  dodgeVelZ = dirZ * DODGE_SPEED;
  dodgeTimer = DODGE_DURATION;
  return true;
}

export function isDodging() { return dodgeTimer > 0; }

// ── 衝突判定 ──────────────────────────────────────────

function isColliding(px, py, pz, boxes1, boxes2) {
  _center.set(px, py + PLAYER_H / 2, pz);
  _playerBox.setFromCenterAndSize(_center, _size);
  for (const box of boxes1) {
    if (_playerBox.intersectsBox(box)) return true;
  }
  if (boxes2) {
    for (const box of boxes2) {
      if (_playerBox.intersectsBox(box)) return true;
    }
  }
  return false;
}

function moveWithCollision(dx, dz, boxes1, boxes2) {
  const tryAxis = (axis, delta) => {
    const prev = axis === 'x' ? group.position.x : group.position.z;
    if (axis === 'x') group.position.x += delta;
    else group.position.z += delta;

    if (isColliding(group.position.x, group.position.y, group.position.z, boxes1, boxes2)) {
      const stepY = group.position.y + STEP_HEIGHT;
      if (!isColliding(group.position.x, stepY, group.position.z, boxes1, boxes2)) {
        group.position.y = stepY;
        velY = 0;
      } else {
        if (axis === 'x') group.position.x = prev;
        else group.position.z = prev;
      }
    }
  };
  tryAxis('x', dx);
  tryAxis('z', dz);
}

function getColliderGroundHeight(x, z, terrainCollider, placedBoxes) {
  let h;
  if (terrainCollider) {
    _rayOrigin.set(x, 200, z);
    _raycaster.set(_rayOrigin, _down);
    _raycaster.firstHitOnly = true;
    _raycaster.far = 500;
    const hit = _raycaster.intersectObject(terrainCollider, false)[0];
    h = hit ? hit.point.y : getTerrainHeight(x, z);
  } else {
    h = getTerrainHeight(x, z);
  }
  if (placedBoxes) {
    const py = group.position.y;
    for (const box of placedBoxes) {
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z) {
        const top = box.max.y;
        if (top > h && py + 0.15 >= top) h = top;
      }
    }
  }
  return h;
}

// ── FBX モデル生成 ─────────────────────────────────────
export function create(scene) {
  group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.rotation.y = Math.PI;
  scene.add(group);

  // FBX が読めるまで（または読めなかった場合に）表示する簡易主人公。
  fallbackModel = buildFallbackHumanoid();
  group.add(fallbackModel);

  const loader = new FBXLoader();

  console.log('[player] model.fbx ロード開始…');
  loader.load('/chara/model.fbx',
    (fbx) => {
     try {
      sanitizeFbx(fbx); // 不正な undefined 子ノードを除去（traverse クラッシュ対策）
      fbx.scale.setScalar(0.01); // Mixamo FBX は cm 単位
      fbx.castShadow = true;
      let meshCount = 0, boneCount = 0;
      safeWalk(fbx, (child) => {
        if (child.isMesh) {
          meshCount++;
          child.castShadow = true;
          child.receiveShadow = true;
          // スキニングでボーンが動くとバインドポーズの境界球が実体とズレ、
          // 視錐台カリングで丸ごと消えることがある → カリングを無効化して常に描画
          child.frustumCulled = false;
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { m.side = THREE.FrontSide; });
          }
        }
        // 右手ボーンを探す（Mixamo: mixamorigRightHand）
        if (child.isBone) {
          boneCount++;
          if (/righthand/i.test(child.name)) {
            rightHandBone = child;
            // setHandItem() が先に呼ばれた場合はここで追加
            if (handItem) rightHandBone.add(handItem);
          }
        }
      });
      group.add(fbx);
      // 本来のモデルが表示できたのでフォールバックを除去
      if (fallbackModel) { group.remove(fallbackModel); fallbackModel = null; }
      console.log(`[player] model.fbx ロード成功: meshes=${meshCount} bones=${boneCount}`);
      buildBoneMap(fbx); // ボーン名マップを構築（コンソールで確認できる）

      mixer = new THREE.AnimationMixer(fbx);
      // 攻撃アニメ終了 → 攻撃アクションを停止（ベース歩きはそのまま継続）
      mixer.addEventListener('finished', (e) => {
        if (e.action === _attackAction) {
          _isAttacking = false;
          e.action.stop();
          _attackAction = null;
          // 攻撃終了後にベースアニメを再開
          const baseName = !onGround ? 'jump'
            : _isMoving ? (_isSprinting && actions.run ? 'run' : 'walk')
            : 'idle';
          const base = actions[baseName] || actions.idle;
          if (base) { base.reset().fadeIn(0.18).play(); currentAction = base; }
        }
      });

      const loadAnim = (url, name, loop = true, upperBodyOnly = false) => {
        loader.load(url, (anim) => {
         try {
          // トラック数が最大のクリップを使う（空のダミーが index 0 に入る場合がある）
          const clips = anim.animations || [];
          if (clips.length === 0) { console.warn(`[player] ${name}: アニメクリップが無い（スキップ）`); return; }
          const clip = clips.reduce((best, a) => a.tracks.length > best.tracks.length ? a : best, clips[0]);
          if (!clip) { console.warn(`[player] ${name}: 有効なクリップが選べない（スキップ）`); return; }
          clip.name  = name;

          // FBXLoader はボーン名のコロンを除去して結合する（mixamorig1:Hips → mixamorig1Hips）。
          // Punch/Swimming/Melee 等の単体 DL は mixamorig: 形式のため
          // コロン除去 → mixamorig1Xxx 形式に統一してモデルのボーンとマッチさせる。
          clip.tracks.forEach(t => {
            const dotIdx = t.name.lastIndexOf('.');
            if (dotIdx < 0) return;
            let bone = t.name.slice(0, dotIdx).replace(/:/g, ''); // コロン除去
            const prop = t.name.slice(dotIdx + 1);
            // mixamorigXxx → mixamorig1Xxx（モデルのボーン名形式に統一）
            if (bone.startsWith('mixamorig') && !bone.startsWith('mixamorig1')) {
              bone = 'mixamorig1' + bone.slice('mixamorig'.length);
            }
            t.name = bone + '.' + prop;
          });
          clip.tracks = clip.tracks.filter(track => {
            const bone = track.name.split('.')[0];
            const prop = track.name.split('.')[1];
            // Hips の位置トラックを全アニメで除去（ゲームコードが移動を管理するため）
            if (/(hip|root)/i.test(bone) && prop === 'position') return false;
            if (upperBodyOnly && /(hip|upleg|leftleg|rightleg|foot|toe)/i.test(bone)) return false;
            return true;
          });

          const action = mixer.clipAction(clip);
          if (!loop) {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
          }
          actions[name] = action;
          if (name === 'idle' && !currentAction) {
            action.play();
            currentAction = action;
          }
         } catch (e) {
           console.warn(`[player] アニメ ${name} の処理でエラー（スキップ）:`, e?.message || e);
         }
        }, undefined, (err) => {
          console.warn(`[player] アニメ ${name} のロード失敗:`, err?.message || err);
        });
      };

      loadAnim('/chara/anim_idle.fbx',   'idle');
      loadAnim('/chara/anim_walk.fbx',   'walk');
      loadAnim('/chara/anim_run.fbx',    'run');
      loadAnim('/chara/anim_attack.fbx', 'attack', false);
      loadAnim('/chara/anim_punch.fbx',  'punch',  false);
      loadAnim('/chara/anim_melee.fbx',  'melee',  false);
      loadAnim('/chara/anim_swim.fbx',   'swim',   true);
      loadAnim('/chara/anim_jump.fbx',   'jump',   false);

      modelReady = true;
     } catch (e) {
       // モデル処理の途中で例外が出てもフォールバックは残す（主人公が消えないように）
       console.error('[player] model.fbx 処理中にエラー:', e?.message || e, e?.stack);
     }
    },
    undefined,
    (err) => {
      // model.fbx のロード自体が失敗 → フォールバックのまま操作できる状態を維持
      console.error('[player] FBX load error (model.fbx):',
        'message=', err?.message,
        'httpStatus=', err?.target?.status,
        err);
      console.warn('[player] model.fbx を読み込めませんでした。簡易主人公で続行します。');
    }
  );

  return group;
}

// ── 毎フレーム更新 ────────────────────────────────────
export function update(delta, inputState, cameraYaw, collidableBoxes, terrainCollider, placedBoxes) {
  if (!group) return new THREE.Vector3();

  const { forward, backward, jump, sprint } = inputState;

  const feetY   = group.position.y;
  const inWater = feetY < WATER_LEVEL - 0.05;
  const swimming = feetY < (WATER_LEVEL - WAIST_HEIGHT);

  const baseSpeed = (swimming ? SWIM_SPEED : (sprint ? SPEED * SPRINT_MULT : SPEED)) * Stats.getSpeedMult();

  let moveX = 0, moveZ = 0;
  if (forward)  { moveX -= Math.sin(cameraYaw); moveZ -= Math.cos(cameraYaw); }
  if (backward) { moveX += Math.sin(cameraYaw); moveZ += Math.cos(cameraYaw); }
  const len     = Math.sqrt(moveX * moveX + moveZ * moveZ);
  const isMoving = len > 0;

  _isMoving    = isMoving;
  _isSprinting = isMoving && sprint;
  _isSwimming  = inWater;

  if (isMoving) {
    const nx = (moveX / len) * baseSpeed * delta;
    const nz = (moveZ / len) * baseSpeed * delta;
    moveWithCollision(nx, nz, collidableBoxes, placedBoxes);
  }

  if (dodgeTimer > 0) {
    dodgeTimer = Math.max(0, dodgeTimer - delta);
    moveWithCollision(dodgeVelX * delta, dodgeVelZ * delta, collidableBoxes, placedBoxes);
  }

  // キャラクターをカメラ方向へ向ける
  const facingAngle = cameraYaw + Math.PI;
  group.rotation.y += shortestAngleDelta(group.rotation.y, facingAngle) * Math.min(1, delta * TURN_SPEED);

  // 垂直移動（水泳 or 通常重力）
  if (inWater) swimTime += delta * 2.5; // 浅い水でも水泳アニメが動くよう常時加算

  if (swimming) {
    velY += SWIM_BUOYANCY * delta;
    if (jump) velY = Math.max(velY, 2.5);
    velY *= SWIM_DRAG;
    if (feetY + velY * delta > WATER_LEVEL - WAIST_HEIGHT + 0.3) velY = Math.min(velY, 1.0);
    onGround = false;
  } else {
    if (jump && onGround) { velY = JUMP_VEL; onGround = false; }
    velY += GRAVITY * delta;
    if (inWater) velY *= 0.92;
  }

  group.position.y += velY * delta;

  const groundY = getColliderGroundHeight(group.position.x, group.position.z, terrainCollider, placedBoxes);
  if (group.position.y <= groundY) {
    group.position.y = groundY;
    velY      = 0;
    onGround  = true;
  }

  if (attackTimer > 0) {
    attackTimer = Math.max(0, attackTimer - delta);
    // 手続きパンチ（FBX なし）の終了検出
    if (attackTimer === 0 && !_attackAction) _isAttacking = false;
  }

  // AnimationMixer 更新
  if (mixer) mixer.update(delta);

  // ベースアニメ状態機械（FBX 攻撃中はスキップ）
  if (modelReady && !_attackAction) {
    if (inWater && actions.swim) {
      switchAction('swim');
    } else if (!onGround && actions.jump) {
      switchAction('jump');
    } else if (isMoving) {
      switchAction(sprint && actions.run ? 'run' : 'walk');
    } else {
      switchAction('idle');
    }
  }

  return group.position;
}
