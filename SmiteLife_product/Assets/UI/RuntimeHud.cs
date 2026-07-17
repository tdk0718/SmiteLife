using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class RuntimeHud : MonoBehaviour
{
    public static bool RotateLeftHeld { get; private set; }
    public static bool RotateRightHeld { get; private set; }

    public static bool PointerHeldOverRotateLeftButton() => PointerHeld() && RotateLeftButtonRect().Contains(GuiPointerPosition());
    public static bool PointerHeldOverRotateRightButton() => PointerHeld() && RotateRightButtonRect().Contains(GuiPointerPosition());
    public static bool PointerDownOverRotationButtons()
    {
        if (!PointerDown()) return false;
        Vector2 pos = GuiPointerPosition();
        return RotateLeftButtonRect().Contains(pos) || RotateRightButtonRect().Contains(pos);
    }

    Vector2 _scroll;
    GUIStyle _box;
    GUIStyle _button;
    GUIStyle _barLabel;
    GUIStyle _toastStyle;
    GUIStyle _petStyle;
    static Texture2D _whiteTex;

    // ── トースト通知（Inventory.showPickup 相当） ─────
    class ToastItem { public string text; public float age; }
    static readonly List<ToastItem> _toasts = new();
    const float ToastLife = 3.2f;

    public static void Toast(string message)
    {
        _toasts.Add(new ToastItem { text = message });
        if (_toasts.Count > 6) _toasts.RemoveAt(0);
    }

    // ペットステータスパネル（Lキー）
    bool _petPanelOpen;
    int _petSelected;

    void Update()
    {
        for (int i = _toasts.Count - 1; i >= 0; i--)
        {
            _toasts[i].age += Time.deltaTime;
            if (_toasts[i].age >= ToastLife) _toasts.RemoveAt(i);
        }

        if (Input.GetKeyDown(KeyCode.L))
        {
            if (_petPanelOpen) _petPanelOpen = false;
            else
            {
                var tamed = EnemyManager.Instance?.GetTamedAnimals();
                if (tamed == null || tamed.Count == 0) Toast("🐺 テイムした動物がいない");
                else { _petPanelOpen = true; _petSelected = -1; }
            }
        }
        if (Input.GetKeyDown(KeyCode.Escape)) _petPanelOpen = false;
    }

    void OnGUI()
    {
        InitStyles();
        DrawVitals();
        DrawInventory();
        DrawCrafting();
        DrawStorage();
        DrawPlacementHint();
        DrawRotationButtons();
        DrawCrosshair();
        DrawToasts();
        DrawTamedHud();
        DrawPetPanel();
    }

    void InitStyles()
    {
        if (_box != null) return;
        _box = new GUIStyle(GUI.skin.box) { fontSize = 14, alignment = TextAnchor.UpperLeft };
        _button = new GUIStyle(GUI.skin.button) { fontSize = 13, alignment = TextAnchor.MiddleCenter };
        _barLabel = new GUIStyle(GUI.skin.label) { fontSize = 13, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
        _toastStyle = new GUIStyle(GUI.skin.label) { fontSize = 15, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
        _petStyle = new GUIStyle(GUI.skin.label) { fontSize = 13, alignment = TextAnchor.UpperRight };
        if (_whiteTex == null)
        {
            _whiteTex = new Texture2D(1, 1);
            _whiteTex.SetPixel(0, 0, Color.white);
            _whiteTex.Apply();
        }
    }

    void DrawVitals()
    {
        var stats = StatsManager.Instance;
        var prog = ProgressionManager.Instance;
        var time = FindAnyObjectByType<DayNightWeatherSystem>();
        if (stats == null || prog == null) return;
        GUILayout.BeginArea(new Rect(10, 10, 430, 210), _box);
        GUILayout.Space(4);
        DrawStatusBar(GUILayoutUtility.GetRect(400, 22), "HP", stats.Hp, stats.MaxHp, new Color(0.78f, 0.15f, 0.14f), new Color(1.0f, 0.32f, 0.26f));
        DrawStatusBar(GUILayoutUtility.GetRect(400, 22), "空腹", stats.Hunger, stats.hungerMax, new Color(0.82f, 0.48f, 0.09f), new Color(1.0f, 0.68f, 0.16f));
        Color staminaA = stats.Exhausted ? new Color(0.48f, 0.22f, 0.12f) : new Color(0.10f, 0.50f, 0.68f);
        Color staminaB = stats.Exhausted ? new Color(0.72f, 0.36f, 0.12f) : new Color(0.22f, 0.75f, 0.88f);
        DrawStatusBar(GUILayoutUtility.GetRect(400, 22), "スタミナ", stats.Stamina, stats.staminaMax, staminaA, staminaB);
        GUILayout.Space(4);
        GUILayout.Label($"Lv.{prog.Level}  XP {prog.Xp}/{prog.XpToNext()}  ATK {prog.AttackPower()} DEF {prog.Defense()}");
        if (time != null) GUILayout.Label($"{time.TimeString()}  Weather {time.WeatherName}");
        GUILayout.Label("WASD:移動  Shift:走る  Space:ジャンプ  Q:回避  F:攻撃/採取");
        GUILayout.Label("I:装備/食事  G:クラフト  T:投擲  R長押し:炎  L/P/O:仲間");
        GUILayout.EndArea();

        if (stats.IsDead)
        {
            var r = new Rect(Screen.width * 0.5f - 130, Screen.height * 0.5f - 40, 260, 80);
            GUI.Box(r, "You Died");
            if (GUI.Button(new Rect(r.x + 55, r.y + 42, 150, 28), "Respawn"))
                RespawnAtBed(stats);
        }
    }

    void DrawStatusBar(Rect rect, string label, float value, float max, Color fillA, Color fillB)
    {
        float pct = max > 0 ? Mathf.Clamp01(value / max) : 0f;
        var bg = new Rect(rect.x, rect.y + 2, rect.width, rect.height - 4);
        DrawRect(bg, new Color(0.04f, 0.05f, 0.06f, 0.82f));
        DrawRect(new Rect(bg.x + 2, bg.y + 2, Mathf.Max(0, (bg.width - 4) * pct), bg.height - 4), fillA);
        DrawRect(new Rect(bg.x + 2, bg.y + 2, Mathf.Max(0, (bg.width - 4) * pct), (bg.height - 4) * 0.45f), fillB);

        _barLabel.normal.textColor = Color.white;
        GUI.Label(bg, $"{label} {Mathf.CeilToInt(value)}/{Mathf.RoundToInt(max)}", _barLabel);
    }

    static void DrawRect(Rect rect, Color color)
    {
        Color old = GUI.color;
        GUI.color = color;
        GUI.DrawTexture(rect, _whiteTex);
        GUI.color = old;
    }

    // ベッドがあればそこで、なければ原点で復活
    void RespawnAtBed(StatsManager stats)
    {
        stats.Respawn();
        var player = GameObject.FindGameObjectWithTag("Player")?.GetComponent<PlayerController>();
        if (player == null) return;

        RuntimePlacedObject nearestBed = null;
        float best = float.MaxValue;
        foreach (var obj in FindObjectsByType<RuntimePlacedObject>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
        {
            if (obj.itemId != "bed") continue;
            float d = Vector3.Distance(player.transform.position, obj.transform.position);
            if (d < best) { best = d; nearestBed = obj; }
        }

        Vector3 pos;
        if (nearestBed != null)
        {
            pos = nearestBed.transform.position + Vector3.up * 1.2f;
            Toast("🛏 ベッドで復活した");
        }
        else
        {
            float y = RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.GroundHeight(Vector3.zero) + 2f : 3f;
            pos = new Vector3(0, y, 0);
        }
        // 地中/場外に湧かないよう、現在の地形高さへ持ち上げる（埋没ベッド対策）
        var rwb = RuntimeWorldBuilder.Instance;
        if (rwb != null)
        {
            float ground = rwb.GroundHeight(pos);
            if (pos.y < ground + 1.0f) pos.y = ground + 1.0f;
        }
        player.WarpTo(pos);
    }

    void DrawInventory()
    {
        var inv = InventoryManager.Instance;
        if (inv == null || (!Input.GetKey(KeyCode.I) && !Input.GetKey(KeyCode.Tab))) return;
        GUILayout.BeginArea(new Rect(Screen.width - 320, 10, 310, 430), _box);
        GUILayout.Label($"Inventory  Equipped: {inv.Equipped ?? "-"}");
        _scroll = GUILayout.BeginScrollView(_scroll);
        foreach (var kv in inv.Counts.Where(kv => kv.Value > 0).OrderBy(kv => kv.Key))
        {
            var item = inv.GetItem(kv.Key);
            GUILayout.BeginHorizontal();
            GUILayout.Label($"{item.icon} {item.displayName} x{kv.Value}", GUILayout.Width(180));
            if ((item.edible || item.isTool) && GUILayout.Button(item.edible ? "Use" : "Equip", _button, GUILayout.Width(55)))
                inv.Use(kv.Key);
            if (ItemCatalog.Placeable.Contains(kv.Key) && GUILayout.Button("Place", _button, GUILayout.Width(55)))
                PlacementSystem.Instance?.Select(kv.Key);
            GUILayout.EndHorizontal();
        }
        GUILayout.EndScrollView();
        GUILayout.EndArea();
    }

    void DrawCrafting()
    {
        var craft = CraftingSystem.Instance;
        var inv = InventoryManager.Instance;
        if (craft == null || inv == null || !craft.MenuOpen) return;
        GUILayout.BeginArea(new Rect(10, 230, 430, 480), _box);
        GUILayout.Label(craft.NearWorkbench ? "Crafting - Workbench nearby" : "Crafting");
        foreach (var recipe in craft.recipes)
        {
            var item = inv.GetItem(recipe.result);
            bool can = craft.CanCraft(recipe);
            GUILayout.BeginHorizontal();
            GUILayout.Label($"{item?.icon ?? ""} {item?.displayName ?? recipe.result} x{recipe.quantity}", GUILayout.Width(170));
            GUILayout.Label(string.Join(", ", recipe.costs.Select(c => $"{c.itemId}:{craft.SourceCount(c.itemId)}/{c.count}")), GUILayout.Width(180));
            GUI.enabled = can;
            if (GUILayout.Button("Craft", _button, GUILayout.Width(60))) craft.Craft(recipe.result);
            GUI.enabled = true;
            GUILayout.EndHorizontal();
        }
        GUILayout.EndArea();
    }

    void DrawStorage()
    {
        var obj = RuntimeStorageSystem.OpenObject;
        var inv = InventoryManager.Instance;
        if (obj == null || inv == null) return;

        GUILayout.BeginArea(new Rect(Screen.width * 0.5f - 250, 120, 500, 520), _box);
        GUILayout.BeginHorizontal();
        GUILayout.Label($"{obj.itemId} Box  {obj.Total()}/{obj.Capacity}");
        if (GUILayout.Button("Close", _button, GUILayout.Width(70))) RuntimeStorageSystem.Close();
        GUILayout.EndHorizontal();
        GUILayout.Label(obj.StatusText());
        if (!string.IsNullOrEmpty(RuntimeStorageSystem.Message))
            GUILayout.Label(RuntimeStorageSystem.Message);

        GUILayout.Space(8);
        GUILayout.Label("Box");
        if (obj.box.Count == 0) GUILayout.Label("(empty)");
        foreach (var item in obj.box.ToArray())
        {
            var data = inv.GetItem(item.id);
            GUILayout.BeginHorizontal();
            GUILayout.Label($"{data?.icon ?? ""} {data?.displayName ?? item.id} x{item.count}", GUILayout.Width(260));
            if (GUILayout.Button("Take", _button, GUILayout.Width(70))) RuntimeStorageSystem.MoveToInventory(item.id, false);
            if (GUILayout.Button("All", _button, GUILayout.Width(70))) RuntimeStorageSystem.MoveToInventory(item.id, true);
            GUILayout.EndHorizontal();
        }

        GUILayout.Space(8);
        GUILayout.Label("Inventory");
        var held = RuntimeStorageSystem.AcceptedHeldItemIds();
        if (held.Length == 0) GUILayout.Label("入れられるアイテムを持っていません");
        foreach (string id in held)
        {
            var data = inv.GetItem(id);
            GUILayout.BeginHorizontal();
            GUILayout.Label($"{data?.icon ?? ""} {data?.displayName ?? id} x{inv.Count(id)}", GUILayout.Width(260));
            if (GUILayout.Button("Put", _button, GUILayout.Width(70))) RuntimeStorageSystem.MoveToBox(id, false);
            if (GUILayout.Button("All", _button, GUILayout.Width(70))) RuntimeStorageSystem.MoveToBox(id, true);
            GUILayout.EndHorizontal();
        }
        GUILayout.EndArea();
    }

    void DrawPlacementHint()
    {
        var placement = PlacementSystem.Instance;
        var combat = FindAnyObjectByType<CombatAbilitySystem>();
        if (combat != null && !string.IsNullOrEmpty(combat.AimHint))
        {
            GUI.Box(new Rect(Screen.width * 0.5f - 190, Screen.height - 70, 380, 46), combat.AimHint);
            return;
        }
        if (placement == null || placement.SelectedItem == null) return;
        GUI.Box(new Rect(Screen.width * 0.5f - 190, Screen.height - 70, 380, 46),
            $"Placing: {placement.SelectedItem}  LeftClick:置く  Z/X:回転  Esc/B:キャンセル");
    }

    void DrawRotationButtons()
    {
        RotateLeftHeld = GUI.RepeatButton(RotateLeftButtonRect(), "左", _button);
        RotateRightHeld = GUI.RepeatButton(RotateRightButtonRect(), "右", _button);
    }

    void DrawCrosshair()
    {
        var cam = Camera.main != null ? Camera.main.GetComponent<ThirdPersonCamera>() : null;
        if (cam == null || !cam.FPMode) return;

        var combat = FindAnyObjectByType<CombatAbilitySystem>();
        bool aiming = combat != null && combat.IsAiming;
        Color color = aiming ? Color.white : new Color(0.25f, 1f, 0.45f, 0.95f);
        var placement = PlacementSystem.Instance;
        if (!aiming && placement != null && placement.SelectedItem != null)
            color = new Color(0.2f, 0.8f, 1f, 0.95f);

        float cx = Screen.width * 0.5f;
        float cy = Screen.height * 0.5f;
        DrawRect(new Rect(cx - 12f, cy - 1f, 9f, 2f), color);
        DrawRect(new Rect(cx + 3f, cy - 1f, 9f, 2f), color);
        DrawRect(new Rect(cx - 1f, cy - 12f, 2f, 9f), color);
        DrawRect(new Rect(cx - 1f, cy + 3f, 2f, 9f), color);
        DrawRect(new Rect(cx - 2f, cy - 2f, 4f, 4f), new Color(color.r, color.g, color.b, 0.55f));
    }

    static Rect RotateLeftButtonRect()
    {
        float size = RotationButtonSize();
        return new Rect(18f, Screen.height - size - 18f, size, size);
    }

    static Rect RotateRightButtonRect()
    {
        float size = RotationButtonSize();
        return new Rect(18f + size + 12f, Screen.height - size - 18f, size, size);
    }

    static float RotationButtonSize() => Mathf.Clamp(Screen.width * 0.13f, 64f, 96f);

    static Vector2 GuiPointerPosition()
    {
        Vector3 p = Input.touchCount > 0 ? (Vector3)Input.GetTouch(0).position : Input.mousePosition;
        return new Vector2(p.x, Screen.height - p.y);
    }

    static bool PointerHeld()
    {
        if (Input.GetMouseButton(0)) return true;
        for (int i = 0; i < Input.touchCount; i++)
        {
            TouchPhase phase = Input.GetTouch(i).phase;
            if (phase == TouchPhase.Began || phase == TouchPhase.Moved || phase == TouchPhase.Stationary) return true;
        }
        return false;
    }

    static bool PointerDown()
    {
        if (Input.GetMouseButtonDown(0)) return true;
        for (int i = 0; i < Input.touchCount; i++)
            if (Input.GetTouch(i).phase == TouchPhase.Began) return true;
        return false;
    }

    // 画面下部中央のトースト通知
    void DrawToasts()
    {
        float y = Screen.height - 120f;
        for (int i = _toasts.Count - 1; i >= 0; i--)
        {
            var t = _toasts[i];
            float alpha = Mathf.Clamp01((ToastLife - t.age) / 0.6f);
            var shadow = new Color(0, 0, 0, alpha);
            var rect = new Rect(Screen.width * 0.5f - 320, y, 640, 24);
            _toastStyle.normal.textColor = shadow;
            GUI.Label(new Rect(rect.x + 1, rect.y + 1, rect.width, rect.height), t.text, _toastStyle);
            _toastStyle.normal.textColor = new Color(1f, 1f, 1f, alpha);
            GUI.Label(rect, t.text, _toastStyle);
            y -= 26f;
        }
    }

    // テイム動物HUD（右下）
    void DrawTamedHud()
    {
        var mgr = EnemyManager.Instance;
        if (mgr == null) return;
        var tamed = mgr.GetTamedAnimals();
        if (tamed.Count == 0) return;

        string orderLabel = mgr.TamedOrder == "attack" ? "🗡 攻撃を許可" : "🕊 攻撃禁止";
        string moveLabel = mgr.TamedMove == "follow" ? "🐾 追従" : "🌏 放浪";
        var lines = new List<string> { $"命令 [P]: {orderLabel} / [O]: {moveLabel}" };
        foreach (var w in tamed)
        {
            string icon = w.type?.icon ?? "🐺";
            string sex = w.sex == "female" ? "♀" : "♂";
            if (w.baby)
            {
                int m = Mathf.FloorToInt(w.starveTimer / 60f);
                int s = Mathf.FloorToInt(w.starveTimer % 60f);
                lines.Add($"{icon}🍼 赤ちゃん{sex} HP: {Mathf.Max(0, w.hp):0}/{w.maxHp:0}  餓死まで {m}:{s:00}");
            }
            else
            {
                string line = $"{icon}{sex} Lv.{w.tamedLevel} HP: {Mathf.Max(0, w.hp):0}/{w.maxHp:0}  XP: {w.tamedXp}";
                if (w.pregnant) line += $"  🤰出産まで約{Mathf.CeilToInt(w.pregnancyTimer / 60f)}分";
                lines.Add(line);
            }
        }
        float height = lines.Count * 18f + 6f;
        var area = new Rect(Screen.width - 372, Screen.height - 90 - height, 360, height);
        GUI.Label(area, string.Join("\n", lines), _petStyle);
    }

    // テイム動物ステータスパネル（Lキー）
    void DrawPetPanel()
    {
        if (!_petPanelOpen) return;
        var mgr = EnemyManager.Instance;
        var tamed = mgr?.GetTamedAnimals();
        if (tamed == null || tamed.Count == 0)
        {
            _petPanelOpen = false; // 対象が死亡/消滅したら閉じる
            return;
        }
        if (_petSelected >= tamed.Count) _petSelected = -1;

        var rect = new Rect(Screen.width * 0.5f - 280, Screen.height * 0.5f - 200, 560, 400);
        GUILayout.BeginArea(rect, _box);
        GUILayout.BeginHorizontal();
        GUILayout.Label("仲間のステータス [L で閉じる]");
        GUILayout.FlexibleSpace();
        if (GUILayout.Button("×", _button, GUILayout.Width(30))) _petPanelOpen = false;
        GUILayout.EndHorizontal();

        // 個体セレクタ
        GUILayout.BeginHorizontal();
        for (int i = 0; i < tamed.Count; i++)
        {
            var t = tamed[i];
            string label = $"{t.type.icon}{(t.sex == "female" ? "♀" : "♂")} Lv.{t.tamedLevel}";
            if (GUILayout.Button(label, _button, GUILayout.Width(110)))
                _petSelected = i == _petSelected ? -1 : i;
        }
        GUILayout.EndHorizontal();
        GUILayout.Space(6);

        if (_petSelected < 0)
        {
            DrawPetPanelAll(tamed);
            GUILayout.EndArea();
            return;
        }

        var pet = tamed[_petSelected];
        var stats = EnemyTypes.TamedStatsFor(pet.tamedLevel);

        // 状態表示（赤ちゃん / 妊娠中 / 通常）
        string status = "通常";
        if (pet.baby)
        {
            int growPct = Mathf.RoundToInt(Mathf.Min(1f, pet.growTimer / (mgr.BabyGrowTime)) * 100f);
            int sm = Mathf.FloorToInt(pet.starveTimer / 60f);
            int ss = Mathf.FloorToInt(pet.starveTimer % 60f);
            status = $"🍼 赤ちゃん（成長 {growPct}% / 餓死まで {sm}:{ss:00}）";
        }
        else if (pet.pregnant)
        {
            status = $"🤰 妊娠中（出産まで 約{Mathf.CeilToInt(pet.pregnancyTimer / 60f)}分）";
        }

        var player = GameObject.FindGameObjectWithTag("Player")?.transform;
        int distance = player != null ? Mathf.RoundToInt(pet.FlatDist(player.position)) : 0;
        int xpForNext = EnemyTypes.TamedXpForLevel(pet.tamedLevel + 1);

        GUILayout.Label($"名前: {pet.type.icon} {pet.type.displayName}");
        GUILayout.Label($"性別: {(pet.sex == "female" ? "♀ メス" : "♂ オス")}");
        GUILayout.Label($"状態: {status}");
        GUILayout.Label($"距離: 約 {distance}m");
        GUILayout.Label($"レベル: Lv.{pet.tamedLevel}");
        GUILayout.Label($"体力: {Mathf.Max(0, pet.hp):0} / {pet.maxHp:0}");
        GUILayout.Label($"攻撃力: {stats.dmg}");
        GUILayout.Label($"移動速度: {stats.speed:0.0}");
        GUILayout.Label($"体格: {Mathf.RoundToInt(stats.scale * 100)}%");
        GUILayout.Label($"経験値: {pet.tamedXp} / {xpForNext}（次まで {Mathf.Max(0, xpForNext - pet.tamedXp)}）");
        GUILayout.Space(4);
        GUILayout.Label("仲間が敵を倒すと経験値を得て成長します（体力・攻撃力・体格が向上）。\nLv.4以上のオスとメスが近くに揃うとメスが妊娠し、2日後に赤ちゃんが生まれます。");
        GUILayout.EndArea();
    }

    void DrawPetPanelAll(List<EnemyAI> tamed)
    {
        int babies = 0, pregnant = 0;
        float hp = 0, maxHp = 0;
        foreach (var pet in tamed)
        {
            if (pet.baby) babies++;
            if (pet.pregnant) pregnant++;
            hp += Mathf.Max(0, pet.hp);
            maxHp += pet.maxHp;
        }

        GUILayout.Label("対象: 全体");
        GUILayout.Label($"仲間数: {tamed.Count}");
        GUILayout.Label($"合計体力: {hp:0} / {maxHp:0}");
        GUILayout.Label($"赤ちゃん: {babies}  妊娠中: {pregnant}");
        GUILayout.Space(4);
        foreach (var pet in tamed)
        {
            string sex = pet.sex == "female" ? "♀" : "♂";
            string state = pet.baby ? "赤ちゃん" : pet.pregnant ? "妊娠中" : "通常";
            GUILayout.Label($"{pet.type.icon}{sex} Lv.{pet.tamedLevel}  HP {Mathf.Max(0, pet.hp):0}/{pet.maxHp:0}  {state}");
        }
        GUILayout.Space(4);
        GUILayout.Label("個体ボタンをクリックすると個別表示、選択中の個体をもう一度クリックすると全体表示に戻ります。");
    }
}
