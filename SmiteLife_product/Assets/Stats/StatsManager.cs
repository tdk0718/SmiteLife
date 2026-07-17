using UnityEngine;
using UnityEngine.Events;

public class StatsManager : MonoBehaviour
{
    public static StatsManager Instance { get; private set; }

    [Header("Config")]
    public float hungerMax         = 100f;
    public float staminaMax        = 100f;
    public float hungerDecay       = 0.7f;
    public float hungerSprintExtra = 1.3f;
    public float starveDamage      = 4f;
    public float staminaRegen      = 20f;
    public float staminaSprint     = 24f;
    public float staminaAttackCost = 18f;
    public float exhaustRecover    = 25f;

    // 現在値
    public float Hp       { get; private set; }
    public float MaxHp    { get; private set; } = 100f;
    public float Hunger   { get; private set; }
    public float Stamina  { get; private set; }
    public float Defense  { get; private set; }
    public bool  IsDead   { get; private set; }
    public bool  Exhausted { get; private set; }
    public float SpeedMultiplier { get; private set; } = 1f;

    float _slowTimer;

    public UnityEvent OnDeath    = new();
    public UnityEvent OnRespawn  = new();

    void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        Hp      = MaxHp;
        Hunger  = hungerMax;
        Stamina = staminaMax;
    }

    public bool CanSprint()  => !IsDead && !Exhausted && Stamina > 0;
    public bool CanAttack()  => !IsDead && !Exhausted && Stamina > 0;

    public bool TryAttack()
    {
        if (!CanAttack()) return false;
        SpendStamina(staminaAttackCost);
        return true;
    }

    public bool SpendStamina(float amount)
    {
        if (IsDead || Stamina < amount) return false;
        Stamina = Mathf.Max(0, Stamina - amount);
        if (Stamina <= 0) Exhausted = true;
        return true;
    }

    public void UpdateStamina(bool sprinting)
    {
        if (IsDead) return;
        if (sprinting)
        {
            Stamina = Mathf.Max(0, Stamina - staminaSprint * Time.deltaTime);
            if (Stamina <= 0) Exhausted = true;
        }
        else
        {
            Stamina = Mathf.Min(staminaMax, Stamina + staminaRegen * Time.deltaTime);
        }
        if (Exhausted && Stamina >= exhaustRecover) Exhausted = false;
    }

    public void TakeDamage(float amount)
    {
        if (IsDead || amount <= 0) return;
        float eff = Mathf.Max(1f, amount - Defense);
        Hp = Mathf.Max(0, Hp - eff);
        if (Hp <= 0) Die();
    }

    public void Heal(float amount)
    {
        Hp = Mathf.Min(MaxHp, Hp + amount);
    }

    public void Eat(float hungerAmount, float hpAmount)
    {
        Hunger = Mathf.Min(hungerMax, Hunger + hungerAmount);
        if (hpAmount > 0) Heal(hpAmount);
        else TakeDamage(-hpAmount);
    }

    public void SetMaxHp(float newMax, bool healToFull)
    {
        float delta = newMax - MaxHp;
        MaxHp = newMax;
        if (healToFull) Hp = newMax;
        else if (delta > 0) Hp = Mathf.Min(newMax, Hp + delta);
        Hp = Mathf.Min(Hp, MaxHp);
    }

    public void SetDefense(float v) => Defense = v;

    public void ApplySlowEffect(float seconds) => _slowTimer = seconds;

    void Die()
    {
        IsDead = true;
        Hp = 0;
        OnDeath.Invoke();
    }

    public void Respawn()
    {
        IsDead    = false;
        Hp        = MaxHp;
        Hunger    = hungerMax;
        Stamina   = staminaMax;
        Exhausted = false;
        OnRespawn.Invoke();
    }

    void Update()
    {
        if (IsDead) return;

        if (_slowTimer > 0)
        {
            _slowTimer        = Mathf.Max(0, _slowTimer - Time.deltaTime);
            SpeedMultiplier   = _slowTimer > 0 ? 0.3f : 1f;
        }

        bool sprinting = !IsDead &&
            Input.GetKey(KeyCode.LeftShift) &&
            (Input.GetAxisRaw("Horizontal") != 0 || Input.GetAxisRaw("Vertical") != 0);

        float hungerLoss = (hungerDecay + (sprinting ? hungerSprintExtra : 0)) * Time.deltaTime;
        Hunger = Mathf.Max(0, Hunger - hungerLoss);
        if (Hunger <= 0) TakeDamage(starveDamage * Time.deltaTime);
    }

    // セーブ/ロード用
    public StatsData Serialize()   => new() { hp = Hp, maxHp = MaxHp, hunger = Hunger };
    public void Deserialize(StatsData d)
    {
        MaxHp  = d.maxHp > 0 ? d.maxHp : MaxHp;
        Hp     = Mathf.Min(d.hp,    MaxHp);
        Hunger = Mathf.Min(d.hunger, hungerMax);
    }
}

[System.Serializable]
public class StatsData { public float hp, maxHp, hunger; }
