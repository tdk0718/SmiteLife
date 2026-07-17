import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';
import * as Inventory from './inventory.js';
import { isRaining } from './weather.js';
import * as Storage from './storage.js';

const PLACE_DIST      = 2.5;
const INTERACT_DIST   = 2.4;
const WATER_LEVEL     = 0.05;
const BLOCK_HEIGHT    = 0.50;  // 石ブロック1段の高さ
const STACK_RADIUS    = 0.70;  // この距離以内なら同じ柱に積む
const FIRE_SPREAD_DIST   = 1.8;  // 火の延焼距離
const FIRE_IGNITE_TIME   = 4.0;  // 延焼までの秒数
const RAIN_EXTINGUISH    = 18.0; // 雨で消えるまでの秒数
const ROOF_COVER_RADIUS  = 1.8;  // 屋根が火を守れる水平距離
const FP_RAY_MAX     = 20;    // 一人称レイキャスト最大距離
const WOOD_BURN_TIME = 15;   // 薪1本が燃え尽きて木炭になる秒数
const COOK_TIME      = 8;    // 焚き火で肉・魚1つが焼ける秒数
const SMELT_TIME     = 6;    // 炉で鉱石1つの精錬にかかる秒数

// 空中に浮かせてはいけないアイテム（side スナップ禁止、topか地面のみ）
const GROUNDED_IDS = new Set(['wood', 'straw', 'stone', 'coal', 'floor_board', 'bed']);

// 設置モード用 Raycaster（地形との交差判定）
const _placementRaycaster = new THREE.Raycaster();

// 設置物の衝突半径（敵の押し出しに使用。0 = 衝突なし）
const COLLIDE_RADIUS = {
  wood: 0.42, straw: 0.35, stone: 0.40, torch: 0.08, coal: 0.20,
  wooden_fence: 0.55, stone_block: 0.44, pillar: 0.18, stone_foundation: 0.0,
  floor_board: 0.0, wall_panel: 0.52, window_wall: 0.52, roof_panel: 0.0, door: 0.55,
  door_frame_wall: 0.52, workbench: 0.50, bed: 0.0,
  furnace: 0.48, lathe: 0.52,
};

// 設置物の論理サイズ { w: 幅, d: 奥行, h: 高さ } ── スナップ計算に使用
const SIZES = {
  wood:         { w: 0.88, d: 0.88, h: 0.40 },
  straw:        { w: 0.76, d: 0.76, h: 0.40 },
  stone:        { w: 0.88, d: 0.88, h: 0.55 },
  torch:        { w: 0.12, d: 0.12, h: 0.75 },
  coal:         { w: 0.44, d: 0.44, h: 0.40 },
  wooden_fence: { w: 1.10, d: 0.10, h: 1.05 },
  stone_block:  { w: 0.90, d: 0.90, h: 0.50 },
  stone_foundation: { w: 1.00, d: 1.00, h: 0.32 },
  pillar:       { w: 0.26, d: 0.26, h: 1.20 },
  floor_board:  { w: 1.00, d: 1.00, h: 0.06 },
  wall_panel:   { w: 1.00, d: 0.08, h: 1.20 },
  window_wall:  { w: 1.00, d: 0.08, h: 1.20 },
  roof_panel:      { w: 1.00, d: 1.00, h: 0.50 },
  door:            { w: 1.00, d: 0.12, h: 2.10 },
  door_frame_wall: { w: 1.00, d: 0.08, h: 1.20 },
  workbench:       { w: 1.00, d: 0.60, h: 0.90 },
  bed:             { w: 0.90, d: 2.00, h: 0.60 },
  furnace:         { w: 0.80, d: 0.80, h: 1.35 },
  lathe:           { w: 1.10, d: 0.50, h: 1.05 },
};
function getSize(id) { return SIZES[id] ?? { w: 1.0, d: 1.0, h: 0.5 }; }

// ─── スナップ制約 ─────────────────────────────────────
// どのオブジェクトにスナップできるか（undefined = 制約なし）
const SNAP_ALLOWED_SOURCES = {
  roof_panel: new Set(['wall_panel', 'window_wall', 'door_frame_wall', 'floor_board', 'pillar']),
  door:       new Set(['door_frame_wall']),
};
// スナップ必須アイテム（自由設置不可）
const SNAP_REQUIRED_IDS = new Set(['door']);
// 地面か床材（床板・石の基礎）の上にしか置けないアイテム
const FLOOR_OR_GROUND_ONLY = new Set(['wood', 'bed']);
const FLOOR_BASE_IDS = new Set(['floor_board', 'stone_foundation']);

// ─── OBB 交差判定 (XZ平面) ───────────────────────────
function obbOverlapXZ(ax, az, aw, ad, arot, bx, bz, bw, bd, brot) {
  const dx = bx - ax, dz = bz - az;
  const axX = Math.cos(arot), axZ = -Math.sin(arot);
  const azX = Math.sin(arot), azZ =  Math.cos(arot);
  const bxX = Math.cos(brot), bxZ = -Math.sin(brot);
  const bzX = Math.sin(brot), bzZ =  Math.cos(brot);
  const MARGIN = 0.025; // 2.5cm 以上食い込まないと衝突とみなさない
  for (const [nx, nz] of [[axX, axZ], [azX, azZ], [bxX, bxZ], [bzX, bzZ]]) {
    const hA = aw / 2 * Math.abs(axX * nx + axZ * nz) + ad / 2 * Math.abs(azX * nx + azZ * nz);
    const hB = bw / 2 * Math.abs(bxX * nx + bxZ * nz) + bd / 2 * Math.abs(bzX * nx + bzZ * nz);
    if (Math.abs(dx * nx + dz * nz) > hA + hB - MARGIN) return false;
  }
  return true;
}

function canCoexist(idA, idB) {
  return (idA === 'door' && idB === 'door_frame_wall') ||
         (idA === 'door_frame_wall' && idB === 'door');
}

function overlapsAny(x, z, y, rot, newId, excludeObj = null) {
  const ns = getSize(newId);
  const newBot = y, newTop = y + ns.h;
  const newMaxR = Math.hypot(ns.w, ns.d) / 2;
  const EPS = 1e-4;
  for (const obj of placed) {
    if (!obj.alive) continue;
    if (obj === excludeObj) continue; // スナップ元は交差チェック対象外
    if (canCoexist(newId, obj.itemId)) continue;
    const os = getSize(obj.itemId);
    const oBot = obj.position.y, oTop = obj.position.y + os.h;
    if (newBot >= oTop - EPS || oBot >= newTop - EPS) continue; // Y重複なし
    const dx = obj.position.x - x, dz = obj.position.z - z;
    const oMaxR = Math.hypot(os.w, os.d) / 2;
    if (dx * dx + dz * dz > (newMaxR + oMaxR) * (newMaxR + oMaxR)) continue;
    if (obbOverlapXZ(x, z, ns.w, ns.d, rot,
                     obj.position.x, obj.position.z, os.w, os.d, obj.rotation ?? 0)) return true;
  }
  return false;
}

// ─── スナップ設定 ─────────────────────────────────
const SNAP_ANGLE     = Math.PI / 4; // 45度ごとに回転を固定
const SNAP_TOLERANCE = 1.6;          // この距離以内ならスナップ

function snapRot(a) {
  return Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
}

// 既存設置物に対する「吸着候補」を返す（設置物の回転を考慮）
// type:'top'     = 真上／真上ずらし
// type:'side'    = 横エッジ揃え（cx/cz=接続点、pivotAxis/pivotSign=ピボット計算用）
// type:'overlay' = 同位置スナップ（ドア→ドア枠付き壁）
function getSnapCandidates(obj, newId) {
  const os = getSize(obj.itemId);
  const ns = getSize(newId);
  const ox = obj.position.x, oz = obj.position.z, oy = obj.position.y;
  const topY = oy + os.h;
  const ry = obj.rotation ?? 0;
  const cR = Math.cos(ry), sR = Math.sin(ry);

  const toWorld = (lx, lz) => ({
    x: ox + lx * cR + lz * sR,
    z: oz - lx * sR + lz * cR,
  });

  const hw = os.w / 2, hd = os.d / 2;
  const nw = ns.w / 2, nd = ns.d / 2;

  // ── ドア → ドア枠付き壁: 同位置オーバーレイ ──
  if (newId === 'door' && obj.itemId === 'door_frame_wall') {
    return [{ x: ox, z: oz, y: oy, type: 'overlay' }];
  }

  // ── 屋根材 → 壁（wall_panel / door_frame_wall）: 屋根端を壁面に揃える ──
  if (newId === 'roof_panel' && (obj.itemId === 'wall_panel' || obj.itemId === 'window_wall' || obj.itemId === 'door_frame_wall')) {
    const ez = hd + nd; // このオフセットで屋根の端が壁面に揃う
    return [
      { ...toWorld(0,    ez),  y: topY, type: 'top' },
      { ...toWorld(0,   -ez),  y: topY, type: 'top' },
      { ...toWorld(nw,   ez),  y: topY, type: 'top' },
      { ...toWorld(-nw,  ez),  y: topY, type: 'top' },
      { ...toWorld(nw,  -ez),  y: topY, type: 'top' },
      { ...toWorld(-nw, -ez),  y: topY, type: 'top' },
    ];
  }

  // ── 屋根材 → 床材: 同サイズなので中心・隣接タイル揃え ──
  if (newId === 'roof_panel' && obj.itemId === 'floor_board') {
    return [
      { ...toWorld(0,   0),  y: topY, type: 'top' },
      { ...toWorld(nw,  0),  y: topY, type: 'top' },
      { ...toWorld(-nw, 0),  y: topY, type: 'top' },
      { ...toWorld(0,  nd),  y: topY, type: 'top' },
      { ...toWorld(0, -nd),  y: topY, type: 'top' },
    ];
  }

  // ── デフォルト候補 ──
  const cpR = toWorld(hw,  0);
  const cpL = toWorld(-hw, 0);
  const cpF = toWorld(0,   hd);
  const cpB = toWorld(0,  -hd);

  return [
    { ...toWorld(0, 0),          y: topY, type: 'top' },
    { ...toWorld(nw, 0),         y: topY, type: 'top' },
    { ...toWorld(-nw, 0),        y: topY, type: 'top' },
    { ...toWorld(0, nd),         y: topY, type: 'top' },
    { ...toWorld(0, -nd),        y: topY, type: 'top' },
    { ...toWorld(hw + nw, 0),    y: oy, type: 'side', cx: cpR.x, cz: cpR.z, pivotAxis: 'X', pivotSign: +1 },
    { ...toWorld(-(hw + nw), 0), y: oy, type: 'side', cx: cpL.x, cz: cpL.z, pivotAxis: 'X', pivotSign: -1 },
    { ...toWorld(0, hd + nd),    y: oy, type: 'side', cx: cpF.x, cz: cpF.z, pivotAxis: 'Z', pivotSign: +1 },
    { ...toWorld(0, -(hd + nd)), y: oy, type: 'side', cx: cpB.x, cz: cpB.z, pivotAxis: 'Z', pivotSign: -1 },
  ];
}

// ─── 見た目バリエーション用の決定的乱数 ─────────────
// 設置位置から決まるシード。同じ場所ならセーブ/ロード後も同じ見た目が再現される。
function posSeed(x, z) {
  const xi = Math.round(x * 10) | 0;
  const zi = Math.round(z * 10) | 0;
  let h = (Math.imul(xi, 374761393) + Math.imul(zi, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── アイテム設置定義 ─────────────────────────────
const DEFS = {
  wood: {
    name: '木材スタック',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
      for (let i = 0; i < 3; i++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.85, 6), mat);
        log.rotation.z = Math.PI / 2;
        log.rotation.y = i * (Math.PI / 3);
        log.position.y = 0.12 + i * 0.08;
        log.castShadow = true;
        g.add(log);
      }
      return g;
    },
    interactions: [{ id: 'box_open', label: '📦 焚き火ボックス' }],
  },
  straw: {
    name: '藁束',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0xcfb040 });
      const pile = new THREE.Mesh(new THREE.SphereGeometry(0.38, 6, 4), mat);
      pile.scale.y = 0.48;
      pile.position.y = 0.18;
      pile.castShadow = true;
      g.add(pile);
      return g;
    },
    interactions: [{ id: 'ignite', label: '🔥 火をつける', requiresTool: 'fire_starter' }],
  },
  stone: {
    name: '石積み',
    build() {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      for (let i = 0; i < 4; i++) {
        const r = 0.16 + (i % 2) * 0.06;
        const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
        s.position.set((i % 2 === 0 ? -1 : 1) * 0.18, r + (Math.floor(i / 2)) * 0.22, (i < 2 ? -0.08 : 0.08));
        s.castShadow = true;
        g.add(s);
      }
      return g;
    },
    interactions: [],
  },
  torch: {
    name: '松明',
    build() {
      const g = new THREE.Group();
      const handleMat = new THREE.MeshLambertMaterial({ color: 0x7a5020 });
      const flameMat  = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 0.9 });
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.65, 6), handleMat);
      handle.position.y = 0.32;
      handle.castShadow = true;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.22, 6), flameMat);
      flame.position.y = 0.75;
      g.add(handle, flame);
      return g;
    },
    onPlace(obj, scene) {
      const light = new THREE.PointLight(0xff9944, 1.8, 9);
      light.position.copy(obj.position).add(new THREE.Vector3(0, 0.9, 0));
      scene.add(light);
      obj.light = light;
    },
    onRemove(obj, scene) {
      if (obj.light) { scene.remove(obj.light); obj.light = null; }
    },
    interactions: [],
  },
  coal: {
    name: '石炭',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
      const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat);
      lump.position.y = 0.22;
      lump.castShadow = true;
      g.add(lump);
      return g;
    },
    interactions: [{ id: 'ignite', label: '🔥 火をつける', requiresTool: 'fire_starter' }],
  },
  wooden_fence: {
    name: '木の柵',
    canBurn: true,
    // 基本デザインは1種類。seed（設置位置由来）で板の傾き・色ムラ・節などの
    // 個体差だけが変わり、並べても「同じオブジェクトのコピー」に見えないようにする。
    build(seed = 0) {
      const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
      const jitter = (amp) => (rand() - 0.5) * amp;

      const g = new THREE.Group();

      // 同系色の中でわずかに違う風化した木の色（古材の日焼けムラ）
      const woodMat = (dark = 0) => new THREE.MeshLambertMaterial({
        color: new THREE.Color().setHSL(
          0.074 + jitter(0.010),
          0.36 + jitter(0.08),
          Math.max(0.14, 0.29 + jitter(0.06) - dark)
        ),
      });

      const plank = (w, h, t, x, y, z, tiltZ = 0) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), woodMat());
        m.position.set(x, y, z);
        m.rotation.z = tiltZ;
        m.castShadow = true;
        m.receiveShadow = true;
        return m;
      };

      // ── 両端の支柱（隣の柵と重なって1本の柱に見える位置） ──
      const postH = 1.00 + jitter(0.05);
      for (const px of [-0.55, 0.55]) {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.044 + jitter(0.006), 0.054 + jitter(0.006), postH, 7),
          woodMat(0.06)
        );
        post.position.set(px, postH / 2, 0);
        post.rotation.z = jitter(0.025);
        post.castShadow = true;
        g.add(post);
        // 天面の面取りキャップ（雨よけ）
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.056, 0.07, 7), woodMat(0.1));
        cap.position.set(px, postH + 0.03, 0);
        g.add(cap);
      }

      // ── 横板3段（全ての柵で共通の基本形。段ごとに高さ・傾き・幅が微妙に違う） ──
      for (const baseY of [0.30, 0.58, 0.86]) {
        g.add(plank(
          1.13 + jitter(0.04),          // 板の長さの個体差
          0.12 + jitter(0.025),         // 板の幅の個体差
          0.034,
          jitter(0.02),                 // 左右の打ち付けズレ
          baseY + jitter(0.035),        // 高さのズレ
          0.045,
          jitter(0.045)                 // 傾き
        ));
      }

      // ── 低確率のディテール（あくまで同じ柵の「使い込まれた差」） ──
      // 約35%: 板の節（コブ）
      if (rand() < 0.35) {
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.030 + jitter(0.010), 5, 4), woodMat(0.13));
        knot.position.set(jitter(0.8), [0.30, 0.58, 0.86][Math.floor(rand() * 3)] + jitter(0.04), 0.062);
        g.add(knot);
      }
      // 約25%: 継ぎ足しの短い当て板（補修跡）
      if (rand() < 0.25) {
        g.add(plank(0.26 + jitter(0.08), 0.10, 0.03, jitter(0.6), 0.44 + jitter(0.3), 0.066, jitter(0.10)));
      }
      // 約20%: 中央の縦桟（ぐらつき止め）
      if (rand() < 0.20) {
        g.add(plank(0.085, 0.78 + jitter(0.06), 0.03, jitter(0.15), 0.50, 0.068, jitter(0.03)));
      }

      return g;
    },
    interactions: [],
  },
  stone_foundation: {
    name: '石の基礎',
    build(seed = 0) {
      const rand = mulberry32((seed ^ 0x51ed270b) >>> 0);
      const jitter = (amp) => (rand() - 0.5) * amp;
      const stoneMat = (dark = 0) => new THREE.MeshLambertMaterial({
        color: new THREE.Color().setHSL(0.08 + jitter(0.02), 0.05 + rand() * 0.04, Math.max(0.15, 0.42 + jitter(0.07) - dark)),
      });
      const g = new THREE.Group();
      // 本体（下段）
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.26, 1.0), stoneMat());
      base.position.y = 0.13;
      base.castShadow = true;
      base.receiveShadow = true;
      g.add(base);
      // 上端プレート（わずかに張り出した笠石）
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.06, 1.04), stoneMat(0.04));
      top.position.y = 0.29;
      top.castShadow = true;
      top.receiveShadow = true;
      g.add(top);
      // 目地（横一周の暗いライン）
      const mortar = new THREE.Mesh(new THREE.BoxGeometry(1.01, 0.02, 1.01), new THREE.MeshLambertMaterial({ color: 0x4a4842 }));
      mortar.position.y = 0.14 + jitter(0.03);
      g.add(mortar);
      // 四隅の隅石（少し飛び出した石積みの表情）
      for (const [cx, cz] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) {
        const corner = new THREE.Mesh(new THREE.BoxGeometry(0.16 + jitter(0.03), 0.20 + jitter(0.04), 0.16 + jitter(0.03)), stoneMat(0.02));
        corner.position.set(cx + jitter(0.02), 0.12, cz + jitter(0.02));
        corner.rotation.y = jitter(0.12);
        corner.castShadow = true;
        g.add(corner);
      }
      return g;
    },
    interactions: [],
  },
  stone_block: {
    name: '石ブロック',
    stackable: true,
    build() {
      const g = new THREE.Group();
      const mat     = new THREE.MeshLambertMaterial({ color: 0x8a8880 });
      const mortMat = new THREE.MeshLambertMaterial({ color: 0x5a5850 });
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.90, BLOCK_HEIGHT, 0.90), mat);
      block.position.y = BLOCK_HEIGHT / 2;
      block.castShadow = true;
      block.receiveShadow = true;
      g.add(block);
      const hLine = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.022, 0.022), mortMat);
      hLine.position.set(0, BLOCK_HEIGHT * 0.5, 0.455);
      const vLine = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.92), mortMat);
      vLine.position.set(0.455, BLOCK_HEIGHT * 0.5, 0);
      g.add(hLine, vLine);
      return g;
    },
    interactions: [],
  },

  // ─── 建築部材 ──────────────────────────────────────
  pillar: {
    name: '木の柱',
    canBurn: true,
    stackable: true,
    stackHeight: 1.2,
    build() {
      const g = new THREE.Group();
      const mat    = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
      const ringMat= new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 1.2, 8), mat);
      post.position.y = 0.6;
      post.castShadow = true;
      post.receiveShadow = true;
      g.add(post);
      for (const ry of [0.08, 1.12]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 8), ringMat);
        ring.position.y = ry;
        g.add(ring);
      }
      return g;
    },
    interactions: [],
  },

  floor_board: {
    name: '床材',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const mat     = new THREE.MeshLambertMaterial({ color: 0xa07040 });
      const lineMat = new THREE.MeshLambertMaterial({ color: 0x7a5020 });
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 1.0), mat);
      board.position.y = 0.03;
      board.receiveShadow = true;
      g.add(board);
      for (let i = -1; i <= 1; i++) {
        const groove = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.065, 1.02), lineMat);
        groove.position.set(i * 0.32, 0.03, 0);
        g.add(groove);
      }
      return g;
    },
    interactions: [],
  },

  wall_panel: {
    name: '木の壁材',
    canBurn: true,
    stackable: true,
    stackHeight: 1.2,
    build() {
      const g = new THREE.Group();
      const mat     = new THREE.MeshLambertMaterial({ color: 0x9a6832 });
      const darkMat = new THREE.MeshLambertMaterial({ color: 0x7a5022 });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 0.08), mat);
      panel.position.y = 0.6;
      panel.castShadow = true;
      panel.receiveShadow = true;
      g.add(panel);
      // 横板の境目（4本）
      for (let i = 0; i < 4; i++) {
        const groove = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.025, 0.09), darkMat);
        groove.position.set(0, 0.15 + i * 0.3, 0);
        g.add(groove);
      }
      return g;
    },
    interactions: [],
  },

  window_wall: {
    name: '窓付き壁',
    canBurn: true,
    stackable: true,
    stackHeight: 1.2,
    build() {
      const g = new THREE.Group();
      const mat      = new THREE.MeshLambertMaterial({ color: 0x9a6832 });
      const darkMat  = new THREE.MeshLambertMaterial({ color: 0x7a5022 });
      const frameMat = new THREE.MeshLambertMaterial({ color: 0x5a3a10 });
      // 窓開口（x -0.25..0.25, y 0.5..1.02）を囲む4枚の壁
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.50, 0.08), mat);
      bottom.position.y = 0.25;
      bottom.castShadow = bottom.receiveShadow = true;
      g.add(bottom);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, 0.08), mat);
      top.position.y = 1.11;
      top.castShadow = true;
      g.add(top);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.52, 0.08), mat);
        side.position.set(sx * 0.375, 0.76, 0);
        side.castShadow = true;
        g.add(side);
      }
      // 窓枠（敷居・まぐさ）
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.13), frameMat);
      sill.position.y = 0.485;
      g.add(sill);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.05, 0.13), frameMat);
      lintel.position.y = 1.035;
      g.add(lintel);
      // 十字の桟
      const muntinH = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.03, 0.05), frameMat);
      muntinH.position.y = 0.76;
      g.add(muntinH);
      const muntinV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.52, 0.05), frameMat);
      muntinV.position.y = 0.76;
      g.add(muntinV);
      // 横板の境目（下部壁）
      const groove = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.025, 0.09), darkMat);
      groove.position.y = 0.15;
      g.add(groove);
      return g;
    },
    interactions: [],
  },

  roof_panel: {
    name: '屋根材',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const mat     = new THREE.MeshLambertMaterial({ color: 0x6b3a1f, side: THREE.DoubleSide });
      const ridgeMat= new THREE.MeshLambertMaterial({ color: 0x4a2510 });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 1.0), mat);
      panel.rotation.x = Math.PI / 6;  // 30度傾斜
      panel.position.y = 0.28;
      panel.position.z = -0.12;
      panel.castShadow = true;
      panel.receiveShadow = true;
      g.add(panel);
      for (let i = -1; i <= 1; i++) {
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.065, 1.02), ridgeMat);
        ridge.rotation.x = Math.PI / 6;
        ridge.position.set(i * 0.40, 0.285, -0.12);
        g.add(ridge);
      }
      return g;
    },
    interactions: [],
  },

  door_frame_wall: {
    name: 'ドア枠付き壁',
    canBurn: true,
    stackable: true,
    stackHeight: 1.2,
    build() {
      const g = new THREE.Group();
      const frameMat = new THREE.MeshLambertMaterial({ color: 0x5a3a10 });
      const panelMat = new THREE.MeshLambertMaterial({ color: 0x9a6832 });
      // 左縦枠
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.09), frameMat);
      left.position.set(-0.41, 0.6, 0);
      left.castShadow = true;
      g.add(left);
      // 右縦枠
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.09), frameMat);
      right.position.set(0.41, 0.6, 0);
      right.castShadow = true;
      g.add(right);
      // 上枠
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.09), frameMat);
      top.position.set(0, 1.14, 0);
      top.castShadow = true;
      g.add(top);
      // 上部小壁（枠上の隙間を埋める薄板）
      const fill = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.07), panelMat);
      fill.position.set(0, 1.17, 0);
      g.add(fill);
      return g;
    },
    interactions: [],
  },

  door: {
    name: 'ドア',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const frameMat= new THREE.MeshLambertMaterial({ color: 0x5a3a10 });
      const panelMat= new THREE.MeshLambertMaterial({ color: 0x8B5E2C });
      const knobMat = new THREE.MeshLambertMaterial({ color: 0xd4a020 });
      // 縦枠
      for (const px of [-0.47, 0.47]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 0.10), frameMat);
        side.position.set(px, 1.0, 0);
        side.castShadow = true;
        g.add(side);
      }
      // 上枠
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.10, 0.10), frameMat);
      top.position.set(0, 2.0, 0);
      top.castShadow = true;
      g.add(top);
      // 開閉する扉本体（左端ヒンジのサブグループ。開閉は leaf.rotation.y で行う）
      const leaf = new THREE.Group();
      leaf.position.set(-0.41, 0, 0);
      const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.80, 0.06), panelMat);
      doorPanel.position.set(0.41, 0.93, 0);
      doorPanel.castShadow = true;
      leaf.add(doorPanel);
      // 横桟
      for (const py of [0.42, 1.0, 1.58]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.06, 0.065), frameMat);
        bar.position.set(0.41, py, 0);
        leaf.add(bar);
      }
      // ノブ
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), knobMat);
      knob.position.set(0.73, 0.92, 0.06);
      leaf.add(knob);
      g.userData.leaf = leaf;
      g.add(leaf);
      return g;
    },
    interactions: [{ id: 'door_toggle', label: '🚪 開ける／閉める' }],
  },

  workbench: {
    name: '作業台',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const woodMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
      const darkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a1a });
      // 天板
      const tabletop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.60), woodMat);
      tabletop.position.y = 0.87;
      tabletop.castShadow = true;
      tabletop.receiveShadow = true;
      g.add(tabletop);
      // 脚4本
      for (const [lx, lz] of [[-0.44, -0.26], [0.44, -0.26], [-0.44, 0.26], [0.44, 0.26]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.84, 0.07), darkMat);
        leg.position.set(lx, 0.42, lz);
        leg.castShadow = true;
        g.add(leg);
      }
      // 下段棚
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.52), woodMat);
      shelf.position.y = 0.35;
      shelf.receiveShadow = true;
      g.add(shelf);
      // 工具掛けバー
      const rack = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.07, 0.06), darkMat);
      rack.position.set(0, 0.93, -0.28);
      g.add(rack);
      return g;
    },
    interactions: [{ id: 'box_open', label: '📦 作業台ボックス' }],
  },

  furnace: {
    name: '簡易炉',
    build() {
      const g = new THREE.Group();
      const stoneMat = new THREE.MeshLambertMaterial({ color: 0x6b6b6b });
      const darkMat  = new THREE.MeshLambertMaterial({ color: 0x262626 });
      const emberMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
      // 本体
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), stoneMat);
      body.position.y = 0.45;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      // 焚き口
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.12), darkMat);
      mouth.position.set(0, 0.3, 0.4);
      g.add(mouth);
      // 残り火（発光）
      const ember = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.06), emberMat);
      ember.position.set(0, 0.28, 0.43);
      g.add(ember);
      // 煙突
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 8), stoneMat);
      chimney.position.set(0.22, 1.1, -0.12);
      chimney.castShadow = true;
      g.add(chimney);
      // 炉内の灯り
      const light = new THREE.PointLight(0xff7a22, 1.1, 4);
      light.position.set(0, 0.35, 0.4);
      g.add(light);
      return g;
    },
    interactions: [{ id: 'box_open', label: '📦 炉ボックス' }],
  },

  lathe: {
    name: '旋盤',
    build() {
      const g = new THREE.Group();
      const metalMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
      const darkMat  = new THREE.MeshLambertMaterial({ color: 0x40454a });
      const woodMat  = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
      // 台
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.5), metalMat);
      base.position.y = 0.8;
      base.castShadow = true; base.receiveShadow = true;
      g.add(base);
      // 脚4本
      for (const [lx, lz] of [[-0.48, -0.18], [0.48, -0.18], [-0.48, 0.18], [0.48, 0.18]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), darkMat);
        leg.position.set(lx, 0.4, lz);
        leg.castShadow = true;
        g.add(leg);
      }
      // 主軸台・芯押し台
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.4), darkMat);
      head.position.set(-0.42, 1.0, 0);
      head.castShadow = true;
      g.add(head);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.36), darkMat);
      tail.position.set(0.44, 0.98, 0);
      tail.castShadow = true;
      g.add(tail);
      // 加工中のワーク（回転軸）
      const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), woodMat);
      spindle.rotation.z = Math.PI / 2;
      spindle.position.set(0, 1.0, 0);
      g.add(spindle);
      return g;
    },
    interactions: [{ id: 'box_open', label: '📦 旋盤ボックス' }],
  },

  bed: {
    name: 'ベッド',
    canBurn: true,
    build() {
      const g = new THREE.Group();
      const frameMat   = new THREE.MeshLambertMaterial({ color: 0x7a4e2a });
      const mattMat    = new THREE.MeshLambertMaterial({ color: 0xcfb89a });
      const pillowMat  = new THREE.MeshLambertMaterial({ color: 0xfff4ec });
      const blanketMat = new THREE.MeshLambertMaterial({ color: 0x6a8cb8 });
      // フレーム
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 2.02), frameMat);
      frame.position.y = 0.11;
      frame.castShadow = true; frame.receiveShadow = true;
      g.add(frame);
      // マットレス
      const matt = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.18, 1.70), mattMat);
      matt.position.y = 0.31;
      matt.receiveShadow = true;
      g.add(matt);
      // 毛布
      const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.08, 1.00), blanketMat);
      blanket.position.set(0, 0.44, 0.35);
      g.add(blanket);
      // 枕
      const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.10, 0.28), pillowMat);
      pillow.position.set(0, 0.45, -0.72);
      pillow.castShadow = true;
      g.add(pillow);
      // ヘッドボード
      const hb = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.45, 0.08), frameMat);
      hb.position.set(0, 0.33, -1.01);
      hb.castShadow = true;
      g.add(hb);
      return g;
    },
    interactions: [
      { id: 'bed_rest', label: '😴 休憩する' },
      { id: 'bed_warp', label: '✨ ベッドへワープ' },
    ],
  },
};

// 設置可能かどうか
export function isPlaceable(itemId) {
  return !!DEFS[itemId];
}

// 最寄りのベッド位置を返す（なければ null）
export function getNearestBedPosition(fromPos) {
  let nearest = null;
  let nearestDist = Infinity;
  for (const obj of placed) {
    if (!obj.alive || obj.itemId !== 'bed') continue;
    const dx = obj.position.x - fromPos.x;
    const dz = obj.position.z - fromPos.z;
    const d = Math.hypot(dx, dz);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = obj.position.clone();
    }
  }
  return nearest;
}

// スタック可能アイテムの積み上げ先 y を返す。スタック不要なら null。
function getStackY(x, z, itemId) {
  const def = DEFS[itemId];
  if (!def?.stackable) return null;
  const stepH = def.stackHeight ?? BLOCK_HEIGHT;
  let topY = null;
  for (const obj of placed) {
    if (!obj.alive || obj.itemId !== itemId) continue;
    if (Math.hypot(obj.position.x - x, obj.position.z - z) < STACK_RADIUS) {
      const blockTop = obj.position.y + stepH;
      if (topY === null || blockTop > topY) topY = blockTop;
    }
  }
  return topY;
}

// ─── 焚き火メッシュ ───────────────────────────────
function buildCampfire() {
  const g = new THREE.Group();
  const logMat   = new THREE.MeshLambertMaterial({ color: 0x4a2a10 });
  const emberMat = new THREE.MeshLambertMaterial({ color: 0xff3300, emissive: 0xcc1100, emissiveIntensity: 1.0 });
  const flameMat = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff6600, emissiveIntensity: 0.85, transparent: true, opacity: 0.88 });

  for (let i = 0; i < 2; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.95, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i * (Math.PI / 2);
    log.position.y = 0.07;
    log.castShadow = true;
    g.add(log);
  }
  const embers = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), emberMat);
  embers.position.y = 0.1;
  g.add(embers);

  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 7), flameMat);
  flame.position.y = 0.52;
  g.userData.flame = flame;
  g.add(flame);

  return g;
}

// ─── モジュール状態 ────────────────────────────────
let _scene = null;
const placed = [];   // 設置済みオブジェクト一覧
let _placedBoxCache = [];
let _placedBoxDirty = true;

function _invalidatePlacedBoxes() { _placedBoxDirty = true; }

export function getPlacedBoxes() {
  if (!_placedBoxDirty) return _placedBoxCache;
  _placedBoxCache = [];
  for (const obj of placed) {
    if (!obj.alive) continue;
    if (obj.itemId === 'door' && obj.doorOpen) continue; // 開いたドアは通れる
    const s = getSize(obj.itemId);
    const p = obj.position;
    const rot = obj.rotation ?? 0;
    // 回転を考慮したAABB（包囲軸に整列）
    const cosR = Math.abs(Math.cos(rot));
    const sinR = Math.abs(Math.sin(rot));
    const halfW = (s.w * cosR + s.d * sinR) / 2;
    const halfD = (s.w * sinR + s.d * cosR) / 2;
    _placedBoxCache.push(new THREE.Box3(
      new THREE.Vector3(p.x - halfW, p.y, p.z - halfD),
      new THREE.Vector3(p.x + halfW, p.y + s.h, p.z + halfD)
    ));
  }
  _placedBoxDirty = false;
  return _placedBoxCache;
}
let placementMode = false;
let placementItemId = null;
let ghostGroup = null;
let ghostMat = null;
let ghostValid   = false; // 現在のゴースト位置が設置可能か
let ghostSnapped = false; // スナップ候補に吸着しているか
let placementRotationOffset = 0;
let interactHint = '';
let nextId = 0;
let _toastFn = null;
let _onWorkbenchCraft = null;
let _onBedWarp = null;
let _onBedNearby = null;

export function setOnWorkbenchCraft(fn) { _onWorkbenchCraft = fn; }
export function setOnBedWarp(fn) { _onBedWarp = fn; }
export function setOnBedNearby(fn) { _onBedNearby = fn; }

export function init(scene, toastFn) {
  _scene = scene;
  _toastFn = toastFn;

  // アイテムボックスUI（焚き火・炉・作業台・旋盤の格納庫）
  Storage.init();
  Storage.setHooks({
    getStatus: getBoxStatus,
    getActions: getBoxActions,
    onAction: onBoxAction,
  });
}

function toast(msg) { _toastFn?.(msg); }

// ─── アイテムボックス ─────────────────────────────
function boxCount(obj, id) { return obj.box?.[id] || 0; }
function boxTake(obj, id, n = 1) {
  if (boxCount(obj, id) < n) return false;
  obj.box[id] -= n;
  if (obj.box[id] <= 0) delete obj.box[id];
  return true;
}
function boxAdd(obj, id, n = 1) {
  obj.box = obj.box || {};
  obj.box[id] = (obj.box[id] || 0) + n;
}

function openStorage(obj) {
  obj.box = obj.box || {};
  Storage.open(obj);
}

// ボックスUIに表示する進行状況テキスト
function getBoxStatus(obj) {
  if (obj.itemId === 'wood') {
    if (obj.state === 'burning') {
      let s = `🔥 燃焼中… 木炭まであと ${Math.max(0, Math.ceil(WOOD_BURN_TIME - (obj.burnTimer || 0)))}秒（薪 ${boxCount(obj, 'wood')}）`;
      if (boxCount(obj, 'meat') > 0 || boxCount(obj, 'raw_fish') > 0) {
        s += ` ／ 🍳 調理中 あと ${Math.max(0, Math.ceil(COOK_TIME - (obj.cookTimer || 0)))}秒`;
      }
      return s;
    }
    return boxCount(obj, 'wood') > 0
      ? '🔥 火をつけられる（火打ち道具が必要）'
      : '🪵 薪（木材）を入れると火をつけられる';
  }
  if (obj.itemId === 'furnace') {
    const fuel = boxCount(obj, 'coal') + boxCount(obj, 'charcoal');
    const ore  = boxCount(obj, 'iron_ore') + boxCount(obj, 'copper_ore');
    if (fuel > 0 && ore > 0) return `🏭 精錬中… あと ${Math.max(0, Math.ceil(SMELT_TIME - (obj.smeltTimer || 0)))}秒`;
    if (ore > 0)  return '⚫ 燃料（石炭か木炭）が足りない';
    if (fuel > 0) return '⚙️ 鉱石（鉄か銅）を入れよう';
    return '燃料と鉱石を入れると自動で精錬が始まる';
  }
  return '';
}

// ボックスUIに表示する操作ボタン
function getBoxActions(obj) {
  if (obj.itemId === 'wood' && obj.state !== 'burning') {
    const enabled = Inventory.has('fire_starter') && boxCount(obj, 'wood') > 0;
    return [{ id: 'ignite', label: '🔥 火をつける', enabled }];
  }
  if (obj.itemId === 'workbench' || obj.itemId === 'lathe') {
    return [{ id: 'craft', label: '🔨 クラフトする', enabled: true }];
  }
  return [];
}

function onBoxAction(id, obj) {
  if (id === 'ignite') {
    ignite(obj);
    Storage.notifyChanged(obj);
  } else if (id === 'craft') {
    Storage.close();
    _onWorkbenchCraft?.(obj);
  }
}

// ─── 設置モード ────────────────────────────────────
export function enterPlacementMode(itemId) {
  if (!DEFS[itemId] || !Inventory.has(itemId)) {
    toast('設置できるアイテムがない！');
    return;
  }
  cancelPlacementMode();
  placementMode = true;
  placementItemId = itemId;
  placementRotationOffset = 0;

  // ゴースト（半透明プレビュー）
  ghostGroup = DEFS[itemId].build();
  ghostMat = new THREE.MeshLambertMaterial({ color: 0x88ddff, transparent: true, opacity: 0.45 });
  ghostGroup.traverse((c) => {
    if (c.isMesh) c.material = ghostMat;
  });
  _scene.add(ghostGroup);
  toast(`📦 ${DEFS[itemId].name} を設置中... F:確定  Z/X:回転  Q:キャンセル`);
}

export function cancelPlacementMode() {
  if (!placementMode) return;
  placementMode = false;
  if (ghostGroup) { _scene.remove(ghostGroup); ghostGroup = null; }
  placementItemId = null;
  placementRotationOffset = 0;
}

export function isInPlacementMode() { return placementMode; }

// ─── update (毎フレーム) ───────────────────────────
// placementRay: { origin: THREE.Vector3, direction: THREE.Vector3 } | null
// terrainCollider: BVH メッシュ | null
export function update(delta, playerPos, playerFacing, attackPressed, cancelPressed, rotateStep, placementRay, terrainCollider) {
  interactHint = '';
  Storage.tick(); // 開いているボックスUIの進行状況を更新

  // ゴーストの位置更新（スナップシステム）
  if (placementMode && ghostGroup) {
    if (rotateStep) {
      placementRotationOffset = snapRot(placementRotationOffset + rotateStep * SNAP_ANGLE);
    }
    const snappedRot = snapRot(playerFacing + placementRotationOffset);
    const rotDeg = ((Math.round(THREE.MathUtils.radToDeg(snappedRot)) % 360) + 360) % 360;
    interactHint = `[F] 設置  [Z/X] 回転 ${rotDeg}°  [Q] キャンセル`;

    // ── ① 視線レイでヒット位置を計算 ──────────────
    let rawX, rawZ, rawHitY;
    if (placementRay && terrainCollider) {
      _placementRaycaster.set(placementRay.origin, placementRay.direction);
      _placementRaycaster.firstHitOnly = true;
      _placementRaycaster.far = FP_RAY_MAX;
      const hits = _placementRaycaster.intersectObject(terrainCollider, false);
      if (hits.length > 0) {
        rawX = hits[0].point.x;
        rawZ = hits[0].point.z;
        rawHitY = hits[0].point.y;
      }
    }
    // レイが地形に当たらない場合は前方固定距離にフォールバック
    if (rawX === undefined) {
      const fx = Math.sin(playerFacing);
      const fz = Math.cos(playerFacing);
      rawX = playerPos.x + fx * PLACE_DIST;
      rawZ = playerPos.z + fz * PLACE_DIST;
      rawHitY = undefined;
    }

    // ── ② 視線レイが当たっている設置物を特定（接続優先のため） ──
    let rayhitObj = null;
    if (placementRay) {
      const _pr = new THREE.Ray(placementRay.origin, placementRay.direction);
      const _bt = new THREE.Vector3();
      const _tb = new THREE.Box3();
      let closestRayDist = FP_RAY_MAX;
      for (const obj of placed) {
        if (!obj.alive) continue;
        const s = getSize(obj.itemId);
        const p = obj.position;
        _tb.min.set(p.x - s.w / 2 - 0.06, p.y - 0.02, p.z - s.d / 2 - 0.06);
        _tb.max.set(p.x + s.w / 2 + 0.06, p.y + s.h + 0.02, p.z + s.d / 2 + 0.06);
        if (_pr.intersectBox(_tb, _bt)) {
          const d = placementRay.origin.distanceTo(_bt);
          if (d < closestRayDist) { closestRayDist = d; rayhitObj = obj; }
        }
      }
    }

    // ── ③ 既存設置物からスナップ候補を探す ─────────
    const isGrounded  = GROUNDED_IDS.has(placementItemId);
    const isFloorOnly = FLOOR_OR_GROUND_ONLY.has(placementItemId);
    const allowedSrc  = SNAP_ALLOWED_SOURCES[placementItemId];
    let bestCand = null, bestDist = SNAP_TOLERANCE, bestSnapSrc = null;
    for (const obj of placed) {
      if (!obj.alive) continue;
      if (allowedSrc && !allowedSrc.has(obj.itemId)) continue; // 接続元制限
      const isRayhit = obj === rayhitObj;
      // 視線ヒットした同種スタック可能アイテム → 上スナップのみ候補にする
      const topOnly = isRayhit && placementItemId === obj.itemId && !!DEFS[placementItemId]?.stackable;
      for (const c of getSnapCandidates(obj, placementItemId)) {
        if (topOnly && c.type !== 'top') continue;
        if (isGrounded && c.type === 'side') continue; // 浮き防止
        if (isFloorOnly && (c.type !== 'top' || !FLOOR_BASE_IDS.has(obj.itemId))) continue; // 床のみ
        // 視線ヒット物体: その中心を基準に距離を測り、SNAP_TOLERANCEを2倍引いて常に優先
        const refX = isRayhit ? obj.position.x : rawX;
        const refZ = isRayhit ? obj.position.z : rawZ;
        const d = Math.hypot(c.x - refX, c.z - refZ);
        const priority = isRayhit ? d - SNAP_TOLERANCE * 2 : d;
        if (priority < bestDist) { bestDist = priority; bestCand = c; bestSnapSrc = obj; }
      }
    }

    let finalX = rawX, finalZ = rawZ, finalY;
    if (bestCand) {
      if (bestCand.type === 'overlay') {
        // ── 同位置オーバーレイ（ドア→ドア枠付き壁） ──
        finalX = bestCand.x;
        finalZ = bestCand.z;
        finalY = bestCand.y;
      } else if (bestCand.type === 'side' && bestCand.cx !== undefined) {
        // ── 接続点ピボット回転 ──────────────────────────
        const ns2 = getSize(placementItemId);
        const nw2 = ns2.w / 2, nd2 = ns2.d / 2;
        const θ = snappedRot;
        if (bestCand.pivotAxis === 'X') {
          finalX = bestCand.cx + bestCand.pivotSign * nw2 * Math.cos(θ);
          finalZ = bestCand.cz - bestCand.pivotSign * nw2 * Math.sin(θ);
        } else {
          finalX = bestCand.cx + bestCand.pivotSign * nd2 * Math.sin(θ);
          finalZ = bestCand.cz + bestCand.pivotSign * nd2 * Math.cos(θ);
        }
        finalY = Math.max(bestCand.y, getTerrainHeight(finalX, finalZ));
      } else {
        finalX = bestCand.x;
        finalZ = bestCand.z;
        const tY = getTerrainHeight(finalX, finalZ);
        finalY = bestCand.type === 'top' ? Math.max(bestCand.y, tY) : bestCand.y;
      }
      ghostValid   = true;
      ghostSnapped = true;
    } else {
      finalY = rawHitY !== undefined ? rawHitY : getTerrainHeight(finalX, finalZ);
      ghostValid   = finalY >= WATER_LEVEL;
      ghostSnapped = false;
    }

    // スナップ必須アイテムは自由設置不可
    if (!bestCand && SNAP_REQUIRED_IDS.has(placementItemId)) {
      ghostValid = false;
    }

    // 交差チェック: 既存設置物と重なっていれば無効（スナップ元は除外）
    if (ghostValid && overlapsAny(finalX, finalZ, finalY, snappedRot, placementItemId, bestSnapSrc)) {
      ghostValid = false;
    }

    ghostGroup.position.set(finalX, finalY, finalZ);
    ghostGroup.rotation.y = snappedRot;

    if (ghostSnapped) {
      ghostMat.color.set(0x44ff88); // スナップ: 緑
      ghostMat.opacity = 0.55 + Math.sin(Date.now() * 0.005) * 0.1;
    } else if (ghostValid) {
      ghostMat.color.set(0x88ddff); // 設置可能: 青
      ghostMat.opacity = 0.45 + Math.sin(Date.now() * 0.004) * 0.1;
    } else {
      ghostMat.color.set(0xff4444); // 無効: 赤
      ghostMat.opacity = 0.4;
    }

    if (cancelPressed) { cancelPlacementMode(); return; }

    if (attackPressed) {
      if (ghostValid) {
        const gp = ghostGroup.position;
        confirmPlacement(gp.x, gp.z, ghostGroup.rotation.y, gp.y);
      } else {
        toast('土台が必要です！（地面か設置物の上に置いてください）');
      }
      return;
    }
  }

  // 焚き火アニメ + 近接ヒント
  let closestDist = INTERACT_DIST;
  let closestObj  = null;

  for (const obj of placed) {
    if (!obj.alive) continue;

    // ── 焚き火の燃焼・調理（薪→木炭、肉/魚→焼き上がり） ──
    if (obj.state === 'burning' && obj.itemId === 'wood') {
      obj.box = obj.box || {};
      obj.fuelLevel = Math.min(5, Math.max(1, boxCount(obj, 'wood')));
      obj.burnTimer = (obj.burnTimer || 0) + delta;
      if (obj.burnTimer >= WOOD_BURN_TIME) {
        obj.burnTimer = 0;
        if (boxTake(obj, 'wood', 1)) boxAdd(obj, 'charcoal', 1);
        Storage.notifyChanged(obj);
        if (boxCount(obj, 'wood') <= 0) {
          extinguish(obj, '🔥 薪が燃え尽きた…（木炭はボックスの中）');
          continue;
        }
      }
      if (boxCount(obj, 'meat') > 0 || boxCount(obj, 'raw_fish') > 0) {
        obj.cookTimer = (obj.cookTimer || 0) + delta;
        if (obj.cookTimer >= COOK_TIME) {
          obj.cookTimer = 0;
          if (boxTake(obj, 'meat', 1)) boxAdd(obj, 'cooked_meat', 1);
          else if (boxTake(obj, 'raw_fish', 1)) boxAdd(obj, 'cooked_fish', 1);
          Storage.notifyChanged(obj);
        }
      } else {
        obj.cookTimer = 0;
      }
    }

    // ── 簡易炉の自動精錬（燃料+鉱石がボックスにあれば進行） ──
    if (obj.itemId === 'furnace') {
      const fuel = boxCount(obj, 'coal') + boxCount(obj, 'charcoal');
      const ore  = boxCount(obj, 'iron_ore') + boxCount(obj, 'copper_ore');
      if (fuel > 0 && ore > 0) {
        obj.smeltTimer = (obj.smeltTimer || 0) + delta;
        if (obj.smeltTimer >= SMELT_TIME) {
          obj.smeltTimer = 0;
          if (!boxTake(obj, 'charcoal', 1)) boxTake(obj, 'coal', 1); // 木炭を優先して消費
          if (boxTake(obj, 'iron_ore', 1)) boxAdd(obj, 'iron_ingot', 1); // 鉄を優先して精錬
          else if (boxTake(obj, 'copper_ore', 1)) boxAdd(obj, 'copper_ingot', 1);
          Storage.notifyChanged(obj);
        }
      } else {
        obj.smeltTimer = 0;
      }
    }

    // 焚き火の炎を揺らす（fuelLevel で大きさが変わる）
    if (obj.state === 'burning' && obj.group.userData.flame) {
      const t = Date.now() * 0.003;
      const fuel = obj.fuelLevel || 1;
      const baseScale = 0.7 + fuel * 0.28;
      obj.group.userData.flame.scale.y = baseScale * (0.85 + Math.sin(t) * 0.2);
      obj.group.userData.flame.scale.x = baseScale * (0.9 + Math.cos(t * 1.3) * 0.12);
      obj.group.userData.flame.scale.z = obj.group.userData.flame.scale.x;
      if (obj.light) {
        const baseIntensity = 1.8 + fuel * 0.6;
        const baseRange     = 10  + fuel * 2.5;
        obj.light.intensity = baseIntensity + Math.sin(t * 2.2) * 0.4;
        obj.light.distance  = baseRange;
      }

      // ── 雨による消火チェック ──────────────────────
      if (isRaining()) {
        const sheltered = placed.some(r =>
          r.alive && r.itemId === 'roof_panel' &&
          r.position.y > obj.position.y &&
          Math.hypot(r.position.x - obj.position.x, r.position.z - obj.position.z) < ROOF_COVER_RADIUS
        );
        if (!sheltered) {
          obj.rainTimer = (obj.rainTimer || 0) + delta;
          if (obj.rainTimer >= RAIN_EXTINGUISH) {
            extinguishByRain(obj);
            continue;
          }
        } else {
          obj.rainTimer = 0;
        }
      } else {
        obj.rainTimer = 0;
      }
    }

    const dx = obj.position.x - playerPos.x;
    const dz = obj.position.z - playerPos.z;
    // ドアはドア枠と同座標に重なるため、わずかに優先して開閉操作を可能にする
    const dist = Math.hypot(dx, dz) - (obj.itemId === 'door' ? 0.01 : 0);
    if (dist < closestDist) {
      closestDist = dist;
      closestObj  = obj;
    }
  }

  // 延焼: 燃えているオブジェクトの近くの可燃物に着火
  for (const obj of placed) {
    if (!obj.alive || obj.state === 'burning') continue;
    if (!DEFS[obj.itemId]?.canBurn) continue;
    // 焚き火（木材スタック）は薪が入っていないと延焼でも火がつかない
    if (obj.itemId === 'wood' && boxCount(obj, 'wood') <= 0) { obj.heatTimer = 0; continue; }
    let nearFire = false;
    for (const fire of placed) {
      if (!fire.alive || fire.state !== 'burning') continue;
      if (obj.position.distanceTo(fire.position) < FIRE_SPREAD_DIST) { nearFire = true; break; }
    }
    if (nearFire) {
      obj.heatTimer = (obj.heatTimer || 0) + delta;
      if (obj.heatTimer >= FIRE_IGNITE_TIME) ignite(obj);
    } else {
      obj.heatTimer = 0;
    }
  }

  // ベッド近接: パッシブ体力回復（INTERACT_DIST以内）
  for (const obj of placed) {
    if (!obj.alive || obj.itemId !== 'bed') continue;
    if (Math.hypot(obj.position.x - playerPos.x, obj.position.z - playerPos.z) < INTERACT_DIST) {
      _onBedNearby?.(delta);
      break;
    }
  }

  if (closestObj) {
    if (closestObj.state === 'burning' && closestObj.itemId === 'wood') {
      interactHint = `🔥 焚き火（薪:${boxCount(closestObj, 'wood')}）  [F] 📦 ボックスを開く`;
    } else if (closestObj.state === 'burning') {
      interactHint = '🔥 燃えている！（消えるまで待とう）';
    } else if (Storage.CONTAINERS[closestObj.itemId]) {
      const cfg = Storage.CONTAINERS[closestObj.itemId];
      interactHint = `[F] 📦 ${cfg.label} ボックスを開く  [E] 拾う`;
    } else if (closestObj.itemId === 'bed') {
      const otherBeds = placed.filter(o => o.alive && o.itemId === 'bed' && o !== closestObj);
      const parts = ['😴 休憩中（体力回復）'];
      if (otherBeds.length > 0) parts.push('[F] ✨ ワープ');
      parts.push('[E] 拾う');
      interactHint = parts.join('  ');
    } else {
      const actions = getActionsFor(closestObj);
      interactHint = actions.length > 0
        ? `[F] ${actions[0].label}  [E] 拾う`
        : '[E] 拾う';
    }
  }
}

function confirmPlacement(x, z, facing, preY) {
  if (!Inventory.remove(placementItemId, 1)) { cancelPlacementMode(); return; }

  const def = DEFS[placementItemId];
  const mesh = def.build(posSeed(x, z));
  const gy = preY !== undefined ? preY : getTerrainHeight(x, z);
  mesh.position.set(x, gy, z);
  mesh.rotation.y = facing;
  mesh.castShadow = true;
  _scene.add(mesh);

  const obj = {
    id:       nextId++,
    itemId:   placementItemId,
    position: new THREE.Vector3(x, gy, z),
    rotation: facing,
    group:    mesh,
    state:    'normal',
    light:    null,
    alive:    true,
  };
  if (Storage.CONTAINERS[obj.itemId]) obj.box = {};

  if (def.onPlace) def.onPlace(obj, _scene);
  placed.push(obj);
  _invalidatePlacedBoxes();

  // 在庫が残っていれば設置モードを継続、なくなれば終了
  if (Inventory.has(placementItemId)) {
    const remaining = Inventory.count(placementItemId);
    toast(`✅ ${def.name} を設置した（残り ${remaining}）`);
  } else {
    toast(`✅ ${def.name} を設置した（在庫なし）`);
    cancelPlacementMode();
  }
}

// ─── インタラクト ──────────────────────────────────
function getActionsFor(obj) {
  const def = DEFS[obj.itemId];
  return def?.interactions || [];
}

// 攻撃キーで設置物に作用: true を返したら gather の空振りを消費しない
export function tryInteract(attackPressed, interactPressed, playerPos, playerFacing, equipped) {
  if (placementMode) return false;

  let closestDist = INTERACT_DIST;
  let closestObj  = null;

  for (const obj of placed) {
    if (!obj.alive) continue;
    const dx = obj.position.x - playerPos.x;
    const dz = obj.position.z - playerPos.z;
    // ドアはドア枠と同座標に重なるため、わずかに優先する
    const dist = Math.hypot(dx, dz) - (obj.itemId === 'door' ? 0.01 : 0);
    if (dist < closestDist) { closestDist = dist; closestObj = obj; }
  }

  if (!closestObj) return false;

  // E キー: 拾う
  if (interactPressed) {
    pickUp(closestObj);
    return true;
  }

  // F キー: 設置物に対するアクション
  if (attackPressed) {
    // 燃えている設置物: 焚き火はボックスを開ける（薪の補充・焼き上がりの回収）
    if (closestObj.state === 'burning') {
      if (Storage.CONTAINERS[closestObj.itemId]) {
        openStorage(closestObj);
        return true;
      }
      toast('🔥 燃えている！（消えるまで待とう）');
      return true;
    }

    const actions = getActionsFor(closestObj);
    for (const action of actions) {
      if (action.id === 'box_open') {
        openStorage(closestObj);
        return true;
      }
      if (action.id === 'ignite') {
        if (equipped === 'fire_starter' || Inventory.has('fire_starter')) {
          ignite(closestObj);
          return true;
        } else {
          toast('🔥 fire_starter が必要です！');
          return true;
        }
      }
      if (action.id === 'door_toggle') {
        toggleDoor(closestObj);
        return true;
      }
      if (action.id === 'bed_rest') {
        // パッシブ回復があるのでFキーでも追加回復
        _onBedNearby?.(1.0);
        toast('😴 休憩した！');
        return true;
      }
      if (action.id === 'bed_warp') {
        const otherBeds = placed.filter(o => o.alive && o.itemId === 'bed' && o !== closestObj);
        if (otherBeds.length === 0) {
          toast('✨ ワープ先のベッドがない！先に別のベッドを設置してください');
          return true;
        }
        // ラウンドロビンで次のベッドへ
        closestObj._warpIdx = ((closestObj._warpIdx ?? -1) + 1) % otherBeds.length;
        const target = otherBeds[closestObj._warpIdx];
        _onBedWarp?.(target.position);
        toast('✨ ベッドへワープした！');
        return true;
      }
    }
  }

  return false;
}

export function getInteractHint() { return interactHint; }

// 設置状態（クロスヘア色変更用）
export function getPlacementState() {
  return { active: placementMode, snapped: ghostSnapped, valid: ghostValid };
}

export function getBurningFirePositions() {
  return placed.filter(o => o.alive && o.state === 'burning').map(o => o.position);
}

// ── セーブ/ロード ──────────────────────────────────
export function serialize() {
  return placed
    .filter(o => o.alive)
    .map(o => ({
      itemId:   o.itemId,
      x: o.position.x, y: o.position.y, z: o.position.z,
      rotation: o.rotation || 0,
      open:     o.doorOpen || undefined,
      box:      (o.box && Object.keys(o.box).length > 0) ? o.box : undefined,
    }));
}

export function deserialize(list = []) {
  if (!_scene) return;
  for (const s of list) {
    const def = DEFS[s.itemId];
    if (!def) continue;
    const mesh = def.build(posSeed(s.x, s.z));
    mesh.position.set(s.x, s.y, s.z);
    mesh.rotation.y = s.rotation || 0;
    mesh.castShadow = true;
    _scene.add(mesh);

    const obj = {
      id:       nextId++,
      itemId:   s.itemId,
      position: new THREE.Vector3(s.x, s.y, s.z),
      rotation: s.rotation || 0,
      group:    mesh,
      state:    'normal',
      light:    null,
      alive:    true,
    };
    if (Storage.CONTAINERS[s.itemId]) obj.box = s.box ? { ...s.box } : {};
    // ドアの開閉状態を復元
    if (s.itemId === 'door' && s.open) {
      obj.doorOpen = true;
      const leaf = mesh.userData.leaf;
      if (leaf) leaf.rotation.y = -1.9;
    }
    if (def.onPlace) def.onPlace(obj, _scene);
    placed.push(obj);
  }
  _invalidatePlacedBoxes();
}

// ─── スタート地点のデフォルトハウス ─────────────────
// 初回起動時（セーブなし）に、スポーン前方に家（寄棟屋根・窓・ドア・家具付き）と
// 柵で囲った庭を生成する。すべて通常の設置物なので拾って再利用できる。
export function buildStarterHouse() {
  const g = getTerrainHeight(0, -11); // スポーン台地は平坦（家の敷地の基準高さ）
  const R = Math.PI / 2;
  const list = [];
  const add = (itemId, x, z, rotation = 0, y = g) => list.push({ itemId, x, y, z, rotation });

  // ── 床（5×4） ──
  for (let ix = -2; ix <= 2; ix++) {
    for (const z of [-12.5, -11.5, -10.5, -9.5]) add('floor_board', ix, z);
  }

  // ── 前壁（南 z=-9）: 中央にドア、2段目に窓 ──
  for (const x of [-2, -1, 1, 2]) add('wall_panel', x, -9);
  add('door_frame_wall', 0, -9);
  add('door', 0, -9);
  for (const x of [-2, 2]) add('wall_panel', x, -9, 0, g + 1.2);
  for (const x of [-1, 1]) add('window_wall', x, -9, 0, g + 1.2);
  // ドア上は開口のまま（ドアが2.1mで2段目まで届く）

  // ── 後壁（北 z=-13） ──
  for (const x of [-2, -1, 0, 1, 2]) add('wall_panel', x, -13);
  for (const x of [-2, -1, 1, 2]) add('wall_panel', x, -13, 0, g + 1.2);
  add('window_wall', 0, -13, 0, g + 1.2);

  // ── 側壁（東西 x=±2.5）: 2段目中央に窓 ──
  for (const sx of [-2.5, 2.5]) {
    for (const z of [-12.5, -11.5, -10.5, -9.5]) add('wall_panel', sx, z, R);
    for (const z of [-12.5, -9.5]) add('wall_panel', sx, z, R, g + 1.2);
    for (const z of [-11.5, -10.5]) add('window_wall', sx, z, R, g + 1.2);
  }

  // ── 屋根（寄棟: 南北2段 + 東西の妻側スロープ + 棟カバー） ──
  for (let x = -3; x <= 3; x++) {
    add('roof_panel', x, -9.3,  0,       g + 2.4); // 南1段目（軒の張り出し付き）
    add('roof_panel', x, -12.7, Math.PI, g + 2.4); // 北1段目
  }
  for (let x = -2; x <= 2; x++) {
    add('roof_panel', x, -10.16, 0,       g + 2.9); // 南2段目
    add('roof_panel', x, -11.84, Math.PI, g + 2.9); // 北2段目
    add('floor_board', x, -11, 0, g + 3.4);          // 棟カバー
  }
  for (const z of [-12.5, -11.5, -10.5, -9.5]) {
    add('roof_panel',  2.3, z,  R, g + 2.4); // 東の妻側1段目
    add('roof_panel', -2.3, z, -R, g + 2.4); // 西の妻側1段目
  }
  for (const z of [-11.5, -10.5]) {
    add('roof_panel',  1.44, z,  R, g + 2.9); // 東の妻側2段目
    add('roof_panel', -1.44, z, -R, g + 2.9); // 西の妻側2段目
  }

  // ── 家具・設備（床板の上 +0.06 に載せる） ──
  add('bed', 1.5, -12, 0, g + 0.06);           // 奥右にベッド（枕は北壁側）
  add('workbench', -1.7, -12.4, 0, g + 0.06);  // 奥左に作業台
  add('torch', -2.2, -9.6, 0, g + 0.06);       // 室内の明かり
  add('furnace', 3.6, -9.5);      // 家の東外に簡易炉
  add('torch',  1.0, -8.5);       // 玄関両脇の明かり
  add('torch', -1.0, -8.5);

  // ── 柵（庭を囲む 12×14、正面中央はゲート開口） ──
  for (let i = 0; i < 11; i++) {
    const x = -5.5 + i * 1.1;
    if (Math.abs(x) > 0.6) add('wooden_fence', x, -4); // 南（中央を開ける）
    add('wooden_fence', x, -18);                        // 北
  }
  for (let i = 0; i < 13; i++) {
    const z = -4.55 - i * 1.1;
    add('wooden_fence',  6, z, R); // 東
    add('wooden_fence', -6, z, R); // 西
  }

  deserialize(list);
}

// 敵の衝突判定用：生きている設置物の位置と半径を返す
export function getObstacles() {
  const out = [];
  for (const o of placed) {
    if (!o.alive) continue;
    if (o.itemId === 'door' && o.doorOpen) continue; // 開いたドアは通れる
    const r = COLLIDE_RADIUS[o.itemId] ?? 0.44;
    if (r <= 0) continue;
    out.push({ x: o.position.x, z: o.position.z, r });
  }
  return out;
}

// ─── アクション実装 ───────────────────────────────
function ignite(obj) {
  if (obj.state === 'burning') return;
  // 焚き火（木材スタック）はボックスに薪が入っていないと着火できない
  if (obj.itemId === 'wood' && boxCount(obj, 'wood') < 1) {
    toast('🔥 薪（木材）をボックスに入れてから火をつけよう');
    return;
  }
  obj.state = 'burning';
  obj.fuelLevel = 1;
  obj.burnTimer = 0;
  obj.cookTimer = 0;
  _scene.remove(obj.group);

  const fire = buildCampfire();
  fire.position.copy(obj.position);
  fire.rotation.y = obj.group.rotation.y;
  _scene.add(fire);
  obj.group = fire;

  const light = new THREE.PointLight(0xff8833, 2.2, 12.5);
  light.position.copy(obj.position).add(new THREE.Vector3(0, 0.7, 0));
  _scene.add(light);
  obj.light = light;

  toast('🔥 焚き火をおこした！');
}

// ドアの開閉
function toggleDoor(obj) {
  obj.doorOpen = !obj.doorOpen;
  const leaf = obj.group.userData.leaf;
  if (leaf) leaf.rotation.y = obj.doorOpen ? -1.9 : 0;
  _invalidatePlacedBoxes();
  toast(obj.doorOpen ? '🚪 ドアを開けた' : '🚪 ドアを閉めた');
}

// 火を消して元のアイテムの見た目に戻す（ボックスの中身はそのまま残る）
function extinguish(obj, msg) {
  if (obj.light) { _scene.remove(obj.light); obj.light = null; }
  _scene.remove(obj.group);
  const def = DEFS[obj.itemId];
  const mesh = def.build(posSeed(obj.position.x, obj.position.z));
  mesh.position.copy(obj.position);
  mesh.rotation.y = obj.rotation ?? 0;
  mesh.castShadow = true;
  _scene.add(mesh);
  obj.group     = mesh;
  obj.state     = 'normal';
  obj.fuelLevel = 0;
  obj.rainTimer = 0;
  obj.burnTimer = 0;
  obj.cookTimer = 0;
  toast(msg);
  Storage.notifyChanged(obj);
}

function extinguishByRain(obj) {
  extinguish(obj, '🌧️ 雨で火が消えた…（ボックスの中身はそのまま）');
}

function pickUp(obj) {
  if (!obj.alive) return;
  const def = DEFS[obj.itemId];
  def?.onRemove?.(obj, _scene);
  if (obj.light) { _scene.remove(obj.light); obj.light = null; }
  _scene.remove(obj.group);
  obj.alive = false;

  if (obj.state !== 'burning') {
    if (Storage.getOpenObj() === obj) Storage.close();
    Inventory.add(obj.itemId, 1);
    // ボックスの中身も手持ちに回収する
    let recovered = 0;
    if (obj.box) {
      for (const [id, n] of Object.entries(obj.box)) {
        if (n > 0) { Inventory.add(id, n); recovered += n; }
      }
      obj.box = {};
    }
    _invalidatePlacedBoxes();
    toast(`📦 ${def?.name || obj.itemId} を拾った${recovered > 0 ? `（中身 ${recovered} 個も回収）` : ''}`);
  } else {
    toast('焚き火は拾えない（消えるまで待とう）');
    obj.alive = true; // 燃えてる間は拾えない
  }
}
