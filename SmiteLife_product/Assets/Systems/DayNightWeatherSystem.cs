using UnityEngine;

public class DayNightWeatherSystem : MonoBehaviour
{
    public Light sun;
    public Light moon;
    public float dayLengthSeconds = 3600f;

    public int DayNumber => Mathf.FloorToInt(_elapsed / dayLengthSeconds) + 1;
    public float GameHour => ((_elapsed % dayLengthSeconds) / dayLengthSeconds) * 24f;
    public string WeatherName => _weatherNames[_weatherIndex];

    float _elapsed;
    float _weatherTimer = 90f;
    int _weatherIndex;
    readonly string[] _weatherNames = { "Clear", "Overcast", "Rain", "Overcast" };
    ParticleSystem _rain;

    void Start()
    {
        _elapsed = dayLengthSeconds * (8f / 24f);
        if (sun == null) sun = RenderSettings.sun;
        CreateRain();
    }

    void Update()
    {
        _elapsed += Time.deltaTime;
        UpdateLight();
        UpdateWeather();
    }

    public string TimeString()
    {
        int h = Mathf.FloorToInt(GameHour);
        int m = Mathf.FloorToInt((GameHour - h) * 60f);
        return $"{DayNumber}日目 {h:00}:{m:00}";
    }

    float LightFactor()
    {
        float h = GameHour;
        if (h >= 7f && h <= 17f) return 1f;
        if (h >= 19f || h <= 5f) return 0f;
        if (h < 7f) return (h - 5f) / 2f;
        return (19f - h) / 2f;
    }

    void UpdateLight()
    {
        float f = LightFactor();
        if (sun != null)
        {
            float ang = ((GameHour - 6f) / 12f) * 180f;
            sun.transform.rotation = Quaternion.Euler(Mathf.Lerp(15f, 75f, Mathf.Sin(ang * Mathf.Deg2Rad)), ang - 90f, 0);
            sun.intensity = 0.12f + f * 1.25f;
            sun.color = Color.Lerp(new Color(0.55f, 0.63f, 0.95f), new Color(1f, 0.93f, 0.78f), f);
        }
        RenderSettings.ambientLight = Color.Lerp(new Color(0.04f, 0.06f, 0.12f), new Color(0.62f, 0.67f, 0.72f), f);
    }

    void UpdateWeather()
    {
        _weatherTimer -= Time.deltaTime;
        if (_weatherTimer <= 0)
        {
            _weatherIndex = (_weatherIndex + 1) % _weatherNames.Length;
            _weatherTimer = _weatherNames[_weatherIndex] == "Rain" ? Random.Range(35f, 80f) : Random.Range(40f, 150f);
        }

        if (_rain == null) return;
        var emission = _rain.emission;
        emission.rateOverTime = _weatherNames[_weatherIndex] == "Rain" ? 850f : 0f;

        Transform player = GameObject.FindGameObjectWithTag("Player")?.transform;
        if (player != null) _rain.transform.position = player.position + Vector3.up * 12f;
    }

    void CreateRain()
    {
        var obj = new GameObject("Runtime Rain");
        _rain = obj.AddComponent<ParticleSystem>();
        var main = _rain.main;
        main.startLifetime = 1.5f;
        main.startSpeed = 18f;
        main.startSize = 0.03f;
        main.maxParticles = 2500;
        var shape = _rain.shape;
        shape.shapeType = ParticleSystemShapeType.Box;
        shape.scale = new Vector3(70f, 1f, 70f);
        var velocity = _rain.velocityOverLifetime;
        velocity.enabled = true;
        velocity.y = -22f;
        var emission = _rain.emission;
        emission.rateOverTime = 0f;
    }
}
