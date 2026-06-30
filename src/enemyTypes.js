import * as THREE from 'three';

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

const wolfBody = new THREE.MeshLambertMaterial({ color: 0x6b6b72 });
const wolfDark = new THREE.MeshLambertMaterial({ color: 0x4a4a50 });
const eyeMat   = new THREE.MeshBasicMaterial({ color: 0xffd34d });

function buildQuadruped(bodyMat, darkMat, scale = 1, eyeColor = eyeMat) {
  const g = new THREE.Group();

  // 胴体（横長、細め）
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.38, 1.05), bodyMat);
  body.position.set(0, 0.58, 0);
  body.castShadow = true;
  g.add(body);

  // 首
  const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.25, 0.20), bodyMat);
  neckMesh.position.set(0, 0.72, 0.55);
  neckMesh.rotation.x = -0.35;
  neckMesh.castShadow = true;
  g.add(neckMesh);

  // 頭（リアル比：胴体の約1/3幅）
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.30), bodyMat);
  head.position.set(0, 0.78, 0.80);
  head.castShadow = true;
  g.add(head);

  // 鼻口部
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.22), darkMat);
  snout.position.set(0, 0.70, 1.01);
  g.add(snout);

  // 耳
  const earL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.05), darkMat);
  earL.position.set(-0.09, 0.95, 0.80);
  g.add(earL);
  const earR = earL.clone(); earR.position.x = 0.09; g.add(earR);

  // 目
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), eyeColor);
  eyeL.position.set(-0.08, 0.80, 0.96);
  g.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.08; g.add(eyeR);

  // 尻尾
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.42), darkMat);
  tail.position.set(0, 0.72, -0.72);
  tail.rotation.x = -0.45;
  g.add(tail);

  // 脚（4本、やや細く長め）
  const legGeo = new THREE.BoxGeometry(0.11, 0.50, 0.11);
  const legs = [];
  for (const [x, y, z] of [[-0.15,0.24,0.36],[0.15,0.24,0.36],[-0.15,0.24,-0.36],[0.15,0.24,-0.36]]) {
    const leg = new THREE.Mesh(legGeo, darkMat);
    leg.position.set(x, y, z);
    leg.castShadow = true;
    g.add(leg);
    legs.push(leg);
  }

  // 前足の先（爪）
  for (const sx of [-0.15, 0.15]) {
    const paw = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.15), darkMat);
    paw.position.set(sx, 0.0, 0.38);
    g.add(paw);
  }

  g.scale.setScalar(scale);
  return { group: g, legs, body };
}

export const ENEMY_TYPES = {
  wolf: {
    id: 'wolf',
    name: '狼',
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
    build: () => buildQuadruped(wolfBody, wolfDark, 1.0),
  },

  // 例: 新しい敵を増やす場合はこのように追加するだけ
  // dire_wolf: {
  //   id: 'dire_wolf', name: '大狼', hp: 8, speedChase: 5, speedWander: 1.8,
  //   detectRange: 24, leashRange: 40, attackRange: 2.1, attackCd: 1.0,
  //   damage: 18, xp: 60, drops: [{ id: 'meat', min: 2, max: 4 }], spawnWeight: 0.3,
  //   build: () => buildQuadruped(direBody, direDark, 1.4),
  // },
};

// 出現重み付き抽選
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
