import * as THREE from 'three';
import { getTerrainHeight } from './scene.js';
import * as Inventory from './inventory.js';
import { isRaining } from './weather.js';

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

// 空中に浮かせてはいけないアイテム（side スナップ禁止、topか地面のみ）
const GROUNDED_IDS = new Set(['wood', 'straw', 'stone', 'coal', 'floor_board', 'bed']);

// 設置モード用 Raycaster（地形との交差判定）
const _placementRaycaster = new THREE.Raycaster();

// 設置物の衝突半径（敵の押し出しに使用。0 = 衝突なし）
const COLLIDE_RADIUS = {
  wood: 0.42, straw: 0.35, stone: 0.40, torch: 0.08, coal: 0.20,
  wooden_fence: 0.55, stone_block: 0.44, pillar: 0.18,
  floor_board: 0.0, wall_panel: 0.52, roof_panel: 0.0, door: 0.55,
  door_frame_wall: 0.52, workbench: 0.50, bed: 0.0,
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
  pillar:       { w: 0.26, d: 0.26, h: 1.20 },
  floor_board:  { w: 1.00, d: 1.00, h: 0.06 },
  wall_panel:   { w: 1.00, d: 0.08, h: 1.20 },
  roof_panel:      { w: 1.00, d: 1.00, h: 0.50 },
  door:            { w: 1.00, d: 0.12, h: 2.10 },
  door_frame_wall: { w: 1.00, d: 0.08, h: 1.20 },
  workbench:       { w: 1.00, d: 0.60, h: 0.90 },
  bed:             { w: 0.90, d: 2.00, h: 0.60 },
};
function getSize(id) { return SIZES[id] ?? { w: 1.0, d: 1.0, h: 0.5 }; }

// ─── スナップ制約 ─────────────────────────────────────
// どのオブジェクトにスナップできるか（undefined = 制約なし）
const SNAP_ALLOWED_SOURCES = {
  roof_panel: new Set(['wall_panel', 'door_frame_wall', 'floor_board', 'pillar']),
  door:       new Set(['door_frame_wall']),
};
// スナップ必須アイテム（自由設置不可）
const SNAP_REQUIRED_IDS = new Set(['door']);
// 地面か床材の上にしか置けないアイテム
const FLOOR_OR_GROUND_ONLY = new Set(['wood', 'bed']);

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
  if (newId === 'roof_panel' && (obj.itemId === 'wall_panel' || obj.itemId === 'door_frame_wall')) {
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
    interactions: [{ id: 'ignite', label: '🔥 火をつける', requiresTool: 'fire_starter' }],
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
    build() {
      const g = new THREE.Group();
      const postMat = new THREE.MeshLambertMaterial({ color: 0x7a5520 });
      const railMat = new THREE.MeshLambertMaterial({ color: 0x9a7030 });
      const postGeo = new THREE.CylinderGeometry(0.038, 0.044, 1.05, 6);
      for (const px of [-0.55, 0, 0.55]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, 0.525, 0);
        post.castShadow = true;
        g.add(post);
      }
      const railGeo = new THREE.CylinderGeometry(0.025, 0.028, 1.20, 6);
      for (const ry of [0.28, 0.70]) {
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(0, ry, 0);
        rail.rotation.z = Math.PI / 2;
        rail.castShadow = true;
        g.add(rail);
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
      // ドアパネル
      const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.80, 0.06), panelMat);
      doorPanel.position.set(0, 0.93, 0);
      doorPanel.castShadow = true;
      g.add(doorPanel);
      // 横桟
      for (const py of [0.42, 1.0, 1.58]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.06, 0.065), frameMat);
        bar.position.set(0, py, 0);
        g.add(bar);
      }
      // ノブ
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), knobMat);
      knob.position.set(0.32, 0.92, 0.06);
      g.add(knob);
      return g;
    },
    interactions: [],
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
    interactions: [{ id: 'craft', label: '🔨 クラフトする' }],
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
}

function toast(msg) { _toastFn?.(msg); }

// ─── 設置モード ────────────────────────────────────
export function enterPlacementMode(itemId) {
  if (!DEFS[itemId] || !Inventory.has(itemId)) {
    toast('設置できるアイテムがない！');
    return;
  }
  cancelPlacementMode();
  placementMode = true;
  placementItemId = itemId;

  // ゴースト（半透明プレビュー）
  ghostGroup = DEFS[itemId].build();
  ghostMat = new THREE.MeshLambertMaterial({ color: 0x88ddff, transparent: true, opacity: 0.45 });
  ghostGroup.traverse((c) => {
    if (c.isMesh) c.material = ghostMat;
  });
  _scene.add(ghostGroup);
  toast(`📦 ${DEFS[itemId].name} を設置中... F:確定  Q:キャンセル`);
}

export function cancelPlacementMode() {
  if (!placementMode) return;
  placementMode = false;
  if (ghostGroup) { _scene.remove(ghostGroup); ghostGroup = null; }
  placementItemId = null;
}

export function isInPlacementMode() { return placementMode; }

// ─── update (毎フレーム) ───────────────────────────
// placementRay: { origin: THREE.Vector3, direction: THREE.Vector3 } | null
// terrainCollider: BVH メッシュ | null
export function update(delta, playerPos, playerFacing, attackPressed, cancelPressed, placementRay, terrainCollider) {
  interactHint = '';

  // ゴーストの位置更新（スナップシステム）
  if (placementMode && ghostGroup) {
    const snappedRot = snapRot(playerFacing);

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
        if (isFloorOnly && (c.type !== 'top' || obj.itemId !== 'floor_board')) continue; // 床のみ
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
    const dist = Math.hypot(dx, dz);
    if (dist < closestDist) {
      closestDist = dist;
      closestObj  = obj;
    }
  }

  // 延焼: 燃えているオブジェクトの近くの可燃物に着火
  for (const obj of placed) {
    if (!obj.alive || obj.state === 'burning') continue;
    if (!DEFS[obj.itemId]?.canBurn) continue;
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
    if (closestObj.state === 'burning') {
      const canCook = Inventory.has('meat') || Inventory.has('raw_fish');
      const hasWood = Inventory.has('wood');
      const fuel    = closestObj.fuelLevel || 1;
      const hints   = [];
      if (canCook) hints.push('[F] 🍳 料理する');
      if (hasWood && fuel < 5) hints.push('[F] 🪵 薪を投げ込む');
      interactHint = hints.length > 0
        ? hints.join('  /  ')
        : `🔥 焚き火（薪:${fuel}/5）`;
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
  const mesh = def.build();
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
  if (obj.state === 'burning') {
    return [{ id: 'cook', label: '🍖 肉を焼く' }];
  }
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
    const dist = Math.hypot(dx, dz);
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
    // 燃えている焚き火への薪投げ込み（料理より優先度低め、木材があれば）
    if (closestObj.state === 'burning') {
      const fuel = closestObj.fuelLevel || 1;
      if (Inventory.has('meat') || Inventory.has('raw_fish')) {
        cook(closestObj);
        return true;
      }
      if (Inventory.has('wood') && fuel < 5) {
        feedWood(closestObj);
        return true;
      }
      if (fuel >= 5) {
        toast('🔥 薪は満タンです！');
        return true;
      }
      toast('🔥 焚き火（肉・魚か木材を持てば操作できる）');
      return true;
    }

    const actions = getActionsFor(closestObj);
    for (const action of actions) {
      if (action.id === 'ignite') {
        if (equipped === 'fire_starter' || Inventory.has('fire_starter')) {
          ignite(closestObj);
          return true;
        } else {
          toast('🔥 fire_starter が必要です！');
          return true;
        }
      }
      if (action.id === 'craft') {
        _onWorkbenchCraft?.();
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

// 敵の衝突判定用：生きている設置物の位置と半径を返す
export function getObstacles() {
  const out = [];
  for (const o of placed) {
    if (!o.alive) continue;
    const r = COLLIDE_RADIUS[o.itemId] ?? 0.44;
    if (r <= 0) continue;
    out.push({ x: o.position.x, z: o.position.z, r });
  }
  return out;
}

// ─── アクション実装 ───────────────────────────────
function ignite(obj) {
  if (obj.state === 'burning') return;
  obj.state = 'burning';
  obj.fuelLevel = 1;
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

function feedWood(obj) {
  if (!Inventory.remove('wood', 1)) return;
  obj.fuelLevel = Math.min(5, (obj.fuelLevel || 1) + 1);
  toast(`🪵 薪を投げ込んだ！炎レベル ${obj.fuelLevel}/5`);
}

function extinguishByRain(obj) {
  if (obj.light) { _scene.remove(obj.light); obj.light = null; }
  _scene.remove(obj.group);
  // 火だけ消して元のアイテムを復元（アイテム自体は残る）
  const def = DEFS[obj.itemId];
  const mesh = def.build();
  mesh.position.copy(obj.position);
  mesh.rotation.y = obj.rotation ?? 0;
  mesh.castShadow = true;
  _scene.add(mesh);
  obj.group     = mesh;
  obj.state     = 'normal';
  obj.fuelLevel = 0;
  obj.rainTimer = 0;
  toast('🌧️ 雨で火が消えた…（薪はそのまま残った）');
}

function cook(_obj) {
  if (Inventory.has('meat')) {
    Inventory.remove('meat', 1);
    Inventory.add('cooked_meat', 1);
    toast('🍗 肉を焼いた！');
    return;
  }
  if (Inventory.has('raw_fish')) {
    Inventory.remove('raw_fish', 1);
    Inventory.add('cooked_fish', 1);
    toast('🍣 魚を焼いた！');
    return;
  }
  toast('料理できるものがない（肉か魚が必要）');
}

function pickUp(obj) {
  if (!obj.alive) return;
  const def = DEFS[obj.itemId];
  def?.onRemove?.(obj, _scene);
  if (obj.light) { _scene.remove(obj.light); obj.light = null; }
  _scene.remove(obj.group);
  obj.alive = false;

  if (obj.state !== 'burning') {
    Inventory.add(obj.itemId, 1);
    _invalidatePlacedBoxes();
    toast(`📦 ${def?.name || obj.itemId} を拾った`);
  } else {
    toast('焚き火は拾えない（消えるまで待とう）');
    obj.alive = true; // 燃えてる間は拾えない
  }
}
