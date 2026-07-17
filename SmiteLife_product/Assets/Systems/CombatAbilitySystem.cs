using UnityEngine;

// 弓・炎魔法・投擲・敵の笛（main.js の戦闘アクション処理の移植）
public class CombatAbilitySystem : MonoBehaviour
{
    public float whistleCooldown = 18f;

    const float FireMagicStamina = 35f;
    const float FireMaxChargeTime = 1.5f; // この秒数でチャージ最大

    float _whistleTimer;
    float _fireChargeTime;
    bool _bowAiming;
    bool _fireAiming;

    // 投擲アイテムの優先順位（装備中 > 投擲ダメージ降順）
    static readonly string[] ThrowPriority =
    {
        "stone_block", "stone_axe", "stone_pickaxe", "stone", "stone_knife", "flint",
        "iron_ore", "copper_ore", "coal", "plank", "wooden_fence", "pillar", "torch",
        "wood", "floor_board", "wall_panel", "straw",
        "meat", "raw_fish", "cooked_meat", "cooked_fish"
    };

    public bool IsAiming => _bowAiming || _fireAiming;
    public string AimHint { get; private set; }

    Transform PlayerTransform => GameObject.FindGameObjectWithTag("Player")?.transform;

    void Update()
    {
        if (_whistleTimer > 0) _whistleTimer -= Time.deltaTime;

        var inv = InventoryManager.Instance;
        if (inv == null || StatsManager.Instance == null) return;

        UpdateBow(inv);
        UpdateFireMagic();

        if (Input.GetKeyDown(KeyCode.T)) ThrowSelected(inv);
        if (Input.GetKeyDown(KeyCode.F) && inv.Equipped == "enemy_whistle" && !IsAiming) BlowWhistle();
    }

    // ── 弓（F長押しで狙い、離すと発射） ───────────────
    void UpdateBow(InventoryManager inv)
    {
        bool placing = PlacementSystem.Instance?.SelectedItem != null;
        if (inv.Equipped == "bow" && !StatsManager.Instance.IsDead && !placing)
        {
            if (Input.GetKey(KeyCode.F))
            {
                _bowAiming = true;
                AimHint = "🏹 [F を離す] 矢を放つ";
                return;
            }

            if (_bowAiming)
            {
                _bowAiming = false;
                AimHint = null;
                ShootArrow(inv);
            }
            return;
        }

        _bowAiming = false;
    }

    void ShootArrow(InventoryManager inv)
    {
        if (!inv.Has("arrow"))
        {
            RuntimeHud.Toast("🏹 矢がない！石と木で作ろう");
            return;
        }
        inv.Remove("arrow");
        var player = PlayerTransform;
        if (player == null || ProjectileSystem.Instance == null) return;
        Ray aim = AimRay(player);
        Vector3 origin = aim.origin + aim.direction * 0.35f;
        ProjectileSystem.Instance.ThrowItemDirected("arrow", origin, aim.direction, 26f);
        RuntimeHud.Toast("🏹 矢を放った！");
    }

    // ── 炎魔法（R長押しでチャージ、離すと発射） ────────
    void UpdateFireMagic()
    {
        bool placing = PlacementSystem.Instance?.SelectedItem != null;
        if (!StatsManager.Instance.IsDead && !placing && !_bowAiming)
        {
            if (Input.GetKey(KeyCode.R))
            {
                _fireAiming = true;
                _fireChargeTime += Time.deltaTime;
                int pct = Mathf.RoundToInt(Mathf.Clamp01(_fireChargeTime / FireMaxChargeTime) * 100f);
                int filled = Mathf.RoundToInt(pct / 10f);
                string bar = new string('█', filled) + new string('░', 10 - filled);
                AimHint = $"🔥 チャージ {bar} {pct}%{(pct >= 100 ? " MAX" : "")}  [R を離す]";
                return;
            }

            if (_fireAiming)
            {
                float charge = Mathf.Clamp01(_fireChargeTime / FireMaxChargeTime);
                _fireAiming = false;
                _fireChargeTime = 0f;
                AimHint = null;
                CastFire(charge);
            }
            return;
        }

        _fireAiming = false;
        _fireChargeTime = 0f;
    }

    void CastFire(float charge)
    {
        // チャージ量に応じてスタミナ消費も増加
        float cost = Mathf.Round(FireMagicStamina * (1f + charge));
        if (!StatsManager.Instance.SpendStamina(cost))
        {
            RuntimeHud.Toast("🔥 スタミナが足りない");
            return;
        }
        var player = PlayerTransform;
        if (player == null || ProjectileSystem.Instance == null) return;
        Ray aim = AimRay(player);
        Vector3 origin = aim.origin + aim.direction * 0.45f;
        ProjectileSystem.Instance.CastFireball(origin, aim.direction, charge);
        PlayerTransform?.GetComponentInChildren<PlayerAnimatorController>()?.TriggerAttack();
        RuntimeHud.Toast(charge > 0.6f ? "🔥 特大の炎魔法を放った！" : "🔥 炎魔法を放った！");
    }

    // ── 投擲（Tキー） ─────────────────────────────
    void ThrowSelected(InventoryManager inv)
    {
        if (StatsManager.Instance.IsDead || PlacementSystem.Instance?.SelectedItem != null || _bowAiming) return;
        string id = PickThrowItem(inv);
        if (string.IsNullOrEmpty(id))
        {
            RuntimeHud.Toast("投げられるアイテムがない");
            return;
        }
        inv.Remove(id);
        var player = PlayerTransform;
        if (player == null || ProjectileSystem.Instance == null) return;
        Vector3 origin = player.position + Vector3.up * 1.5f;
        ProjectileSystem.Instance.ThrowItem(id, origin, AimDirection(player), 0.32f);
        var item = inv.GetItem(id);
        RuntimeHud.Toast($"↗ {item?.displayName ?? id} を投げた");
    }

    string PickThrowItem(InventoryManager inv)
    {
        // 1) 装備中アイテムが投げられるなら最優先
        if (!string.IsNullOrEmpty(inv.Equipped) && IsThrowable(inv.Equipped) && inv.Has(inv.Equipped))
            return inv.Equipped;
        // 2) 優先順位順にフォールバック
        foreach (string id in ThrowPriority)
            if (inv.Has(id)) return id;
        return null;
    }

    public static bool IsThrowable(string id) => System.Array.IndexOf(ThrowPriority, id) >= 0;

    // ── 敵の笛 ────────────────────────────────────
    void BlowWhistle()
    {
        if (StatsManager.Instance.IsDead || PlacementSystem.Instance?.SelectedItem != null) return;
        if (_whistleTimer > 0)
        {
            RuntimeHud.Toast($"📯 笛はまだ吹けない（あと{Mathf.CeilToInt(_whistleTimer)}秒）");
            return;
        }
        var player = PlayerTransform;
        if (player == null || EnemyManager.Instance == null) return;
        _whistleTimer = whistleCooldown;
        PlayerTransform?.GetComponentInChildren<PlayerAnimatorController>()?.TriggerAttack();
        EnemyManager.Instance.CallEnemyHorde(player.position);
    }

    // 狙い方向: 一人称時は画面中央の照準レイ、通常時はプレイヤー正面。
    Ray AimRay(Transform player)
    {
        var cam = Camera.main != null ? Camera.main.GetComponent<ThirdPersonCamera>() : null;
        if (cam != null && cam.FPMode) return cam.GetAimRay();
        return new Ray(player.position + Vector3.up * 1.5f, player.forward);
    }

    Vector3 AimDirection(Transform player) => AimRay(player).direction;
}
