using UnityEditor;
using UnityEngine;

public static class SmiteLifePlayerModelPrefabBuilder
{
    const string ModelPath = "Assets/Characters/model.fbx";
    const string ControllerPath = "Assets/Characters/PlayerAnimator.controller";
    const string ResourcesDir = "Assets/Resources";
    const string PrefabPath = "Assets/Resources/PlayerModel.prefab";

    [InitializeOnLoadMethod]
    static void EnsurePrefab()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode) return;
        if (AssetDatabase.LoadAssetAtPath<GameObject>(PrefabPath) != null) return;

        var model = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
        if (model == null) return;

        if (!AssetDatabase.IsValidFolder(ResourcesDir))
        {
            AssetDatabase.CreateFolder("Assets", "Resources");
        }

        var instance = PrefabUtility.InstantiatePrefab(model) as GameObject;
        if (instance == null) return;

        try
        {
            instance.name = "PlayerModel";
            instance.transform.position = Vector3.zero;
            instance.transform.rotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one;

            foreach (var collider in instance.GetComponentsInChildren<Collider>())
            {
                Object.DestroyImmediate(collider);
            }

            foreach (var renderer in instance.GetComponentsInChildren<Renderer>())
            {
                renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
                renderer.receiveShadows = true;
            }

            // GetComponent は欠落時に「偽null」スタブを返すことがあるため ?? は使わない
            var animator = instance.GetComponent<Animator>();
            if (animator == null) animator = instance.AddComponent<Animator>();
            if (animator.avatar == null)
            {
                foreach (var asset in AssetDatabase.LoadAllAssetsAtPath(ModelPath))
                    if (asset is Avatar avatar) { animator.avatar = avatar; break; }
            }
            var controller = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(ControllerPath);
            if (controller != null) animator.runtimeAnimatorController = controller;
            if (instance.GetComponent<PlayerAnimatorController>() == null)
            {
                instance.AddComponent<PlayerAnimatorController>();
            }

            PrefabUtility.SaveAsPrefabAsset(instance, PrefabPath);
        }
        finally
        {
            Object.DestroyImmediate(instance);
        }
    }
}
