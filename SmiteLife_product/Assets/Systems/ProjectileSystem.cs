using System.Collections.Generic;
using UnityEngine;

// 投擲物・餌・火球・燃える木の管理（projectile.js + main.js の燃焼処理の移植）
// 物理は Rigidbody ではなく手動シミュレーション（地形高さ判定 + 敵への距離判定）
public class ProjectileSystem : MonoBehaviour
{
    public static ProjectileSystem Instance { get; private set; }

    const float Gravity = -18f;
    const float BaitLife = 45f;       // 餌の消滅までの秒数
    const float FireballDamage = 16f;
    const float FireballRadius = 2.4f;
    const float FireballLife = 3.2f;

    // アイテムごとの投擲ダメージ
    public static readonly Dictionary<string, float> ThrowDamage = new()
    {
        { "stone", 8 }, { "stone_block", 14 }, { "flint", 6 }, { "coal", 5 }, { "iron_ore", 7 }, { "copper_ore", 6 },
        { "wood", 4 }, { "straw", 2 }, { "plank", 5 },
        { "wooden_fence", 5 }, { "pillar", 4 }, { "floor_board", 3 }, { "wall_panel", 4 },
        { "stone_axe", 12 }, { "stone_pickaxe", 12 }, { "stone_knife", 9 }, { "torch", 5 },
        { "meat", 2 }, { "raw_fish", 2 }, { "cooked_meat", 2 }, { "cooked_fish", 2 }, { "mushroom", 1 }, { "fur", 1 },
        { "arrow", 20 },
    };

    // 餌として機能するアイテム
    public static readonly HashSet<string> BaitItems = new() { "meat", "raw_fish", "cooked_meat", "cooked_fish" };

    public class Bait
    {
        public string itemId;
        public Vector3 pos;
        public GameObject mesh;
        public float timer = BaitLife;
        public bool alive = true;
    }

    class Projectile
    {
        public string itemId;
        public GameObject mesh;
        public Vector3 pos;
        public Vector3 vel;
        public float age;
        public bool alive = true;
        public bool isArrow;
        public bool isFireball;
        public float fbDamage, fbRadius;
        public Light light;
    }

    class FireBurst
    {
        public GameObject mesh;
        public float age;
        public float life = 0.45f;
        public Light light;
        public float lightBase = 3.4f;
        public List<Renderer> fades = new();
    }

    // 燃えている木ノード
    class BurningNode
    {
        public ResourceNode node;
        public GameObject flames;
        public Light light;
        public float burnTimer;
        public float damageTimer;
    }

    readonly List<Projectile> _projectiles = new();
    readonly List<Bait> _baits = new();
    readonly List<FireBurst> _bursts = new();
    readonly List<BurningNode> _burning = new();

    Shader _shader;

    // Vefects 炎 VFX を URP 用に描画するためのマテリアル（テクスチャから実行時生成）
    Material _fireMat, _glowMat, _emberMat, _smokeMat;

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
    }

    float TerrainHeight(float x, float z) =>
        RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.TerrainHeight(x, z) : 0f;

    // ── 発射 API ──────────────────────────────────
    // アイテムを投げる / 矢を射る。dirFlat は水平方向（正規化不要）、pitch は仰角ラジアン。
    public void ThrowItem(string itemId, Vector3 origin, Vector3 dirFlat, float pitch = 0.32f, float speed = 14f)
    {
        dirFlat.y = 0;
        if (dirFlat.sqrMagnitude < 0.0001f) dirFlat = Vector3.forward;
        dirFlat.Normalize();
        var mesh = BuildMesh(itemId);
        mesh.transform.position = origin + Vector3.up * 0.1f;
        var vel = dirFlat * (Mathf.Cos(pitch) * speed) + Vector3.up * (Mathf.Sin(pitch) * speed);
        _projectiles.Add(new Projectile
        {
            itemId = itemId,
            mesh = mesh,
            pos = mesh.transform.position,
            vel = vel,
            isArrow = itemId == "arrow",
            light = mesh.GetComponentInChildren<Light>(),
        });
    }

    public void ThrowItemDirected(string itemId, Vector3 origin, Vector3 dir, float speed = 14f)
    {
        if (dir.sqrMagnitude < 0.0001f) dir = Vector3.forward;
        dir.Normalize();
        var mesh = BuildMesh(itemId);
        mesh.transform.position = origin + dir * 0.25f;
        _projectiles.Add(new Projectile
        {
            itemId = itemId,
            mesh = mesh,
            pos = mesh.transform.position,
            vel = dir * speed,
            isArrow = itemId == "arrow",
            light = mesh.GetComponentInChildren<Light>(),
        });
    }

    // charge: 0〜1（Rキーの長押しで溜めた力）。大きいほど巨大・高威力・広範囲になる
    public static (float scale, float damage, float radius, float speed) FireballStats(float charge)
    {
        float c = Mathf.Clamp01(charge);
        return (1f + c * 1.8f,
                FireballDamage * (1f + c * 2.0f),
                FireballRadius * (1f + c * 1.1f),
                28f - c * 8f);
    }

    public void CastFireball(Vector3 origin, Vector3 dir, float charge)
    {
        var (scale, damage, radius, speed) = FireballStats(charge);
        var mesh = BuildMesh("fireball");
        mesh.transform.localScale = Vector3.one * scale;
        mesh.transform.position = origin;
        _projectiles.Add(new Projectile
        {
            itemId = "fireball",
            mesh = mesh,
            pos = origin,
            vel = dir.normalized * speed,
            isFireball = true,
            fbDamage = damage,
            fbRadius = radius,
            light = mesh.GetComponentInChildren<Light>(),
        });
    }

    // ── 餌 ────────────────────────────────────────
    public List<Bait> GetBaits()
    {
        var list = new List<Bait>();
        foreach (var b in _baits)
            if (b.alive) list.Add(b);
        return list;
    }

    public void ConsumeBait(Bait bait)
    {
        if (bait == null || !bait.alive) return;
        bait.alive = false;
        if (bait.mesh != null) Destroy(bait.mesh);
    }

    // ── 燃える木 ──────────────────────────────────
    public void IgniteNode(ResourceNode node)
    {
        if (node == null || !node.Alive) return;
        foreach (var b in _burning)
            if (b.node == node) return;

        // 木のサイズに合わせた Vefects 炎 VFX（prefab 未取り込み時はカプセル炎）
        float scale = 0.8f * Mathf.Clamp(node.sizeScale, 0.6f, 2.2f);
        var g = SpawnFireVfx("VFX_Fire_01_Medium", scale) ?? BuildProceduralFlames();
        g.name = "Flames";
        g.transform.SetParent(node.transform, false);
        g.transform.localPosition = Vector3.up * 0.15f;

        var lightObj = new GameObject("FireLight");
        lightObj.transform.SetParent(g.transform, false);
        lightObj.transform.localPosition = Vector3.up * 1.5f;
        var light = lightObj.AddComponent<Light>();
        light.type = LightType.Point;
        light.color = new Color(1f, 0.33f, 0f);
        light.intensity = 2.5f;
        light.range = 9f;

        _burning.Add(new BurningNode { node = node, flames = g, light = light });
    }

    // ── Vefects 炎 VFX（HDRP アセットを URP マテリアルで描画） ──
    // Resources/VFX の炎 prefab を生成し、各パーティクルのマテリアルを
    // 名前に応じて URP マテリアルへ差し替える（HDRP シェーダーのマゼンタ回避）。
    GameObject SpawnFireVfx(string prefabName, float scale)
    {
        var prefab = Resources.Load<GameObject>("VFX/" + prefabName);
        if (prefab == null) return null;

        var go = Instantiate(prefab);
        go.transform.localScale = Vector3.one * Mathf.Max(0.05f, scale);
        EnsureFireMats();

        foreach (var r in go.GetComponentsInChildren<ParticleSystemRenderer>(true))
        {
            string n = r.transform.name.ToLowerInvariant();
            if (n.Contains("distortion") || n.Contains("haze")) { r.enabled = false; continue; } // URP に歪みなし
            Material m;
            if (n.Contains("smoke")) m = _smokeMat;
            else if (n.Contains("ash") || n.Contains("spark")) m = _emberMat;
            else if (n.Contains("light") || n.Contains("glow")) m = _glowMat;
            else m = _fireMat; // Flames / Flames Secondary / その他
            r.sharedMaterial = m;
            if (r.trailMaterial != null) r.trailMaterial = m;
        }
        return go;
    }

    void EnsureFireMats()
    {
        if (_fireMat != null) return;
        _fireMat = BuildParticleMat("T_VFX_Fire_Mask_01", additive: true);
        _glowMat = BuildParticleMat("T_VFX_Glow_01", additive: true);
        _emberMat = BuildParticleMat("T_VFX_Ashes_01", additive: true);
        _smokeMat = BuildParticleMat("T_VFX_Smoke_01", additive: false);
    }

    Material BuildParticleMat(string texName, bool additive)
    {
        var shader = Shader.Find("Universal Render Pipeline/Particles/Unlit");
        if (shader == null) shader = Shader.Find("Universal Render Pipeline/Unlit");
        var m = new Material(shader);

        var tex = Resources.Load<Texture2D>("VFX/" + texName);
        if (tex != null)
        {
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", tex);
            m.mainTexture = tex;
        }
        if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", Color.white);

        // 透過（加算 or アルファ）設定
        if (m.HasProperty("_Surface")) m.SetFloat("_Surface", 1);
        m.SetOverrideTag("RenderType", "Transparent");
        m.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        if (m.HasProperty("_ZWrite")) m.SetFloat("_ZWrite", 0);
        m.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
        m.SetInt("_DstBlend", additive
            ? (int)UnityEngine.Rendering.BlendMode.One
            : (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        if (m.HasProperty("_Blend")) m.SetFloat("_Blend", additive ? 2f : 0f);
        m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        return m;
    }

    // prefab 未取り込み時のフォールバック（従来のカプセル炎）
    GameObject BuildProceduralFlames()
    {
        var g = new GameObject("Flames");
        Color[] colors = { new(1f, 0.27f, 0f), new(1f, 0.53f, 0f), new(1f, 0.8f, 0f) };
        for (int i = 0; i < 7; i++)
        {
            float h = 0.5f + Random.value * 0.7f;
            var cone = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            Destroy(cone.GetComponent<Collider>());
            cone.transform.SetParent(g.transform, false);
            float a = i / 7f * Mathf.PI * 2f;
            cone.transform.localPosition = new Vector3(Mathf.Cos(a) * 0.3f, h * 0.5f, Mathf.Sin(a) * 0.3f);
            cone.transform.localScale = new Vector3(0.3f, h * 0.5f, 0.3f);
            cone.GetComponent<Renderer>().material = UnlitMat(colors[i % 3], 0.9f);
        }
        return g;
    }

    public List<Vector3> GetBurningNodePositions()
    {
        var list = new List<Vector3>();
        foreach (var b in _burning)
            if (b.node != null && b.node.Alive) list.Add(b.node.transform.position);
        return list;
    }

    // ── 更新 ──────────────────────────────────────
    void Update()
    {
        float delta = Time.deltaTime;
        var enemies = EnemyManager.Instance != null ? EnemyManager.Instance.Enemies : null;

        for (int i = _projectiles.Count - 1; i >= 0; i--)
        {
            var p = _projectiles[i];
            if (!p.alive) { _projectiles.RemoveAt(i); continue; }
            p.age += delta;
            if (p.age > (p.isFireball ? FireballLife : 10f)) { KillProjectile(p); continue; }

            p.vel.y += Gravity * (p.isFireball ? 0.08f : 1f) * delta;
            p.pos += p.vel * delta;
            p.mesh.transform.position = p.pos;

            if (p.isFireball)
            {
                p.mesh.transform.Rotate(0, 9f * delta * Mathf.Rad2Deg, 5f * delta * Mathf.Rad2Deg, Space.Self);
                if (p.light != null) p.light.intensity = 1.6f + Mathf.Sin(p.age * 28f) * 0.6f;
            }
            else if (p.isArrow)
            {
                // 矢は速度方向に向ける
                if (p.vel.sqrMagnitude > 0.01f)
                    p.mesh.transform.rotation = Quaternion.LookRotation(p.vel);
            }
            else
            {
                p.mesh.transform.Rotate(6f * delta * Mathf.Rad2Deg, 0, 3f * delta * Mathf.Rad2Deg, Space.Self);
            }

            // 地形衝突
            float gy = TerrainHeight(p.pos.x, p.pos.z);
            if (p.pos.y <= gy + 0.05f)
            {
                var impact = new Vector3(p.pos.x, gy + 0.05f, p.pos.z);
                if (p.isFireball) ExplodeFireball(p, impact, enemies);
                if (BaitItems.Contains(p.itemId))
                {
                    AddBait(impact, p.itemId);
                    RuntimeHud.Toast("🥩 餌を置いた（動物が近づいてくるかも）");
                }
                KillProjectile(p);
                continue;
            }

            // 敵への命中判定
            if (enemies != null)
            {
                foreach (var e in enemies)
                {
                    if (e == null || !e.alive || e.tamed) continue;
                    Vector3 center = e.transform.position + Vector3.up * 0.55f * e.baseScale;
                    if (Vector3.Distance(p.pos, center) < 0.65f * e.baseScale)
                    {
                        if (p.isFireball)
                        {
                            ExplodeFireball(p, p.pos, enemies);
                        }
                        else
                        {
                            float dmg = ThrowDamage.TryGetValue(p.itemId, out float d) ? d : 2f;
                            e.TakeDamage(dmg);
                        }
                        KillProjectile(p);
                        break;
                    }
                }
            }
        }

        // 餌のタイマー更新
        for (int i = _baits.Count - 1; i >= 0; i--)
        {
            var b = _baits[i];
            if (!b.alive) { _baits.RemoveAt(i); continue; }
            b.timer -= delta;
            if (b.mesh != null) b.mesh.transform.Rotate(0, delta * 1.2f * Mathf.Rad2Deg, 0); // ゆっくり回転
            if (b.timer <= 0) { ConsumeBait(b); _baits.RemoveAt(i); }
        }

        // 着弾炎エフェクトのフェード
        for (int i = _bursts.Count - 1; i >= 0; i--)
        {
            var burst = _bursts[i];
            burst.age += delta;
            float t = Mathf.Min(1f, burst.age / burst.life);
            // カプセル炎（フォールバック）のみ成長＆アルファフェード。VFX はパーティクル任せ
            if (burst.fades.Count > 0)
            {
                burst.mesh.transform.localScale = Vector3.one * (1f + t * 0.5f);
                foreach (var r in burst.fades)
                {
                    if (r == null) continue;
                    var c = r.material.color;
                    c.a *= 0.88f;
                    r.material.color = c;
                }
            }
            if (burst.light != null) burst.light.intensity = Mathf.Max(0f, burst.lightBase * (1f - t));
            if (burst.age >= burst.life)
            {
                Destroy(burst.mesh);
                _bursts.RemoveAt(i);
            }
        }

        // 燃えている木の更新（炎アニメ＋定期ダメージ）
        for (int i = _burning.Count - 1; i >= 0; i--)
        {
            var burn = _burning[i];
            if (burn.node == null || !burn.node.Alive)
            {
                if (burn.flames != null) Destroy(burn.flames);
                _burning.RemoveAt(i);
                continue;
            }
            burn.burnTimer += delta;
            burn.damageTimer += delta;
            if (burn.light != null) burn.light.intensity = 2.0f + Mathf.Sin(burn.burnTimer * 7f) * 0.9f;
            if (burn.damageTimer >= 1.8f)
            {
                burn.damageTimer = 0;
                burn.node.TakeDamage(2);
            }
        }
    }

    void ExplodeFireball(Projectile p, Vector3 impact, IReadOnlyList<EnemyAI> enemies)
    {
        AddFireBurst(impact, p.fbRadius);
        if (enemies != null)
        {
            // 一旦リスト化（TakeDamage で死亡→リスト変更が起きるため）
            var targets = new List<EnemyAI>();
            foreach (var t in enemies)
            {
                if (t == null || !t.alive || t.tamed) continue;
                float dist = Vector2.Distance(new Vector2(impact.x, impact.z),
                    new Vector2(t.transform.position.x, t.transform.position.z));
                if (dist <= p.fbRadius * t.baseScale) targets.Add(t);
            }
            foreach (var t in targets) t.TakeDamage(p.fbDamage);
        }
        // 着弾位置周辺の木を着火
        foreach (var node in FindObjectsByType<ResourceNode>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
        {
            if (node.type != ResourceType.Wood || !node.Alive) continue;
            float dist = Vector2.Distance(new Vector2(impact.x, impact.z),
                new Vector2(node.transform.position.x, node.transform.position.z));
            if (dist <= p.fbRadius) IgniteNode(node);
        }
    }

    void KillProjectile(Projectile p)
    {
        p.alive = false;
        if (p.mesh != null) Destroy(p.mesh);
    }

    void AddBait(Vector3 pos, string itemId)
    {
        var mesh = BuildMesh(itemId);
        mesh.transform.position = pos;
        _baits.Add(new Bait { itemId = itemId, pos = pos, mesh = mesh });
    }

    void AddFireBurst(Vector3 pos, float radius)
    {
        float rScale = radius / FireballRadius;

        // Vefects の大型炎 VFX を一瞬だけ再生して爆炎を表現
        var g = SpawnFireVfx("VFX_Fire_01_Big", rScale);
        FireBurst burst;
        if (g != null)
        {
            g.name = "FireBurst";
            burst = new FireBurst { mesh = g, life = 0.85f };
        }
        else
        {
            // フォールバック: 従来のカプセル炎
            g = new GameObject("FireBurst");
            burst = new FireBurst { mesh = g };
            Color[] colors = { new(1f, 0.95f, 0.65f), new(1f, 0.54f, 0.11f), new(0.85f, 0.23f, 0.07f) };
            for (int i = 0; i < 9; i++)
            {
                var flame = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                Destroy(flame.GetComponent<Collider>());
                flame.transform.SetParent(g.transform, false);
                float a = i / 9f * Mathf.PI * 2f;
                float r = 0.18f + Random.value * 0.42f;
                flame.transform.localPosition = new Vector3(Mathf.Cos(a) * r, 0.25f + Random.value * 0.15f, Mathf.Sin(a) * r);
                flame.transform.localRotation = Quaternion.Euler(Random.value * 26f, 0, -20f + Random.value * 40f);
                flame.transform.localScale = new Vector3(0.24f + Random.value * 0.16f, (0.45f + Random.value * 0.35f) * 0.5f, 0.24f);
                var renderer = flame.GetComponent<Renderer>();
                renderer.material = UnlitMat(colors[i % colors.Length], 0.86f);
                burst.fades.Add(renderer);
            }
            g.transform.localScale = Vector3.one * rScale;
        }
        g.transform.position = pos;

        var lightObj = new GameObject("BurstLight");
        lightObj.transform.SetParent(g.transform, false);
        lightObj.transform.localPosition = Vector3.up * 0.8f;
        burst.light = lightObj.AddComponent<Light>();
        burst.light.type = LightType.Point;
        burst.light.color = new Color(1f, 0.42f, 0.10f);
        burst.light.intensity = 3.4f * rScale;
        burst.light.range = 10f * rScale;
        burst.lightBase = burst.light.intensity;
        _bursts.Add(burst);
    }

    // ── 投擲物のビジュアル ─────────────────────────
    GameObject BuildMesh(string itemId)
    {
        GameObject g;
        if (itemId == "fireball")
        {
            g = new GameObject("Projectile_fireball");
            AddSphere(g.transform, 0.13f, UnlitMat(new Color(1f, 0.94f, 0.63f)));
            var flame = AddSphere(g.transform, 0.24f, UnlitMat(new Color(1f, 0.35f, 0.09f), 0.82f));
            flame.transform.localScale = new Vector3(0.53f, 0.41f, 0.65f);
            AddSphere(g.transform, 0.42f, UnlitMat(new Color(1f, 0.67f, 0.13f), 0.34f));
            var lightObj = new GameObject("Light");
            lightObj.transform.SetParent(g.transform, false);
            var light = lightObj.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = new Color(1f, 0.48f, 0.13f);
            light.intensity = 2.2f;
            light.range = 8f;
            return g;
        }
        if (itemId == "arrow")
        {
            g = new GameObject("Projectile_arrow");
            var shaft = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            Destroy(shaft.GetComponent<Collider>());
            shaft.transform.SetParent(g.transform, false);
            shaft.transform.localRotation = Quaternion.Euler(90f, 0, 0);
            shaft.transform.localScale = new Vector3(0.032f, 0.26f, 0.032f);
            shaft.GetComponent<Renderer>().material = LitMat(new Color(0.545f, 0.37f, 0.235f));
            var tip = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Destroy(tip.GetComponent<Collider>());
            tip.transform.SetParent(g.transform, false);
            tip.transform.localPosition = new Vector3(0, 0, 0.31f);
            tip.transform.localRotation = Quaternion.Euler(45f, 0, 45f);
            tip.transform.localScale = Vector3.one * 0.05f;
            tip.GetComponent<Renderer>().material = LitMat(new Color(0.53f, 0.53f, 0.50f));
            return g;
        }

        g = GameObject.CreatePrimitive(PickShape(itemId));
        Destroy(g.GetComponent<Collider>());
        g.name = "Projectile_" + itemId;
        g.transform.localScale = PickScale(itemId);
        g.GetComponent<Renderer>().material = LitMat(PickColor(itemId));
        return g;
    }

    static PrimitiveType PickShape(string itemId)
    {
        if (itemId == "wood" || itemId == "plank") return PrimitiveType.Cube;
        if (itemId == "torch") return PrimitiveType.Cylinder;
        if (BaitItems.Contains(itemId)) return PrimitiveType.Sphere;
        if (itemId == "stone" || itemId == "stone_block" || itemId == "flint"
            || itemId == "coal" || itemId == "iron_ore" || itemId == "copper_ore") return PrimitiveType.Sphere;
        return PrimitiveType.Cube;
    }

    static Vector3 PickScale(string itemId) => itemId switch
    {
        "wood" or "plank" => new Vector3(0.22f, 0.10f, 0.30f),
        "torch" => new Vector3(0.08f, 0.14f, 0.08f),
        "stone" or "stone_block" or "flint" => Vector3.one * 0.26f,
        "coal" or "iron_ore" or "copper_ore" => Vector3.one * 0.22f,
        _ => BaitItems.Contains(itemId) ? Vector3.one * 0.2f : Vector3.one * 0.14f,
    };

    static Color PickColor(string itemId)
    {
        if (itemId == "coal") return new Color(0.10f, 0.10f, 0.10f);
        if (itemId == "iron_ore" || itemId == "copper_ore") return new Color(0.48f, 0.375f, 0.25f);
        if (itemId == "wood" || itemId == "plank" || itemId == "torch") return new Color(0.545f, 0.37f, 0.235f);
        if (BaitItems.Contains(itemId))
            return itemId.StartsWith("cooked") ? new Color(0.815f, 0.375f, 0.19f) : new Color(0.72f, 0.25f, 0.25f);
        if (itemId.Contains("stone") || itemId == "flint") return new Color(0.53f, 0.53f, 0.53f);
        return new Color(0.67f, 0.67f, 0.67f);
    }

    GameObject AddSphere(Transform parent, float radius, Material mat)
    {
        var s = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        Destroy(s.GetComponent<Collider>());
        s.transform.SetParent(parent, false);
        s.transform.localScale = Vector3.one * radius * 2f;
        s.GetComponent<Renderer>().sharedMaterial = mat;
        return s;
    }

    Material LitMat(Color c)
    {
        EnsureShader();
        return new Material(_shader) { color = c };
    }

    Material UnlitMat(Color c, float alpha = 1f)
    {
        var shader = Shader.Find("Universal Render Pipeline/Unlit");
        if (shader == null) shader = Shader.Find("Unlit/Color");
        var mat = new Material(shader);
        c.a = alpha;
        mat.color = c;
        if (alpha < 1f && mat.HasProperty("_Surface"))
        {
            // URP Unlit を透過モードへ
            mat.SetFloat("_Surface", 1);
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            mat.SetInt("_SrcBlend", (int)UnityEngine.Rendering.BlendMode.SrcAlpha);
            mat.SetInt("_DstBlend", (int)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
        }
        return mat;
    }

    void EnsureShader()
    {
        if (_shader != null) return;
        _shader = Shader.Find("Universal Render Pipeline/Lit");
        if (_shader == null) _shader = Shader.Find("Standard");
    }
}
