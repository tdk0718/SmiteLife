using System.Collections.Generic;
using UnityEngine;

// プレイヤーが F キーを押したときの採取・攻撃処理（gather.js の移植）
// 範囲内の最も近い対象1つ（敵 or 資源）にヒットし、資源は毎ヒットでドロップする。
public class GatherSystem : MonoBehaviour
{
    public float attackRange = 2.8f;
    public float attackArc   = 60f;  // 正面±度
    public float attackCd    = 0.45f;

    float _cooldown;

    PlayerAnimatorController _anim;

    void Start()
    {
        _anim = GetComponentInChildren<PlayerAnimatorController>();
    }

    void Update()
    {
        if (_cooldown > 0) _cooldown -= Time.deltaTime;
        if (!Input.GetKeyDown(KeyCode.F)) return;
        if (FindAnyObjectByType<CombatAbilitySystem>()?.IsAiming == true) return;
        if (_cooldown > 0 || (StatsManager.Instance != null && StatsManager.Instance.IsDead)) return;

        var inv = InventoryManager.Instance;
        if (inv == null) return;
        if (inv.Equipped == "bow" || inv.Equipped == "enemy_whistle") return;
        if (StatsManager.Instance != null && !StatsManager.Instance.TryAttack())
        {
            RuntimeHud.Toast("スタミナが足りない！");
            return;
        }
        var equipped = inv.GetEquippedData();
        bool bare = equipped == null || !equipped.isTool;

        // 素手はパンチ、道具持ちは近接攻撃モーション（player.js triggerPunch/triggerAttack）
        if (bare) _anim?.TriggerPunch();
        else      _anim?.TriggerMelee();

        // 範囲内の最も近い対象（敵 or 資源）を1つ選ぶ
        EnemyAI bestEnemy = null;
        ResourceNode bestNode = null;
        float bestDist = float.MaxValue;
        foreach (var col in Physics.OverlapSphere(transform.position, attackRange))
        {
            Vector3 to = col.transform.position - transform.position;
            to.y = 0;
            float dist = to.magnitude;
            if (dist < 1e-4f) continue;
            if (Vector3.Angle(transform.forward, to) > attackArc) continue;

            if (col.TryGetComponent(out EnemyAI enemy) && enemy.alive)
            {
                if (dist < bestDist) { bestDist = dist; bestEnemy = enemy; bestNode = null; }
            }
            else if (col.TryGetComponent(out ResourceNode node) && node.Alive)
            {
                if (dist < bestDist) { bestDist = dist; bestNode = node; bestEnemy = null; }
            }
        }

        if (bestEnemy != null)
        {
            _cooldown = attackCd;
            int atk = (ProgressionManager.Instance?.AttackPower() ?? 1) + (equipped?.attackBonus ?? 0);
            bestEnemy.TakeDamage(atk);
            return;
        }

        if (bestNode == null) { _cooldown = attackCd; return; }

        bool isTree = bestNode.type == ResourceType.Wood;
        bool isRock = bestNode.type is ResourceType.Stone or ResourceType.IronRock
            or ResourceType.CopperRock or ResourceType.CoalRock or ResourceType.FlintRock;

        int dmg = 1;
        float cdMult = 1.0f;
        if (equipped != null && equipped.isTool)
        {
            if ((equipped.toolCategory == "tree" && isTree) || (equipped.toolCategory == "rock" && isRock))
            {
                dmg = equipped.gatherMult > 0 ? equipped.gatherMult : 2;
                cdMult = 0.38f;
            }
            else
            {
                cdMult = 0.72f;
            }
        }
        // 素手で木や岩を採取すると小ダメージ
        if (bare && (isTree || isRock))
        {
            StatsManager.Instance?.TakeDamage(1);
            RuntimeHud.Toast("✋ 素手での採取は痛い！");
        }
        _cooldown = attackCd * cdMult;

        // 破壊前後にかかわらず毎ヒットでドロップ（gather.js rollDrops と同じテーブル）
        var drops = RollDrops(bestNode);
        var parts = new List<string>();
        foreach (var (id, qty) in drops)
        {
            inv.Add(id, qty);
            var item = inv.GetItem(id);
            parts.Add($"{item?.icon ?? ""} {item?.displayName ?? id} ×{qty}");
        }
        if (parts.Count > 0) RuntimeHud.Toast($"入手: {string.Join("  ", parts)}");

        bestNode.TakeDamage(dmg);
    }

    // 1回のヒットごとにドロップする内容（gather.js rollDrops の移植）
    static List<(string id, int qty)> RollDrops(ResourceNode node)
    {
        float sc = node.sizeScale > 0 ? node.sizeScale : 1f;
        int Mul(int baseQty) => Mathf.Max(1, Mathf.RoundToInt(baseQty * sc));
        var drops = new List<(string, int)>();

        switch (node.type)
        {
            case ResourceType.Wood:
                drops.Add(("wood", Mul(2 + Random.Range(0, 3))));
                drops.Add(("straw", Mathf.Max(1, Mathf.RoundToInt((1 + Random.Range(0, 2)) * sc))));
                break;
            case ResourceType.IronRock:
                drops.Add(("stone", Mul(1 + Random.Range(0, 2))));
                drops.Add(("iron_ore", Mul(1 + Random.Range(0, 2))));
                break;
            case ResourceType.CopperRock:
                drops.Add(("stone", Mul(1 + Random.Range(0, 2))));
                drops.Add(("copper_ore", Mul(1 + Random.Range(0, 2))));
                break;
            case ResourceType.CoalRock:
                drops.Add(("coal", Mul(2 + Random.Range(0, 3))));
                if (Random.value < 0.25f) drops.Add(("flint", 1));
                break;
            case ResourceType.FlintRock:
                drops.Add(("flint", Mul(1 + Random.Range(0, 2))));
                if (Random.value < 0.3f) drops.Add(("stone", 1));
                break;
            case ResourceType.Grass:
                drops.Add(("straw", 1 + Random.Range(0, 2)));
                break;
            case ResourceType.Mushroom:
                drops.Add((string.IsNullOrEmpty(node.variantItem) ? "mushroom" : node.variantItem, 1));
                break;
            default: // 通常の石
                drops.Add(("stone", Mul(2 + Random.Range(0, 3))));
                if (Random.value < 0.12f) drops.Add(("flint", 1));
                break;
        }
        return drops;
    }
}
