using UnityEngine;

public enum ResourceType { Wood, Stone, IronRock, CoalRock, Grass, Mushroom }

public class ResourceNode : MonoBehaviour
{
    public ResourceType type;
    public int maxHp = 5;
    public float sizeScale = 1f;

    [System.Serializable]
    public struct Drop { public string itemId; public int min, max; }
    public Drop[] drops;

    int  _hp;
    bool _alive = true;

    void Start() => _hp = maxHp;

    public bool Alive => _alive;

    public void TakeDamage(int amount)
    {
        if (!_alive) return;
        _hp -= amount;
        // スケールでダメージ感を演出
        transform.localScale = Vector3.one * sizeScale * (0.9f + 0.1f * ((float)_hp / maxHp));
        if (_hp <= 0) Destroy();
    }

    void Destroy()
    {
        _alive = false;
        foreach (var d in drops)
        {
            int qty = Random.Range(d.min, d.max + 1);
            InventoryManager.Instance?.Add(d.itemId, qty);
            // 取得トーストは UI 側で OnInventoryChanged を受けて表示
        }
        gameObject.SetActive(false);
    }
}
