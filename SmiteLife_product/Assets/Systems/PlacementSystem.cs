using UnityEngine;

public class PlacementSystem : MonoBehaviour
{
    public static PlacementSystem Instance { get; private set; }
    public string SelectedItem { get; private set; }

    GameObject _ghost;
    float _yaw;

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
    }

    void Update()
    {
        var inv = InventoryManager.Instance;
        if (Input.GetKeyDown(KeyCode.B))
        {
            if (SelectedItem == null) SelectFirstPlaceable();
            else Clear();
        }
        if (SelectedItem == null || inv == null) return;

        if (Input.GetKeyDown(KeyCode.Z)) _yaw -= 45f;
        if (Input.GetKeyDown(KeyCode.X)) _yaw += 45f;
        if (Input.GetKeyDown(KeyCode.Escape)) { Clear(); return; }

        Vector3 pos = TargetPosition();
        UpdateGhost(pos);

        if (Input.GetMouseButtonDown(0) && !RuntimeHud.PointerDownOverRotationButtons() && inv.Has(SelectedItem))
        {
            RuntimeWorldBuilder.Instance.PlaceItem(SelectedItem, pos, Quaternion.Euler(0, _yaw, 0));
            inv.Remove(SelectedItem);
            Clear();
        }
    }

    public void Select(string itemId)
    {
        if (!ItemCatalog.Placeable.Contains(itemId) || !InventoryManager.Instance.Has(itemId)) return;
        SelectedItem = itemId;
        _yaw = 0f;
    }

    void SelectFirstPlaceable()
    {
        foreach (var kv in InventoryManager.Instance.Counts)
        {
            if (kv.Value > 0 && ItemCatalog.Placeable.Contains(kv.Key))
            {
                Select(kv.Key);
                return;
            }
        }
    }

    void Clear()
    {
        SelectedItem = null;
        if (_ghost != null) Destroy(_ghost);
    }

    Vector3 TargetPosition()
    {
        Camera cam = Camera.main;
        if (cam != null && Physics.Raycast(cam.transform.position, cam.transform.forward, out RaycastHit hit, 8f))
            return Snap(hit.point);

        Transform player = GameObject.FindGameObjectWithTag("Player")?.transform;
        Vector3 p = player != null ? player.position + player.forward * 3f : Vector3.forward * 3f;
        p.y = RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.GroundHeight(p) : p.y;
        return Snap(p);
    }

    Vector3 Snap(Vector3 p)
    {
        p.x = Mathf.Round(p.x * 2f) * 0.5f;
        p.z = Mathf.Round(p.z * 2f) * 0.5f;
        return p + Vector3.up * 0.35f;
    }

    void UpdateGhost(Vector3 pos)
    {
        if (_ghost == null)
        {
            _ghost = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Destroy(_ghost.GetComponent<Collider>());
            _ghost.GetComponent<Renderer>().material.color = new Color(0.2f, 0.8f, 1f, 0.35f);
        }
        _ghost.name = "PlacementGhost_" + SelectedItem;
        _ghost.transform.SetPositionAndRotation(pos, Quaternion.Euler(0, _yaw, 0));
        _ghost.transform.localScale = Vector3.one;
    }
}
