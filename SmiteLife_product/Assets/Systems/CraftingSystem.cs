using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class CraftingSystem : MonoBehaviour
{
    public static CraftingSystem Instance { get; private set; }

    [System.Serializable]
    public class Recipe
    {
        public string result;
        public int quantity = 1;
        public bool workbenchOnly;
        public string[] requiredTools = new string[0];
        public Cost[] costs = new Cost[0];
    }

    [System.Serializable]
    public class Cost { public string itemId; public int count; }

    public List<Recipe> recipes = new();
    public bool MenuOpen { get; private set; }
    public bool NearWorkbench { get; set; }
    public RuntimePlacedObject ActiveWorkbench { get; set; }

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        if (recipes.Count == 0) recipes.AddRange(DefaultRecipes());
    }

    void Update()
    {
        if (Input.GetKeyDown(KeyCode.G)) MenuOpen = !MenuOpen;
        if (Input.GetKeyDown(KeyCode.Escape)) MenuOpen = false;
    }

    public bool IsCraftMaterial(string id)
    {
        foreach (var recipe in recipes)
        foreach (var cost in recipe.costs)
            if (cost.itemId == id) return true;
        return false;
    }

    public bool CanCraft(Recipe recipe)
    {
        var inv = InventoryManager.Instance;
        if (recipe == null || inv == null) return false;
        if (recipe.workbenchOnly && !NearWorkbench) return false;
        if (recipe.requiredTools.Length > 0 && !recipe.requiredTools.Any(t => inv.Has(t))) return false;
        foreach (var cost in recipe.costs)
            if (SourceCount(cost.itemId) < cost.count) return false;
        return true;
    }

    public bool Craft(string resultId)
    {
        var recipe = recipes.FirstOrDefault(r => r.result == resultId);
        var inv = InventoryManager.Instance;
        if (!CanCraft(recipe) || inv == null) return false;
        foreach (var cost in recipe.costs) RemoveFromSource(cost.itemId, cost.count);
        if (ActiveWorkbench != null && (ActiveWorkbench.itemId == "workbench" || ActiveWorkbench.itemId == "lathe"))
            ActiveWorkbench.Add(recipe.result, recipe.quantity);
        else
            inv.Add(recipe.result, recipe.quantity);
        SaveSystem.Instance?.Save();
        return true;
    }

    public int SourceCount(string id)
    {
        if (ActiveWorkbench != null && (ActiveWorkbench.itemId == "workbench" || ActiveWorkbench.itemId == "lathe"))
            return ActiveWorkbench.Count(id);
        return InventoryManager.Instance?.Count(id) ?? 0;
    }

    bool RemoveFromSource(string id, int qty)
    {
        if (ActiveWorkbench != null && (ActiveWorkbench.itemId == "workbench" || ActiveWorkbench.itemId == "lathe"))
            return ActiveWorkbench.Remove(id, qty);
        return InventoryManager.Instance?.Remove(id, qty) == true;
    }

    static IEnumerable<Recipe> DefaultRecipes()
    {
        yield return R("stone_axe", C("wood", 2), C("stone", 3), C("straw", 1));
        yield return R("stone_pickaxe", C("wood", 2), C("stone", 3), C("straw", 2));
        yield return R("stone_knife", C("wood", 1), C("stone", 2));
        yield return R("fire_starter", C("flint", 1), C("straw", 2), C("wood", 1));
        yield return R("torch", C("wood", 1), C("straw", 2));
        yield return R("stone_block", C("stone", 4));
        yield return R("stone_foundation", C("stone", 6));
        yield return R("straw_rope", C("straw", 3));
        yield return R("plank", new[] { "stone_axe", "stone_knife" }, C("wood", 2));
        yield return R("wooden_fence", C("plank", 2), C("straw_rope", 1));
        yield return R("pillar", C("plank", 2));
        yield return R("floor_board", C("plank", 2));
        yield return R("wall_panel", C("plank", 3));
        yield return R("window_wall", C("plank", 3), C("straw_rope", 1));
        yield return R("roof_panel", C("plank", 3));
        yield return R("door", C("plank", 3), C("straw_rope", 1));
        yield return R("door_frame_wall", C("plank", 3), C("straw_rope", 1));
        yield return R("workbench", new[] { "stone_axe", "stone_knife" }, C("plank", 4), C("straw_rope", 2));
        yield return R("bed", C("wood", 3), C("straw", 4));
        yield return R("bow", C("wood", 2), C("straw_rope", 1));
        yield return R("arrow", 3, C("stone", 1), C("wood", 1));
        yield return R("enemy_whistle", C("wood", 1), C("straw_rope", 1), C("flint", 1));
        yield return R("furnace", C("stone", 8));
        yield return R("lathe", true, C("iron_ingot", 4));
        yield return R("iron_axe", true, C("iron_ingot", 2), C("wood", 2));
        yield return R("iron_pickaxe", true, C("iron_ingot", 2), C("wood", 2));
        yield return R("iron_hammer", true, C("iron_ingot", 3), C("wood", 2));
    }

    static Cost C(string itemId, int count) => new() { itemId = itemId, count = count };
    static Recipe R(string result, params Cost[] costs) => new() { result = result, costs = costs };
    static Recipe R(string result, int qty, params Cost[] costs) => new() { result = result, quantity = qty, costs = costs };
    static Recipe R(string result, bool bench, params Cost[] costs) => new() { result = result, workbenchOnly = bench, costs = costs };
    static Recipe R(string result, string[] tools, params Cost[] costs) => new() { result = result, requiredTools = tools, costs = costs };
}
