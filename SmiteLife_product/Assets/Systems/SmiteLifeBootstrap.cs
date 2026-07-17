using UnityEngine;
#if UNITY_EDITOR
using UnityEditor;
#endif

public class SmiteLifeBootstrap : MonoBehaviour
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void EnsureScene()
    {
        if (FindAnyObjectByType<SmiteLifeBootstrap>() != null) return;
        new GameObject("SmiteLife Runtime").AddComponent<SmiteLifeBootstrap>();
    }

    void Awake()
    {
        EnsureManager<StatsManager>("StatsManager");
        EnsureManager<ProgressionManager>("ProgressionManager");
        EnsureManager<InventoryManager>("InventoryManager");
        EnsureManager<SaveSystem>("SaveSystem");
        EnsureManager<CraftingSystem>("CraftingSystem");
        EnsureManager<PlacementSystem>("PlacementSystem");
        EnsureManager<RuntimeStorageSystem>("RuntimeStorageSystem");
        EnsureManager<CombatAbilitySystem>("CombatAbilitySystem");
        EnsureManager<ProjectileSystem>("ProjectileSystem");
        EnsureManager<EnemyManager>("EnemyManager");
        EnsureManager<RuntimeFishSystem>("RuntimeFishSystem");
        EnsureManager<RuntimeWorldBuilder>("RuntimeWorldBuilder");
        EnsureManager<RuntimeHud>("RuntimeHud");
        EnsureManager<DamageTextSystem>("DamageTextSystem");
        EnsureLighting();
        EnsurePlayerAndCamera();
    }

    static void EnsureManager<T>(string name) where T : Component
    {
        if (FindAnyObjectByType<T>() != null) return;
        new GameObject(name).AddComponent<T>();
    }

    static void EnsureLighting()
    {
        Light sun = RenderSettings.sun;
        if (sun == null)
        {
            var obj = new GameObject("Sun");
            sun = obj.AddComponent<Light>();
            sun.type = LightType.Directional;
            RenderSettings.sun = sun;
        }
        if (FindAnyObjectByType<DayNightWeatherSystem>() == null)
        {
            var obj = new GameObject("DayNightWeatherSystem");
            var system = obj.AddComponent<DayNightWeatherSystem>();
            system.sun = sun;
        }
    }

    static void EnsurePlayerAndCamera()
    {
        GameObject player = GameObject.FindGameObjectWithTag("Player");
        if (player == null)
        {
            player = new GameObject("Player");
            player.tag = "Player";
            float y = RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.GroundHeight(Vector3.zero) + 2f : 3f;
            player.transform.position = new Vector3(0, y, 0);
            var cc = player.AddComponent<CharacterController>();
            cc.height = 1.9f;
            cc.radius = 0.35f;
            cc.center = Vector3.up * 0.95f;
            player.AddComponent<PlayerController>();
            player.AddComponent<GatherSystem>();

            CreatePlayerVisual(player.transform);
        }
        else
        {
            var visual = player.transform.Find("PlayerVisual");
            if (visual == null || ShouldReplaceLegacyVisual(visual))
            {
                if (visual != null) Destroy(visual.gameObject);
                CreatePlayerVisual(player.transform);
            }
        }

        Camera cam = Camera.main;
        if (cam == null)
        {
            var obj = new GameObject("Main Camera");
            cam = obj.AddComponent<Camera>();
            obj.tag = "MainCamera";
            obj.AddComponent<AudioListener>();
        }
        // GetComponent は欠落時に「偽null」スタブを返すことがあるため ?? は使わない
        var tpc = cam.GetComponent<ThirdPersonCamera>();
        if (tpc == null) tpc = cam.gameObject.AddComponent<ThirdPersonCamera>();
        tpc.target = player.transform;
    }

    static void CreatePlayerVisual(Transform parent)
    {
        GameObject prefab = Resources.Load<GameObject>("PlayerModel");
#if UNITY_EDITOR
        if (prefab == null)
        {
            prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Characters/model.fbx");
        }
#endif
        if (prefab != null)
        {
            var visual = Instantiate(prefab, parent);
            visual.name = "PlayerVisual";
            visual.transform.localPosition = Vector3.zero;
            // Mixamo モデルは +Z 向き。transform.forward が移動方向なので回転しない
            visual.transform.localRotation = Quaternion.identity;
            visual.transform.localScale = Vector3.one;
            ConfigurePlayerModel(visual);
            return;
        }

        CreateFallbackHumanoid(parent);
    }

    static bool ShouldReplaceLegacyVisual(Transform visual)
    {
        return visual.GetComponent<MeshFilter>() != null
            && visual.GetComponent<Animator>() == null
            && visual.GetComponentInChildren<SkinnedMeshRenderer>() == null;
    }

    static void ConfigurePlayerModel(GameObject visual)
    {
        foreach (var collider in visual.GetComponentsInChildren<Collider>())
        {
            Destroy(collider);
        }

        foreach (var renderer in visual.GetComponentsInChildren<Renderer>())
        {
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        var animator = visual.GetComponent<Animator>();
        if (animator == null) animator = visual.AddComponent<Animator>();
#if UNITY_EDITOR
        if (animator.avatar == null)
        {
            foreach (var asset in AssetDatabase.LoadAllAssetsAtPath("Assets/Characters/model.fbx"))
                if (asset is Avatar avatar) { animator.avatar = avatar; break; }
        }
#endif
        if (animator.runtimeAnimatorController == null)
        {
            var controller = Resources.Load<RuntimeAnimatorController>("PlayerAnimator");
#if UNITY_EDITOR
            if (controller == null)
            {
                controller = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>("Assets/Characters/PlayerAnimator.controller");
            }
#endif
            animator.runtimeAnimatorController = controller;
        }
        if (visual.GetComponent<PlayerAnimatorController>() == null)
        {
            visual.AddComponent<PlayerAnimatorController>();
        }
        if (visual.GetComponent<PlayerHandItem>() == null)
        {
            visual.AddComponent<PlayerHandItem>();
        }
    }

    static void CreateFallbackHumanoid(Transform parent)
    {
        var visual = new GameObject("PlayerVisual");
        visual.transform.SetParent(parent, false);

        var skinMat = MakeVisualMat(new Color(0.88f, 0.66f, 0.47f));
        var bodyMat = MakeVisualMat(new Color(0.23f, 0.43f, 0.65f));
        var legMat = MakeVisualMat(new Color(0.22f, 0.27f, 0.32f));

        AddPart(visual.transform, PrimitiveType.Capsule, "Torso", bodyMat, new Vector3(0, 1.15f, 0), Quaternion.identity, new Vector3(0.56f, 0.78f, 0.56f));
        AddPart(visual.transform, PrimitiveType.Sphere, "Head", skinMat, new Vector3(0, 1.72f, 0), Quaternion.identity, new Vector3(0.48f, 0.48f, 0.48f));
        AddPart(visual.transform, PrimitiveType.Capsule, "LeftArm", skinMat, new Vector3(-0.38f, 1.2f, 0), Quaternion.Euler(0, 0, 12f), new Vector3(0.18f, 0.62f, 0.18f));
        AddPart(visual.transform, PrimitiveType.Capsule, "RightArm", skinMat, new Vector3(0.38f, 1.2f, 0), Quaternion.Euler(0, 0, -12f), new Vector3(0.18f, 0.62f, 0.18f));
        AddPart(visual.transform, PrimitiveType.Capsule, "LeftLeg", legMat, new Vector3(-0.15f, 0.5f, 0), Quaternion.identity, new Vector3(0.22f, 0.7f, 0.22f));
        AddPart(visual.transform, PrimitiveType.Capsule, "RightLeg", legMat, new Vector3(0.15f, 0.5f, 0), Quaternion.identity, new Vector3(0.22f, 0.7f, 0.22f));
    }

    static void AddPart(Transform parent, PrimitiveType type, string name, Material mat, Vector3 pos, Quaternion rot, Vector3 scale)
    {
        var part = GameObject.CreatePrimitive(type);
        part.name = name;
        part.transform.SetParent(parent, false);
        part.transform.localPosition = pos;
        part.transform.localRotation = rot;
        part.transform.localScale = scale;
        part.GetComponent<Renderer>().sharedMaterial = mat;
        Destroy(part.GetComponent<Collider>());
    }

    static Material MakeVisualMat(Color color)
    {
        Shader shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        var mat = new Material(shader);
        mat.color = color;
        return mat;
    }

}
