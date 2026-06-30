import * as THREE from 'three';

// 地形の高さ関数（ワールド座標で呼び出し可能なようにexport）
export function getTerrainHeight(x, z) {
  const d = Math.sqrt(x * x + z * z);
  // スポーン周辺（半径15）は平坦、そこから25ユニットかけてブレンド
  const blend = Math.min(1, Math.max(0, (d - 15) / 25));

  let h = 0;
  h += Math.sin(x * 0.05) * Math.cos(z * 0.04) * 4;
  h += Math.sin(x * 0.11 + 2.0) * Math.cos(z * 0.09 - 1.2) * 1.8;
  // max(0, ...) で谷のない山塊を生成
  h += Math.max(0, Math.sin(x * 0.03 + 0.5) * Math.cos(z * 0.02 - 0.8)) * 14;
  h += Math.max(0, Math.sin(x * 0.025 - 1.0) * Math.cos(z * 0.035 + 1.3)) * 10;

  return h * blend;
}

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function addTree(scene, x, z) {
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  const leafMat  = new THREE.MeshLambertMaterial({ color: 0x3a7d44 });
  const y = getTerrainHeight(x, z);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2, 8), trunkMat);
  trunk.position.set(x, y + 1, z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), leafMat);
  leaves.position.set(x, y + 3.0, z);
  leaves.castShadow = true;

  scene.add(trunk, leaves);
  return trunk; // 幹のみ衝突対象
}

function addRock(scene, x, z) {
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const geo = Math.random() > 0.5
    ? new THREE.IcosahedronGeometry(randomRange(0.4, 0.9), 0)
    : new THREE.SphereGeometry(randomRange(0.3, 0.8), 5, 4);
  const y = getTerrainHeight(x, z);

  const rock = new THREE.Mesh(geo, rockMat);
  rock.position.set(x, y + 0.3, z);
  rock.rotation.set(randomRange(0, Math.PI), randomRange(0, Math.PI), randomRange(0, Math.PI));
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
  return rock;
}

function addBlacksmith(scene) {
  const wallMat    = new THREE.MeshLambertMaterial({ color: 0xc8a96e });
  const roofMat    = new THREE.MeshLambertMaterial({ color: 0x7a3b1e });
  const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const signMat    = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
  const anvilMat   = new THREE.MeshLambertMaterial({ color: 0x444444 });

  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), wallMat);
  wall.position.set(0, 2, -15);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 2.5, 4), roofMat);
  roof.position.set(0, 5.25, -15);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  scene.add(roof);

  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 2.5, 8), chimneyMat);
  chimney.position.set(2, 6.0, -16);
  chimney.castShadow = true;
  scene.add(chimney);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 0.1), signMat);
  sign.position.set(0, 3.5, -11.9);
  scene.add(sign);

  const anvilBody = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 0.5), anvilMat);
  anvilBody.position.set(4, 0.8, -12);
  anvilBody.castShadow = true;
  scene.add(anvilBody);

  const anvilTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.55), anvilMat);
  anvilTop.position.set(4, 1.0, -12);
  anvilTop.castShadow = true;
  scene.add(anvilTop);

  const anvilLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.7, 6), anvilMat);
  anvilLeg.position.set(4, 0.35, -12);
  scene.add(anvilLeg);

  return [wall]; // 壁のみ衝突対象
}

export function create(scene) {
  // ライト
  const dirLight = new THREE.DirectionalLight(0xfff5e0, 1.3);
  dirLight.position.set(40, 80, 30);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width  = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near   = 0.5;
  dirLight.shadow.camera.far    = 300;
  dirLight.shadow.camera.left   = -80;
  dirLight.shadow.camera.right  = 80;
  dirLight.shadow.camera.top    = 80;
  dirLight.shadow.camera.bottom = -80;
  scene.add(dirLight);

  const ambLight = new THREE.AmbientLight(0x7090bb, 0.6);
  scene.add(ambLight);

  // 地形メッシュ（頂点をgetTerrainHeightで変位）
  const segments = 100;
  const size = 200;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2); // ジオメトリ自体を回転してワールド座標と一致させる

  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getTerrainHeight(x, z));
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshLambertMaterial({ color: 0x5a8c3a })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // グリッドは地面に合わせて非表示でも可（平坦エリア用）
  const grid = new THREE.GridHelper(30, 15, 0x000000, 0x000000);
  grid.material.opacity = 0.1;
  grid.material.transparent = true;
  scene.add(grid);

  // オブジェクト配置
  const collidableMeshes = [];

  collidableMeshes.push(...addBlacksmith(scene));

  const treePositions = [
    [10, -5], [-12, 8], [18, -20], [-8, -18], [25, 10],
    [-20, -10], [15, 20], [-25, 15], [8, 25], [-15, -25],
  ];
  for (const [x, z] of treePositions) {
    collidableMeshes.push(addTree(scene, x + randomRange(-1, 1), z + randomRange(-1, 1)));
  }

  const rockPositions = [
    [6, -8], [-5, 12], [14, -6], [-10, -5], [20, 5],
    [-18, 3], [7, 18], [-7, -12],
  ];
  for (const [x, z] of rockPositions) {
    collidableMeshes.push(addRock(scene, x + randomRange(-0.5, 0.5), z + randomRange(-0.5, 0.5)));
  }

  // Box3 をあらかじめ計算してキャッシュ（静的オブジェクトなので毎フレーム再計算不要）
  const collidableBoxes = collidableMeshes.map(mesh => {
    mesh.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(mesh);
  });

  return { collidableBoxes };
}
