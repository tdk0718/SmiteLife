using UnityEngine;

// プレイヤーが F キーを押したときの採取・攻撃処理
public class GatherSystem : MonoBehaviour
{
    public float attackRange = 2.8f;
    public float attackArc   = 60f;  // 正面±度
    public float attackCd    = 0.45f;

    float _cooldown;

    PlayerAnimatorController _anim;
    ThirdPersonCamera        _cam;

    void Start()
    {
        _anim = GetComponentInChildren<PlayerAnimatorController>();
        _cam  = Camera.main?.GetComponent<ThirdPersonCamera>();
    }

    void Update()
    {
        if (_cooldown > 0) _cooldown -= Time.deltaTime;
        if (!Input.GetKeyDown(KeyCode.F)) return;
        if (_cooldown > 0 || StatsManager.Instance.IsDead) return;
        if (!StatsManager.Instance.TryAttack()) return;

        var inv      = InventoryManager.Instance;
        var equipped = inv.GetEquippedData();
        bool bare    = equipped == null || !equipped.isTool;

        if (bare) _anim?.TriggerPunch();
        else      _anim?.TriggerAttack();

        _cooldown = attackCd;

        // 範囲内の敵・資源をチェック
        Collider[] hits = Physics.OverlapSphere(transform.position, attackRange);
        foreach (var col in hits)
        {
            Vector3 dir = (col.transform.position - transform.position).normalized;
            float angle = Vector3.Angle(transform.forward, dir);
            if (angle > attackArc) continue;

            if (col.TryGetComponent(out WolfAI wolf))
            {
                int atk = ProgressionManager.Instance.AttackPower()
                        + (equipped?.attackBonus ?? 0);
                wolf.TakeDamage(atk);
                return;
            }

            if (col.TryGetComponent(out ResourceNode node) && node.Alive)
            {
                int dmg = 1;
                if (equipped != null && equipped.isTool)
                {
                    bool match = (node.type == ResourceType.Wood && equipped.toolCategory == "tree")
                              || (node.type == ResourceType.Stone && equipped.toolCategory == "rock");
                    if (match) dmg = equipped.gatherMult > 0 ? equipped.gatherMult : 2;
                }
                else if (node.type == ResourceType.Wood || node.type == ResourceType.Stone)
                {
                    StatsManager.Instance.TakeDamage(1); // 素手ペナルティ
                }
                node.TakeDamage(dmg);
                return;
            }
        }
    }
}
