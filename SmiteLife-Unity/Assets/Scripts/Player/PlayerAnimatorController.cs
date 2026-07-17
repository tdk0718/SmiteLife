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

    Animator         _anim;
    PlayerController _player;

    void Awake()
    {
        _anim   = GetComponent<Animator>();
        _player = GetComponentInParent<PlayerController>();
        if (_player == null) _player = GetComponent<PlayerController>();
    }

    void Update()
    {
        float speed = _player.IsMoving
            ? (_player.IsSprinting ? 2f : 1f)
            : 0f;

        _anim.SetFloat  (ParamSpeed,    speed,       0.1f, Time.deltaTime);
        _anim.SetBool   (ParamInWater,  _player.InWater);
        _anim.SetBool   (ParamGrounded, _player.IsGrounded);
    }

    public void TriggerAttack() => _anim.SetTrigger(ParamAttack);
    public void TriggerPunch()  => _anim.SetTrigger(ParamPunch);
    public void TriggerMelee()  => _anim.SetTrigger(ParamMelee);
}
