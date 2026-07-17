using System.Collections.Generic;
using UnityEngine;

// 敵に与えたダメージを 3D 位置に追従するフローティング数値として表示（damageText.js の移植）
public class DamageTextSystem : MonoBehaviour
{
    const float Life = 0.9f; // 表示秒数
    const float Rise = 1.1f; // 上昇量（ワールド単位）

    class Item
    {
        public Vector3 pos;
        public float age;
        public string text;
        public bool crit;
    }

    static DamageTextSystem _instance;
    readonly List<Item> _items = new();
    GUIStyle _style;

    void Awake()
    {
        if (_instance != null) { Destroy(gameObject); return; }
        _instance = this;
    }

    public static void Spawn(Vector3 worldPos, float amount, bool crit = false)
    {
        if (_instance == null) return;
        int val = Mathf.Max(1, Mathf.RoundToInt(amount));
        // 少し横にばらけさせて重なりを防ぐ
        worldPos.x += (Random.value - 0.5f) * 0.4f;
        worldPos.z += (Random.value - 0.5f) * 0.4f;
        _instance._items.Add(new Item
        {
            pos = worldPos,
            text = crit ? $"{val}!" : val.ToString(),
            crit = crit,
        });
    }

    void Update()
    {
        for (int i = _items.Count - 1; i >= 0; i--)
        {
            _items[i].age += Time.deltaTime;
            if (_items[i].age >= Life) _items.RemoveAt(i);
        }
    }

    void OnGUI()
    {
        if (_items.Count == 0) return;
        var cam = Camera.main;
        if (cam == null) return;

        _style ??= new GUIStyle(GUI.skin.label)
        {
            fontStyle = FontStyle.Bold,
            alignment = TextAnchor.MiddleCenter,
        };

        foreach (var it in _items)
        {
            float t = it.age / Life;
            Vector3 world = it.pos + Vector3.up * (Rise * t);
            Vector3 screen = cam.WorldToScreenPoint(world);
            if (screen.z <= 0) continue; // カメラ後方なら隠す

            float alpha = 1f - t * t; // 終盤でフェードアウト
            _style.fontSize = it.crit ? 26 : 20;
            var rect = new Rect(screen.x - 60, Screen.height - screen.y - 14, 120, 28);

            // 縁取り（黒）+ 本体
            var shadow = new Color(0, 0, 0, alpha);
            var color = it.crit
                ? new Color(1f, 0.87f, 0.20f, alpha)
                : new Color(1f, 0.42f, 0.29f, alpha);
            _style.normal.textColor = shadow;
            GUI.Label(new Rect(rect.x + 1, rect.y + 1, rect.width, rect.height), it.text, _style);
            _style.normal.textColor = color;
            GUI.Label(rect, it.text, _style);
        }
    }
}
