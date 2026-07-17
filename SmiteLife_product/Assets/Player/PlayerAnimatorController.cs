using UnityEngine;

// Animator の各パラメータ名を定数管理
// Animator Controller に同名の bool/float/trigger を作成すること
[RequireComponent(typeof(Animator))]
public class PlayerAnimatorController : MonoBehaviour
{
    static readonly int ParamSpeed    = Animator.StringToHash("Speed");
    static readonly int ParamInWater  = Animator.StringToHash("InWater");
    static readonly int ParamGrounded = Animator.StringToHash("IsGrounded");
    static readonly int ParamAttack   = Animator.StringToHash("Attack");
    static readonly int ParamPunch    = Animator.StringToHash("Punch");
    static readonly int ParamMelee    = Animator.StringToHash("Melee");
    static readonly int StateIdle     = Animator.StringToHash("Idle");
    static readonly int StateWalk     = Animator.StringToHash("Walk");
    static readonly int StateRun      = Animator.StringToHash("Run");
    static readonly int StateSwim     = Animator.StringToHash("Swim");
    static readonly int StateJump     = Animator.StringToHash("Jump");
    static readonly int StateAttack   = Animator.StringToHash("Attack");
    static readonly int StatePunch    = Animator.StringToHash("Punch");
    static readonly int StateMelee    = Animator.StringToHash("Melee");

    Animator         _anim;
    PlayerController _player;
    int              _currentState;
    float            _lockedUntil;

    void Awake()
    {
        _anim   = GetComponent<Animator>();
        _player = GetComponentInParent<PlayerController>();
        if (_player == null) _player = GetComponent<PlayerController>();
    }

    void Update()
    {
        if (_player == null)
        {
            _player = GetComponentInParent<PlayerController>();
            if (_player == null) return;
        }

        float speed = _player.IsMoving
            ? (_player.IsSprinting ? 2f : 1f)
            : 0f;

        _anim.SetFloat  (ParamSpeed,    speed,       0.1f, Time.deltaTime);
        _anim.SetBool   (ParamInWater,  _player.InWater);
        _anim.SetBool   (ParamGrounded, _player.IsGrounded);

        if (Time.time < _lockedUntil) return;

        // 通常移動(5m/s)も走りペースなので、移動中は常に Run（走り）を再生する。
        // ゆっくり歩き(Walk)は将来スニーク等の低速移動用に温存。
        int state = _player.InWater ? StateSwim
            : !_player.IsGrounded ? StateJump
            : _player.IsMoving ? StateRun
            : StateIdle;
        PlayState(state, 0.18f);
    }

    public void TriggerAttack()
    {
        _anim.SetTrigger(ParamAttack);
        PlayLocked(StateAttack, 0.75f);
    }

    public void TriggerPunch()
    {
        _anim.SetTrigger(ParamPunch);
        PlayLocked(StatePunch, 0.65f);
    }

    public void TriggerMelee()
    {
        _anim.SetTrigger(ParamMelee);
        PlayLocked(StateMelee, 0.75f);
    }

    void PlayLocked(int state, float duration)
    {
        PlayState(state, 0.08f);
        _lockedUntil = Time.time + duration;
    }

    void PlayState(int state, float fade)
    {
        if (_anim.runtimeAnimatorController == null || _currentState == state) return;
        _anim.CrossFade(state, fade, 0);
        _currentState = state;
    }
}
