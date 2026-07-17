using System.Linq;
using UnityEngine;

public class RuntimeStorageSystem : MonoBehaviour
{
    public static RuntimePlacedObject OpenObject { get; private set; }
    public static string Message { get; set; }

    void Update()
    {
        if (OpenObject != null && Input.GetKeyDown(KeyCode.Escape)) Close();
        if (OpenObject != null && !OpenObject.gameObject.activeInHierarchy) Close();
    }

    public static void Open(RuntimePlacedObject obj)
    {
        if (obj == null || !obj.HasContainer) return;
        OpenObject = obj;
        Message = "";
    }

    public static void Close() => OpenObject = null;

    public static bool MoveToBox(string id, bool all)
    {
        var obj = OpenObject;
        var inv = InventoryManager.Instance;
        if (obj == null || inv == null || !obj.Accepts(id)) return false;
        int space = obj.Capacity - obj.Total();
        int qty = Mathf.Min(all ? inv.Count(id) : 1, space);
        if (qty <= 0 || !inv.Remove(id, qty)) return false;
        obj.Add(id, qty);
        SaveSystem.Instance?.Save();
        return true;
    }

    public static bool MoveToInventory(string id, bool all)
    {
        var obj = OpenObject;
        if (obj == null) return false;
        int qty = all ? obj.Count(id) : Mathf.Min(1, obj.Count(id));
        if (qty <= 0 || !obj.Remove(id, qty)) return false;
        InventoryManager.Instance?.Add(id, qty);
        SaveSystem.Instance?.Save();
        return true;
    }

    public static string[] AcceptedHeldItemIds()
    {
        var obj = OpenObject;
        var inv = InventoryManager.Instance;
        if (obj == null || inv == null) return new string[0];
        return inv.Counts.Where(kv => kv.Value > 0 && obj.Accepts(kv.Key)).Select(kv => kv.Key).ToArray();
    }
}
