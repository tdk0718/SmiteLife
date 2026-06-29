import * as THREE from 'three';

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function addTree(scene, x, z) {
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B5E3C });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3a7d44 });

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.3, 2, 8),
    trunkMat
  );
  trunk.position.set(x, 1, z);
  trunk.castShadow = true;
  trunk.receiveShadow = true;

  const leaves = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 8, 6),
    leafMat
  );
  leaves.position.set(x, 3.0, z);
  leaves.castShadow = true;

  scene.add(trunk, leaves);
}

function addRock(scene, x, z) {
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const geo = Math.random() > 0.5
    ? new THREE.IcosahedronGeometry(randomRange(0.4, 0.9), 0)
    : new THREE.SphereGeometry(randomRange(0.3, 0.8), 5, 4);

  const rock = new THREE.Mesh(geo, rockMat);
  rock.position.set(x, 0.3, z);
  rock.rotation.set(
    randomRange(0, Math.PI),
    randomRange(0, Math.PI),
    randomRange(0, Math.PI)
  );
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

function addBlacksmith(scene) {
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xc8a96e });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x7a3b1e });
  const chimneyMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const signMat = new THREE.MeshLambertMaterial({ color: 0x8B6914 });
  const anvilMat = new THREE.MeshLambertMaterial({ color: 0x444444 });

  // 壁
  const wall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), wallMat);
  wall.position.set(0, 2, -15);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  // 屋根（ConeGeometryで三角屋根）
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 2.5, 4), roofMat);
  roof.position.set(0, 5.25, -15);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  scene.add(roof);

  // 煙突
  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.35, 2.5, 8),
    chimneyMat
  );
  chimney.position.set(2, 6.0, -16);
  chimney.castShadow = true;
  scene.add(chimney);

  // 看板
  const sign = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 0.1), signMat);
  sign.position.set(0, 3.5, -11.9);
  scene.add(sign);

  // 金床（本体 + 脚）
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
}

export function create(scene) {
  // 太陽光
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(30, 50, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 200;
  dirLight.shadow.camera.left = -60;
  dirLight.shadow.camera.right = 60;
  dirLight.shadow.camera.top = 60;
  dirLight.shadow.camera.bottom = -60;
  scene.add(dirLight);

  const ambLight = new THREE.AmbientLight(0x7090aa, 0.6);
  scene.add(ambLight);

  // 地面
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshLambertMaterial({ color: 0x5a8c3a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // グリッド
  const grid = new THREE.GridHelper(200, 20, 0x000000, 0x000000);
  grid.material.opacity = 0.12;
  grid.material.transparent = true;
  scene.add(grid);

  // 鍛冶場
  addBlacksmith(scene);

  // 木 × 10
  const treePositions = [
    [10, -5], [-12, 8], [18, -20], [-8, -18], [25, 10],
    [-20, -10], [15, 20], [-25, 15], [8, 25], [-15, -25],
  ];
  for (const [x, z] of treePositions) {
    addTree(scene, x + randomRange(-1, 1), z + randomRange(-1, 1));
  }

  // 岩 × 8
  const rockPositions = [
    [6, -8], [-5, 12], [14, -6], [-10, -5], [20, 5],
    [-18, 3], [7, 18], [-7, -12],
  ];
  for (const [x, z] of rockPositions) {
    addRock(scene, x + randomRange(-0.5, 0.5), z + randomRange(-0.5, 0.5));
  }
}
