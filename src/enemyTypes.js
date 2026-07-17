import * as THREE from 'three';
import { getPlainsFactor } from './scene.js';

// ─── レベル閾値テーブル ────────────────────────────
// 各レベルは独立した閾値（連続スケールではなく段階）
export const LEVEL_TIERS = [
  { level: 1, label: 'Lv.1', sizeScale: 1.00, hpMult: 1.0, dmgMult: 1.0,  speedMult: 1.00, xpMult:  1.0 },
  { level: 2, label: 'Lv.2', sizeScale: 1.25, hpMult: 2.0, dmgMult: 1.5,  speedMult: 1.10, xpMult:  2.5 },
  { level: 3, label: 'Lv.3', sizeScale: 1.55, hpMult: 3.8, dmgMult: 2.2,  speedMult: 1.22, xpMult:  5.5 },
  { level: 4, label: 'Lv.4', sizeScale: 1.90, hpMult: 6.5, dmgMult: 3.2,  speedMult: 1.38, xpMult: 12.0 },
  { level: 5, label: 'Lv.5', sizeScale: 2.40, hpMult: 11., dmgMult: 4.8,  speedMult: 1.58, xpMult: 25.0 },
];

// 出現重み（低レベルほど頻繁）
// Lv1=70% / Lv2=18% / Lv3=8% / Lv4=3% / Lv5=1%
const LEVEL_WEIGHTS = [70, 18, 8, 3, 1];

export function pickLevel() {
  const total = LEVEL_WEIGHTS.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < LEVEL_TIERS.length; i++) {
    r -= LEVEL_WEIGHTS[i];
    if (r <= 0) return LEVEL_TIERS[i];
  }
  return LEVEL_TIERS[0];
}

// 敵タイプを定義するレジストリ。
// 新しい敵を増やすときは、ここに1エントリ追加するだけでよい。
//   build(): { group, legs? } を返す関数（legs があれば歩行アニメ対象）
//   各数値は AI・戦闘・ドロップ・経験値に使われる。

// ── マテリアル ──────────────────────────────────
// 狼（灰色、腹は明るめ）
const wolfFur   = new THREE.MeshLambertMaterial({ color: 0x6f6f78 });
const wolfDark  = new THREE.MeshLambertMaterial({ color: 0x44444a });
const wolfBelly = new THREE.MeshLambertMaterial({ color: 0x9a9aa2 });
const wolfEye   = new THREE.MeshBasicMaterial({ color: 0xffd34d });

// 牛（ホルスタイン風: 白地に黒ぶち、ピンクの鼻）
const cowFur    = new THREE.MeshLambertMaterial({ color: 0xe6e2d8 });
const cowDark   = new THREE.MeshLambertMaterial({ color: 0x3a342e });
const cowMuzzle = new THREE.MeshLambertMaterial({ color: 0xd8a8a0 });
const cowNose   = new THREE.MeshLambertMaterial({ color: 0xc08878 });
const cowHorn   = new THREE.MeshLambertMaterial({ color: 0xd8cfb8 });
const cowUdder  = new THREE.MeshLambertMaterial({ color: 0xe8b8b0 });
const cowEye    = new THREE.MeshBasicMaterial({ color: 0x442a10 });

// 虎（オレンジに黒縞、白い腹・マズル）
const tigerFur   = new THREE.MeshLambertMaterial({ color: 0xd07828 });
const tigerBelly = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
const tigerDark  = new THREE.MeshLambertMaterial({ color: 0x26221e });
const tigerNose  = new THREE.MeshLambertMaterial({ color: 0xb06858 });
const tigerEye   = new THREE.MeshBasicMaterial({ color: 0x9aff5a });

// ── 有機的な形状ヘルパー ─────────────────────────
function ellipsoid(r, sx, sy, sz, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

// 脚: 股関節で回転するグループ（太もも → すね → 足先の3節）
function buildLeg(o, x, z) {
  const leg = new THREE.Group();
  leg.position.set(x, o.legTop, z);

  const upper = new THREE.Mesh(
    new THREE.CylinderGeometry(o.legR * 1.2, o.legR * 0.85, o.legTop * 0.55, 8),
    o.furMat
  );
  upper.position.y = -o.legTop * 0.26;
  upper.castShadow = true;
  upper.userData.fur = true;
  leg.add(upper);

  const lower = new THREE.Mesh(
    new THREE.CylinderGeometry(o.legR * 0.72, o.legR * 0.55, o.legTop * 0.55, 8),
    o.lowerLegMat ?? o.furMat
  );
  lower.position.y = -o.legTop * 0.72;
  if (!o.lowerLegMat) lower.userData.fur = true;
  leg.add(lower);

  const paw = ellipsoid(
    o.legR * 1.2, 1, 0.55, 1.45,
    o.pawMat ?? o.darkMat,
    0, -o.legTop + o.legR * 0.55, o.legR * 0.4
  );
  leg.add(paw);

  return leg;
}

// 四足動物の共通ボディ。丸みのあるパーツ（カプセル胴・球体の胸/尻/腹・
// マズル付きの頭・スタイル別の耳/尻尾）で構成する。
// body はグループで、AI 側の上下動・傾きアニメの対象。
function buildAnimal(o) {
  const g = new THREE.Group();

  const body = new THREE.Group();
  body.position.y = o.bodyY;
  g.add(body);

  // 胴体（カプセルを寝かせる）
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(o.torsoR, o.torsoL, 6, 14), o.furMat);
  torso.rotation.x = Math.PI / 2;
  torso.castShadow = true;
  torso.userData.fur = true;
  body.add(torso);

  // 胸と尻（シルエットに丸い起伏をつける）
  const chest = ellipsoid(o.torsoR * 1.1, 0.95, 1.0, 1.1, o.furMat, 0, 0.02, o.torsoL * 0.5);
  chest.castShadow = true;
  chest.userData.fur = true;
  body.add(chest);

  const haunch = ellipsoid(o.torsoR * 1.06, 0.95, 1.0, 1.0, o.furMat, 0, 0.02, -o.torsoL * 0.5);
  haunch.userData.fur = true;
  body.add(haunch);

  // 腹（妊娠時にここが膨らむ）
  const belly = ellipsoid(o.torsoR * 0.92, 1.0, 0.95, 1.3, o.bellyMat ?? o.furMat, 0, -o.torsoR * 0.3, 0);
  if (!o.bellyMat) belly.userData.fur = true;
  body.add(belly);

  // 首（前傾した円柱）
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(o.neckR, o.neckR * 1.4, o.neckL, 10), o.furMat);
  neck.position.set(0, o.torsoR * 0.5 + o.neckL * 0.2, o.torsoL * 0.5 + o.torsoR * 0.8);
  neck.rotation.x = -0.5;
  neck.userData.fur = true;
  body.add(neck);

  // 頭（頭蓋 + マズル + 鼻 + 耳 + 目）
  const head = new THREE.Group();
  head.position.set(0, o.torsoR * 0.5 + o.neckL * 0.55, o.torsoL * 0.5 + o.torsoR * 1.5);
  body.add(head);

  const skull = ellipsoid(o.headR, 0.92, 0.9, 1.0, o.furMat);
  skull.castShadow = true;
  skull.userData.fur = true;
  head.add(skull);

  const muzzle = ellipsoid(
    o.headR * 0.6, o.muzzleW ?? 0.85, 0.68, 1.5,
    o.muzzleMat ?? o.furMat,
    0, -o.headR * 0.24, o.headR * 0.8
  );
  if (!o.muzzleMat) muzzle.userData.fur = true;
  head.add(muzzle);

  const nose = ellipsoid(
    o.headR * 0.17, 1, 0.75, 0.7,
    o.noseMat ?? o.darkMat,
    0, -o.headR * 0.14, o.headR * 1.6
  );
  head.add(nose);

  // 耳（pointed=尖り耳 / round=丸耳 / droop=垂れ耳）
  for (const sx of [-1, 1]) {
    let ear;
    if (o.earStyle === 'round') {
      ear = ellipsoid(o.headR * 0.42, 1, 1, 0.45, o.furMat,
        sx * o.headR * 0.62, o.headR * 0.72, -o.headR * 0.15);
    } else if (o.earStyle === 'droop') {
      ear = ellipsoid(o.headR * 0.45, 1.3, 0.5, 0.8, o.furMat,
        sx * o.headR * 0.95, o.headR * 0.30, -o.headR * 0.1);
      ear.rotation.z = -sx * 0.5;
    } else {
      ear = new THREE.Mesh(new THREE.ConeGeometry(o.headR * 0.30, o.headR * 0.85, 7), o.furMat);
      ear.position.set(sx * o.headR * 0.5, o.headR * 0.85, -o.headR * 0.2);
      ear.rotation.z = -sx * 0.22;
    }
    ear.userData.fur = true;
    head.add(ear);
  }

  // 目
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(o.headR * 0.15, 8, 6), o.eyeMat);
    eye.position.set(sx * o.headR * 0.45, o.headR * 0.12, o.headR * 0.7);
    head.add(eye);
  }

  // 尻尾（bushy=ふさふさ / long=長い / tuft=先端に房）
  let tail;
  if (o.tailStyle === 'bushy') {
    tail = new THREE.Mesh(new THREE.CapsuleGeometry(o.torsoR * 0.28, o.torsoR * 1.5, 4, 10), o.furMat);
    tail.position.set(0, o.torsoR * 0.35, -(o.torsoL * 0.5 + o.torsoR * 0.9));
    tail.rotation.x = 2.45;
    tail.userData.fur = true;
  } else if (o.tailStyle === 'long') {
    tail = new THREE.Mesh(new THREE.CapsuleGeometry(o.torsoR * 0.14, o.torsoR * 2.4, 4, 8), o.furMat);
    tail.position.set(0, o.torsoR * 0.5, -(o.torsoL * 0.5 + o.torsoR * 1.1));
    tail.rotation.x = 2.1;
    tail.userData.fur = true;
    const tip = ellipsoid(o.torsoR * 0.16, 1, 1.2, 1, o.darkMat, 0, -o.torsoR * 1.35, 0);
    tail.add(tip);
  } else {
    tail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, o.torsoR * 1.7, 6), o.furMat);
    tail.position.set(0, -0.05, -(o.torsoL * 0.5 + o.torsoR * 0.95));
    tail.rotation.x = 0.25;
    tail.userData.fur = true;
    const tuft = ellipsoid(0.05, 1, 1.4, 1, o.darkMat, 0, -o.torsoR * 0.95, 0);
    tail.add(tuft);
  }
  body.add(tail);

  // 脚（4本、股関節ピボット）
  const legs = [];
  for (const [x, z] of [
    [-o.legSpread, o.legZF], [o.legSpread, o.legZF],
    [-o.legSpread, o.legZR], [o.legSpread, o.legZR],
  ]) {
    const leg = buildLeg(o, x, z);
    g.add(leg);
    legs.push(leg);
  }

  return { group: g, legs, body, head, belly };
}

// 狼: 細身で俊敏、尖り耳とふさふさの尻尾。オスは首まわりの毛が豊か。
function buildWolf(sex) {
  const parts = buildAnimal({
    furMat: wolfFur, darkMat: wolfDark, bellyMat: wolfBelly, eyeMat: wolfEye,
    lowerLegMat: wolfDark,
    bodyY: 0.58, torsoR: 0.19, torsoL: 0.50,
    neckR: 0.085, neckL: 0.26,
    headR: 0.145, muzzleW: 0.72,
    earStyle: 'pointed', tailStyle: 'bushy',
    legTop: 0.50, legR: 0.045, legSpread: 0.12, legZF: 0.30, legZR: -0.27,
  });
  if (sex === 'male') {
    const ruff = ellipsoid(0.20, 1.05, 1.0, 0.8, wolfFur, 0, 0.14, 0.34);
    ruff.userData.fur = true;
    parts.body.add(ruff);
  }
  return parts;
}

// 牛: 樽型の胴に短い太脚、垂れ耳とピンクのマズル。
// オスは大きな角、メスは小さな角と乳房を持つ。
function buildCow(sex) {
  const parts = buildAnimal({
    furMat: cowFur, darkMat: cowDark, eyeMat: cowEye,
    muzzleMat: cowMuzzle, noseMat: cowNose, pawMat: cowDark,
    bodyY: 0.68, torsoR: 0.30, torsoL: 0.55,
    neckR: 0.13, neckL: 0.26,
    headR: 0.17, muzzleW: 0.95,
    earStyle: 'droop', tailStyle: 'tuft',
    legTop: 0.46, legR: 0.062, legSpread: 0.17, legZF: 0.33, legZR: -0.31,
  });
  const { body, head } = parts;

  // ぶち模様（体表に張り付く平たい黒斑）
  const patchDefs = [
    // [x, y, z, 半径, 側面フラグ]
    [ 0.26,  0.02,  0.20, 0.17, true],
    [-0.26, -0.02, -0.16, 0.20, true],
    [ 0.25,  0.08, -0.28, 0.14, true],
    [-0.25,  0.06,  0.30, 0.15, true],
    [ 0.00,  0.26, -0.05, 0.19, false],
  ];
  for (const [px, py, pz, r, side] of patchDefs) {
    const patch = ellipsoid(r, side ? 0.25 : 1.1, side ? 1.1 : 0.25, 1.15, cowDark, px, py, pz);
    body.add(patch);
  }

  // 角（オスは長く立派）
  const hornLen = sex === 'male' ? 0.20 : 0.11;
  for (const sx of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.032, hornLen, 6), cowHorn);
    horn.position.set(sx * 0.11, 0.16, -0.02);
    horn.rotation.z = -sx * 0.7;
    head.add(horn);
  }

  // メスは乳房
  if (sex === 'female') {
    const udder = ellipsoid(0.13, 1, 0.8, 1.1, cowUdder, 0, -0.30, -0.18);
    body.add(udder);
  }

  return parts;
}

// 虎: しなやかな長い胴、丸耳、長い尻尾、胴に巻く黒縞。
// オスは頬の白い飾り毛を持つ。
function buildTiger(sex) {
  const o = {
    furMat: tigerFur, darkMat: tigerDark, bellyMat: tigerBelly, eyeMat: tigerEye,
    muzzleMat: tigerBelly, noseMat: tigerNose,
    bodyY: 0.60, torsoR: 0.23, torsoL: 0.62,
    neckR: 0.11, neckL: 0.24,
    headR: 0.16, muzzleW: 0.9,
    earStyle: 'round', tailStyle: 'long',
    legTop: 0.47, legR: 0.056, legSpread: 0.15, legZF: 0.36, legZR: -0.33,
  };
  const parts = buildAnimal(o);
  const { body, head } = parts;

  // 縞模様（胴に巻き付く細い輪。腹側は腹メッシュに隠れる）
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(o.torsoR, 0.022, 6, 18), tigerDark);
    ring.position.z = -0.25 + i * 0.125;
    body.add(ring);
  }

  // オスは頬の飾り毛
  if (sex === 'male') {
    for (const sx of [-1, 1]) {
      const ruff = ellipsoid(0.09, 0.5, 1, 1, tigerBelly, sx * 0.14, -0.05, 0.02);
      head.add(ruff);
    }
  }

  return parts;
}

export const ENEMY_TYPES = {
  wolf: {
    id: 'wolf',
    name: '狼',
    icon: '🐺',
    hp: 3,
    speedChase: 4.2,
    speedWander: 1.6,
    detectRange: 20,
    leashRange: 32,
    attackRange: 1.9,
    attackCd: 1.2,
    damage: 10,
    xp: 20,
    drops: [{ id: 'meat', min: 1, max: 2 }, { id: 'fur', min: 1, max: 1 }],
    spawnWeight: 1,
    fearsFire: true,    // 火を怖がる
    fireFleeSpeed: 5.5, // 逃げ足の速さ
    tameable: true,
    tameAffection: 20,  // 餌1回あたりの好感度上昇
    collar: { y: 0.72, z: 0.42, r: 0.15 }, // テイム首輪の位置
    build: (sex) => buildWolf(sex),
  },

  cow: {
    id: 'cow',
    name: '牛',
    icon: '🐄',
    hp: 14,
    speedChase: 3.4,     // 逃走時の速さ
    speedWander: 1.1,
    detectRange: 15,     // 餌の発見にも使う
    leashRange: 30,
    attackRange: 1.7,
    attackCd: 1.5,
    damage: 4,
    xp: 30,
    drops: [{ id: 'meat', min: 2, max: 4 }, { id: 'fur', min: 1, max: 2 }],
    spawnWeight: 1,
    fearsFire: true,
    passive: true,       // 自分からは襲わない
    fleeOnHurt: true,    // 攻撃されると逃げる
    tameable: true,
    tameAffection: 25,   // おとなしいのでテイムしやすい
    collar: { y: 0.87, z: 0.50, r: 0.21 },
    build: (sex) => buildCow(sex),
  },

  tiger: {
    id: 'tiger',
    name: '虎',
    icon: '🐅',
    hp: 10,
    speedChase: 5.2,
    speedWander: 1.5,
    detectRange: 26,
    leashRange: 44,
    attackRange: 2.1,
    attackCd: 1.0,
    damage: 22,
    xp: 90,
    drops: [{ id: 'meat', min: 2, max: 3 }, { id: 'fur', min: 2, max: 3 }],
    spawnWeight: 1,
    fearsFire: true,
    fireFleeSpeed: 6.2,
    tameable: true,
    tameAffection: 10,   // どう猛なのでテイムしにくい
    collar: { y: 0.75, z: 0.47, r: 0.18 },
    build: (sex) => buildTiger(sex),
  },
};

// 出現重み付き抽選（場所を考慮しない旧版・フォールバック用）
export function pickEnemyType() {
  const types = Object.values(ENEMY_TYPES);
  const total = types.reduce((s, t) => s + (t.spawnWeight || 1), 0);
  let r = Math.random() * total;
  for (const t of types) {
    r -= (t.spawnWeight || 1);
    if (r <= 0) return t;
  }
  return types[0];
}

// ── 場所に応じた出現分布 ─────────────────────────────
//   ・スタート地点（原点）周辺: 狼が多い
//   ・平原地帯: 牛の群れが多い
//   ・原点から離れた森林/山岳: 虎が出現
export function pickEnemyTypeAt(x, z) {
  const d = Math.hypot(x, z);
  const plains = getPlainsFactor(x, z);
  const weights = {
    wolf:  d < 80 ? 5.0 : 1.2,
    cow:   0.2 + plains * 4.5,
    tiger: d < 60 ? 0 : (0.3 + Math.min(1, (d - 60) / 120) * 2.0) * (1 - plains * 0.6),
  };
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (const [id, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return ENEMY_TYPES[id];
  }
  return ENEMY_TYPES.wolf;
}
