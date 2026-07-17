using System.Collections.Generic;
using UnityEngine;

// 樹木・岩などのノードを「1つの結合メッシュ」として組み立てるための
// 軽量ジオメトリ生成器（three.js の CylinderGeometry / IcosahedronGeometry 等の代替）。
// GameObject をパーツごとに作らないことで、scene.js と同じ配置密度でも描画負荷を抑える。
public class Geo
{
    public Vector3[] verts;
    public int[] tris;

    public Geo Clone() => new() { verts = (Vector3[])verts.Clone(), tris = (int[])tris.Clone() };

    // 頂点をラジアル方向にランダム変位させて有機的な凹凸を作る（displaceVertices の移植）。
    // 位置ハッシュで乱数を決めるため、同じ位置の重複頂点は同じ量だけ動き、面が裂けない。
    public Geo Displace(float amount, Mulberry32 rng)
    {
        float seed = rng.Next() * 100f;
        for (int i = 0; i < verts.Length; i++)
        {
            var v = verts[i];
            float h = Mathf.Sin(v.x * 12.9898f + v.y * 78.233f + v.z * 37.719f + seed) * 43758.5453f;
            float n = h - Mathf.Floor(h) - 0.5f;
            verts[i] = v * (1f + n * 2f * amount);
        }
        return this;
    }
}

public static class ProceduralGeo
{
    // 円柱（three.js CylinderGeometry 互換: 中心原点、上下にキャップ）
    public static Geo Cylinder(float rTop, float rBottom, float height, int seg)
    {
        var verts = new List<Vector3>();
        var tris = new List<int>();
        float half = height * 0.5f;

        for (int i = 0; i < seg; i++)
        {
            float a0 = i * Mathf.PI * 2f / seg;
            float a1 = (i + 1) * Mathf.PI * 2f / seg;
            Vector3 t0 = new(Mathf.Cos(a0) * rTop, half, Mathf.Sin(a0) * rTop);
            Vector3 t1 = new(Mathf.Cos(a1) * rTop, half, Mathf.Sin(a1) * rTop);
            Vector3 b0 = new(Mathf.Cos(a0) * rBottom, -half, Mathf.Sin(a0) * rBottom);
            Vector3 b1 = new(Mathf.Cos(a1) * rBottom, -half, Mathf.Sin(a1) * rBottom);
            AddQuad(verts, tris, b0, b1, t1, t0);
            if (rTop > 0.001f) AddTri(verts, tris, new Vector3(0, half, 0), t0, t1);
            if (rBottom > 0.001f) AddTri(verts, tris, new Vector3(0, -half, 0), b1, b0);
        }
        return new Geo { verts = verts.ToArray(), tris = tris.ToArray() };
    }

    public static Geo Cone(float radius, float height, int seg) => Cylinder(0f, radius, height, seg);

    // 正20面体（detail 0 = 20面 / detail 1 = 80面）を球に投影
    public static Geo Icosahedron(float radius, int detail)
    {
        float t = (1f + Mathf.Sqrt(5f)) * 0.5f;
        Vector3[] baseVerts =
        {
            new(-1, t, 0), new(1, t, 0), new(-1, -t, 0), new(1, -t, 0),
            new(0, -1, t), new(0, 1, t), new(0, -1, -t), new(0, 1, -t),
            new(t, 0, -1), new(t, 0, 1), new(-t, 0, -1), new(-t, 0, 1),
        };
        int[] baseTris =
        {
            0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11,
            1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8,
            3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9,
            4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1,
        };

        var verts = new List<Vector3>();
        var tris = new List<int>();
        for (int i = 0; i < baseTris.Length; i += 3)
        {
            Vector3 a = baseVerts[baseTris[i]].normalized;
            Vector3 b = baseVerts[baseTris[i + 1]].normalized;
            Vector3 c = baseVerts[baseTris[i + 2]].normalized;
            if (detail <= 0)
            {
                AddTri(verts, tris, a * radius, b * radius, c * radius);
            }
            else
            {
                Vector3 ab = ((a + b) * 0.5f).normalized;
                Vector3 bc = ((b + c) * 0.5f).normalized;
                Vector3 ca = ((c + a) * 0.5f).normalized;
                AddTri(verts, tris, a * radius, ab * radius, ca * radius);
                AddTri(verts, tris, ab * radius, b * radius, bc * radius);
                AddTri(verts, tris, ca * radius, bc * radius, c * radius);
                AddTri(verts, tris, ab * radius, bc * radius, ca * radius);
            }
        }
        return new Geo { verts = verts.ToArray(), tris = tris.ToArray() };
    }

    // 低ポリ UV 球
    public static Geo Sphere(float radius, int wSeg, int hSeg)
    {
        var verts = new List<Vector3>();
        var tris = new List<int>();
        for (int y = 0; y < hSeg; y++)
        {
            float v0 = Mathf.PI * y / hSeg;
            float v1 = Mathf.PI * (y + 1) / hSeg;
            for (int x = 0; x < wSeg; x++)
            {
                float u0 = Mathf.PI * 2f * x / wSeg;
                float u1 = Mathf.PI * 2f * (x + 1) / wSeg;
                Vector3 p00 = SpherePoint(radius, u0, v0);
                Vector3 p10 = SpherePoint(radius, u1, v0);
                Vector3 p01 = SpherePoint(radius, u0, v1);
                Vector3 p11 = SpherePoint(radius, u1, v1);
                if (y > 0) AddTri(verts, tris, p00, p10, p11);
                if (y < hSeg - 1) AddTri(verts, tris, p00, p11, p01);
            }
        }
        return new Geo { verts = verts.ToArray(), tris = tris.ToArray() };
    }

    static Vector3 SpherePoint(float r, float u, float v) =>
        new(r * Mathf.Sin(v) * Mathf.Cos(u), r * Mathf.Cos(v), r * Mathf.Sin(v) * Mathf.Sin(u));

    // 両面板（草の葉用。XY 平面、原点中心）
    public static Geo DoublePlane(float w, float h)
    {
        var verts = new List<Vector3>();
        var tris = new List<int>();
        Vector3 a = new(-w / 2, -h / 2, 0), b = new(w / 2, -h / 2, 0);
        Vector3 c = new(w / 2, h / 2, 0), d = new(-w / 2, h / 2, 0);
        AddQuad(verts, tris, a, b, c, d);
        AddQuad(verts, tris, b, a, d, c); // 裏面
        return new Geo { verts = verts.ToArray(), tris = tris.ToArray() };
    }

    public static Geo Box(float w, float h, float d)
    {
        var verts = new List<Vector3>();
        var tris = new List<int>();
        float x = w / 2, y = h / 2, z = d / 2;
        Vector3[] p =
        {
            new(-x,-y,-z), new(x,-y,-z), new(x,y,-z), new(-x,y,-z),
            new(-x,-y,z), new(x,-y,z), new(x,y,z), new(-x,y,z),
        };
        AddQuad(verts, tris, p[0], p[3], p[2], p[1]); // 前
        AddQuad(verts, tris, p[4], p[5], p[6], p[7]); // 後
        AddQuad(verts, tris, p[0], p[4], p[7], p[3]); // 左
        AddQuad(verts, tris, p[1], p[2], p[6], p[5]); // 右
        AddQuad(verts, tris, p[3], p[7], p[6], p[2]); // 上
        AddQuad(verts, tris, p[0], p[1], p[5], p[4]); // 下
        return new Geo { verts = verts.ToArray(), tris = tris.ToArray() };
    }

    static void AddTri(List<Vector3> verts, List<int> tris, Vector3 a, Vector3 b, Vector3 c)
    {
        int i = verts.Count;
        verts.Add(a); verts.Add(b); verts.Add(c);
        tris.Add(i); tris.Add(i + 1); tris.Add(i + 2);
    }

    static void AddQuad(List<Vector3> verts, List<int> tris, Vector3 a, Vector3 b, Vector3 c, Vector3 d)
    {
        AddTri(verts, tris, a, b, c);
        AddTri(verts, tris, a, c, d);
    }
}

// マテリアルごとのサブメッシュを持つ1メッシュへ、変換付きでジオメトリを蓄積する
public class NodeMeshBuilder
{
    readonly List<Vector3> _verts = new();
    readonly List<Material> _mats = new();
    readonly List<List<int>> _submeshes = new();

    public void Add(Geo geo, Material mat, Vector3 pos, Quaternion rot, Vector3 scale)
    {
        Add(geo, mat, Matrix4x4.TRS(pos, rot, scale));
    }

    public void Add(Geo geo, Material mat, Matrix4x4 trs)
    {
        int matIdx = _mats.IndexOf(mat);
        if (matIdx < 0)
        {
            matIdx = _mats.Count;
            _mats.Add(mat);
            _submeshes.Add(new List<int>());
        }
        int baseIdx = _verts.Count;
        foreach (var v in geo.verts) _verts.Add(trs.MultiplyPoint3x4(v));
        var tris = _submeshes[matIdx];
        foreach (int t in geo.tris) tris.Add(baseIdx + t);
    }

    // フラットシェーディング（面法線）でメッシュ化して GameObject に設定する
    public void Apply(GameObject go)
    {
        var mesh = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
        mesh.SetVertices(_verts);
        mesh.subMeshCount = _submeshes.Count;
        for (int s = 0; s < _submeshes.Count; s++)
            mesh.SetTriangles(_submeshes[s], s);
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();

        var filter = go.GetComponent<MeshFilter>();
        if (filter == null) filter = go.AddComponent<MeshFilter>();
        filter.sharedMesh = mesh;
        var renderer = go.GetComponent<MeshRenderer>();
        if (renderer == null) renderer = go.AddComponent<MeshRenderer>();
        renderer.sharedMaterials = _mats.ToArray();
    }
}
