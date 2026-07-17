using UnityEngine;

// localStorage の代替: Unity の PlayerPrefs に JSON を保存
// WebGL ビルドでは PlayerPrefs が IndexedDB に永続化される
public class SaveSystem : MonoBehaviour
{
    public static SaveSystem Instance { get; private set; }

    const string SaveKey = "smitelife_v1";

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
    }

    void Start()
    {
        if (HasSave()) Load();
    }

    public bool HasSave() => PlayerPrefs.HasKey(SaveKey);

    public void Save()
    {
        var data = new SaveData
        {
            progression = ProgressionManager.Instance.Serialize(),
            stats       = StatsManager.Instance.Serialize(),
            inventory   = InventoryManager.Instance.Serialize(),
        };
        PlayerPrefs.SetString(SaveKey, JsonUtility.ToJson(data));
        PlayerPrefs.Save();
    }

    public void Load()
    {
        if (!HasSave()) return;
        var data = JsonUtility.FromJson<SaveData>(PlayerPrefs.GetString(SaveKey));
        ProgressionManager.Instance.Deserialize(data.progression);
        StatsManager.Instance.Deserialize(data.stats);
        InventoryManager.Instance.Deserialize(data.inventory);
    }

    public void DeleteSave()
    {
        PlayerPrefs.DeleteKey(SaveKey);
        PlayerPrefs.Save();
    }

    void OnApplicationQuit() => Save();
}

[System.Serializable]
public class SaveData
{
    public ProgressionData progression;
    public StatsData       stats;
    public InventoryData   inventory;
}
