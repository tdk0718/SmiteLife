using UnityEngine;
using System.Collections;

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

    IEnumerator Start()
    {
        yield return null;
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
            placed      = RuntimeWorldBuilder.Instance?.SerializePlacedObjects(),
            player      = PlayerData.From(GameObject.FindGameObjectWithTag("Player")?.transform),
            enemies     = EnemyManager.Instance?.Serialize(),
            tamedOrder  = EnemyManager.Instance?.TamedOrder,
            tamedMove   = EnemyManager.Instance?.TamedMove,
        };
        PlayerPrefs.SetString(SaveKey, JsonUtility.ToJson(data));
        PlayerPrefs.Save();
    }

    public void Load()
    {
        if (!HasSave()) return;
        var data = JsonUtility.FromJson<SaveData>(PlayerPrefs.GetString(SaveKey));
        if (data.progression != null) ProgressionManager.Instance.Deserialize(data.progression);
        if (data.stats != null) StatsManager.Instance.Deserialize(data.stats);
        if (data.inventory != null) InventoryManager.Instance.Deserialize(data.inventory);
        RuntimeWorldBuilder.Instance?.DeserializePlacedObjects(data.placed);
        EnemyManager.Instance?.Deserialize(data.enemies);
        EnemyManager.Instance?.SetOrders(data.tamedOrder, data.tamedMove);
        data.player?.Apply(GameObject.FindGameObjectWithTag("Player")?.GetComponent<PlayerController>());
        RuntimeHud.Toast("💾 セーブデータを引き継ぎました");
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
    public PlacedObjectDataList placed;
    public PlayerData player;
    public EnemySaveDataList enemies;
    public string tamedOrder;
    public string tamedMove;
}

[System.Serializable]
public class PlayerData
{
    public float x, y, z;
    public float rotY;

    public static PlayerData From(Transform t)
    {
        if (t == null) return null;
        return new PlayerData
        {
            x = t.position.x,
            y = t.position.y,
            z = t.position.z,
            rotY = t.eulerAngles.y,
        };
    }

    public void Apply(PlayerController player)
    {
        if (player == null) return;
        var pos = new Vector3(x, y, z);
        if (RuntimeWorldBuilder.Instance != null)
        {
            float ground = RuntimeWorldBuilder.Instance.GroundHeight(pos);
            if (pos.y < ground + 0.2f) pos.y = ground + 0.2f;
        }
        player.WarpTo(pos);
        player.transform.rotation = Quaternion.Euler(0, rotY, 0);
    }
}
