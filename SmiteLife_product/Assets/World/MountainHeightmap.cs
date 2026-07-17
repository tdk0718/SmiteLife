using UnityEngine;

// BackgroundMountainFree の 16bit RAW ハイトマップ（4096x4096, little-endian）を
// Resources から読み込み、正規化した高さ 0..1 をバイリニアで返すヘルパー。
// 地形形状のベースとして RuntimeWorldBuilder.TerrainHeight から参照される。
public class MountainHeightmap
{
    const string ResourcePath = "Terrain/BackgroundMountain"; // Resources/Terrain/BackgroundMountain.bytes
    const int Size = 4096;                                    // 4096x4096
    const bool LittleEndian = true;                           // RAW のバイト順（並びが変なら false）
    public const bool FlipV = true;                          // 画像の行順は上下反転していることが多い（色ドレープと共有）

    static MountainHeightmap _instance;
    static bool _loadAttempted;

    readonly ushort[] _heights;

    MountainHeightmap(ushort[] heights) { _heights = heights; }

    public static bool Available => Instance != null;

    public static MountainHeightmap Instance
    {
        get
        {
            if (_instance != null || _loadAttempted) return _instance;
            _loadAttempted = true;
            _instance = Load();
            return _instance;
        }
    }

    static MountainHeightmap Load()
    {
        var asset = Resources.Load<TextAsset>(ResourcePath);
        if (asset == null) { Debug.LogWarning($"[MountainHeightmap] {ResourcePath} が見つかりません。手続き地形にフォールバックします。"); return null; }

        var bytes = asset.bytes;
        int expected = Size * Size * 2;
        if (bytes == null || bytes.Length < expected)
        {
            Debug.LogWarning($"[MountainHeightmap] RAW サイズ不正 ({bytes?.Length} != {expected})。フォールバックします。");
            return null;
        }

        var heights = new ushort[Size * Size];
        if (LittleEndian)
            for (int i = 0; i < heights.Length; i++)
                heights[i] = (ushort)(bytes[i * 2] | (bytes[i * 2 + 1] << 8));
        else
            for (int i = 0; i < heights.Length; i++)
                heights[i] = (ushort)((bytes[i * 2] << 8) | bytes[i * 2 + 1]);

        Resources.UnloadAsset(asset); // 32MB の TextAsset を解放
        return new MountainHeightmap(heights);
    }

    // u,v は 0..1。範囲外はクランプ。戻り値は正規化した高さ 0..1。
    public float SampleNormalized(float u, float v)
    {
        u = Mathf.Clamp01(u);
        v = Mathf.Clamp01(v);
        if (FlipV) v = 1f - v;

        float fx = u * (Size - 1);
        float fy = v * (Size - 1);
        int x0 = (int)fx;
        int y0 = (int)fy;
        int x1 = Mathf.Min(x0 + 1, Size - 1);
        int y1 = Mathf.Min(y0 + 1, Size - 1);
        float tx = fx - x0;
        float ty = fy - y0;

        float h00 = _heights[y0 * Size + x0];
        float h10 = _heights[y0 * Size + x1];
        float h01 = _heights[y1 * Size + x0];
        float h11 = _heights[y1 * Size + x1];

        float top = Mathf.Lerp(h00, h10, tx);
        float bottom = Mathf.Lerp(h01, h11, tx);
        return Mathf.Lerp(top, bottom, ty) / 65535f;
    }
}
