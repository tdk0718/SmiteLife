using System.Collections.Generic;
using UnityEngine;

public static class ItemCatalog
{
    static bool _registered;

    public static void RegisterDefaults(InventoryManager inv)
    {
        if (inv == null || _registered) return;
        _registered = true;

        Add(inv, "wood", "木材", "W");
        Add(inv, "straw", "藁", "S");
        Add(inv, "stone", "石", "R");
        Add(inv, "flint", "火打石", "F");
        Add(inv, "iron_ore", "鉄鉱石", "IO");
        Add(inv, "copper_ore", "銅鉱石", "CO");
        Add(inv, "coal", "石炭", "CL");
        Add(inv, "charcoal", "木炭", "CH");
        Add(inv, "iron_ingot", "鉄インゴット", "II");
        Add(inv, "copper_ingot", "銅インゴット", "CI");
        Add(inv, "fur", "毛皮", "FR");

        Add(inv, "meat", "生肉", "M", edible: true, hunger: 25, hp: -5);
        Add(inv, "cooked_meat", "焼き肉", "CM", edible: true, hunger: 40, hp: 8);
        Add(inv, "raw_fish", "生魚", "FI", edible: true, hunger: 15, hp: -2);
        Add(inv, "cooked_fish", "焼き魚", "CF", edible: true, hunger: 30, hp: 6);
        Add(inv, "mushroom", "食用キノコ", "MU", edible: true, hunger: 12, hp: 3);
        Add(inv, "toxic_mushroom", "毒キノコ", "TX", edible: true, hunger: 8, hp: -18);
        Add(inv, "anesthetic_mushroom", "麻酔キノコ", "AM", edible: true, hunger: 10, hp: -3, slow: true);
        Add(inv, "medicine_mushroom", "薬キノコ", "MD", edible: true, hunger: 5, hp: 22);

        Add(inv, "stone_axe", "石斧", "AX", tool: true, category: "tree", gather: 2, attack: 1);
        Add(inv, "stone_pickaxe", "石のツルハシ", "PX", tool: true, category: "rock", gather: 2, attack: 1);
        Add(inv, "stone_knife", "石ナイフ", "KN", tool: true, gather: 1, attack: 2);
        Add(inv, "iron_axe", "鉄の斧", "IA", tool: true, category: "tree", gather: 3, attack: 2);
        Add(inv, "iron_pickaxe", "鉄のツルハシ", "IP", tool: true, category: "rock", gather: 3, attack: 2);
        Add(inv, "iron_hammer", "鉄のハンマー", "IH", tool: true, gather: 1, attack: 3);
        Add(inv, "fire_starter", "火打ち道具", "FS", tool: true);
        Add(inv, "torch", "松明", "TC", tool: true);
        Add(inv, "bow", "弓", "BW", tool: true, ranged: true);
        Add(inv, "arrow", "矢", "AR");
        Add(inv, "enemy_whistle", "敵を呼ぶ笛", "WH", tool: true);

        Add(inv, "stone_block", "石ブロック", "SB");
        Add(inv, "stone_foundation", "石の基礎", "SF");
        Add(inv, "straw_rope", "藁ロープ", "RP");
        Add(inv, "plank", "板材", "PL");
        Add(inv, "wooden_fence", "木の柵", "FN");
        Add(inv, "pillar", "木の柱", "PI");
        Add(inv, "wall_panel", "木の壁材", "WA");
        Add(inv, "window_wall", "窓付き壁", "WW");
        Add(inv, "roof_panel", "屋根材", "RF");
        Add(inv, "door", "ドア", "DR");
        Add(inv, "door_frame_wall", "ドア枠付き壁", "DF");
        Add(inv, "floor_board", "床材", "FL");
        Add(inv, "workbench", "作業台", "WB");
        Add(inv, "furnace", "簡易炉", "FU");
        Add(inv, "lathe", "旋盤", "LA");
        Add(inv, "bed", "ベッド", "BD");
    }

    static void Add(
        InventoryManager inv,
        string id,
        string displayName,
        string icon,
        bool edible = false,
        float hunger = 0,
        float hp = 0,
        bool tool = false,
        string category = "",
        int gather = 0,
        int attack = 0,
        bool ranged = false,
        bool slow = false)
    {
        var data = ScriptableObject.CreateInstance<ItemData>();
        data.displayName = displayName;
        data.icon = icon;
        data.edible = edible;
        data.hungerAmount = hunger;
        data.hpAmount = hp;
        data.isTool = tool;
        data.toolCategory = category;
        data.gatherMult = gather;
        data.attackBonus = attack;
        data.isRanged = ranged;
        data.slow = slow;
        inv.RegisterItem(id, data);
    }

    public static readonly HashSet<string> Placeable = new()
    {
        "wood", "straw", "stone", "torch", "coal", "stone_block", "stone_foundation",
        "wooden_fence", "pillar", "wall_panel", "window_wall", "roof_panel", "door",
        "door_frame_wall", "floor_board", "workbench", "bed", "furnace", "lathe"
    };
}
