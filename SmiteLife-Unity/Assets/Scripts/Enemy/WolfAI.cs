using UnityEngine;
using UnityEngine.AI;

// NavMeshAgent を使ったシンプルな狼AI
// NavMesh を事前にベイクすること（Window > AI > Navigation > Bake）
// 水域は NavMesh Area "Not Walkable" に設定すると自動的に避ける
[RequireComponent(typeof(NavMeshAgent))]
public class WolfAI : MonoBehaviour
{
    [Header("Stats")]
    public float maxHp        = 30f;
    public float attackDamage = 10f;
    public float attackRange  = 1.9f;
    public float attackCd     = 1.2f;
    public float detectRange  = 20f;
    public float leashRange   = 32f;
    public int   xpReward     = 20;

    [Header("Drops")]
    public GameObject[] dropPrefabs;

    // 内部状態
    float    _hp;
    bool     _aggro;
    float    _attackTimer;
    float    _wanderTimer;
    bool     _alive   = true;
    bool     _inWater;
    bool     _tamed;

    NavMeshAgent _agent;
    Animator     _anim;
    Transform    _player;

    static readonly int AnimSpeed   = Animator.StringToHash("Speed");
    static readonly int AnimInWater = Animator.StringToHash("InWater");

    void Start()
    {
        _hp     = maxHp;
        _agent  = GetComponent<NavMeshAgent>();
        _anim   = GetComponentInChildren<Animator>();
        _player = GameObject.FindGameObjectWithTag("Player")?.transform;

        SetNewWanderTarget();
    }

    void Update()
    {
        if (!_alive || _player == null) return;

        float dist = Vector3.Distance(transform.position, _player.position);
        _inWater   = transform.position.y < 0f;

        // 水中は移動速度低下（NavMesh で水に入れない設定なら不要）
        _agent.speed = _inWater ? 2.0f : (_aggro ? 4.2f : 1.6f);

        // アグロ判定
        if (!_tamed && dist <= detectRange) _aggro = true;
        if (dist > leashRange)             { _aggro = false; SetNewWanderTarget(); }

        if (_aggro && dist > attackRange)
        {
            _agent.SetDestination(_player.position);
        }
        else if (_aggro && dist <= attackRange)
        {
            _agent.ResetPath();
            _attackTimer -= Time.deltaTime;
            if (_attackTimer <= 0)
            {
                _attackTimer = attackCd;
                StatsManager.Instance?.TakeDamage(attackDamage);
            }
            transform.LookAt(new Vector3(_player.position.x, transform.position.y, _player.position.z));
        }
        else
        {
            // 徘徊
            _wanderTimer -= Time.deltaTime;
            if (_wanderTimer <= 0 || !_agent.hasPath)
                SetNewWanderTarget();
        }

        // アニメーション
        float speed = _agent.velocity.magnitude;
        _anim?.SetFloat(AnimSpeed, speed / (_aggro ? 4.2f : 1.6f));
        _anim?.SetBool (AnimInWater, _inWater);
    }

    void SetNewWanderTarget()
    {
        _wanderTimer = Random.Range(2f, 5f);
        Vector3 randomDir = Random.insideUnitSphere * 8f;
        randomDir += transform.position;
        if (NavMesh.SamplePosition(randomDir, out NavMeshHit hit, 8f, NavMesh.AllAreas))
            _agent.SetDestination(hit.position);
    }

    public void TakeDamage(float dmg)
    {
        if (!_alive) return;
        _hp -= dmg;
        _aggro = true;
        if (_hp <= 0) Die();
    }

    void Die()
    {
        _alive = false;
        _agent.enabled = false;
        ProgressionManager.Instance?.AddXp(xpReward);
        // ドロップ生成
        foreach (var prefab in dropPrefabs)
            if (prefab != null)
                Instantiate(prefab, transform.position + Vector3.up * 0.3f, Quaternion.identity);
        Destroy(gameObject, 0.5f);
    }
}
