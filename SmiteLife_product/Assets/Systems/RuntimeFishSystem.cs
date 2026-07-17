using System.Collections.Generic;
using UnityEngine;

public class RuntimeFishSystem : MonoBehaviour
{
    readonly List<RuntimeFish> _fish = new();

    void Start()
    {
        var spots = new List<Vector3>();
        for (int a = 0; a < 32; a++)
        for (int r = 28; r <= 115; r += 12)
        {
            float angle = a / 32f * Mathf.PI * 2f;
            Vector3 p = new(Mathf.Cos(angle) * r, 0, Mathf.Sin(angle) * r);
            float ground = RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.GroundHeight(p) : -1f;
            if (ground < RuntimeWorldBuilder.WaterLevel - 0.5f)
                spots.Add(new Vector3(p.x, Mathf.Min(RuntimeWorldBuilder.WaterLevel - 0.28f, ground + 0.9f), p.z));
        }

        for (int i = 0; i < Mathf.Min(18, spots.Count); i++)
        {
            int pick = Random.Range(i, spots.Count);
            (spots[i], spots[pick]) = (spots[pick], spots[i]);
            SpawnFish(spots[i], i);
        }
    }

    void SpawnFish(Vector3 pos, int index)
    {
        var fish = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        fish.name = "Fish";
        fish.transform.position = pos;
        fish.transform.localScale = new Vector3(0.18f, 0.08f, 0.35f);
        fish.GetComponent<Renderer>().material.color = Color.HSVToRGB((index * 0.17f) % 1f, 0.75f, 0.9f);
        var col = fish.GetComponent<Collider>();
        col.isTrigger = true;
        var runtime = fish.AddComponent<RuntimeFish>();
        runtime.center = pos;
        runtime.radius = Random.Range(2.5f, 5.5f);
        runtime.speed = Random.Range(0.35f, 0.7f);
        _fish.Add(runtime);
    }
}

public class RuntimeFish : MonoBehaviour
{
    public Vector3 center;
    public float radius = 4f;
    public float speed = 0.45f;

    float _angle;
    bool _caught;

    void Update()
    {
        if (_caught) return;
        _angle += speed * Time.deltaTime;
        Vector3 next = center + new Vector3(Mathf.Cos(_angle) * radius, Mathf.Sin(Time.time * 2f) * 0.05f, Mathf.Sin(_angle) * radius);
        float ground = RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.GroundHeight(next) : -1f;
        if (ground < RuntimeWorldBuilder.WaterLevel - 0.2f)
            transform.position = new Vector3(next.x, Mathf.Min(RuntimeWorldBuilder.WaterLevel - 0.28f, ground + 0.9f), next.z);
        transform.rotation = Quaternion.Euler(90f, -_angle * Mathf.Rad2Deg, 0);

        var player = GameObject.FindGameObjectWithTag("Player");
        if (player != null && Vector3.Distance(player.transform.position, transform.position) < 2.2f && Input.GetKeyDown(KeyCode.E))
            Catch();
    }

    void Catch()
    {
        _caught = true;
        InventoryManager.Instance?.Add("raw_fish", 1);
        RuntimeStorageSystem.Message = "魚を捕まえた";
        Destroy(gameObject);
    }
}
