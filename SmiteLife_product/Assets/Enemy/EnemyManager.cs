using System.Collections.Generic;
using UnityEngine;

// 敵/動物の全体管理（enemy.js の create() が持っていたスポーン・繁殖・命令の移植）
public class EnemyManager : MonoBehaviour
{
    public static EnemyManager Instance { get; private set; }

    const int MaxEnemies = 10;
    const float SpawnInterval = 4f;
    const float SpawnMinDist = 22f;
    const float SpawnMaxDist = 34f;
    const float DespawnDist = 90f;
    const float PlayerFireSafe = 7f;

    // 繁殖・赤ちゃん
    const int BreedLevel = 4;    // 繁殖に必要なテイムレベル
    const float BreedRange = 10f;

    float DayLength => FindAnyObjectByType<DayNightWeatherSystem>()?.dayLengthSeconds ?? 3600f;
    public float BabyGrowTime => DayLength;          // 1日かけて大人に成長
    float PregnancyTime => DayLength * 2f;           // 妊娠期間: 2日で出産
    float BreedCooldown => DayLength;                // 出産後、次の妊娠までのクールダウン

    readonly List<EnemyAI> _enemies = new();
    readonly List<Vector3> _fires = new();

    float _spawnTimer = SpawnInterval * 0.5f;
    float _breedTimer = 5f;
    float _fireRefreshTimer;

    public IReadOnlyList<EnemyAI> Enemies => _enemies;
    public IReadOnlyList<Vector3> FirePositions => _fires;
    public bool PlayerNearFire { get; private set; }
    public bool PlayerDodging { get; private set; }
    public Transform Player { get; private set; }

    // 仲間への全体命令: 'attack'（攻撃する・デフォルト）| 'passive'（攻撃しない）
    public string TamedOrder { get; private set; } = "attack";
    // 仲間への移動命令: 'follow'（追従・デフォルト）| 'roam'（放浪）
    public string TamedMove { get; private set; } = "follow";

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
    }

    void Update()
    {
        if (Player == null)
        {
            Player = GameObject.FindGameObjectWithTag("Player")?.transform;
            if (Player == null) return;
        }
        PlayerDodging = Player.GetComponent<PlayerController>()?.IsDodging == true;

        float delta = Time.deltaTime;
        Vector3 playerPos = Player.position;

        // 燃えている火の一覧（燃焼中の木 + 焚き火）を定期更新
        _fireRefreshTimer -= delta;
        if (_fireRefreshTimer <= 0)
        {
            _fireRefreshTimer = 0.5f;
            RefreshFires(playerPos);
        }

        // スポーン
        _spawnTimer -= delta;
        if (_spawnTimer <= 0)
        {
            _spawnTimer = SpawnInterval;
            int hostileCount = 0;
            foreach (var e in _enemies)
                if (e != null && e.alive && !e.tamed) hostileCount++;
            if (hostileCount < MaxEnemies) SpawnAroundPlayer(playerPos);
        }

        // 遠すぎる非テイム個体はデスポーン
        for (int i = _enemies.Count - 1; i >= 0; i--)
        {
            var e = _enemies[i];
            if (e == null || !e.alive) { _enemies.RemoveAt(i); continue; }
            if (!e.tamed && e.FlatDist(playerPos) > DespawnDist) e.Kill();
        }

        // 繁殖判定（数秒おき）: テイム済み・Lv4以上のオスとメスが近くに揃うとメスが妊娠
        _breedTimer -= delta;
        if (_breedTimer <= 0)
        {
            _breedTimer = 3f;
            foreach (var f in _enemies)
            {
                if (!f.alive || !f.tamed || f.baby) continue;
                if (f.sex != "female" || f.pregnant || f.breedCd > 0 || f.tamedLevel < BreedLevel) continue;
                foreach (var m in _enemies)
                {
                    if (!m.alive || !m.tamed || m.baby || m.sex != "male") continue;
                    if (m.type.id != f.type.id || m.tamedLevel < BreedLevel) continue;
                    if (m.FlatDist(f.transform.position) < BreedRange)
                    {
                        MarkPregnant(f);
                        break;
                    }
                }
            }
        }

        // 仲間への命令キー（P: 攻撃許可/禁止, O: 追従/放浪）
        if (Input.GetKeyDown(KeyCode.P))
        {
            if (GetTamedAnimals().Count > 0)
            {
                TamedOrder = TamedOrder == "attack" ? "passive" : "attack";
                RuntimeHud.Toast(TamedOrder == "attack"
                    ? "🗡 仲間への命令: 攻撃を許可（敵を見つけたら戦う）"
                    : "🕊 仲間への命令: 攻撃禁止（そばで待機する）");
                SaveSystem.Instance?.Save();
            }
            else RuntimeHud.Toast("🐺 命令できる仲間がいない");
        }
        if (Input.GetKeyDown(KeyCode.O))
        {
            if (GetTamedAnimals().Count > 0)
            {
                TamedMove = TamedMove == "follow" ? "roam" : "follow";
                RuntimeHud.Toast(TamedMove == "follow"
                    ? "🐾 仲間への命令: 追従モード（そばについてくる）"
                    : "🌏 仲間への命令: 放浪モード（その場周辺で自由に過ごす）");
                SaveSystem.Instance?.Save();
            }
            else RuntimeHud.Toast("🐺 命令できる仲間がいない");
        }
    }

    void RefreshFires(Vector3 playerPos)
    {
        _fires.Clear();
        if (ProjectileSystem.Instance != null)
            _fires.AddRange(ProjectileSystem.Instance.GetBurningNodePositions());
        foreach (var placed in FindObjectsByType<RuntimePlacedObject>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            if (placed.burning) _fires.Add(placed.transform.position);

        PlayerNearFire = false;
        foreach (var fp in _fires)
        {
            float d = Vector2.Distance(new Vector2(playerPos.x, playerPos.z), new Vector2(fp.x, fp.z));
            if (d < PlayerFireSafe) { PlayerNearFire = true; break; }
        }
    }

    // ── スポーン ──────────────────────────────────
    float GroundHeight(float x, float z) =>
        RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.TerrainHeight(x, z) : 0f;

    void SpawnAroundPlayer(Vector3 playerPos)
    {
        float angle = Random.value * Mathf.PI * 2f;
        float dist = SpawnMinDist + Random.value * (SpawnMaxDist - SpawnMinDist);
        SpawnEnemyAt(playerPos.x + Mathf.Cos(angle) * dist, playerPos.z + Mathf.Sin(angle) * dist);
    }

    public EnemyAI SpawnEnemyAt(float x, float z, bool aggro = false)
    {
        var type = EnemyTypes.PickTypeAt(x, z); // 場所に応じた出現分布
        var tier = EnemyTypes.PickLevel();
        string sex = Random.value < 0.5f ? "male" : "female";
        return SpawnBody(type, tier, sex, new Vector3(x, GroundHeight(x, z), z), aggro);
    }

    EnemyAI SpawnBody(EnemyTypeDef type, EnemyLevelTier tier, string sex, Vector3 pos, bool aggro)
    {
        var obj = new GameObject("Enemy_" + type.id);
        obj.transform.position = pos;
        var ai = obj.AddComponent<EnemyAI>();
        ai.Setup(type, tier, sex, aggro);
        _enemies.Add(ai);
        return ai;
    }

    public void Unregister(EnemyAI enemy) => _enemies.Remove(enemy);

    // 敵の笛: 周囲に敵の群れを呼び寄せる
    public int CallEnemyHorde(Vector3 playerPos, int count = 18)
    {
        int spawned = 0;
        float waterY = RuntimeWorldBuilder.WaterLevel - 0.10f;
        for (int i = 0; i < count; i++)
        {
            float angle = Random.value * Mathf.PI * 2f;
            float dist = 16f + Random.value * 18f;
            float x = playerPos.x + Mathf.Cos(angle) * dist;
            float z = playerPos.z + Mathf.Sin(angle) * dist;

            // 水中に偏った場合は、少しずらして陸地候補を探す
            for (int j = 0; j < 5 && GroundHeight(x, z) < waterY; j++)
            {
                float retryA = angle + (Random.value - 0.5f) * 1.4f;
                float retryD = 18f + Random.value * 20f;
                x = playerPos.x + Mathf.Cos(retryA) * retryD;
                z = playerPos.z + Mathf.Sin(retryA) * retryD;
            }

            var enemy = SpawnEnemyAt(x, z, aggro: true);
            if (enemy != null)
            {
                enemy.SetWanderTarget(playerPos);
                spawned++;
            }
        }
        if (spawned > 0) RuntimeHud.Toast($"📯 笛の音に引かれて周囲の敵が集まってきた！ ({spawned}体)");
        return spawned;
    }

    // ── 繁殖・出産 ────────────────────────────────
    void MarkPregnant(EnemyAI female)
    {
        female.pregnant = true;
        female.pregnancyTimer = PregnancyTime;
        female.SetPregnantVisual(true);
        RuntimeHud.Toast($"💕 {female.type.icon} メスの{female.type.displayName}が妊娠した！（2日後に出産）");
    }

    public void GiveBirth(EnemyAI mother)
    {
        mother.pregnant = false;
        mother.pregnancyTimer = 0;
        mother.breedCd = BreedCooldown;
        mother.SetPregnantVisual(false);
        SpawnBaby(mother.type, mother.transform.position);
        RuntimeHud.Toast($"👶 {mother.type.icon} {mother.type.displayName}の赤ちゃんが生まれた！20分以内に餌（肉や魚を投げる）を与えないと死んでしまう");
    }

    // 赤ちゃんを産む（テイム済みの小さな個体）
    public EnemyAI SpawnBaby(EnemyTypeDef type, Vector3 pos)
    {
        float a = Random.value * Mathf.PI * 2f;
        float x = pos.x + Mathf.Cos(a) * 0.8f;
        float z = pos.z + Mathf.Sin(a) * 0.8f;
        var baby = SpawnBody(type, EnemyTypes.LevelTiers[0], Random.value < 0.5f ? "male" : "female",
            new Vector3(x, GroundHeight(x, z), z), aggro: false);
        baby.hp = baby.maxHp = 8;
        baby.damage = 1;
        baby.xp = 0;
        baby.affection = 100;
        baby.tamed = true;
        baby.tamedLevel = 1;
        baby.tamedXp = 0;
        baby.tamedBaseScale = 1f;
        baby.baby = true;
        baby.starveTimer = EnemyAI.BabyStarveTime;
        baby.growTimer = 0;
        baby.baseScale = EnemyAI.BabyScale;
        baby.transform.localScale = Vector3.one * baby.baseScale;
        baby.ApplyTamedAppearance();
        return baby;
    }

    // テイム動物が敵を倒したときの処理（ドロップは主人へ、経験値は動物自身へ）
    public void OnTamedKill(EnemyAI killer, EnemyAI killed)
    {
        if (!killed.alive) return;
        var parts = new List<string>();
        foreach (var d in killed.type.drops)
        {
            int qty = Random.Range(d.min, d.max + 1);
            if (qty <= 0) continue;
            InventoryManager.Instance?.Add(d.itemId, qty);
            var item = InventoryManager.Instance?.GetItem(d.itemId);
            parts.Add($"{item?.icon ?? ""}{item?.displayName ?? d.itemId}×{qty}");
        }
        killer.tamedXp += killed.xp;
        killer.CheckTamedLevelUp();
        RuntimeHud.Toast($"{killer.type.icon} 仲間の{killer.type.displayName}が {killed.tier?.label ?? ""} {killed.type.displayName}を倒した！ {string.Join(" ", parts)} (仲間 +{killed.xp}EXP)");
        killed.Kill();
    }

    // ── HUD 用 ───────────────────────────────────
    public List<EnemyAI> GetTamedAnimals()
    {
        var list = new List<EnemyAI>();
        foreach (var e in _enemies)
            if (e != null && e.alive && e.tamed) list.Add(e);
        return list;
    }

    // ── セーブ/ロード（テイム動物のみ） ──────────────
    public EnemySaveDataList Serialize()
    {
        var list = new EnemySaveDataList();
        foreach (var e in _enemies)
            if (e != null && e.alive && e.tamed) list.items.Add(e.Serialize());
        return list;
    }

    public void Deserialize(EnemySaveDataList data)
    {
        if (data == null) return;
        // 既存のテイム個体を消してから復元
        for (int i = _enemies.Count - 1; i >= 0; i--)
            if (_enemies[i] != null && _enemies[i].tamed) _enemies[i].Kill();

        foreach (var s in data.items)
        {
            var type = EnemyTypes.Find(s.typeId);
            if (type == null) continue;
            int tierIdx = Mathf.Clamp((s.tierLevel > 0 ? s.tierLevel : 1) - 1, 0, EnemyTypes.LevelTiers.Length - 1);
            string sex = s.sex == "male" || s.sex == "female" ? s.sex : (Random.value < 0.5f ? "male" : "female");
            var ai = SpawnBody(type, EnemyTypes.LevelTiers[tierIdx], sex, new Vector3(s.x, s.y, s.z), aggro: false);

            ai.tamed = true;
            ai.tamedLevel = Mathf.Max(1, s.tamedLevel);
            ai.tamedXp = Mathf.Max(0, s.tamedXp);
            ai.tamedBaseScale = s.tamedBaseScale > 0 ? s.tamedBaseScale : ai.baseScale;
            ai.hp = s.hp > 0 ? s.hp : EnemyTypes.TamedStatsFor(ai.tamedLevel).hp;
            ai.maxHp = s.maxHp > 0 ? s.maxHp : EnemyTypes.TamedStatsFor(ai.tamedLevel).hp;
            ai.pregnant = s.pregnant;
            ai.pregnancyTimer = s.pregnancyTimer;
            ai.breedCd = s.breedCd;
            ai.baby = s.baby;
            ai.starveTimer = s.starveTimer;
            ai.growTimer = s.growTimer;
            ai.ApplyTamedAppearance();

            if (ai.baby)
            {
                float g = Mathf.Min(1f, ai.growTimer / BabyGrowTime);
                ai.baseScale = (EnemyAI.BabyScale + (1f - EnemyAI.BabyScale) * g) * ai.tamedBaseScale;
                if (ai.starveTimer <= 0) ai.starveTimer = EnemyAI.BabyStarveTime;
            }
            else
            {
                ai.baseScale = ai.tamedBaseScale * EnemyTypes.TamedStatsFor(ai.tamedLevel).scale;
            }
            ai.transform.localScale = Vector3.one * ai.baseScale;
            if (ai.pregnant) ai.SetPregnantVisual(true);
        }
    }

    public void SetOrders(string order, string move)
    {
        if (order == "attack" || order == "passive") TamedOrder = order;
        if (move == "follow" || move == "roam") TamedMove = move;
    }
}
