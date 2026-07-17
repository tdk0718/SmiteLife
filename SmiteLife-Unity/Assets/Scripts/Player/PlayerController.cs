using UnityEngine;

[RequireComponent(typeof(CharacterController))]
public class PlayerController : MonoBehaviour
{
    [Header("Movement")]
    public float walkSpeed    = 4.0f;
    public float runSpeed     = 7.5f;
    public float swimSpeed    = 2.8f;
    public float jumpForce    = 6.0f;
    public float gravity      = -20f;
    public float waterLevel   = 0.0f;
    public float waistHeight  = 0.8f;

    [Header("Dodge")]
    public float dodgeSpeed    = 12f;
    public float dodgeDuration = 0.28f;

    CharacterController _cc;
    Vector3  _velocity;
    float    _dodgeTimer;
    Vector3  _dodgeDir;
    bool     _isDodging;

    // 外部から読み取る状態
    public bool  IsGrounded  { get; private set; }
    public bool  InWater     { get; private set; }
    public bool  IsSwimming  { get; private set; }
    public bool  IsMoving    { get; private set; }
    public bool  IsSprinting { get; private set; }
    public bool  IsDodging   => _isDodging;

    // カメラの向き（ThirdPersonCamera から毎フレームセット）
    [HideInInspector] public float CameraYaw;

    void Awake() => _cc = GetComponent<CharacterController>();

    void Update()
    {
        IsGrounded  = _cc.isGrounded;
        InWater     = transform.position.y + waistHeight < waterLevel;
        IsSwimming  = transform.position.y < waterLevel - 0.3f;

        if (_isDodging)
        {
            UpdateDodge();
            return;
        }

        // 入力
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");

        bool sprint = Input.GetKey(KeyCode.LeftShift) && StatsManager.Instance.CanSprint();
        IsSprinting = sprint && (Mathf.Abs(h) > 0.1f || Mathf.Abs(v) > 0.1f);

        // カメラ方向を基準に移動ベクトルを計算
        Vector3 moveDir = Vector3.zero;
        if (Mathf.Abs(h) > 0.1f || Mathf.Abs(v) > 0.1f)
        {
            float yaw = CameraYaw * Mathf.Deg2Rad;
            moveDir = new Vector3(
                h * Mathf.Cos(yaw) + v * Mathf.Sin(yaw),
                0,
                -h * Mathf.Sin(yaw) + v * Mathf.Cos(yaw)
            ).normalized;
            transform.rotation = Quaternion.Slerp(
                transform.rotation,
                Quaternion.LookRotation(moveDir),
                Time.deltaTime * 12f
            );
        }

        IsMoving = moveDir.sqrMagnitude > 0.01f;

        float speed = IsSwimming ? swimSpeed
                    : (IsSprinting ? runSpeed : walkSpeed);
        speed *= StatsManager.Instance.SpeedMultiplier;

        if (IsSwimming)
        {
            // 水泳: 垂直方向にも動ける
            _velocity.x = moveDir.x * speed;
            _velocity.z = moveDir.z * speed;
            _velocity.y = Mathf.Lerp(_velocity.y, 0f, Time.deltaTime * 4f);
            if (Input.GetKey(KeyCode.Space))  _velocity.y =  2.5f;
            if (Input.GetKey(KeyCode.LeftControl)) _velocity.y = -2.5f;
        }
        else
        {
            _velocity.x = moveDir.x * speed;
            _velocity.z = moveDir.z * speed;

            if (IsGrounded && _velocity.y < 0) _velocity.y = -2f;

            if (IsGrounded && Input.GetKeyDown(KeyCode.Space))
                _velocity.y = jumpForce;

            _velocity.y += gravity * Time.deltaTime;
        }

        _cc.Move(_velocity * Time.deltaTime);
        StatsManager.Instance.UpdateStamina(IsSprinting);
    }

    void UpdateDodge()
    {
        _dodgeTimer -= Time.deltaTime;
        _cc.Move(_dodgeDir * dodgeSpeed * Time.deltaTime);
        _velocity.y += gravity * Time.deltaTime;
        _cc.Move(new Vector3(0, _velocity.y * Time.deltaTime, 0));
        if (_dodgeTimer <= 0) _isDodging = false;
    }

    public void StartDodge(Vector3 dir)
    {
        if (_isDodging) return;
        _dodgeDir   = dir.sqrMagnitude > 0.01f ? dir.normalized : -transform.forward;
        _dodgeTimer = dodgeDuration;
        _isDodging  = true;
        StatsManager.Instance.SpendStamina(25f);
    }

    public void WarpTo(Vector3 pos)
    {
        _cc.enabled = false;
        transform.position = pos;
        _cc.enabled = true;
    }
}
