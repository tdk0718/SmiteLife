using UnityEngine;

// scene.js の乱数/ノイズ基盤の移植
// ・Mulberry32: 決定論的な軽量乱数（チャンクごとの配置が再現可能）
// ・HashChunk: チャンク座標 → シード
// ・SimplexNoise2D: 固定シードの 2D シンプレックスノイズ（地形が毎回同じになる）
public class Mulberry32
{
    uint _a;

    public Mulberry32(uint seed) => _a = seed;

    public float Next()
    {
        unchecked
        {
            _a += 0x6D2B79F5u;
            uint t = _a;
            t = (t ^ (t >> 15)) * (t | 1u);
            t ^= t + (t ^ (t >> 7)) * (t | 61u);
            return (t ^ (t >> 14)) / 4294967296f;
        }
    }

    public float Range(float min, float max) => min + Next() * (max - min);
    public int NextInt(int maxExclusive) => Mathf.Min(maxExclusive - 1, (int)(Next() * maxExclusive));
}

public static class WorldNoise
{
    public static uint HashChunk(int cx, int cz, int salt = 0)
    {
        unchecked
        {
            uint h = 2166136261u;
            h ^= (uint)cx + 0x9e3779b9u + (h << 6) + (h >> 2);
            h ^= (uint)cz + 0x85ebca6bu + (h << 6) + (h >> 2);
            h ^= (uint)salt + 0xc2b2ae35u + (h << 6) + (h >> 2);
            return h;
        }
    }

    // ── 2D シンプレックスノイズ（Gustavson 実装ベース、[-1,1]） ──
    const float F2 = 0.36602540378f; // (sqrt(3)-1)/2
    const float G2 = 0.21132486540f; // (3-sqrt(3))/6

    static readonly int[] _perm = new int[512];
    static readonly Vector2[] _grad =
    {
        new(1,1), new(-1,1), new(1,-1), new(-1,-1),
        new(1,0), new(-1,0), new(0,1), new(0,-1),
    };

    static WorldNoise()
    {
        // 固定シードで並べ替え（scene.js: createNoise2D(mulberry32(0xA1B2C3D4)) 相当）
        var rng = new Mulberry32(0xA1B2C3D4);
        var p = new int[256];
        for (int i = 0; i < 256; i++) p[i] = i;
        for (int i = 0; i < 255; i++)
        {
            int r = i + (int)(rng.Next() * (256 - i));
            (p[i], p[r]) = (p[r], p[i]);
        }
        for (int i = 0; i < 512; i++) _perm[i] = p[i & 255];
    }

    public static float Noise2D(float x, float y)
    {
        float s = (x + y) * F2;
        int i = Mathf.FloorToInt(x + s);
        int j = Mathf.FloorToInt(y + s);
        float t = (i + j) * G2;
        float x0 = x - (i - t);
        float y0 = y - (j - t);

        int i1 = x0 > y0 ? 1 : 0;
        int j1 = 1 - i1;

        float x1 = x0 - i1 + G2;
        float y1 = y0 - j1 + G2;
        float x2 = x0 - 1f + 2f * G2;
        float y2 = y0 - 1f + 2f * G2;

        int ii = i & 255;
        int jj = j & 255;

        float n = 0;
        float t0 = 0.5f - x0 * x0 - y0 * y0;
        if (t0 > 0)
        {
            var g = _grad[_perm[ii + _perm[jj]] & 7];
            t0 *= t0;
            n += t0 * t0 * (g.x * x0 + g.y * y0);
        }
        float t1 = 0.5f - x1 * x1 - y1 * y1;
        if (t1 > 0)
        {
            var g = _grad[_perm[ii + i1 + _perm[jj + j1]] & 7];
            t1 *= t1;
            n += t1 * t1 * (g.x * x1 + g.y * y1);
        }
        float t2 = 0.5f - x2 * x2 - y2 * y2;
        if (t2 > 0)
        {
            var g = _grad[_perm[ii + 1 + _perm[jj + 1]] & 7];
            t2 *= t2;
            n += t2 * t2 * (g.x * x2 + g.y * y2);
        }
        return 70f * n;
    }
}
