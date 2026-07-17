using UnityEngine;
using UnityEngine.Events;

public class ProgressionManager : MonoBehaviour
{
    public static ProgressionManager Instance { get; private set; }

    public int   Level { get; private set; } = 1;
    public int   Xp    { get; private set; }

    public UnityEvent<int> OnLevelUp = new(); // 引数: 新レベル

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
    }

    void Start() => ApplyDerived(false);

    public int XpToNext(int level = -1)
    {
        if (level < 0) level = Level;
        return Mathf.FloorToInt(50 * Mathf.Pow(level, 1.6f));
    }

    public int  AttackPower(int level = -1) { if (level < 0) level = Level; return 1 + (level - 1); }
    public int  MaxHp      (int level = -1) { if (level < 0) level = Level; return 100 + (level - 1) * 20; }
    public int  Defense    (int level = -1) { if (level < 0) level = Level; return (level - 1) * 2; }

    public void AddXp(int amount)
    {
        if (amount <= 0) return;
        Xp += amount;
        bool leveled = false;
        while (Xp >= XpToNext())
        {
            Xp -= XpToNext();
            Level++;
            leveled = true;
        }
        if (leveled)
        {
            ApplyDerived(true);
            OnLevelUp.Invoke(Level);
            SaveSystem.Instance?.Save();
        }
    }

    void ApplyDerived(bool healToFull)
    {
        StatsManager.Instance?.SetMaxHp(MaxHp(), healToFull);
        StatsManager.Instance?.SetDefense(Defense());
    }

    // セーブ/ロード
    public ProgressionData Serialize() => new() { level = Level, xp = Xp };
    public void Deserialize(ProgressionData d)
    {
        Level = Mathf.Max(1, d.level);
        Xp    = Mathf.Max(0, d.xp);
        ApplyDerived(false);
    }
}

[System.Serializable]
public class ProgressionData { public int level, xp; }
