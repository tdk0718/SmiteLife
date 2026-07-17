using UnityEngine;

// 敵タイプのレジストリ（enemyTypes.js の移植）
// 新しい敵を増やすときはここに1エントリ追加するだけでよい。

[System.Serializable]
public class EnemyDrop
{
    public string itemId;
    public int min = 1;
    public int max = 1;
}

public class EnemyTypeDef
{
    public string id;
    public string displayName;
    public string icon;
    public float hp;
    public float speedChase;
    public float speedWander;
    public float detectRange;
    public float leashRange;
    public float attackRange;
    public float attackCd;
    public float damage;
    public int xp;
    public EnemyDrop[] drops;
    public bool fearsFire;
    public float fireFleeSpeed;
    public bool passive;      // 自分からは襲わない
    public bool fleeOnHurt;   // 攻撃されると逃げる
    public bool tameable;
    public float tameAffection; // 餌1回あたりの好感度上昇
    public Vector3 collar = new(0, 0.74f, 0.50f); // x未使用 / y,z=首輪位置
    public float collarRadius = 0.17f;
}

// レベル閾値テーブル（連続スケールではなく段階）
public class EnemyLevelTier
{
    public int level;
    public string label;
    public float sizeScale, hpMult, dmgMult, speedMult, xpMult;
}

public static class EnemyTypes
{
    public static readonly EnemyLevelTier[] LevelTiers =
    {
        new() { level = 1, label = "Lv.1", sizeScale = 1.00f, hpMult = 1.0f,  dmgMult = 1.0f, speedMult = 1.00f, xpMult = 1.0f },
        new() { level = 2, label = "Lv.2", sizeScale = 1.25f, hpMult = 2.0f,  dmgMult = 1.5f, speedMult = 1.10f, xpMult = 2.5f },
        new() { level = 3, label = "Lv.3", sizeScale = 1.55f, hpMult = 3.8f,  dmgMult = 2.2f, speedMult = 1.22f, xpMult = 5.5f },
        new() { level = 4, label = "Lv.4", sizeScale = 1.90f, hpMult = 6.5f,  dmgMult = 3.2f, speedMult = 1.38f, xpMult = 12.0f },
        new() { level = 5, label = "Lv.5", sizeScale = 2.40f, hpMult = 11f,   dmgMult = 4.8f, speedMult = 1.58f, xpMult = 25.0f },
    };

    // 出現重み（低レベルほど頻繁）Lv1=70% / Lv2=18% / Lv3=8% / Lv4=3% / Lv5=1%
    static readonly int[] LevelWeights = { 70, 18, 8, 3, 1 };

    public static EnemyLevelTier PickLevel()
    {
        int total = 0;
        foreach (int w in LevelWeights) total += w;
        float r = Random.value * total;
        for (int i = 0; i < LevelTiers.Length; i++)
        {
            r -= LevelWeights[i];
            if (r <= 0) return LevelTiers[i];
        }
        return LevelTiers[0];
    }

    public static readonly EnemyTypeDef Wolf = new()
    {
        id = "wolf", displayName = "狼", icon = "🐺",
        hp = 3, speedChase = 4.2f, speedWander = 1.6f,
        detectRange = 20, leashRange = 32, attackRange = 1.9f, attackCd = 1.2f,
        damage = 10, xp = 20,
        drops = new[] { D("meat", 1, 2), D("fur", 1, 1) },
        fearsFire = true, fireFleeSpeed = 5.5f,
        tameable = true, tameAffection = 20,
        collar = new Vector3(0, 0.72f, 0.42f), collarRadius = 0.15f,
    };

    public static readonly EnemyTypeDef Cow = new()
    {
        id = "cow", displayName = "牛", icon = "🐄",
        hp = 14, speedChase = 3.4f, speedWander = 1.1f,
        detectRange = 15, leashRange = 30, attackRange = 1.7f, attackCd = 1.5f,
        damage = 4, xp = 30,
        drops = new[] { D("meat", 2, 4), D("fur", 1, 2) },
        fearsFire = true, passive = true, fleeOnHurt = true,
        tameable = true, tameAffection = 25,
        collar = new Vector3(0, 0.87f, 0.50f), collarRadius = 0.21f,
    };

    public static readonly EnemyTypeDef Tiger = new()
    {
        id = "tiger", displayName = "虎", icon = "🐅",
        hp = 10, speedChase = 5.2f, speedWander = 1.5f,
        detectRange = 26, leashRange = 44, attackRange = 2.1f, attackCd = 1.0f,
        damage = 22, xp = 90,
        drops = new[] { D("meat", 2, 3), D("fur", 2, 3) },
        fearsFire = true, fireFleeSpeed = 6.2f,
        tameable = true, tameAffection = 10,
        collar = new Vector3(0, 0.75f, 0.47f), collarRadius = 0.18f,
    };

    public static readonly EnemyTypeDef[] All = { Wolf, Cow, Tiger };

    public static EnemyTypeDef Find(string id)
    {
        foreach (var t in All)
            if (t.id == id) return t;
        return null;
    }

    // 平原度 0〜1（地形と同じ平原マスクを使う。牛の生息地判定）
    public static float GetPlainsFactor(float x, float z)
    {
        if (RuntimeWorldBuilder.Instance != null) return RuntimeWorldBuilder.Instance.PlainsFactor(x, z);
        float n = Mathf.PerlinNoise(x * 0.008f + 7.3f, z * 0.008f + 3.1f);
        return Mathf.Clamp01((n - 0.45f) / 0.30f);
    }

    // ── 場所に応じた出現分布 ─────────────────────────
    //   ・スタート地点（原点）周辺: 狼が多い
    //   ・平原地帯: 牛の群れが多い
    //   ・原点から離れた森林/山岳: 虎が出現
    public static EnemyTypeDef PickTypeAt(float x, float z)
    {
        float d = Mathf.Sqrt(x * x + z * z);
        float plains = GetPlainsFactor(x, z);
        float wolfW = d < 80f ? 5.0f : 1.2f;
        float cowW = 0.2f + plains * 4.5f;
        float tigerW = d < 60f ? 0f : (0.3f + Mathf.Min(1f, (d - 60f) / 120f) * 2.0f) * (1f - plains * 0.6f);

        float r = Random.value * (wolfW + cowW + tigerW);
        if ((r -= wolfW) <= 0) return Wolf;
        if ((r -= cowW) <= 0) return Cow;
        return Tiger;
    }

    // ── テイム動物のレベルテーブル（Lv1〜5の基準値。以降は計算式で無限成長） ──
    public struct TamedStats
    {
        public int level;
        public int hp;
        public int dmg;
        public float speed;
        public float scale;
    }

    static readonly TamedStats[] TamedTable =
    {
        new() { level = 1, hp = 15,  dmg = 6,  speed = 4.8f, scale = 1.00f },
        new() { level = 2, hp = 28,  dmg = 10, speed = 5.2f, scale = 1.18f },
        new() { level = 3, hp = 45,  dmg = 16, speed = 5.7f, scale = 1.36f },
        new() { level = 4, hp = 68,  dmg = 25, speed = 6.2f, scale = 1.56f },
        new() { level = 5, hp = 100, dmg = 38, speed = 6.8f, scale = 1.80f },
    };

    static readonly int[] TamedXpThresh = { 0, 50, 130, 300, 700 }; // Lv2〜5に必要な累計XP

    public static TamedStats TamedStatsFor(int level)
    {
        if (level <= TamedTable.Length) return TamedTable[Mathf.Max(0, level - 1)];
        int over = level - TamedTable.Length;
        var last = TamedTable[^1];
        return new TamedStats
        {
            level = level,
            hp = Mathf.RoundToInt(last.hp * Mathf.Pow(1.22f, over)),
            dmg = Mathf.RoundToInt(last.dmg * Mathf.Pow(1.20f, over)),
            speed = Mathf.Min(9.5f, last.speed + over * 0.15f), // 速度は暴走防止に上限
            scale = Mathf.Min(3.2f, last.scale + over * 0.10f), // 体格も上限
        };
    }

    // そのレベルに到達するために必要な累計XP（レベルキャップなし）
    public static int TamedXpForLevel(int level)
    {
        if (level <= 1) return 0;
        if (level <= TamedXpThresh.Length) return TamedXpThresh[level - 1];
        int over = level - TamedXpThresh.Length;
        return Mathf.RoundToInt(TamedXpThresh[^1] * Mathf.Pow(1.6f, over));
    }

    static EnemyDrop D(string id, int min, int max) => new() { itemId = id, min = min, max = max };
}
