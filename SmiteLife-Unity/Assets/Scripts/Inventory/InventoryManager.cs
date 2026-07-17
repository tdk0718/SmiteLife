using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

public class InventoryManager : MonoBehaviour
{
    public static InventoryManager Instance { get; private set; }

    // アイテムデータは ScriptableObject で定義（Inspector で設定）
    [System.Serializable]
    public class ItemEntry { public string id; public ItemData data; }
    public List<ItemEntry> itemRegistry = new();

    Dictionary<string, ItemData>  _registry = new();
    Dictionary<string, int>       _counts   = new();
    string                        _equipped;

    public UnityEvent OnInventoryChanged = new();

    public string Equipped => _equipped;

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        foreach (var e in itemRegistry) _registry[e.id] = e.data;
    }

    public ItemData GetItem(string id) =>
        _registry.TryGetValue(id, out var d) ? d : null;

    public int  Count(string id) => _counts.TryGetValue(id, out var n) ? n : 0;
    public bool Has  (string id, int qty = 1) => Count(id) >= qty;

    public void Add(string id, int qty = 1)
    {
        if (!_registry.ContainsKey(id)) return;
        _counts[id] = Count(id) + qty;
        OnInventoryChanged.Invoke();
    }

    public bool Remove(string id, int qty = 1)
    {
        if (!Has(id, qty)) return false;
        _counts[id] -= qty;
        if (_counts[id] <= 0 && _equipped == id) SetEquipped(null);
        OnInventoryChanged.Invoke();
        return true;
    }

    public void SetEquipped(string id)
    {
        _equipped = (id != null && Has(id)) ? id : null;
        OnInventoryChanged.Invoke();
    }

    public ItemData GetEquippedData() =>
        _equipped != null ? GetItem(_equipped) : null;

    // セーブ/ロード
    public InventoryData Serialize()
    {
        var data = new InventoryData { equipped = _equipped };
        foreach (var kv in _counts)
            if (kv.Value > 0) data.items.Add(new ItemCount { id = kv.Key, count = kv.Value });
        return data;
    }

    public void Deserialize(InventoryData data)
    {
        _counts.Clear();
        foreach (var ic in data.items)
            if (_registry.ContainsKey(ic.id) && ic.count > 0) _counts[ic.id] = ic.count;
        _equipped = (data.equipped != null && Has(data.equipped)) ? data.equipped : null;
        OnInventoryChanged.Invoke();
    }
}

// ScriptableObject: Assets/Items/ 以下に各アイテム1ファイル作成
[CreateAssetMenu(menuName = "SmiteLife/ItemData")]
public class ItemData : ScriptableObject
{
    public string  displayName;
    public string  icon;          // emoji or sprite name
    public bool    edible;
    public float   hungerAmount;
    public float   hpAmount;
    public bool    isTool;
    public string  toolCategory;  // "tree" / "rock" / null
    public int     gatherMult;
    public int     attackBonus;
    public bool    isRanged;
    public bool    slow;
}

[System.Serializable]
public class ItemCount  { public string id; public int count; }
[System.Serializable]
public class InventoryData
{
    public string equipped;
    public List<ItemCount> items = new();
}
