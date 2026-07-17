using System.Collections.Generic;
using UnityEngine;

// scene.js の移植: チャンクストリーミング式のワールド生成
//   ・シンプレックスFBM地形（尾根・平原マスク・スポーン台地）+ 高さに応じた地表色
//   ・チャンク(50m)ごとに 樹木90〜135本 / 岩54〜90個 / 草クラスター / キノコ9〜27本
//   ・樹木は4種（オーク/松/白樺/ポプラ）、岩は5種（石/鉄/銅/石炭/火打石）
//   ・各ノードは結合メッシュ1つ + ResourceNode + コライダーで構成
public class RuntimeWorldBuilder : MonoBehaviour
{
    public static RuntimeWorldBuilder Instance { get; private set; }

    public Material groundMaterial; // 指定があれば地形のベースに使用（テクスチャは上書き）
    public Material waterMaterial;
    public const float WaterLevel = 0.0f;

    const int ChunkSize = 50;
    const int ChunkSegments = 52;
    // 原典は 2（5x5チャンク）。Unity は GameObject コストが高いため既定 1（3x3 = 150m四方）
    public int viewDistance = 1;

    // ── 山ハイトマップ地形（BackgroundMountainFree ベース）調整用 ──
    const float MountainWorldSpan = 2048f;  // ハイトマップ全体が覆うワールド距離（m）
    const float MountainPeakHeight = 180f;  // 正規化1.0 の高さ（m）
    const float MountainSeaOffset = 45f;     // 全体を下げる量。谷が 0(水面) 付近に来るよう調整
    const float MountainCenterX = 0f;        // 原点に写すハイトマップ上の位置（m オフセット）
    const float MountainCenterZ = 0f;
    const float SpawnFlatRadius = 24f;       // この半径内はスポーン平地（原点高さで平坦化）
    const float SpawnBlendWidth = 32f;       // 平地から山へ遷移する幅（m）
    float _mountainOriginH = float.NaN;      // 原点の山高さ（スポーン平地の基準）キャッシュ
    Material _terrainDrape;                  // 山 ColorMap を貼る共有地形マテリアル

    class Chunk
    {
        public int cx, cz;
        public GameObject root;
    }

    readonly Dictionary<(int, int), Chunk> _chunks = new();
    readonly HashSet<string> _destroyedResourceIds = new();
    int _centerCx = int.MinValue, _centerCz = int.MinValue;

    Transform _placedRoot;
    Transform _chunkRoot;
    Transform _player;

    // ── マテリアル（scene.js と同じ配色） ─────────────
    Material _terrainBase;
    Material _oakBark, _pineBark, _birchBark, _poplarBark, _birchBand, _moss;
    Material[] _oakLeaf, _pineLeaf, _birchLeaf, _poplarLeaf;
    Dictionary<ResourceType, Material[]> _rockMats;
    Dictionary<ResourceType, Material> _veinMats;
    Material[] _grassMats;
    Material _stemMat;

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        _placedRoot = new GameObject("PlacedObjects").transform;
        _chunkRoot = new GameObject("Chunks").transform;
        CreateMaterials();
    }

    void Start()
    {
        CreateWater();
        UpdateChunks(Vector3.zero, force: true);
        BuildStarterHouse();
    }

    void Update()
    {
        if (_player == null)
        {
            _player = GameObject.FindGameObjectWithTag("Player")?.transform;
            if (_player == null) return;
        }
        UpdateChunks(_player.position, force: false);
    }

    // ── 地形関数（scene.js getTerrainHeight の移植） ──
    public float PlainsFactor(float x, float z)
    {
        float n = WorldNoise.Noise2D(x * 0.0032f + 173.3f, z * 0.0032f - 89.7f);
        float t = Mathf.Clamp01((n - 0.02f) / 0.38f);
        return t * t * (3f - 2f * t); // smoothstep
    }

    public float TerrainHeight(float x, float z)
    {
        // 山ハイトマップが利用可能なら、それをベースに地形を作る。
        // スポーン付近(半径 SpawnFlatRadius)は原点高さで平坦化し、外周へ滑らかに山へ接続する。
        if (MountainHeightmap.Available)
        {
            float d = Mathf.Sqrt(x * x + z * z);
            float blend = Mathf.Clamp01((d - SpawnFlatRadius) / SpawnBlendWidth);
            return Mathf.Lerp(MountainOriginHeight(), MountainHeightAt(x, z), blend);
        }
        return ProceduralTerrainHeight(x, z);
    }

    // 山ハイトマップから (x,z) の高さ（m）を返す
    float MountainHeightAt(float x, float z)
    {
        var hm = MountainHeightmap.Instance;
        float u = 0.5f + (x + MountainCenterX) / MountainWorldSpan;
        float v = 0.5f + (z + MountainCenterZ) / MountainWorldSpan;
        return hm.SampleNormalized(u, v) * MountainPeakHeight - MountainSeaOffset;
    }

    float MountainOriginHeight()
    {
        if (float.IsNaN(_mountainOriginH)) _mountainOriginH = MountainHeightAt(0f, 0f);
        return _mountainOriginH;
    }

    // 地形メッシュ用のグローバル UV（高さと同じ写像。色ドレープを形状に一致させる）
    Vector2 MountainUV(float wx, float wz)
    {
        float u = 0.5f + (wx + MountainCenterX) / MountainWorldSpan;
        float v = 0.5f + (wz + MountainCenterZ) / MountainWorldSpan;
        if (MountainHeightmap.FlipV) v = 1f - v;
        return new Vector2(u, v);
    }

    // 山 ColorMap/NormalMap を貼る共有 URP 地形マテリアル（Built-in シェーダーのマゼンタ回避）
    Material TerrainDrapeMaterial()
    {
        if (_terrainDrape != null) return _terrainDrape;
        var col = Resources.Load<Texture2D>("Terrain/MountainColor");
        if (col == null) return null; // 無ければ従来の高さ色テクスチャにフォールバック

        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        var m = new Material(shader);
        if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", col);
        m.mainTexture = col;

        var nrm = Resources.Load<Texture2D>("Terrain/MountainNormal");
        if (nrm != null && m.HasProperty("_BumpMap"))
        {
            m.SetTexture("_BumpMap", nrm);
            m.EnableKeyword("_NORMALMAP");
        }
        if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.1f); // 地面はほぼマット
        _terrainDrape = m;
        return _terrainDrape;
    }

    // 従来の FBM 手続き地形（ハイトマップ未取得時のフォールバック）
    float ProceduralTerrainHeight(float x, float z)
    {
        float d = Mathf.Sqrt(x * x + z * z);
        float blend = Mathf.Clamp01((d - 24f) / 32f);

        float h = WorldNoise.Noise2D(x * 0.006f, z * 0.006f) * 10f;
        h += WorldNoise.Noise2D(x * 0.018f, z * 0.018f) * 4.5f;
        h += WorldNoise.Noise2D(x * 0.056f, z * 0.056f) * 2.2f;
        h += WorldNoise.Noise2D(x * 0.16f, z * 0.16f) * 1.1f;
        h += WorldNoise.Noise2D(x * 0.46f, z * 0.46f) * 0.40f;

        float ridge = 1f - Mathf.Abs(WorldNoise.Noise2D(x * 0.014f + 50f, z * 0.014f + 50f));
        h += ridge * ridge * 5f * blend;

        h += 1.5f;
        h = Mathf.Max(-2.5f, h);

        // 平原マスク: マスクが強い場所は起伏をならして広い平地にする
        float plains = PlainsFactor(x, z);
        if (plains > 0.001f)
        {
            float flatH = 2.4f + WorldNoise.Noise2D(x * 0.012f, z * 0.012f) * 0.5f;
            h = h * (1f - plains) + flatH * plains;
        }

        float spawnPlateau = (1f - blend) * 2.2f;
        return h * blend + spawnPlateau;
    }

    public float GroundHeight(Vector3 p) => TerrainHeight(p.x, p.z);

    public void MarkResourceDestroyed(string nodeId) => _destroyedResourceIds.Add(nodeId);

    // 高さから地表色を返す（heightToRGB の移植）
    static Color HeightColor(float h)
    {
        if (h < -0.8f) return new Color(0.62f, 0.55f, 0.35f); // 川床・砂地
        if (h < 2.0f) return new Color(0.33f, 0.58f, 0.22f);  // 低地の草
        if (h < 7.0f) return new Color(0.38f, 0.54f, 0.25f);  // 平原の草
        if (h < 14.0f) return new Color(0.43f, 0.50f, 0.28f); // 高原の草
        if (h < 22.0f) return new Color(0.52f, 0.48f, 0.40f); // 岩肌混じり
        if (h < 30.0f) return new Color(0.60f, 0.56f, 0.50f); // 岩石帯
        return new Color(0.84f, 0.84f, 0.82f);                // 雪/白岩
    }

    // ── チャンクストリーミング ───────────────────────
    static int WorldToChunk(float v) => Mathf.FloorToInt((v + ChunkSize / 2f) / ChunkSize);

    void UpdateChunks(Vector3 pos, bool force)
    {
        int cx = WorldToChunk(pos.x);
        int cz = WorldToChunk(pos.z);
        if (!force && cx == _centerCx && cz == _centerCz) return;
        _centerCx = cx;
        _centerCz = cz;

        var needed = new HashSet<(int, int)>();
        for (int dz = -viewDistance; dz <= viewDistance; dz++)
        for (int dx = -viewDistance; dx <= viewDistance; dx++)
        {
            var key = (cx + dx, cz + dz);
            needed.Add(key);
            if (!_chunks.ContainsKey(key))
                _chunks[key] = CreateChunk(key.Item1, key.Item2);
        }

        var stale = new List<(int, int)>();
        foreach (var kv in _chunks)
            if (!needed.Contains(kv.Key)) stale.Add(kv.Key);
        foreach (var key in stale)
        {
            Destroy(_chunks[key].root);
            _chunks.Remove(key);
        }
    }

    Chunk CreateChunk(int cx, int cz)
    {
        var rng = new Mulberry32(WorldNoise.HashChunk(cx, cz));
        var root = new GameObject($"chunk-{cx},{cz}");
        root.transform.SetParent(_chunkRoot, false);

        CreateTerrainMesh(root.transform, cx, cz);

        float minX = cx * ChunkSize - ChunkSize / 2f;
        float minZ = cz * ChunkSize - ChunkSize / 2f;

        // 樹木: 実写prefab（LODなし）は重いためチャンクあたり48〜71本に抑える。
        //       密度を戻したい場合はこの2値を増やす（旧: 90 + rng*46）。平原では 75% 間引く
        int treeCount = 48 + (int)(rng.Next() * 24);
        for (int i = 0; i < treeCount; i++)
        {
            string id = $"{cx},{cz}:tree:{i}";
            float x = minX + rng.Range(4, ChunkSize - 4);
            float z = minZ + rng.Range(4, ChunkSize - 4);
            bool skip = _destroyedResourceIds.Contains(id)
                || !IsPlacementAllowed(x, z)
                || (PlainsFactor(x, z) > 0.5f && rng.Next() < 0.75f);
            if (!skip) AddTree(root.transform, x, z, rng, id);
            else ConsumeTreeRng(rng); // 配置スキップでも乱数消費を近づけ、決定論を保つ
        }

        // 岩: 54〜90個
        int rockCount = 54 + (int)(rng.Next() * 37);
        for (int i = 0; i < rockCount; i++)
        {
            string id = $"{cx},{cz}:rock:{i}";
            float x = minX + rng.Range(4, ChunkSize - 4);
            float z = minZ + rng.Range(4, ChunkSize - 4);
            if (!_destroyedResourceIds.Contains(id) && IsPlacementAllowed(x, z))
                AddRock(root.transform, x, z, rng, id);
        }

        // 草: 3〜5クラスター、各6〜12パッチが半径3m以内に密集
        int clusterCount = 3 + (int)(rng.Next() * 3);
        int grassIdx = 0;
        for (int ci = 0; ci < clusterCount; ci++)
        {
            float ccx = minX + rng.Range(5, ChunkSize - 5);
            float ccz = minZ + rng.Range(5, ChunkSize - 5);
            int patchCount = 6 + (int)(rng.Next() * 7);
            for (int pi = 0; pi < patchCount; pi++)
            {
                string id = $"{cx},{cz}:grass:{grassIdx++}";
                float angle = rng.Next() * Mathf.PI * 2f;
                float radius = rng.Next() * 3.0f;
                float x = ccx + Mathf.Cos(angle) * radius;
                float z = ccz + Mathf.Sin(angle) * radius;
                if (_destroyedResourceIds.Contains(id)) continue;
                if (x < minX + 1 || x > minX + ChunkSize - 1 || z < minZ + 1 || z > minZ + ChunkSize - 1) continue;
                if (!IsPlacementAllowed(x, z)) continue;
                AddGrass(root.transform, x, z, rng, id);
            }
        }

        // キノコ: 9〜27本
        int mushCount = 9 + (int)(rng.Next() * 19);
        for (int i = 0; i < mushCount; i++)
        {
            string id = $"{cx},{cz}:mush:{i}";
            float x = minX + rng.Range(2, ChunkSize - 2);
            float z = minZ + rng.Range(2, ChunkSize - 2);
            if (!_destroyedResourceIds.Contains(id) && IsPlacementAllowed(x, z))
                AddMushroom(root.transform, x, z, rng, id);
        }

        return new Chunk { cx = cx, cz = cz, root = root };
    }

    // スポーン地点とデフォルトハウスの敷地には自然物を置かない
    static bool IsPlacementAllowed(float x, float z)
    {
        if (Mathf.Sqrt(x * x + z * z) < 8f) return false;
        if (x > -7.5f && x < 7.5f && z > -19.5f && z < -2.5f) return false;
        return true;
    }

    void ConsumeTreeRng(Mulberry32 rng)
    {
        // AddTree 相当の主要な乱数消費（scale/rotation/builder選択）
        rng.Next(); rng.Next(); rng.Next();
    }

    void CreateTerrainMesh(Transform parent, int cx, int cz)
    {
        float centerX = cx * ChunkSize;
        float centerZ = cz * ChunkSize;
        const int res = ChunkSegments + 1;
        float step = (float)ChunkSize / ChunkSegments;

        var vertices = new Vector3[res * res];
        var uvs = new Vector2[vertices.Length];
        var triangles = new int[ChunkSegments * ChunkSegments * 6];

        // 山 ColorMap を貼れる場合は共有ドレープマテリアル、無ければ従来の高さ色テクスチャ
        var drape = MountainHeightmap.Available ? TerrainDrapeMaterial() : null;
        bool useDrape = drape != null;
        Texture2D tex = useDrape ? null : new Texture2D(res, res, TextureFormat.RGB24, false);

        for (int z = 0; z < res; z++)
        for (int x = 0; x < res; x++)
        {
            float lx = -ChunkSize / 2f + x * step;
            float lz = -ChunkSize / 2f + z * step;
            float wx = centerX + lx;
            float wz = centerZ + lz;
            float h = TerrainHeight(wx, wz);
            int i = z * res + x;
            vertices[i] = new Vector3(lx, h, lz);
            if (useDrape)
            {
                uvs[i] = MountainUV(wx, wz); // 形状と同じ写像で ColorMap を貼る
            }
            else
            {
                uvs[i] = new Vector2((float)x / ChunkSegments, (float)z / ChunkSegments);
                tex.SetPixel(x, z, HeightColor(h));
            }
        }
        if (!useDrape)
        {
            tex.Apply();
            tex.wrapMode = TextureWrapMode.Clamp;
        }

        int t = 0;
        for (int z = 0; z < ChunkSegments; z++)
        for (int x = 0; x < ChunkSegments; x++)
        {
            int i = z * res + x;
            triangles[t++] = i;
            triangles[t++] = i + res;
            triangles[t++] = i + 1;
            triangles[t++] = i + 1;
            triangles[t++] = i + res;
            triangles[t++] = i + res + 1;
        }

        var mesh = new Mesh { name = $"terrain-{cx},{cz}" };
        mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
        mesh.vertices = vertices;
        mesh.uv = uvs;
        mesh.triangles = triangles;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();

        var ground = new GameObject("Terrain");
        ground.transform.SetParent(parent, false);
        ground.transform.localPosition = new Vector3(centerX, 0, centerZ);
        ground.AddComponent<MeshFilter>().sharedMesh = mesh;
        var mat = useDrape ? drape : new Material(_terrainBase) { mainTexture = tex };
        ground.AddComponent<MeshRenderer>().sharedMaterial = mat;
        ground.AddComponent<MeshCollider>().sharedMesh = mesh;
    }

    void CreateWater()
    {
        if (GameObject.Find("Runtime Water") != null) return;
        var water = GameObject.CreatePrimitive(PrimitiveType.Plane);
        water.name = "Runtime Water";
        water.transform.position = new Vector3(0, WaterLevel + 0.02f, 0);
        water.transform.localScale = new Vector3(300, 1, 300); // Plane は 10m 基準 → 3km 四方
        water.GetComponent<Renderer>().sharedMaterial =
            waterMaterial != null ? waterMaterial : MakeTransparentMat(new Color(0.23f, 0.48f, 0.75f, 0.72f));
        Destroy(water.GetComponent<Collider>());
    }

    // ── 樹木 ──────────────────────────────────────────
    // Asset Store「Realistic Tree 9」の prefab（Resources/Trees）を配置する。
    // prefab が無い環境では従来の手続き生成メッシュにフォールバックする。
    GameObject[] _treePrefabs;

    GameObject[] TreePrefabs()
    {
        if (_treePrefabs == null)
            _treePrefabs = Resources.LoadAll<GameObject>("Trees") ?? new GameObject[0];
        return _treePrefabs;
    }

    void AddTree(Transform parent, float x, float z, Mulberry32 rng, string id)
    {
        float y = TerrainHeight(x, z);
        if (y <= 0.35f) { ConsumeTreeRng(rng); return; }

        // ConsumeTreeRng と揃えて必ず3つ消費する（スキップ時と決定論を一致させる）
        float s = rng.Range(0.5f, 2.2f);   // 小さな若木〜大木
        float yaw = rng.Next() * 360f;
        float pick = rng.Next();           // prefab（または樹種）選択

        var prefabs = TreePrefabs();
        if (prefabs.Length == 0)           // prefab 未取り込み時のフォールバック
        {
            BuildProceduralTree(parent, x, z, y, s, yaw, pick, rng, id);
            return;
        }

        var go = new GameObject("Tree");
        go.transform.SetParent(parent, false);
        go.transform.position = new Vector3(x, y, z);
        go.transform.rotation = Quaternion.Euler(0, yaw, 0);

        var prefab = prefabs[Mathf.Clamp((int)(pick * prefabs.Length), 0, prefabs.Length - 1)];
        var visual = Instantiate(prefab, go.transform);
        visual.transform.localPosition = Vector3.zero;
        visual.transform.localRotation = Quaternion.identity;

        // 葉の落下パーティクルは大量配置では非常に重いので停止する
        foreach (var ps in visual.GetComponentsInChildren<ParticleSystem>(true))
        {
            var em = ps.emission; em.enabled = false;
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var psr = ps.GetComponent<ParticleSystemRenderer>();
            if (psr != null) psr.enabled = false;
        }

        // prefab の実寸を測り、ゲーム内スケール（従来の樹高感）へ正規化する
        float targetH = 3.2f * (s / 1.35f); // s=0.5〜2.2 → 約1.2〜5.2m
        float natural = MeasureRendererHeight(visual);
        float f = natural > 0.05f ? targetH / natural : 1f;
        visual.transform.localScale = Vector3.one * f;

        var node = go.AddComponent<ResourceNode>();
        node.type = ResourceType.Wood;
        node.maxHp = Mathf.Max(1, Mathf.RoundToInt(3f * s));
        node.sizeScale = s;
        node.nodeId = id;

        var col = go.AddComponent<CapsuleCollider>();
        col.radius = 0.20f + 0.14f * s;
        col.height = targetH;
        col.center = Vector3.up * targetH * 0.5f;
    }

    // 子の MeshRenderer 群からワールド空間の高さ（Y サイズ）を測る
    static float MeasureRendererHeight(GameObject go)
    {
        var rends = go.GetComponentsInChildren<MeshRenderer>();
        bool has = false;
        Bounds bounds = default;
        foreach (var r in rends)
        {
            if (!has) { bounds = r.bounds; has = true; }
            else bounds.Encapsulate(r.bounds);
        }
        return has ? bounds.size.y : 0f;
    }

    // ── 手続き生成の樹木（scene.js buildOak/Pine/Birch/Poplar の移植・フォールバック） ──
    void BuildProceduralTree(Transform parent, float x, float z, float y,
        float s, float yaw, float species, Mulberry32 rng, string id)
    {
        var go = new GameObject("Tree");
        go.transform.SetParent(parent, false);
        go.transform.position = new Vector3(x, y, z);
        go.transform.rotation = Quaternion.Euler(0, yaw, 0);

        var b = new NodeMeshBuilder();
        float trunkRadius; // 樹種選択（オーク40% / 松30% / 白樺20% / ポプラ10%）
        if (species < 0.40f) trunkRadius = BuildOak(b, s, rng);
        else if (species < 0.70f) trunkRadius = BuildPine(b, s, rng);
        else if (species < 0.90f) trunkRadius = BuildBirch(b, s, rng);
        else trunkRadius = BuildPoplar(b, s, rng);
        b.Apply(go);

        var node = go.AddComponent<ResourceNode>();
        node.type = ResourceType.Wood;
        node.maxHp = Mathf.Max(1, Mathf.RoundToInt(3f * s));
        node.sizeScale = s;
        node.nodeId = id;

        var col = go.AddComponent<CapsuleCollider>();
        col.radius = trunkRadius;
        col.height = 2.6f * s;
        col.center = Vector3.up * 1.3f * s;
    }

    // 幹の根本の広がり（根張り）
    void AddRootFlare(NodeMeshBuilder b, float s, float baseR, Material mat, Mulberry32 rng)
    {
        var geo = ProceduralGeo.Cylinder(baseR * 0.85f, baseR * 1.75f, 0.28f * s, 7).Displace(0.10f, rng);
        b.Add(geo, mat, new Vector3(0, 0.14f * s, 0), Quaternion.identity, Vector3.one);
    }

    // 広葉樹（オーク）: 太い幹 + 枝 + 不定形の樹冠
    float BuildOak(NodeMeshBuilder b, float s, Mulberry32 rng)
    {
        float baseR = 0.24f + 0.14f * s;
        var trunkGeo = ProceduralGeo.Cylinder(0.14f + 0.08f * s, baseR, 2.2f * s, 7).Displace(0.05f, rng);
        b.Add(trunkGeo, _oakBark, new Vector3(0, 1.1f * s, 0),
            Quaternion.Euler(0, 0, (rng.Next() - 0.5f) * 5.7f), Vector3.one);
        AddRootFlare(b, s, baseR, _oakBark, rng);

        int branchCount = 1 + (int)(rng.Next() * 2);
        for (int i = 0; i < branchCount; i++)
        {
            float a = rng.Next() * Mathf.PI * 2f;
            var pos = new Vector3(Mathf.Cos(a) * 0.45f * s, (1.7f + rng.Next() * 0.5f) * s, Mathf.Sin(a) * 0.45f * s);
            var rot = Quaternion.Euler(Mathf.Sin(a) * 57f, 0, Mathf.Cos(a) * 57f);
            b.Add(ProceduralGeo.Cylinder(0.05f * s, 0.09f * s, 1.1f * s, 5), _oakBark, pos, rot, Vector3.one);
        }

        int blobCount = 3 + (int)(rng.Next() * 3);
        for (int i = 0; i < blobCount; i++)
        {
            float br = (0.75f + rng.Next() * 0.55f) * s;
            var geo = ProceduralGeo.Icosahedron(br, 1).Displace(0.16f, rng);
            var pos = new Vector3((rng.Next() - 0.5f) * 1.5f * s, (2.7f + rng.Next() * 0.9f) * s, (rng.Next() - 0.5f) * 1.5f * s);
            var scale = new Vector3(1, 0.75f + rng.Next() * 0.2f, 1);
            b.Add(geo, _oakLeaf[rng.NextInt(_oakLeaf.Length)], pos, Quaternion.Euler(0, rng.Next() * 180f, 0), scale);
        }
        return baseR;
    }

    // 針葉樹（松）: 高い幹 + 円錐を段重ね
    float BuildPine(NodeMeshBuilder b, float s, Mulberry32 rng)
    {
        float baseR = 0.18f + 0.10f * s;
        b.Add(ProceduralGeo.Cylinder(0.10f + 0.05f * s, baseR, 2.8f * s, 7), _pineBark,
            new Vector3(0, 1.4f * s, 0), Quaternion.identity, Vector3.one);
        AddRootFlare(b, s, baseR, _pineBark, rng);

        int tiers = 3 + (int)(rng.Next() * 2);
        var mat = _pineLeaf[rng.NextInt(_pineLeaf.Length)];
        for (int i = 0; i < tiers; i++)
        {
            float t = tiers > 1 ? (float)i / (tiers - 1) : 0f;
            float cr = (1.35f - t * 0.85f) * s * (0.9f + rng.Next() * 0.2f);
            float ch = (1.1f - t * 0.3f) * s;
            var geo = ProceduralGeo.Cone(cr, ch, 9).Displace(0.07f, rng);
            var pos = new Vector3((rng.Next() - 0.5f) * 0.1f * s, (1.7f + i * 0.85f) * s, (rng.Next() - 0.5f) * 0.1f * s);
            b.Add(geo, mat, pos, Quaternion.Euler(0, rng.Next() * 180f, 0), Vector3.one);
        }
        return baseR;
    }

    // 白樺: 細い白い幹（黒い横縞入り） + 小ぶりの明るい樹冠
    float BuildBirch(NodeMeshBuilder b, float s, Mulberry32 rng)
    {
        float baseR = 0.11f + 0.06f * s;
        b.Add(ProceduralGeo.Cylinder(0.07f + 0.04f * s, baseR, 2.7f * s, 7), _birchBark,
            new Vector3(0, 1.35f * s, 0), Quaternion.Euler(0, 0, (rng.Next() - 0.5f) * 4.6f), Vector3.one);
        AddRootFlare(b, s, baseR, _birchBark, rng);

        for (int i = 0; i < 3; i++)
        {
            float a = rng.Next() * Mathf.PI * 2f;
            float bandY = (0.5f + rng.Next() * 1.7f) * s;
            float br = 0.10f + 0.05f * s;
            var pos = new Vector3(Mathf.Cos(a) * br, bandY, Mathf.Sin(a) * br);
            var rot = Quaternion.Euler(0, (-a + Mathf.PI / 2f) * Mathf.Rad2Deg, 0);
            b.Add(ProceduralGeo.Box(0.20f * s + 0.05f, 0.06f * s, 0.02f), _birchBand, pos, rot, Vector3.one);
        }

        int blobCount = 2 + (int)(rng.Next() * 2);
        for (int i = 0; i < blobCount; i++)
        {
            float br = (0.55f + rng.Next() * 0.35f) * s;
            var geo = ProceduralGeo.Icosahedron(br, 1).Displace(0.14f, rng);
            var pos = new Vector3((rng.Next() - 0.5f) * 0.8f * s, (2.6f + rng.Next() * 0.7f) * s, (rng.Next() - 0.5f) * 0.8f * s);
            b.Add(geo, _birchLeaf[rng.NextInt(_birchLeaf.Length)], pos, Quaternion.identity,
                new Vector3(1, 1.05f + rng.Next() * 0.25f, 1));
        }
        return baseR;
    }

    // ポプラ: まっすぐな幹 + 縦長で細い樹冠
    float BuildPoplar(NodeMeshBuilder b, float s, Mulberry32 rng)
    {
        float baseR = 0.15f + 0.08f * s;
        b.Add(ProceduralGeo.Cylinder(0.09f + 0.05f * s, baseR, 1.9f * s, 7), _poplarBark,
            new Vector3(0, 0.95f * s, 0), Quaternion.identity, Vector3.one);
        AddRootFlare(b, s, baseR, _poplarBark, rng);

        var mat = _poplarLeaf[0];
        var crownGeo = ProceduralGeo.Icosahedron(0.85f * s, 1).Displace(0.12f, rng);
        b.Add(crownGeo, mat, new Vector3(0, 2.6f * s, 0), Quaternion.identity,
            new Vector3(0.62f, 1.85f + rng.Next() * 0.3f, 0.62f));
        var crown2 = ProceduralGeo.Icosahedron(0.55f * s, 1).Displace(0.12f, rng);
        b.Add(crown2, mat, new Vector3(0, 1.65f * s, 0), Quaternion.identity, new Vector3(0.75f, 1.0f, 0.75f));
        return baseR;
    }

    // ── 岩（scene.js addRock の移植） ────────────────
    static readonly ResourceType[] RockTypeDist =
    {
        ResourceType.Stone, ResourceType.Stone, ResourceType.Stone, ResourceType.Stone,
        ResourceType.IronRock, ResourceType.IronRock, ResourceType.CopperRock,
        ResourceType.CoalRock, ResourceType.FlintRock,
    };

    static int RockHp(ResourceType t) => t switch
    {
        ResourceType.Stone => 4,
        ResourceType.IronRock => 5,
        ResourceType.CopperRock => 4,
        ResourceType.CoalRock => 3,
        _ => 3, // flint
    };

    // Asset Store「Stones」の FBX メッシュ（Resources/Stones）を岩本体に使う。
    // prefab（モデル）が無い環境では従来の手続き生成メッシュにフォールバックする。
    GameObject[] _stonePrefabs;
    static readonly string[] StoneNames = { "Stone_1", "Stone_2", "Stone_3", "Stone_4", "Stone_5" };

    GameObject[] StonePrefabs()
    {
        if (_stonePrefabs == null)
        {
            var list = new List<GameObject>();
            foreach (var name in StoneNames)
            {
                var m = Resources.Load<GameObject>("Stones/Mesh/" + name);
                if (m != null) list.Add(m);
            }
            _stonePrefabs = list.ToArray();
        }
        return _stonePrefabs;
    }

    // Stones.mat は Built-in Standard シェーダーで URP ではマゼンタになるため、
    // 同梱テクスチャから URP/Lit マテリアルをコードで生成して差し替える。
    Material _stoneMat;

    Material StoneMaterial()
    {
        if (_stoneMat != null) return _stoneMat;
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        var m = new Material(shader);

        var col = Resources.Load<Texture2D>("Stones/Textures/stones_color");
        var nrm = Resources.Load<Texture2D>("Stones/Textures/stones_normal");
        if (col != null)
        {
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", col);
            m.mainTexture = col;
        }
        if (nrm != null && m.HasProperty("_BumpMap"))
        {
            m.SetTexture("_BumpMap", nrm);
            m.EnableKeyword("_NORMALMAP");
        }
        if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", 0.2f); // 岩はほぼマット
        if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 0f);
        _stoneMat = m;
        return _stoneMat;
    }

    void AddRock(Transform parent, float x, float z, Mulberry32 rng, string id)
    {
        float y = TerrainHeight(x, z);
        if (y <= 0.18f) return; // 水中には岩を置かない

        var rockType = RockTypeDist[rng.NextInt(RockTypeDist.Length)];
        float size = rng.Range(0.35f, 2.00f); // 小石〜巨岩

        var go = new GameObject(rockType.ToString());
        go.transform.SetParent(parent, false);
        go.transform.position = new Vector3(x, y, z);
        go.transform.rotation = Quaternion.Euler(0, rng.Next() * 360f, 0);

        var prefabs = StonePrefabs();
        if (prefabs.Length == 0)              // モデル未取り込み時のフォールバック
            BuildProceduralRock(go, rockType, size, y, rng);
        else
            BuildStoneMesh(go, prefabs, rockType, size, y, rng);

        var node = go.AddComponent<ResourceNode>();
        node.type = rockType;
        node.maxHp = Mathf.Max(2, Mathf.RoundToInt(RockHp(rockType) * size));
        node.sizeScale = size;
        node.nodeId = id;

        // 当たり判定は視覚サイズによらず小さなプロキシ球（大岩でも近づける）
        float collRad = Mathf.Min(size * 0.45f, 0.62f);
        var col = go.AddComponent<SphereCollider>();
        col.radius = collRad;
        col.center = new Vector3(0, collRad * 0.6f, 0);
    }

    // リアルな石メッシュを本体にし、鉱石タイプの見分け用に鉱脈オーバーレイを重ねる
    void BuildStoneMesh(GameObject go, GameObject[] prefabs, ResourceType rockType,
        float size, float y, Mulberry32 rng)
    {
        var prefab = prefabs[rng.NextInt(prefabs.Length)];
        var visual = Instantiate(prefab, go.transform);
        visual.transform.localPosition = Vector3.zero;
        visual.transform.localRotation = Quaternion.Euler(
            (rng.Next() - 0.5f) * 26f, rng.Next() * 360f, (rng.Next() - 0.5f) * 26f);

        // URP 用の岩マテリアルへ差し替え（Standard シェーダーのマゼンタ回避）
        var stoneMat = StoneMaterial();
        foreach (var r in visual.GetComponentsInChildren<MeshRenderer>())
            r.sharedMaterial = stoneMat;

        // 実寸を測り、最大寸法が size*1.8 になるよう均一スケール（形状は崩さない）
        var raw = LocalBounds(go.transform, visual);
        float maxDim = Mathf.Max(raw.size.x, Mathf.Max(raw.size.y, raw.size.z));
        float f = maxDim > 0.01f ? size * 1.8f / maxDim : size;
        visual.transform.localScale = Vector3.one * f;

        // スケール後のローカル境界。底を少し地面へ埋めて自然に接地させる
        var lb = LocalBounds(go.transform, visual);
        float offsetY = -lb.min.y - lb.extents.y * 0.22f;
        visual.transform.localPosition = new Vector3(0, offsetY, 0);
        Vector3 c = lb.center + Vector3.up * offsetY;
        Vector3 ext = lb.extents;

        // 鉱脈・苔は結合メッシュ1つの子として重ねる
        var detail = new NodeMeshBuilder();
        bool hasDetail = false;

        // 鉱石タイプは表面に鉱脈の塊を散らす（鉄=橙/銅=緑/石炭=黒/火打石=白）
        if (_veinMats.TryGetValue(rockType, out var veinMat))
        {
            int veinCount = 3 + (int)(rng.Next() * 3);
            for (int i = 0; i < veinCount; i++)
            {
                var geo = ProceduralGeo.Icosahedron(size * (0.12f + rng.Next() * 0.08f), 0);
                float va = rng.Next() * Mathf.PI * 2f;
                float vu = 0.15f + rng.Next() * 0.75f;
                var dir = new Vector3(Mathf.Cos(va) * (1 - vu), vu, Mathf.Sin(va) * (1 - vu)).normalized;
                var pos = c + new Vector3(dir.x * ext.x, dir.y * ext.y, dir.z * ext.z) * 0.92f;
                detail.Add(geo, veinMat, Matrix4x4.TRS(pos,
                    Quaternion.Euler(rng.Next() * 180f, rng.Next() * 180f, 0), Vector3.one));
            }
            hasDetail = true;
        }

        // 草地の石には時々苔が生える
        if (rockType == ResourceType.Stone && y > 0.35f && y < 9f && rng.Next() < 0.45f)
        {
            var mossGeo = ProceduralGeo.Sphere(size * 0.5f, 8, 6);
            var pos = c + Vector3.up * ext.y * 0.55f;
            detail.Add(mossGeo, _moss, Matrix4x4.TRS(pos, Quaternion.identity,
                new Vector3(1.15f, 0.5f, 1.0f)));
            hasDetail = true;
        }

        if (hasDetail)
        {
            var d = new GameObject("Detail");
            d.transform.SetParent(go.transform, false);
            detail.Apply(d);
        }
    }

    // フレーム transform を基準にした子 MeshFilter 群のローカル空間 AABB
    static Bounds LocalBounds(Transform frame, GameObject vis)
    {
        var mfs = vis.GetComponentsInChildren<MeshFilter>();
        bool has = false;
        Bounds b = default;
        foreach (var mf in mfs)
        {
            if (mf.sharedMesh == null) continue;
            var mb = mf.sharedMesh.bounds;
            Vector3 cc = mb.center, e = mb.extents;
            for (int i = 0; i < 8; i++)
            {
                var corner = cc + new Vector3(
                    (i & 1) == 0 ? -e.x : e.x,
                    (i & 2) == 0 ? -e.y : e.y,
                    (i & 4) == 0 ? -e.z : e.z);
                var lp = frame.InverseTransformPoint(mf.transform.TransformPoint(corner));
                if (!has) { b = new Bounds(lp, Vector3.zero); has = true; }
                else b.Encapsulate(lp);
            }
        }
        return has ? b : new Bounds(Vector3.zero, Vector3.zero);
    }

    // ── 手続き生成の岩（scene.js addRock の移植・フォールバック） ──
    void BuildProceduralRock(GameObject go, ResourceType rockType, float size, float y, Mulberry32 rng)
    {
        var b = new NodeMeshBuilder();
        var mats = _rockMats[rockType];
        var mat = mats[rng.NextInt(mats.Length)];

        // 本体: 凹凸をつけた多面体（火打石はより鋭角的）
        var mainGeo = ProceduralGeo.Icosahedron(size, 1)
            .Displace(rockType == ResourceType.FlintRock ? 0.34f : 0.22f, rng);
        var rockScale = new Vector3(1, 0.62f + rng.Next() * 0.35f, 0.75f + rng.Next() * 0.4f);
        var rockTrs = Matrix4x4.TRS(new Vector3(0, size * 0.30f, 0), Quaternion.identity, rockScale);
        b.Add(mainGeo, mat, rockTrs);

        // 根本に転がる小石（1〜2個）
        int sideCount = 1 + (int)(rng.Next() * 2);
        for (int i = 0; i < sideCount; i++)
        {
            float sr = size * (0.20f + rng.Next() * 0.20f);
            var sGeo = ProceduralGeo.Icosahedron(sr, 1).Displace(0.25f, rng);
            float sa = rng.Next() * Mathf.PI * 2f;
            b.Add(sGeo, mats[rng.NextInt(mats.Length)],
                new Vector3(Mathf.Cos(sa) * size * 0.95f, sr * 0.35f, Mathf.Sin(sa) * size * 0.95f),
                Quaternion.identity, new Vector3(1, 0.7f, 1));
        }

        // 鉱石タイプは表面に鉱脈の塊を散らす（rock の潰れ形状に追従）
        if (_veinMats.TryGetValue(rockType, out var veinMat))
        {
            int veinCount = 3 + (int)(rng.Next() * 3);
            for (int i = 0; i < veinCount; i++)
            {
                var geo = ProceduralGeo.Icosahedron(size * (0.12f + rng.Next() * 0.08f), 0);
                float va = rng.Next() * Mathf.PI * 2f;
                float vu = 0.15f + rng.Next() * 0.75f;
                var dir = new Vector3(Mathf.Cos(va) * (1 - vu), vu, Mathf.Sin(va) * (1 - vu)).normalized;
                var local = Matrix4x4.TRS(dir * (size * 0.92f),
                    Quaternion.Euler(rng.Next() * 180f, rng.Next() * 180f, 0), Vector3.one);
                b.Add(geo, veinMat, rockTrs * local);
            }
        }

        // 草地の石には時々苔が生える
        if (rockType == ResourceType.Stone && y > 0.35f && y < 9f && rng.Next() < 0.45f)
        {
            var mossGeo = ProceduralGeo.Sphere(size * 0.55f, 8, 6);
            var local = Matrix4x4.TRS(new Vector3(0, size * 0.72f, 0), Quaternion.identity,
                new Vector3(1.15f, 0.5f, 1.0f));
            b.Add(mossGeo, _moss, rockTrs * local);
        }

        b.Apply(go);
    }

    // ── 草（addGrass の移植） ────────────────────────
    void AddGrass(Transform parent, float x, float z, Mulberry32 rng, string id)
    {
        float y = TerrainHeight(x, z);
        if (y <= 0.35f) return;

        var go = new GameObject("Grass");
        go.transform.SetParent(parent, false);
        go.transform.position = new Vector3(x, y, z);

        var b = new NodeMeshBuilder();
        var mat = _grassMats[rng.NextInt(_grassMats.Length)];
        float bladeH = 0.52f + rng.Next() * 0.10f;
        float bladeW = 0.13f + rng.Next() * 0.06f;
        var bladeGeo = ProceduralGeo.DoublePlane(bladeW, bladeH);
        int bladeCount = 5 + (int)(rng.Next() * 4);
        for (int i = 0; i < bladeCount; i++)
        {
            var pos = new Vector3((rng.Next() - 0.5f) * 0.22f, bladeH * 0.5f, (rng.Next() - 0.5f) * 0.22f);
            var rot = Quaternion.Euler(0, ((float)i / bladeCount * Mathf.PI * 2f + rng.Next() * 0.5f) * Mathf.Rad2Deg,
                (rng.Next() - 0.5f) * 17f);
            b.Add(bladeGeo, mat, pos, rot, Vector3.one);
        }
        b.Apply(go);

        var node = go.AddComponent<ResourceNode>();
        node.type = ResourceType.Grass;
        node.maxHp = 1;
        node.nodeId = id;
        var col = go.AddComponent<SphereCollider>();
        col.radius = 0.5f;
        col.center = Vector3.up * 0.3f;
        col.isTrigger = true;
    }

    // ── キノコ（addMushroom の移植） ─────────────────
    // [タイプ, 傘の色, 斑点色, 斑点数] 出現率 40/25/20/15%
    struct MushroomDef
    {
        public string item;
        public Color cap;
        public Color? spot;
        public int spots;
    }

    static readonly MushroomDef[] MushroomTypes =
    {
        new() { item = "mushroom", cap = new Color(0.83f, 0.63f, 0.31f), spot = null, spots = 0 },
        new() { item = "toxic_mushroom", cap = new Color(0.80f, 0.20f, 0.07f), spot = new Color(1f, 0.98f, 0.80f), spots = 4 },
        new() { item = "anesthetic_mushroom", cap = new Color(0.47f, 0.27f, 0.73f), spot = new Color(0.93f, 0.87f, 1f), spots = 5 },
        new() { item = "medicine_mushroom", cap = new Color(0.20f, 0.73f, 0.33f), spot = new Color(0.67f, 1f, 0.80f), spots = 3 },
    };
    static readonly int[] MushroomWeights = { 40, 25, 20, 15 };

    void AddMushroom(Transform parent, float x, float z, Mulberry32 rng, string id)
    {
        float y = TerrainHeight(x, z);
        if (y <= 0.35f) return;

        int total = 0;
        foreach (int w in MushroomWeights) total += w;
        float pick = rng.Next() * total;
        var def = MushroomTypes[0];
        for (int i = 0; i < MushroomTypes.Length; i++)
        {
            pick -= MushroomWeights[i];
            if (pick <= 0) { def = MushroomTypes[i]; break; }
        }

        var go = new GameObject("Mushroom");
        go.transform.SetParent(parent, false);
        go.transform.position = new Vector3(x, y, z);

        var b = new NodeMeshBuilder();
        var capMat = MakeMat(def.cap, 0.5f);
        float stemH = 0.12f + rng.Next() * 0.08f;
        float capR = 0.10f + rng.Next() * 0.08f;
        b.Add(ProceduralGeo.Cylinder(0.024f, 0.030f, stemH, 6), _stemMat,
            new Vector3(0, stemH / 2f, 0), Quaternion.identity, Vector3.one);
        b.Add(ProceduralGeo.Sphere(capR, 7, 5), capMat,
            new Vector3(0, stemH + capR * 0.35f, 0), Quaternion.identity, new Vector3(1, 0.55f, 1));
        if (def.spot.HasValue && def.spots > 0)
        {
            var spotMat = MakeMat(def.spot.Value, 0.5f);
            var spotGeo = ProceduralGeo.Sphere(0.018f, 5, 4);
            for (int s = 0; s < def.spots; s++)
            {
                float sa = s * (Mathf.PI * 2f / def.spots) + rng.Next() * 0.5f;
                b.Add(spotGeo, spotMat,
                    new Vector3(Mathf.Cos(sa) * capR * 0.55f, stemH + capR * 0.55f, Mathf.Sin(sa) * capR * 0.55f),
                    Quaternion.identity, Vector3.one);
            }
        }
        b.Apply(go);

        var node = go.AddComponent<ResourceNode>();
        node.type = ResourceType.Mushroom;
        node.variantItem = def.item;
        node.maxHp = 1;
        node.nodeId = id;
        var col = go.AddComponent<SphereCollider>();
        col.radius = 0.45f;
        col.center = Vector3.up * 0.2f;
        col.isTrigger = true;
    }

    // ── 設置物（既存 API を維持） ────────────────────
    public GameObject PlaceItem(string itemId, Vector3 position, Quaternion rotation)
    {
        var obj = GameObject.CreatePrimitive(ModelFor(itemId));
        obj.name = "Placed_" + itemId;
        obj.transform.SetParent(_placedRoot);
        obj.transform.SetPositionAndRotation(position, rotation);
        obj.transform.localScale = ScaleFor(itemId);
        obj.GetComponent<Renderer>().material.color = ColorFor(itemId);
        var placed = obj.AddComponent<RuntimePlacedObject>();
        placed.Init(itemId);
        if (itemId == "workbench" || itemId == "furnace" || itemId == "lathe")
        {
            obj.GetComponent<Collider>().isTrigger = true;
            obj.AddComponent<WorkbenchZone>();
        }
        if (itemId == "bed")
        {
            obj.GetComponent<Collider>().isTrigger = true;
            obj.AddComponent<BedZone>();
        }
        if (itemId == "door")
        {
            obj.GetComponent<Collider>().isTrigger = true;
        }
        return obj;
    }

    public void ClearPlacedObjects()
    {
        for (int i = _placedRoot.childCount - 1; i >= 0; i--)
            Destroy(_placedRoot.GetChild(i).gameObject);
    }

    public PlacedObjectDataList SerializePlacedObjects()
    {
        var list = new PlacedObjectDataList();
        foreach (var obj in _placedRoot.GetComponentsInChildren<RuntimePlacedObject>())
        {
            list.items.Add(new PlacedObjectData
            {
                itemId = obj.itemId,
                x = obj.transform.position.x,
                y = obj.transform.position.y,
                z = obj.transform.position.z,
                rotY = obj.transform.eulerAngles.y,
                burning = obj.burning,
                doorOpen = obj.doorOpen,
                burnTimer = obj.burnTimer,
                cookTimer = obj.cookTimer,
                smeltTimer = obj.smeltTimer,
                box = new List<ItemCount>(obj.box),
            });
        }
        return list;
    }

    public void DeserializePlacedObjects(PlacedObjectDataList data)
    {
        if (data == null || data.items.Count == 0) return;
        ClearPlacedObjects();
        foreach (var saved in data.items)
        {
            var obj = PlaceItem(saved.itemId, new Vector3(saved.x, saved.y, saved.z), Quaternion.Euler(0, saved.rotY, 0));
            var placed = obj.GetComponent<RuntimePlacedObject>();
            placed.doorOpen = saved.doorOpen;
            placed.burnTimer = saved.burnTimer;
            placed.cookTimer = saved.cookTimer;
            placed.smeltTimer = saved.smeltTimer;
            placed.box = saved.box ?? new List<ItemCount>();
            if (saved.burning) placed.Ignite();
        }
    }

    // 初回起動: スタート地点にデフォルトの家（柵付き）を建てる（placedObjects.js buildStarterHouse 相当）
    void BuildStarterHouse()
    {
        if (_placedRoot.childCount > 0) return;

        GameObject PlaceOnGround(string id, float x, float z, float yOffset, float rotY = 0f) =>
            PlaceItem(id, new Vector3(x, TerrainHeight(x, z) + yOffset, z), Quaternion.Euler(0, rotY, 0));

        // 柵で囲った庭（南側中央はゲート = ドア）
        for (int x = -2; x <= 2; x++)
        {
            PlaceOnGround("wooden_fence", x * 2f, -17f, 0.55f);
            if (x == 0) PlaceOnGround("door", 0f, -9f, 0.9f); // ゲート
            else PlaceOnGround("wooden_fence", x * 2f, -9f, 0.55f);
        }
        for (int z = -8; z <= -3; z++)
        {
            PlaceOnGround("wooden_fence", -5f, z * 2f + 7f, 0.55f, 90f);
            PlaceOnGround("wooden_fence", 5f, z * 2f + 7f, 0.55f, 90f);
        }

        // 小さな家（床 + 壁 + ドア + 屋根）
        float hx = 0f, hz = -13.5f;
        for (int ix = -1; ix <= 1; ix += 2)
        for (int iz = -1; iz <= 1; iz += 2)
            PlaceOnGround("floor_board", hx + ix * 0.9f, hz + iz * 0.9f, 0.10f);
        for (int ix = -1; ix <= 1; ix += 2)
        {
            PlaceOnGround("wall_panel", hx + ix * 0.9f, hz - 1.8f, 1.0f);
            PlaceOnGround("wall_panel", hx - 1.8f, hz + ix * 0.9f, 1.0f, 90f);
            PlaceOnGround("wall_panel", hx + 1.8f, hz + ix * 0.9f, 1.0f, 90f);
        }
        PlaceOnGround("door", hx - 0.9f, hz + 1.8f, 1.0f);
        PlaceOnGround("window_wall", hx + 0.9f, hz + 1.8f, 1.0f);
        for (int ix = -1; ix <= 1; ix += 2)
        for (int iz = -1; iz <= 1; iz += 2)
            PlaceOnGround("roof_panel", hx + ix * 0.9f, hz + iz * 0.9f, 2.05f);

        PlaceOnGround("workbench", hx - 2.8f, -12f, 0.45f);
        PlaceOnGround("bed", hx + 0.4f, hz - 0.6f, 0.35f);
        PlaceOnGround("torch", hx + 1.6f, -9.6f, 0.6f);

        if (SaveSystem.Instance == null || !SaveSystem.Instance.HasSave())
            RuntimeHud.Toast("🏠 目の前に家が建っている！柵のゲートから入ろう");
    }

    PrimitiveType ModelFor(string itemId) => itemId.Contains("wall") || itemId.Contains("door") ? PrimitiveType.Cube : itemId == "torch" ? PrimitiveType.Cylinder : PrimitiveType.Cube;
    Vector3 ScaleFor(string itemId) => itemId switch
    {
        "wooden_fence" => new Vector3(1.8f, 1.1f, 0.12f),
        "pillar" => new Vector3(0.25f, 1.8f, 0.25f),
        "wall_panel" or "window_wall" or "door_frame_wall" => new Vector3(1.8f, 1.8f, 0.18f),
        "floor_board" or "roof_panel" => new Vector3(1.8f, 0.15f, 1.8f),
        "bed" => new Vector3(1.0f, 0.35f, 2.0f),
        "torch" => new Vector3(0.12f, 1.1f, 0.12f),
        _ => new Vector3(1.0f, 0.7f, 1.0f)
    };
    Color ColorFor(string itemId) => itemId.StartsWith("stone") || itemId == "furnace" ? Color.gray : itemId == "bed" ? new Color(0.5f, 0.2f, 0.2f) : new Color(0.55f, 0.36f, 0.18f);

    // ── マテリアル生成 ───────────────────────────────
    void CreateMaterials()
    {
        _terrainBase = groundMaterial != null ? groundMaterial : MakeMat(Color.white, 0.85f);

        _oakBark = MakeMat(Hex(0x7a5230), 0.7f);
        _pineBark = MakeMat(Hex(0x5e4226), 0.7f);
        _birchBark = MakeMat(Hex(0xd8d2c2), 0.6f);
        _poplarBark = MakeMat(Hex(0x8a6a44), 0.7f);
        _birchBand = MakeMat(Hex(0x3a3630), 0.7f);
        _moss = MakeMat(Hex(0x4a7a35), 0.8f);

        _oakLeaf = new[] { MakeMat(Hex(0x3f7d3a), 0.8f), MakeMat(Hex(0x4c8a3e), 0.8f), MakeMat(Hex(0x35702f), 0.8f) };
        _pineLeaf = new[] { MakeMat(Hex(0x2c5a34), 0.8f), MakeMat(Hex(0x255030), 0.8f) };
        _birchLeaf = new[] { MakeMat(Hex(0x6aa848), 0.8f), MakeMat(Hex(0x7ab652), 0.8f) };
        _poplarLeaf = new[] { MakeMat(Hex(0x4a8a40), 0.8f) };

        _rockMats = new Dictionary<ResourceType, Material[]>
        {
            { ResourceType.Stone, ShadedMats(0x888888) },
            { ResourceType.IronRock, ShadedMats(0x7a6058) },
            { ResourceType.CopperRock, ShadedMats(0x7a6540) },
            { ResourceType.CoalRock, ShadedMats(0x252525, -0.02f, 0f, 0.04f) },
            { ResourceType.FlintRock, ShadedMats(0xb8b0a0) },
        };
        _veinMats = new Dictionary<ResourceType, Material>
        {
            { ResourceType.IronRock, MakeMat(Hex(0xc45a25), 0.5f) },
            { ResourceType.CopperRock, MakeMat(Hex(0x4db07a), 0.5f) },
            { ResourceType.CoalRock, MakeMat(Hex(0x111111), 0.5f) },
            { ResourceType.FlintRock, MakeMat(Hex(0xddd8c8), 0.5f) },
        };

        int[] grassColors = { 0x4a9a2e, 0x52a832, 0x3d8a28, 0x5cb038, 0x45952b };
        _grassMats = new Material[grassColors.Length];
        for (int i = 0; i < grassColors.Length; i++) _grassMats[i] = MakeMat(Hex(grassColors[i]), 0.9f);

        _stemMat = MakeMat(Hex(0xe8e0d0), 0.6f);
    }

    // 明暗3階調のマテリアル（岩肌のフラット陰影感）
    Material[] ShadedMats(int hex, float d0 = -0.05f, float d1 = 0f, float d2 = 0.05f)
    {
        var result = new Material[3];
        float[] deltas = { d0, d1, d2 };
        for (int i = 0; i < 3; i++)
        {
            Color.RGBToHSV(Hex(hex), out float h, out float s, out float v);
            result[i] = MakeMat(Color.HSVToRGB(h, s, Mathf.Clamp01(v + deltas[i])), 0.75f);
        }
        return result;
    }

    static Color Hex(int hex) => new(
        ((hex >> 16) & 0xff) / 255f,
        ((hex >> 8) & 0xff) / 255f,
        (hex & 0xff) / 255f);

    Material MakeMat(Color color, float roughness)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        var mat = new Material(shader);
        mat.color = color;
        if (mat.HasProperty("_Smoothness")) mat.SetFloat("_Smoothness", Mathf.Clamp01(1f - roughness));
        return mat;
    }

    Material MakeTransparentMat(Color color)
    {
        var mat = MakeMat(color, 0.2f);
        if (mat.HasProperty("_Surface"))
        {
            mat.SetFloat("_Surface", 1); // URP Transparent
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            mat.SetInt("_ZWrite", 0);
        }
        mat.color = color;
        return mat;
    }
}

[System.Serializable]
public class PlacedObjectDataList
{
    public List<PlacedObjectData> items = new();
}

public class WorkbenchZone : MonoBehaviour
{
    void OnTriggerStay(Collider other)
    {
        if (other.CompareTag("Player") && CraftingSystem.Instance != null)
        {
            CraftingSystem.Instance.NearWorkbench = true;
            CraftingSystem.Instance.ActiveWorkbench = GetComponent<RuntimePlacedObject>();
        }
    }

    void OnTriggerExit(Collider other)
    {
        if (other.CompareTag("Player") && CraftingSystem.Instance != null)
        {
            CraftingSystem.Instance.NearWorkbench = false;
            if (CraftingSystem.Instance.ActiveWorkbench == GetComponent<RuntimePlacedObject>())
                CraftingSystem.Instance.ActiveWorkbench = null;
        }
    }
}

public class BedZone : MonoBehaviour
{
    void OnTriggerStay(Collider other)
    {
        if (!other.CompareTag("Player")) return;

        // ベッドの近くにいる間は徐々に回復（4 HP/秒）
        var stats = StatsManager.Instance;
        if (stats != null && !stats.IsDead) stats.Heal(4f * Time.deltaTime);

        if (Input.GetKeyDown(KeyCode.E))
        {
            stats?.Respawn();
            var pc = other.GetComponent<PlayerController>();
            if (pc != null)
            {
                var pos = transform.position + Vector3.forward * 1.5f;
                // 地中に湧かないよう地形高さへ持ち上げる
                var rwb = RuntimeWorldBuilder.Instance;
                if (rwb != null)
                {
                    float ground = rwb.GroundHeight(pos);
                    if (pos.y < ground + 1.0f) pos.y = ground + 1.0f;
                }
                pc.WarpTo(pos);
            }
        }
    }
}
