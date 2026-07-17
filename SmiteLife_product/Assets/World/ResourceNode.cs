using UnityEngine;

public enum ResourceType { Wood, Stone, IronRock, CoalRock, CopperRock, FlintRock, Grass, Mushroom }

public class ResourceNode : MonoBehaviour
{
    public ResourceType type;
    public int maxHp = 5;
    public float sizeScale = 1f;
    public string nodeId;      // チャンク再生成時に破壊済みノードを除外するための決定論ID
    public string variantItem; // キノコの種類など、タイプ内バリエーションのドロップID

    int _hp;
    bool _alive = true;
    bool _started;
    Vector3 _baseScale;

    void Start()
    {
        _hp = maxHp;
        _baseScale = transform.localScale;
        _started = true;
    }

    public bool Alive => _alive;

    public void TakeDamage(int amount)
    {
        if (!_alive) return;
        if (!_started) { _hp = maxHp; _baseScale = transform.localScale; _started = true; }
        _hp -= amount;
        // ヒットフィードバック: 残HPに合わせて少し縮める（scene.js damageNode と同じ係数）
        float ratio = Mathf.Max(0.55f, (float)_hp / maxHp);
        transform.localScale = _baseScale * (0.82f + ratio * 0.18f);
        if (_hp <= 0) DestroyNode();
    }

    void DestroyNode()
    {
        // ドロップは採取ヒットごとに GatherSystem 側で付与される（gather.js と同じ）
        _alive = false;
        if (!string.IsNullOrEmpty(nodeId)) RuntimeWorldBuilder.Instance?.MarkResourceDestroyed(nodeId);
        Destroy(gameObject);
    }
}
