using UnityEngine;

// 装備中の道具を右手ボーンに表示する（player.js buildHandMesh / setHandItem の移植）
// PlayerVisual（モデルのルート）にアタッチし、インベントリの装備変更に追従する。
public class PlayerHandItem : MonoBehaviour
{
    Transform _rightHand;
    GameObject _handItem;
    string _currentId;
    bool _searched;

    void Start()
    {
        InventoryManager.Instance?.OnInventoryChanged.AddListener(Refresh);
        Refresh();
    }

    void OnDestroy()
    {
        InventoryManager.Instance?.OnInventoryChanged.RemoveListener(Refresh);
    }

    Transform FindRightHand()
    {
        if (_rightHand != null || _searched) return _rightHand;
        _searched = true;
        // Mixamo リグ: mixamorig:RightHand / mixamorigRightHand などの名前を探す
        foreach (var t in GetComponentsInChildren<Transform>())
        {
            string n = t.name.ToLowerInvariant();
            if (n.EndsWith("righthand") || n.Contains("righthand"))
            {
                _rightHand = t;
                break;
            }
        }
        return _rightHand;
    }

    void Refresh()
    {
        string id = InventoryManager.Instance?.Equipped;
        if (id == _currentId) return;
        _currentId = id;

        if (_handItem != null)
        {
            Destroy(_handItem);
            _handItem = null;
        }
        if (string.IsNullOrEmpty(id)) return;

        var hand = FindRightHand();
        if (hand == null) return;

        _handItem = BuildHandMesh(id);
        if (_handItem == null) return;
        _handItem.transform.SetParent(hand, false);
        _handItem.transform.localPosition = new Vector3(0, 0.03f, 0.05f);
        _handItem.transform.localRotation = Quaternion.Euler(-90f, 0, 0);
    }

    // 道具ごとの簡易メッシュ（buildHandMesh の移植）
    static GameObject BuildHandMesh(string itemId)
    {
        var wood = new Color(0.545f, 0.37f, 0.235f);
        var stone = new Color(0.60f, 0.565f, 0.50f);
        var blade = new Color(0.75f, 0.75f, 0.72f);
        var fire = new Color(1f, 0.53f, 0f);

        var g = new GameObject("HandItem_" + itemId);
        switch (itemId)
        {
            case "stone_axe":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.19f, 0), Vector3.zero, new Vector3(0.044f, 0.19f, 0.044f));
                AddPart(g, PrimitiveType.Cube, stone, new Vector3(0.07f, -0.36f, 0), Vector3.zero, new Vector3(0.14f, 0.12f, 0.04f));
                break;
            case "iron_axe":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.19f, 0), Vector3.zero, new Vector3(0.044f, 0.19f, 0.044f));
                AddPart(g, PrimitiveType.Cube, blade, new Vector3(0.07f, -0.36f, 0), Vector3.zero, new Vector3(0.15f, 0.13f, 0.04f));
                break;
            case "stone_pickaxe":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.20f, 0), Vector3.zero, new Vector3(0.044f, 0.20f, 0.044f));
                AddPart(g, PrimitiveType.Cube, stone, new Vector3(0, -0.38f, 0), Vector3.zero, new Vector3(0.26f, 0.055f, 0.04f));
                break;
            case "iron_pickaxe":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.20f, 0), Vector3.zero, new Vector3(0.044f, 0.20f, 0.044f));
                AddPart(g, PrimitiveType.Cube, blade, new Vector3(0, -0.38f, 0), Vector3.zero, new Vector3(0.27f, 0.06f, 0.04f));
                break;
            case "stone_knife":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.065f, 0), Vector3.zero, new Vector3(0.04f, 0.065f, 0.04f));
                AddPart(g, PrimitiveType.Cube, blade, new Vector3(0, -0.255f, 0), Vector3.zero, new Vector3(0.036f, 0.25f, 0.018f));
                break;
            case "iron_hammer":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.20f, 0), Vector3.zero, new Vector3(0.044f, 0.20f, 0.044f));
                AddPart(g, PrimitiveType.Cube, blade, new Vector3(0, -0.39f, 0), Vector3.zero, new Vector3(0.12f, 0.10f, 0.10f));
                break;
            case "fire_starter":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(-0.025f, -0.15f, 0), new Vector3(0, 0, 14f), new Vector3(0.032f, 0.15f, 0.032f));
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0.025f, -0.14f, 0.01f), new Vector3(0, 0, -14f), new Vector3(0.032f, 0.14f, 0.032f));
                break;
            case "torch":
            {
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.17f, 0), Vector3.zero, new Vector3(0.048f, 0.17f, 0.048f));
                AddPart(g, PrimitiveType.Sphere, fire, new Vector3(0, 0.055f, 0), Vector3.zero, new Vector3(0.10f, 0.12f, 0.10f));
                var lightObj = new GameObject("TorchLight");
                lightObj.transform.SetParent(g.transform, false);
                lightObj.transform.localPosition = new Vector3(0, 0.1f, 0);
                var light = lightObj.AddComponent<Light>();
                light.type = LightType.Point;
                light.color = new Color(1f, 0.62f, 0.25f);
                light.intensity = 1.3f;
                light.range = 7f;
                break;
            }
            case "bow":
                AddPart(g, PrimitiveType.Cylinder, wood, new Vector3(0, -0.05f, 0), new Vector3(0, 0, 90f), new Vector3(0.03f, 0.28f, 0.03f));
                break;
            default:
                Destroy(g);
                return null;
        }
        return g;
    }

    static void AddPart(GameObject parent, PrimitiveType type, Color color, Vector3 pos, Vector3 euler, Vector3 scale)
    {
        var part = GameObject.CreatePrimitive(type);
        Destroy(part.GetComponent<Collider>());
        part.transform.SetParent(parent.transform, false);
        part.transform.localPosition = pos;
        part.transform.localEulerAngles = euler;
        part.transform.localScale = scale;
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        part.GetComponent<Renderer>().material = new Material(shader) { color = color };
    }
}
