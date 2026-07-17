import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise2D } from 'simplex-noise';

// three-mesh-bvh をグローバルに有効化（レイキャスト高速化＋boundsTree生成）
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const CHUNK_SIZE = 50;
const CHUNK_SEGMENTS = 52; // 高解像度地形
const VIEW_DISTANCE = 2;

// 頂点カラー有効（高さ・勾配で色付け）
const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
const leafMat  = new THREE.MeshLambertMaterial({ color: 0x3a7d44 });

// 岩タイプ別マテリアル
const rockMaterials = {
  stone:       new THREE.MeshLambertMaterial({ color: 0x888888 }),
  iron_rock:   new THREE.MeshLambertMaterial({ color: 0x7a6058 }),
  copper_rock: new THREE.MeshLambertMaterial({ color: 0x7a6540 }),
  coal_rock:   new THREE.MeshLambertMaterial({ color: 0x252525 }),
  flint_rock:  new THREE.MeshLambertMaterial({ color: 0xb8b0a0 }),
};
const veinMaterials = {
  iron_rock:   new THREE.MeshLambertMaterial({ color: 0xc45a25 }),
  copper_rock: new THREE.MeshLambertMaterial({ color: 0x4db07a }),
  coal_rock:   new THREE.MeshLambertMaterial({ color: 0x111111 }),
  flint_rock:  new THREE.MeshLambertMaterial({ color: 0xddd8c8 }),
};

function disposeMeshGeometry(object) {
  object.traverse((child) => {
    if (child.isMesh && child.geometry) child.geometry.dispose();
  });
}

function disposeCollider(collider) {
  if (!collider) return;
  collider.geometry.disposeBoundsTree?.();
  collider.geometry.dispose();
  if (Array.isArray(collider.material)) {
    collider.material.forEach((m) => m.dispose());
  } else {
    collider.material.dispose();
  }
}

// 衝突対象メッシュ群をワールド座標で1つのジオメトリに統合し、
// BVH（boundsTree）を構築した不可視コライダーメッシュを返す。
function buildCollider(meshes) {
  const geometries = [];
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    // mergeGeometries は属性構成が揃っている必要があるため position/normal/uv のみに統一
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') {
        g.deleteAttribute(name);
      }
    }
    geometries.push(g);
  }

  const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
  geometries.forEach((g) => g.dispose());
  merged.computeBoundsTree();

  // 真下/真上どちらからのレイでもヒットさせるため DoubleSide
  const collider = new THREE.Mesh(
    merged,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  collider.visible = false; // 当たり判定専用（描画しない）
  return collider;
}

// 高さから地形カラー(RGB 0-1)を返す
function heightToRGB(h) {
  if (h < -0.8) return [0.62, 0.55, 0.35]; // 川床・砂地
  if (h < 2.0)  return [0.33, 0.58, 0.22]; // 低地の草
  if (h < 7.0)  return [0.38, 0.54, 0.25]; // 平原の草
  if (h < 14.0) return [0.43, 0.50, 0.28]; // 高原の草
  if (h < 22.0) return [0.52, 0.48, 0.40]; // 岩肌混じり
  if (h < 30.0) return [0.60, 0.56, 0.50]; // 岩石帯
  return [0.84, 0.84, 0.82]; // 雪/白岩
}

// 地形の高さ関数 — simplex-noise による多重オクターブ FBM
export function getTerrainHeight(x, z) {
  const d = Math.sqrt(x * x + z * z);
  const blend = Math.min(1, Math.max(0, (d - 24) / 32));

  let h  = noise2D(x * 0.006,  z * 0.006)  * 10;
  h     += noise2D(x * 0.018,  z * 0.018)  * 4.5;
  h     += noise2D(x * 0.056,  z * 0.056)  * 2.2;
  h     += noise2D(x * 0.16,   z * 0.16)   * 1.1;
  h     += noise2D(x * 0.46,   z * 0.46)   * 0.40;

  const ridge = 1 - Math.abs(noise2D(x * 0.014 + 50, z * 0.014 + 50));
  h += ridge * ridge * 5 * blend;

  h += 1.5;
  h = Math.max(-2.5, h);

  const spawnPlateau = (1.0 - blend) * 2.2;
  return h * blend + spawnPlateau;
}

function hashChunk(cx, cz, salt = 0) {
  let h = 2166136261;
  h ^= cx + 0x9e3779b9 + (h << 6) + (h >>> 2);
  h ^= cz + 0x85ebca6b + (h << 6) + (h >>> 2);
  h ^= salt + 0xc2b2ae35 + (h << 6) + (h >>> 2);
  return h >>> 0;
}

function mulberry32(seed) {
  return function rng() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 固定シードの決定論的ノイズ（リロードしても地形が変わらない）
const noise2D = createNoise2D(mulberry32(0xA1B2C3D4));

function randomRange(min, max, rng = Math.random) {
  return rng() * (max - min) + min;
}

function worldToChunk(value) {
  return Math.floor((value + CHUNK_SIZE / 2) / CHUNK_SIZE);
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function isPlacementAllowed(x, z) {
  // スポーン地点と鍛冶屋の周辺には自然物を置かない
  if (Math.hypot(x, z) < 8) return false;
  if (x > -8 && x < 8 && z > -24 && z < -8) return false;
  return true;
}

// 採取可能な素材ノードを表す（木 or 岩）
// ノードはローカル原点を地面に置いた Group で、ダメージ時に縮小させやすくする。
function addTree(parent, x, z, rng, id) {
  const y = getTerrainHeight(x, z);
  if (y <= 0.35) return null;
  const heightScale = randomRange(0.5, 2.2, rng); // 小さな若木〜大木

  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(x, y, z);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 + 0.10 * heightScale, 0.18 + 0.14 * heightScale, 2 * heightScale, 8),
    trunkMat
  );
  trunk.position.set(0, heightScale, 0);
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.2 * heightScale, 8, 6), leafMat);
  leaves.position.set(0, 3.0 * heightScale, 0);
  leaves.castShadow = true;

  nodeGroup.add(trunk, leaves);
  parent.add(nodeGroup);

  const hp = Math.max(1, Math.round(3 * heightScale));
  return {
    id,
    type: 'wood',
    hp,
    maxHp: hp,
    sizeScale: heightScale,
    alive: true,
    group: nodeGroup,
    collidable: trunk,
    position: new THREE.Vector3(x, y, z),
  };
}

const ROCK_TYPE_DIST = ['stone', 'stone', 'stone', 'stone', 'iron_rock', 'iron_rock', 'copper_rock', 'coal_rock', 'flint_rock'];
const ROCK_HP = { stone: 4, iron_rock: 5, copper_rock: 4, coal_rock: 3, flint_rock: 3 };

function addRock(parent, x, z, rng, id) {
  const y = getTerrainHeight(x, z);
  if (y <= 0.18) return null; // 水中には岩を置かない

  const rockType = ROCK_TYPE_DIST[Math.floor(rng() * ROCK_TYPE_DIST.length)];
  const size = randomRange(0.35, 2.00, rng); // 小石〜巨岩

  let geo;
  if (rockType === 'flint_rock') {
    geo = new THREE.IcosahedronGeometry(size, 0); // 鋭角的
  } else if (rockType === 'coal_rock') {
    geo = new THREE.BoxGeometry(size * 1.4, size * 0.9, size * 1.2); // 塊状
  } else {
    geo = rng() > 0.5
      ? new THREE.IcosahedronGeometry(size, 0)
      : new THREE.SphereGeometry(size * 0.9, 5, 4);
  }

  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(x, y, z);

  const mat = rockMaterials[rockType];
  const rock = new THREE.Mesh(geo, mat);
  rock.position.set(0, size * 0.35, 0);
  rock.rotation.set(randomRange(0, Math.PI, rng), randomRange(0, Math.PI, rng), randomRange(0, Math.PI, rng));
  rock.castShadow = true;
  rock.receiveShadow = true;
  nodeGroup.add(rock);

  // 鉱石タイプには鉱脈の模様を追加
  const veinMat = veinMaterials[rockType];
  if (veinMat) {
    const vs = size * 0.38;
    const veinGeo = rockType === 'flint_rock'
      ? new THREE.BoxGeometry(vs, vs * 0.4, vs * 0.6)
      : new THREE.IcosahedronGeometry(vs, 0);
    const vein = new THREE.Mesh(veinGeo, veinMat);
    vein.position.set(size * 0.2, size * 0.55, size * 0.1);
    vein.rotation.set(randomRange(0, Math.PI, rng), randomRange(0, Math.PI, rng), 0);
    nodeGroup.add(vein);

    // 2つ目の小さい鉱脈
    const vein2 = new THREE.Mesh(new THREE.IcosahedronGeometry(vs * 0.6, 0), veinMat);
    vein2.position.set(-size * 0.25, size * 0.4, size * 0.2);
    vein2.rotation.set(randomRange(0, Math.PI, rng), randomRange(0, Math.PI, rng), 0);
    nodeGroup.add(vein2);
  }

  // 当たり判定は視覚サイズによらず小さなプロキシ球を使う
  // （大きな岩でもプレイヤーが近づけるように）
  const collRad = Math.min(size * 0.45, 0.62);
  const collProxy = new THREE.Mesh(
    new THREE.SphereGeometry(collRad, 4, 2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  collProxy.position.set(0, collRad * 0.6, 0);
  nodeGroup.add(collProxy);

  parent.add(nodeGroup);

  const hp = Math.max(2, Math.round(ROCK_HP[rockType] * size));
  return {
    id,
    type: rockType,
    hp,
    maxHp: hp,
    sizeScale: size,
    alive: true,
    group: nodeGroup,
    collidable: collProxy,
    position: new THREE.Vector3(x, y, z),
  };
}

// 草の色バリエーション（緑の濃淡）
// マテリアルは共有する（パッチごとに生成するとチャンク破棄時にリークする）
const GRASS_COLORS = [0x4a9a2e, 0x52a832, 0x3d8a28, 0x5cb038, 0x45952b];
const grassMaterials = GRASS_COLORS.map(
  (color) => new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
);

function addGrass(parent, x, z, rng, id) {
  const y = getTerrainHeight(x, z);
  if (y <= 0.35) return null;
  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(x, y, z);
  const mat = grassMaterials[Math.floor(rng() * grassMaterials.length)];
  // 膝くらいの高さ (PLAYER_H=1.9, 膝≒0.5m) 刃の高さ 0.52〜0.62m
  const bladeH = 0.52 + rng() * 0.10;
  const bladeW = 0.13 + rng() * 0.06;
  const bladeGeo = new THREE.PlaneGeometry(bladeW, bladeH);
  const bladeCount = 5 + Math.floor(rng() * 4); // 5〜8枚
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(bladeGeo, mat);
    blade.position.set((rng()-0.5)*0.22, bladeH * 0.5, (rng()-0.5)*0.22);
    blade.rotation.y = (i / bladeCount) * Math.PI * 2 + rng() * 0.5;
    blade.rotation.z = (rng()-0.5) * 0.30;
    nodeGroup.add(blade);
  }
  parent.add(nodeGroup);
  return { id, type: 'grass', hp: 1, maxHp: 1, alive: true, group: nodeGroup, collidable: null, position: new THREE.Vector3(x, y, z) };
}

// キノコタイプ定義 [type, capColor, spotColor, spotCount, emissive]
const MUSHROOM_TYPES = [
  // 食用: 琥珀色 (40%)
  { type: 'mushroom',             capColor: 0xd4a050, spotColor: null,    spots: 0, emissive: 0x000000 },
  // 毒: 赤に白斑点 (25%)
  { type: 'toxic_mushroom',       capColor: 0xcc3311, spotColor: 0xfffacc, spots: 4, emissive: 0x000000 },
  // 麻酔: 紫に白斑点 (20%)
  { type: 'anesthetic_mushroom',  capColor: 0x7744bb, spotColor: 0xeeddff, spots: 5, emissive: 0x220033 },
  // 薬: 鮮緑に光る (15%)
  { type: 'medicine_mushroom',    capColor: 0x33bb55, spotColor: 0xaaffcc, spots: 3, emissive: 0x003311 },
];
const MUSHROOM_WEIGHTS = [40, 25, 20, 15];

function pickMushroomType(rng) {
  const total = MUSHROOM_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < MUSHROOM_TYPES.length; i++) {
    r -= MUSHROOM_WEIGHTS[i];
    if (r <= 0) return MUSHROOM_TYPES[i];
  }
  return MUSHROOM_TYPES[0];
}

// キノコのマテリアルはタイプ単位で共有（個体ごとの生成はリークの原因）
const mushroomStemMat = new THREE.MeshLambertMaterial({ color: 0xe8e0d0 });
function getMushroomMats(def) {
  if (!def._capMat) {
    def._capMat  = new THREE.MeshLambertMaterial({ color: def.capColor, emissive: def.emissive, emissiveIntensity: 0.35 });
    def._spotMat = def.spotColor ? new THREE.MeshLambertMaterial({ color: def.spotColor }) : null;
  }
  return { capMat: def._capMat, spotMat: def._spotMat };
}

function addMushroom(parent, x, z, rng, id) {
  const y = getTerrainHeight(x, z);
  if (y <= 0.35) return null;
  const def = pickMushroomType(rng);
  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(x, y, z);
  const stemMat = mushroomStemMat;
  const { capMat, spotMat } = getMushroomMats(def);
  const stemH = 0.12 + rng() * 0.08;
  const capR  = 0.10 + rng() * 0.08;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.030, stemH, 6), stemMat);
  stem.position.y = stemH / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 7, 5), capMat);
  cap.scale.y = 0.55;
  cap.position.y = stemH + capR * 0.35;
  nodeGroup.add(stem, cap);
  if (spotMat && def.spots > 0) {
    for (let s = 0; s < def.spots; s++) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4), spotMat);
      const sa = s * (Math.PI * 2 / def.spots) + rng() * 0.5;
      spot.position.set(Math.cos(sa)*capR*0.55, stemH + capR*0.55, Math.sin(sa)*capR*0.55);
      nodeGroup.add(spot);
    }
  }
  parent.add(nodeGroup);
  return { id, type: def.type, hp: 1, maxHp: 1, alive: true, group: nodeGroup, collidable: null, position: new THREE.Vector3(x, y, z) };
}

function createTerrainChunkMesh(cx, cz) {
  const centerX = cx * CHUNK_SIZE;
  const centerZ = cz * CHUNK_SIZE;
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGMENTS, CHUNK_SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const colors  = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i) + centerX;
    const z = posAttr.getZ(i) + centerZ;
    const h = getTerrainHeight(x, z);
    posAttr.setXYZ(i, x, h, z);

    const [r, g, b] = heightToRGB(h);
    colors[i * 3]     = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  posAttr.needsUpdate = true;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.name = `terrain-${cx},${cz}`;
  return ground;
}

function createChunk(cx, cz, destroyedResourceIds) {
  const rng = mulberry32(hashChunk(cx, cz));
  const group = new THREE.Group();
  group.name = `chunk-${cx},${cz}`;

  const ground = createTerrainChunkMesh(cx, cz);
  group.add(ground);

  const resourceNodes = [];
  const minX = cx * CHUNK_SIZE - CHUNK_SIZE / 2;
  const minZ = cz * CHUNK_SIZE - CHUNK_SIZE / 2;

  const treeCount = 40 + Math.floor(rng() * 21); // 40〜60本
  for (let i = 0; i < treeCount; i++) {
    const id = `${cx},${cz}:tree:${i}`;
    if (destroyedResourceIds.has(id)) continue;
    const x = minX + randomRange(4, CHUNK_SIZE - 4, rng);
    const z = minZ + randomRange(4, CHUNK_SIZE - 4, rng);
    if (!isPlacementAllowed(x, z)) continue;
    const node = addTree(group, x, z, rng, id);
    if (node) resourceNodes.push(node);
  }

  const rockCount = 24 + Math.floor(rng() * 17); // 24〜40個
  for (let i = 0; i < rockCount; i++) {
    const id = `${cx},${cz}:rock:${i}`;
    if (destroyedResourceIds.has(id)) continue;
    const x = minX + randomRange(4, CHUNK_SIZE - 4, rng);
    const z = minZ + randomRange(4, CHUNK_SIZE - 4, rng);
    if (!isPlacementAllowed(x, z)) continue;
    const node = addRock(group, x, z, rng, id);
    if (node) resourceNodes.push(node);
  }

  // 草：3〜5クラスター、各クラスターに6〜12パッチ、半径3m以内に密集
  const clusterCount = 3 + Math.floor(rng() * 3);
  let grassIdx = 0;
  for (let ci = 0; ci < clusterCount; ci++) {
    const cx2 = minX + randomRange(5, CHUNK_SIZE - 5, rng);
    const cz2 = minZ + randomRange(5, CHUNK_SIZE - 5, rng);
    const patchCount = 6 + Math.floor(rng() * 7);
    for (let pi = 0; pi < patchCount; pi++) {
      const id = `${cx},${cz}:grass:${grassIdx++}`;
      if (destroyedResourceIds.has(id)) continue;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 3.0;
      const x = cx2 + Math.cos(angle) * radius;
      const z = cz2 + Math.sin(angle) * radius;
      if (x < minX + 1 || x > minX + CHUNK_SIZE - 1 || z < minZ + 1 || z > minZ + CHUNK_SIZE - 1) continue;
      if (!isPlacementAllowed(x, z)) continue;
      const node = addGrass(group, x, z, rng, id);
      if (node) resourceNodes.push(node);
    }
  }

  const mushCount = 4 + Math.floor(rng() * 9);
  for (let i = 0; i < mushCount; i++) {
    const id = `${cx},${cz}:mush:${i}`;
    if (destroyedResourceIds.has(id)) continue;
    const x = minX + randomRange(2, CHUNK_SIZE - 2, rng);
    const z = minZ + randomRange(2, CHUNK_SIZE - 2, rng);
    if (!isPlacementAllowed(x, z)) continue;
    const node = addMushroom(group, x, z, rng, id);
    if (node) resourceNodes.push(node);
  }

  return { cx, cz, group, ground, resourceNodes };
}

// 資源ノードの衝突ボックス一覧を再構築（軽量。ノード破壊のたびに呼べる）
function rebuildNodeCollision(world) {
  world.collidableBoxes.length = 0;
  world.resourceNodes.length = 0;

  const collidableMeshes = [...world.staticCollidableMeshes];

  for (const chunk of world.chunks.values()) {
    for (const node of chunk.resourceNodes) {
      if (!node.alive) continue;
      world.resourceNodes.push(node);
      if (node.collidable) collidableMeshes.push(node.collidable);
    }
  }

  for (const mesh of collidableMeshes) {
    // 親（nodeGroup / chunk group）の行列も含めて更新しないと、
    // ローカル原点基準の誤ったワールドAABBになる
    mesh.updateWorldMatrix(true, false);
    world.collidableBoxes.push(new THREE.Box3().setFromObject(mesh));
  }
}

// 地形BVHコライダーを再構築（重い。チャンクの出入りが変わったときだけ呼ぶ）
function rebuildTerrainCollider(scene, world) {
  const terrainMeshes = [];
  for (const chunk of world.chunks.values()) terrainMeshes.push(chunk.ground);

  if (world.terrainCollider) {
    scene.remove(world.terrainCollider);
    disposeCollider(world.terrainCollider);
  }

  world.terrainCollider = buildCollider(terrainMeshes);
  scene.add(world.terrainCollider);
}

function damageNode(scene, world, node, amount = 1) {
  if (!node || !node.alive) return false;

  node.hp -= amount;

  // ヒットフィードバック: 残HPに合わせて少し縮める
  const ratio = Math.max(0.55, node.hp / node.maxHp);
  node.group.scale.setScalar(0.82 + ratio * 0.18);

  if (node.hp > 0) return false;

  node.alive = false;
  world.destroyedResourceIds.add(node.id);
  const parent = node.group.parent;
  if (parent) parent.remove(node.group);
  disposeMeshGeometry(node.group);
  // 地形BVHはノード破壊で変化しないため、軽いボックス再構築のみ行う
  rebuildNodeCollision(world);
  return true;
}

function updateChunks(scene, world, position, force = false) {
  const centerCx = worldToChunk(position.x);
  const centerCz = worldToChunk(position.z);

  if (!force && centerCx === world.centerCx && centerCz === world.centerCz) {
    return false;
  }

  world.centerCx = centerCx;
  world.centerCz = centerCz;

  const needed = new Set();
  for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
      const cx = centerCx + dx;
      const cz = centerCz + dz;
      const key = chunkKey(cx, cz);
      needed.add(key);

      if (!world.chunks.has(key)) {
        const chunk = createChunk(cx, cz, world.destroyedResourceIds);
        world.chunks.set(key, chunk);
        scene.add(chunk.group);
      }
    }
  }

  for (const [key, chunk] of world.chunks) {
    if (needed.has(key)) continue;
    scene.remove(chunk.group);
    disposeMeshGeometry(chunk.group);
    world.chunks.delete(key);
  }

  rebuildNodeCollision(world);
  rebuildTerrainCollider(scene, world);
  return true;
}

export function create(scene) {
  // 太陽光（午後の角度）
  const dirLight = new THREE.DirectionalLight(0xfff2cc, 1.4);
  dirLight.position.set(60, 110, 45);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width  = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near   = 0.5;
  dirLight.shadow.camera.far    = 400;
  dirLight.shadow.camera.left   = -120;
  dirLight.shadow.camera.right  = 120;
  dirLight.shadow.camera.top    = 120;
  dirLight.shadow.camera.bottom = -120;
  dirLight.shadow.bias = -0.0003;
  scene.add(dirLight);
  scene.add(dirLight.target); // ターゲットをシーンに入れないと追従時に行列が更新されない

  // 半球ライト（空→地面のグラデーション環境光）
  const hemiLight = new THREE.HemisphereLight(0x8ec8ff, 0x7a8c4a, 0.65);
  scene.add(hemiLight);

  // 水面（高さ 0 以下の地形を隠す半透明プレーン）
  const waterGeo = new THREE.PlaneGeometry(3000, 3000);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x3a7abf,
    transparent: true,
    opacity: 0.72,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = 0.02;
  water.renderOrder = 1;
  scene.add(water);

  const world = {
    chunks: new Map(),
    centerCx: null,
    centerCz: null,
    staticCollidableMeshes: [],
    collidableBoxes: [],
    resourceNodes: [],
    destroyedResourceIds: new Set(),
    terrainCollider: null,
    update(position) {
      // 太陽光と水面をプレイヤーに追従させる
      // （固定のままだと原点から離れたとき影と水が消える）
      dirLight.position.set(position.x + 60, 110, position.z + 45);
      dirLight.target.position.set(position.x, 0, position.z);
      water.position.set(position.x, 0.02, position.z);
      return updateChunks(scene, world, position);
    },
    getResourceNodes() {
      return world.resourceNodes;
    },
    damageNode(node, amount = 1) {
      return damageNode(scene, world, node, amount);
    },
  };

  // 初期スポーン周辺を生成
  updateChunks(scene, world, new THREE.Vector3(0, 0, 0), true);

  return world;
}
