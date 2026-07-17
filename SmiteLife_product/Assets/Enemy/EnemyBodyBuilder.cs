using System.Collections.Generic;
using UnityEngine;

// 四足動物の見た目をプリミティブから組み立てる（enemyTypes.js の build 系の移植）
// body は上下動・傾きアニメの対象、legs は股関節ピボットの歩行アニメ対象。
public class EnemyBodyParts
{
    public GameObject root;
    public Transform body;
    public Transform head;
    public Transform belly;
    public List<Transform> legs = new();
    public List<Renderer> furRenderers = new(); // テイム時の毛色変更対象
    public Animator animator;
    public bool usesExternalModel;
    public float bodyBaseY;
}

public static class EnemyBodyBuilder
{
    const float ExternalWolfGroundInset = 0.04f;

    class BuildOptions
    {
        public Material furMat, darkMat, bellyMat, eyeMat, muzzleMat, noseMat, lowerLegMat, pawMat;
        public float bodyY, torsoR, torsoL, neckR, neckL, headR;
        public float muzzleW = 0.85f;
        public string earStyle = "pointed"; // pointed / round / droop
        public string tailStyle = "bushy";  // bushy / long / tuft
        public float legTop, legR, legSpread, legZF, legZR;
    }

    static Shader _shader;

    static Material Mat(Color color, bool unlit = false)
    {
        if (_shader == null)
        {
            _shader = Shader.Find("Universal Render Pipeline/Lit");
            if (_shader == null) _shader = Shader.Find("Standard");
        }
        var m = new Material(_shader) { color = color };
        return m;
    }

    static Color C(int hex) => new(
        ((hex >> 16) & 0xff) / 255f,
        ((hex >> 8) & 0xff) / 255f,
        (hex & 0xff) / 255f);

    public static EnemyBodyParts Build(string typeId, string sex)
    {
        return typeId switch
        {
            "cow" => BuildCow(sex),
            "tiger" => BuildTiger(sex),
            _ => BuildWolf(sex),
        };
    }

    // 狼: 細身で俊敏、尖り耳とふさふさの尻尾。オスは首まわりの毛が豊か。
    static EnemyBodyParts BuildWolf(string sex)
    {
        var prefabParts = TryBuildWolfPrefab(sex);
        if (prefabParts != null) return prefabParts;

        var fur = Mat(C(0x6f6f78));
        var dark = Mat(C(0x44444a));
        var parts = BuildAnimal(new BuildOptions
        {
            furMat = fur, darkMat = dark, bellyMat = Mat(C(0x9a9aa2)), eyeMat = Mat(C(0xffd34d)),
            lowerLegMat = dark,
            bodyY = 0.58f, torsoR = 0.19f, torsoL = 0.50f,
            neckR = 0.085f, neckL = 0.26f,
            headR = 0.145f, muzzleW = 0.72f,
            earStyle = "pointed", tailStyle = "bushy",
            legTop = 0.50f, legR = 0.045f, legSpread = 0.12f, legZF = 0.30f, legZR = -0.27f,
        });
        if (sex == "male")
        {
            var ruff = Ellipsoid(parts.body, 0.20f, 1.05f, 1.0f, 0.8f, fur, 0, 0.14f, 0.34f);
            parts.furRenderers.Add(ruff.GetComponent<Renderer>());
        }
        return parts;
    }

    static EnemyBodyParts TryBuildWolfPrefab(string sex)
    {
        var prefab = Resources.Load<GameObject>("WolfModel");
        if (prefab == null) return null;

        var parts = new EnemyBodyParts();
        var root = new GameObject("EnemyBody");
        parts.root = root;

        var body = new GameObject("Body").transform;
        body.SetParent(root.transform, false);
        body.localPosition = Vector3.up * 0.58f;
        parts.body = body;
        parts.bodyBaseY = body.localPosition.y;

        var model = Object.Instantiate(prefab, body);
        model.name = "WolfModel";
        model.transform.localPosition = Vector3.zero;
        model.transform.localRotation = Quaternion.identity;
        model.transform.localScale = Vector3.one;
        parts.usesExternalModel = true;
        parts.animator = model.GetComponentInChildren<Animator>();
        if (parts.animator != null)
        {
            parts.animator.applyRootMotion = false;
            parts.animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
        }

        foreach (var collider in model.GetComponentsInChildren<Collider>())
            Object.Destroy(collider);

        foreach (var renderer in model.GetComponentsInChildren<Renderer>())
        {
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            renderer.receiveShadows = true;
            parts.furRenderers.Add(renderer);
        }

        parts.head = FindDeepChild(model.transform, "Head")
            ?? FindDeepChild(model.transform, "head")
            ?? body;
        parts.belly = FindDeepChild(model.transform, "Belly")
            ?? FindDeepChild(model.transform, "Spine")
            ?? body;

        if (sex == "male")
            model.transform.localScale = Vector3.one * 1.06f;

        AlignFootToGround(parts);

        return parts;
    }

    static void AlignFootToGround(EnemyBodyParts parts)
    {
        if (parts.furRenderers.Count == 0) return;
        float minY = float.MaxValue;
        foreach (var renderer in parts.furRenderers)
        {
            if (renderer == null) continue;
            minY = Mathf.Min(minY, renderer.bounds.min.y);
        }
        if (minY == float.MaxValue) return;

        Vector3 bodyPos = parts.body.localPosition;
        bodyPos.y -= minY + ExternalWolfGroundInset;
        parts.body.localPosition = bodyPos;
        parts.bodyBaseY = bodyPos.y;
    }

    static Transform FindDeepChild(Transform parent, string name)
    {
        foreach (Transform child in parent)
        {
            if (child.name == name) return child;
            var found = FindDeepChild(child, name);
            if (found != null) return found;
        }
        return null;
    }

    // 牛: 樽型の胴に短い太脚、垂れ耳とピンクのマズル。
    // オスは大きな角、メスは小さな角と乳房を持つ。
    static EnemyBodyParts BuildCow(string sex)
    {
        var fur = Mat(C(0xe6e2d8));
        var dark = Mat(C(0x3a342e));
        var parts = BuildAnimal(new BuildOptions
        {
            furMat = fur, darkMat = dark, eyeMat = Mat(C(0x442a10)),
            muzzleMat = Mat(C(0xd8a8a0)), noseMat = Mat(C(0xc08878)), pawMat = dark,
            bodyY = 0.68f, torsoR = 0.30f, torsoL = 0.55f,
            neckR = 0.13f, neckL = 0.26f,
            headR = 0.17f, muzzleW = 0.95f,
            earStyle = "droop", tailStyle = "tuft",
            legTop = 0.46f, legR = 0.062f, legSpread = 0.17f, legZF = 0.33f, legZR = -0.31f,
        });

        // ぶち模様（体表に張り付く平たい黒斑）[x, y, z, 半径, 側面フラグ]
        float[][] patches =
        {
            new[] {  0.26f,  0.02f,  0.20f, 0.17f, 1f },
            new[] { -0.26f, -0.02f, -0.16f, 0.20f, 1f },
            new[] {  0.25f,  0.08f, -0.28f, 0.14f, 1f },
            new[] { -0.25f,  0.06f,  0.30f, 0.15f, 1f },
            new[] {  0.00f,  0.26f, -0.05f, 0.19f, 0f },
        };
        foreach (var p in patches)
        {
            bool side = p[4] > 0.5f;
            Ellipsoid(parts.body, p[3], side ? 0.25f : 1.1f, side ? 1.1f : 0.25f, 1.15f, dark, p[0], p[1], p[2]);
        }

        // 角（オスは長く立派）
        var hornMat = Mat(C(0xd8cfb8));
        float hornLen = sex == "male" ? 0.20f : 0.11f;
        for (int sx = -1; sx <= 1; sx += 2)
        {
            var horn = Primitive(PrimitiveType.Cylinder, parts.head, hornMat);
            horn.transform.localPosition = new Vector3(sx * 0.11f, 0.16f, -0.02f);
            horn.transform.localRotation = Quaternion.Euler(0, 0, -sx * 40f);
            horn.transform.localScale = new Vector3(0.05f, hornLen * 0.5f, 0.05f);
        }

        // メスは乳房
        if (sex == "female")
            Ellipsoid(parts.body, 0.13f, 1f, 0.8f, 1.1f, Mat(C(0xe8b8b0)), 0, -0.30f, -0.18f);

        return parts;
    }

    // 虎: しなやかな長い胴、丸耳、長い尻尾、胴に巻く黒縞。オスは頬の飾り毛。
    static EnemyBodyParts BuildTiger(string sex)
    {
        var fur = Mat(C(0xd07828));
        var belly = Mat(C(0xe8e0d0));
        var dark = Mat(C(0x26221e));
        float torsoR = 0.23f;
        var parts = BuildAnimal(new BuildOptions
        {
            furMat = fur, darkMat = dark, bellyMat = belly, eyeMat = Mat(C(0x9aff5a)),
            muzzleMat = belly, noseMat = Mat(C(0xb06858)),
            bodyY = 0.60f, torsoR = torsoR, torsoL = 0.62f,
            neckR = 0.11f, neckL = 0.24f,
            headR = 0.16f, muzzleW = 0.9f,
            earStyle = "round", tailStyle = "long",
            legTop = 0.47f, legR = 0.056f, legSpread = 0.15f, legZF = 0.36f, legZR = -0.33f,
        });

        // 縞模様（胴に巻き付く細い輪をトーラスの代わりに薄い円筒で表現）
        for (int i = 0; i < 5; i++)
        {
            var ring = Primitive(PrimitiveType.Cylinder, parts.body, dark);
            ring.transform.localPosition = new Vector3(0, 0, -0.25f + i * 0.125f);
            ring.transform.localRotation = Quaternion.Euler(90f, 0, 0);
            ring.transform.localScale = new Vector3(torsoR * 2.1f, 0.011f, torsoR * 2.1f);
        }

        // オスは頬の飾り毛
        if (sex == "male")
            for (int sx = -1; sx <= 1; sx += 2)
                Ellipsoid(parts.head, 0.09f, 0.5f, 1f, 1f, belly, sx * 0.14f, -0.05f, 0.02f);

        return parts;
    }

    // 四足動物の共通ボディ（buildAnimal の移植）
    static EnemyBodyParts BuildAnimal(BuildOptions o)
    {
        var parts = new EnemyBodyParts();
        var root = new GameObject("EnemyBody");
        parts.root = root;

        var body = new GameObject("Body").transform;
        body.SetParent(root.transform, false);
        body.localPosition = Vector3.up * o.bodyY;
        parts.body = body;
        parts.bodyBaseY = o.bodyY;

        // 胴体（カプセルを寝かせる）
        var torso = Primitive(PrimitiveType.Capsule, body, o.furMat, fur: parts);
        torso.transform.localRotation = Quaternion.Euler(90f, 0, 0);
        torso.transform.localScale = new Vector3(o.torsoR * 2f, (o.torsoL + o.torsoR * 2f) * 0.5f, o.torsoR * 2f);

        // 胸と尻（シルエットに丸い起伏をつける）
        Ellipsoid(body, o.torsoR * 1.1f, 0.95f, 1.0f, 1.1f, o.furMat, 0, 0.02f, o.torsoL * 0.5f, parts);
        Ellipsoid(body, o.torsoR * 1.06f, 0.95f, 1.0f, 1.0f, o.furMat, 0, 0.02f, -o.torsoL * 0.5f, parts);

        // 腹（妊娠時にここが膨らむ）
        var bellyObj = Ellipsoid(body, o.torsoR * 0.92f, 1.0f, 0.95f, 1.3f,
            o.bellyMat != null ? o.bellyMat : o.furMat, 0, -o.torsoR * 0.3f, 0,
            o.bellyMat == null ? parts : null);
        parts.belly = bellyObj.transform;

        // 首（前傾した円柱）
        var neck = Primitive(PrimitiveType.Cylinder, body, o.furMat, fur: parts);
        neck.transform.localPosition = new Vector3(0, o.torsoR * 0.5f + o.neckL * 0.2f, o.torsoL * 0.5f + o.torsoR * 0.8f);
        neck.transform.localRotation = Quaternion.Euler(-28.6f, 0, 0);
        neck.transform.localScale = new Vector3(o.neckR * 2.4f, o.neckL * 0.5f, o.neckR * 2.4f);

        // 頭（頭蓋 + マズル + 鼻 + 耳 + 目）
        var head = new GameObject("Head").transform;
        head.SetParent(body, false);
        head.localPosition = new Vector3(0, o.torsoR * 0.5f + o.neckL * 0.55f, o.torsoL * 0.5f + o.torsoR * 1.5f);
        parts.head = head;

        Ellipsoid(head, o.headR, 0.92f, 0.9f, 1.0f, o.furMat, 0, 0, 0, parts);

        Ellipsoid(head, o.headR * 0.6f, o.muzzleW, 0.68f, 1.5f,
            o.muzzleMat != null ? o.muzzleMat : o.furMat,
            0, -o.headR * 0.24f, o.headR * 0.8f,
            o.muzzleMat == null ? parts : null);

        Ellipsoid(head, o.headR * 0.17f, 1f, 0.75f, 0.7f,
            o.noseMat != null ? o.noseMat : o.darkMat,
            0, -o.headR * 0.14f, o.headR * 1.6f);

        // 耳（pointed=尖り耳 / round=丸耳 / droop=垂れ耳）
        for (int sx = -1; sx <= 1; sx += 2)
        {
            GameObject ear;
            if (o.earStyle == "round")
            {
                ear = Ellipsoid(head, o.headR * 0.42f, 1f, 1f, 0.45f, o.furMat,
                    sx * o.headR * 0.62f, o.headR * 0.72f, -o.headR * 0.15f, parts);
            }
            else if (o.earStyle == "droop")
            {
                ear = Ellipsoid(head, o.headR * 0.45f, 1.3f, 0.5f, 0.8f, o.furMat,
                    sx * o.headR * 0.95f, o.headR * 0.30f, -o.headR * 0.1f, parts);
                ear.transform.localRotation = Quaternion.Euler(0, 0, -sx * 28.6f);
            }
            else
            {
                ear = Primitive(PrimitiveType.Cylinder, head, o.furMat, fur: parts);
                ear.transform.localPosition = new Vector3(sx * o.headR * 0.5f, o.headR * 0.85f, -o.headR * 0.2f);
                ear.transform.localRotation = Quaternion.Euler(0, 0, -sx * 12.6f);
                ear.transform.localScale = new Vector3(o.headR * 0.5f, o.headR * 0.42f, o.headR * 0.5f);
            }
        }

        // 目
        for (int sx = -1; sx <= 1; sx += 2)
        {
            var eye = Primitive(PrimitiveType.Sphere, head, o.eyeMat);
            eye.transform.localPosition = new Vector3(sx * o.headR * 0.45f, o.headR * 0.12f, o.headR * 0.7f);
            eye.transform.localScale = Vector3.one * o.headR * 0.30f;
        }

        // 尻尾（bushy=ふさふさ / long=長い / tuft=先端に房）
        if (o.tailStyle == "bushy")
        {
            var tail = Primitive(PrimitiveType.Capsule, body, o.furMat, fur: parts);
            tail.transform.localPosition = new Vector3(0, o.torsoR * 0.35f, -(o.torsoL * 0.5f + o.torsoR * 0.9f));
            tail.transform.localRotation = Quaternion.Euler(140f, 0, 0);
            tail.transform.localScale = new Vector3(o.torsoR * 0.56f, o.torsoR * 1.05f, o.torsoR * 0.56f);
        }
        else if (o.tailStyle == "long")
        {
            var tail = Primitive(PrimitiveType.Capsule, body, o.furMat, fur: parts);
            tail.transform.localPosition = new Vector3(0, o.torsoR * 0.5f, -(o.torsoL * 0.5f + o.torsoR * 1.1f));
            tail.transform.localRotation = Quaternion.Euler(120f, 0, 0);
            tail.transform.localScale = new Vector3(o.torsoR * 0.28f, o.torsoR * 1.4f, o.torsoR * 0.28f);
            var tip = Ellipsoid(tail.transform, o.torsoR * 0.16f, 1f, 1.2f, 1f, o.darkMat, 0, -0.9f, 0);
            tip.transform.localScale = new Vector3(0.6f, 0.14f, 0.6f); // 親スケール補正
        }
        else
        {
            var tail = Primitive(PrimitiveType.Cylinder, body, o.furMat, fur: parts);
            tail.transform.localPosition = new Vector3(0, -0.05f, -(o.torsoL * 0.5f + o.torsoR * 0.95f));
            tail.transform.localRotation = Quaternion.Euler(14f, 0, 0);
            tail.transform.localScale = new Vector3(0.05f, o.torsoR * 0.85f, 0.05f);
            var tuft = Ellipsoid(tail.transform, 1f, 1f, 1.4f, 1f, o.darkMat, 0, -1.05f, 0);
            tuft.transform.localScale = new Vector3(2.0f, 0.16f, 2.0f);
        }

        // 脚（4本、股関節ピボット）
        float[][] legDefs =
        {
            new[] { -o.legSpread, o.legZF }, new[] { o.legSpread, o.legZF },
            new[] { -o.legSpread, o.legZR }, new[] { o.legSpread, o.legZR },
        };
        foreach (var ld in legDefs)
            parts.legs.Add(BuildLeg(root.transform, o, ld[0], ld[1], parts));

        return parts;
    }

    // 脚: 股関節で回転するグループ（太もも → すね → 足先）
    static Transform BuildLeg(Transform root, BuildOptions o, float x, float z, EnemyBodyParts parts)
    {
        var leg = new GameObject("Leg").transform;
        leg.SetParent(root, false);
        leg.localPosition = new Vector3(x, o.legTop, z);

        var upper = Primitive(PrimitiveType.Cylinder, leg, o.furMat, fur: parts);
        upper.transform.localPosition = Vector3.down * o.legTop * 0.26f;
        upper.transform.localScale = new Vector3(o.legR * 2.1f, o.legTop * 0.275f, o.legR * 2.1f);

        var lower = Primitive(PrimitiveType.Cylinder, leg,
            o.lowerLegMat != null ? o.lowerLegMat : o.furMat,
            fur: o.lowerLegMat == null ? parts : null);
        lower.transform.localPosition = Vector3.down * o.legTop * 0.72f;
        lower.transform.localScale = new Vector3(o.legR * 1.3f, o.legTop * 0.275f, o.legR * 1.3f);

        var paw = Ellipsoid(leg, o.legR * 1.2f, 1f, 0.55f, 1.45f,
            o.pawMat != null ? o.pawMat : o.darkMat,
            0, -o.legTop + o.legR * 0.55f, o.legR * 0.4f);

        return leg;
    }

    static GameObject Ellipsoid(Transform parent, float r, float sx, float sy, float sz, Material mat,
        float x = 0, float y = 0, float z = 0, EnemyBodyParts fur = null)
    {
        var m = Primitive(PrimitiveType.Sphere, parent, mat, fur: fur);
        m.transform.localPosition = new Vector3(x, y, z);
        m.transform.localScale = new Vector3(r * 2f * sx, r * 2f * sy, r * 2f * sz);
        return m;
    }

    static GameObject Primitive(PrimitiveType type, Transform parent, Material mat, EnemyBodyParts fur = null)
    {
        var obj = GameObject.CreatePrimitive(type);
        Object.Destroy(obj.GetComponent<Collider>()); // 当たり判定はルートのカプセル1個に集約
        obj.transform.SetParent(parent, false);
        var renderer = obj.GetComponent<Renderer>();
        renderer.sharedMaterial = mat;
        fur?.furRenderers.Add(renderer);
        return obj;
    }
}
