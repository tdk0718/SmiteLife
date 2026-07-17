using UnityEditor;
using UnityEngine;

// 移動系アニメーションのループ設定を保証する。
// loopTime が無効だと歩行/走行モーションが1回再生されたまま止まってしまう。
public static class SmiteLifeAnimImportFixer
{
    static readonly string[] LoopingClips =
    {
        "Assets/Characters/anim_idle.fbx",
        "Assets/Characters/anim_walk.fbx",
        "Assets/Characters/anim_run.fbx",
        "Assets/Characters/anim_swim.fbx",
    };

    [InitializeOnLoadMethod]
    static void EnsureLoopSettings()
    {
        EditorApplication.delayCall += () =>
        {
            foreach (string path in LoopingClips) FixLoop(path);
        };
    }

    static void FixLoop(string path)
    {
        var importer = AssetImporter.GetAtPath(path) as ModelImporter;
        if (importer == null) return;

        var clips = importer.clipAnimations;
        if (clips == null || clips.Length == 0) clips = importer.defaultClipAnimations;
        if (clips == null || clips.Length == 0) return;

        bool changed = false;
        foreach (var clip in clips)
        {
            if (!clip.loopTime)
            {
                clip.loopTime = true;
                changed = true;
            }
        }
        if (!changed) return;

        importer.clipAnimations = clips;
        importer.SaveAndReimport();
        Debug.Log($"[SmiteLife] ループ設定を修正: {path}");
    }
}
