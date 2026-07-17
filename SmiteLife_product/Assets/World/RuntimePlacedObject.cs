using System.Collections.Generic;
using UnityEngine;

public class RuntimePlacedObject : MonoBehaviour
{
    const float WoodBurnTime = 15f;
    const float CookTime = 8f;
    const float SmeltTime = 6f;

    public string itemId;
    public bool burning;
    public bool doorOpen;
    public float burnTimer;
    public float cookTimer;
    public float smeltTimer;
    public List<ItemCount> box = new();

    Light _light;

    public bool HasContainer => itemId == "wood" || itemId == "furnace" || itemId == "workbench" || itemId == "lathe";
    public int Capacity => itemId == "workbench" || itemId == "lathe" ? 60 : 30;

    public void Init(string id)
    {
        itemId = id;
        if (HasContainer && box.Count == 0) box = new List<ItemCount>();
        if (itemId == "torch") CreateTorchLight();
    }

    void CreateTorchLight()
    {
        var obj = new GameObject("TorchLight");
        obj.transform.SetParent(transform, false);
        obj.transform.localPosition = Vector3.up * 0.7f;
        var light = obj.AddComponent<Light>();
        light.type = LightType.Point;
        light.color = new Color(1f, 0.62f, 0.25f);
        light.intensity = 1.4f;
        light.range = 8f;
    }

    void Update()
    {
        if (burning) UpdateFire(Time.deltaTime);
        if (itemId == "furnace") UpdateFurnace(Time.deltaTime);
        if (!IsPlayerNearby()) return;

        if (Input.GetKeyDown(KeyCode.E))
        {
            if (HasContainer) RuntimeStorageSystem.Open(this);
            else if (itemId == "door") ToggleDoor();
            else if (itemId == "bed") RestAtBed();
        }

        if (Input.GetKeyDown(KeyCode.F) && itemId == "wood")
            Ignite();
    }

    public int Count(string id)
    {
        var item = box.Find(x => x.id == id);
        return item?.count ?? 0;
    }

    public void Add(string id, int qty)
    {
        if (qty <= 0) return;
        var item = box.Find(x => x.id == id);
        if (item == null) box.Add(new ItemCount { id = id, count = qty });
        else item.count += qty;
    }

    public bool Remove(string id, int qty)
    {
        var item = box.Find(x => x.id == id);
        if (item == null || item.count < qty) return false;
        item.count -= qty;
        if (item.count <= 0) box.Remove(item);
        return true;
    }

    public int Total()
    {
        int total = 0;
        foreach (var item in box) total += Mathf.Max(0, item.count);
        return total;
    }

    public bool Accepts(string id)
    {
        if (itemId == "wood") return id == "wood" || id == "meat" || id == "raw_fish";
        if (itemId == "furnace") return id == "coal" || id == "charcoal" || id == "iron_ore" || id == "copper_ore";
        if (itemId == "workbench" || itemId == "lathe") return CraftingSystem.Instance?.IsCraftMaterial(id) == true;
        return false;
    }

    public string StatusText()
    {
        if (itemId == "wood")
        {
            if (!burning) return Count("wood") > 0 ? "F: 火をつける / E: ボックス" : "薪を入れると着火できます";
            return $"燃焼中  薪:{Count("wood")}  料理:{Mathf.CeilToInt(Mathf.Max(0, CookTime - cookTimer))}秒";
        }
        if (itemId == "furnace")
            return $"炉  燃料:{Count("coal") + Count("charcoal")}  精錬:{Mathf.CeilToInt(Mathf.Max(0, SmeltTime - smeltTimer))}秒";
        if (itemId == "workbench" || itemId == "lathe")
            return "材料を入れて近くで G を押すと作業台レシピを作れます";
        if (itemId == "bed") return "E: 休憩して回復";
        if (itemId == "door") return "E: 開閉";
        return "";
    }

    public void Ignite()
    {
        if (burning || itemId != "wood" || Count("wood") < 1) return;
        burning = true;
        EnsureLight();
        GetComponent<Renderer>().material.color = new Color(1f, 0.38f, 0.08f);
    }

    void UpdateFire(float delta)
    {
        EnsureLight();
        burnTimer += delta;
        cookTimer += delta;
        _light.intensity = 1.7f + Mathf.Sin(Time.time * 9f) * 0.45f;

        if (cookTimer >= CookTime)
        {
            cookTimer = 0f;
            if (Remove("meat", 1)) Add("cooked_meat", 1);
            else if (Remove("raw_fish", 1)) Add("cooked_fish", 1);
        }

        if (burnTimer >= WoodBurnTime)
        {
            burnTimer = 0f;
            if (Remove("wood", 1)) Add("charcoal", 1);
            if (Count("wood") <= 0) Extinguish();
        }
    }

    void UpdateFurnace(float delta)
    {
        if ((Count("coal") + Count("charcoal")) <= 0) return;
        if (Count("iron_ore") <= 0 && Count("copper_ore") <= 0) return;

        smeltTimer += delta;
        if (smeltTimer < SmeltTime) return;
        smeltTimer = 0f;

        if (!Remove("coal", 1)) Remove("charcoal", 1);
        if (Remove("iron_ore", 1)) Add("iron_ingot", 1);
        else if (Remove("copper_ore", 1)) Add("copper_ingot", 1);
    }

    void Extinguish()
    {
        burning = false;
        if (_light != null) Destroy(_light.gameObject);
        _light = null;
        GetComponent<Renderer>().material.color = new Color(0.55f, 0.36f, 0.18f);
    }

    void EnsureLight()
    {
        if (_light != null) return;
        var obj = new GameObject("FireLight");
        obj.transform.SetParent(transform, false);
        obj.transform.localPosition = Vector3.up * 1.2f;
        _light = obj.AddComponent<Light>();
        _light.type = LightType.Point;
        _light.color = new Color(1f, 0.45f, 0.15f);
        _light.range = 12f;
    }

    void ToggleDoor()
    {
        doorOpen = !doorOpen;
        transform.rotation *= Quaternion.Euler(0, doorOpen ? -80f : 80f, 0);
    }

    void RestAtBed()
    {
        StatsManager.Instance?.Eat(0, 35f);
        RuntimeStorageSystem.Message = "ベッドで休憩した";
    }

    bool IsPlayerNearby()
    {
        var player = GameObject.FindGameObjectWithTag("Player");
        return player != null && Vector3.Distance(player.transform.position, transform.position) <= 2.8f;
    }
}

[System.Serializable]
public class PlacedObjectData
{
    public string itemId;
    public float x, y, z;
    public float rotY;
    public bool burning;
    public bool doorOpen;
    public float burnTimer;
    public float cookTimer;
    public float smeltTimer;
    public List<ItemCount> box = new();
}
