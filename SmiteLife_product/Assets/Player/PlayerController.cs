using UnityEngine;

// player.js の移植:
//   ・W/S: カメラ yaw 基準の前進/後退（前 = カメラの反対方向 = -sin/-cos）
//   ・A/D: カメラの回転（ストレイフではない）
//   ・キャラクターは常に cameraYaw + π の向きへなめらかに回頭する
[RequireComponent(typeof(CharacterController))]
public class PlayerController : MonoBehaviour
{
    const float Speed = 5f;
    const float SprintMult = 1.5f;
    const float JumpVel = 8f;
    const float Gravity = -20f;
    const float TurnSpeed = 12f;
    const float DodgeSpeed = 12f;
    const float DodgeDuration = 0.28f;
    const float DodgeStamina = 25f;
    const float StepHeight = 0.55f;

    const float WaterLevel = 0.0f;
    const float WaistHeight = 0.88f;
    const float SwimSpeed = 2.8f;
    const float SwimBuoyancy = 14f;
    const float SwimDrag = 0.88f;

    CharacterController _cc;
    ThirdPersonCamera _camera;
    float _velY;
    bool _onGround = true;
    float _dodgeTimer;
    Vector3 _dodgeDir;

    // 外部から読み取る状態
    public bool IsGrounded => _onGround;
    public bool InWater { get; private set; }
    public bool IsSwimming { get; private set; }
    public bool IsMoving { get; private set; }
    public bool IsSprinting { get; private set; }
    public bool IsDodging => _dodgeTimer > 0;

    void Awake()
    {
        _cc = GetComponent<CharacterController>();
        _cc.stepOffset = StepHeight;
    }

    ThirdPersonCamera Cam
    {
        get
        {
            if (_camera == null) _camera = Camera.main != null ? Camera.main.GetComponent<ThirdPersonCamera>() : null;
            return _camera;
        }
    }

    void Update()
    {
        float delta = Time.deltaTime;
        bool dead = StatsManager.Instance != null && StatsManager.Instance.IsDead;

        float feetY = transform.position.y;
        InWater = feetY < WaterLevel - 0.05f;
        IsSwimming = feetY < WaterLevel - WaistHeight;

        bool forward = !dead && (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow));
        bool backward = !dead && (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow));
        bool left = !dead && (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)
            || RuntimeHud.RotateLeftHeld || RuntimeHud.PointerHeldOverRotateLeftButton());
        bool right = !dead && (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)
            || RuntimeHud.RotateRightHeld || RuntimeHud.PointerHeldOverRotateRightButton());
        bool jump = !dead && Input.GetKey(KeyCode.Space);
        bool sprint = !dead && Input.GetKey(KeyCode.LeftShift)
            && (StatsManager.Instance == null || StatsManager.Instance.CanSprint());

        // A/D はカメラの回転（原典 main.js: CameraController.rotate）
        Cam?.Rotate(delta, left, right);
        float yaw = Cam != null ? Cam.YawRad : 0f;

        // 前 = カメラの反対方向（-sin, -cos）
        float moveX = 0, moveZ = 0;
        if (forward) { moveX -= Mathf.Sin(yaw); moveZ -= Mathf.Cos(yaw); }
        if (backward) { moveX += Mathf.Sin(yaw); moveZ += Mathf.Cos(yaw); }
        float len = Mathf.Sqrt(moveX * moveX + moveZ * moveZ);
        IsMoving = len > 0;
        IsSprinting = IsMoving && sprint;

        float speedMult = StatsManager.Instance != null ? StatsManager.Instance.SpeedMultiplier : 1f;
        float baseSpeed = (IsSwimming ? SwimSpeed : (sprint ? Speed * SprintMult : Speed)) * speedMult;

        // 回避（Q）: 前後入力方向、なければ正面へ
        if (!dead && Input.GetKeyDown(KeyCode.Q) && _dodgeTimer <= 0
            && StatsManager.Instance != null && StatsManager.Instance.SpendStamina(DodgeStamina))
        {
            float dx = 0, dz = 0;
            if (forward) { dx -= Mathf.Sin(yaw); dz -= Mathf.Cos(yaw); }
            if (backward) { dx += Mathf.Sin(yaw); dz += Mathf.Cos(yaw); }
            float dlen = Mathf.Sqrt(dx * dx + dz * dz);
            if (dlen > 0.001f) { dx /= dlen; dz /= dlen; }
            else { dx = transform.forward.x; dz = transform.forward.z; }
            _dodgeDir = new Vector3(dx, 0, dz);
            _dodgeTimer = DodgeDuration;
        }

        var horizontal = Vector3.zero;
        if (IsMoving && len > 0)
            horizontal = new Vector3(moveX / len, 0, moveZ / len) * baseSpeed;
        if (_dodgeTimer > 0)
        {
            _dodgeTimer = Mathf.Max(0, _dodgeTimer - delta);
            horizontal += _dodgeDir * DodgeSpeed;
        }

        // キャラクターをカメラの反対方向へ向ける（facing = yaw + π）
        float facing = yaw + Mathf.PI;
        float current = transform.eulerAngles.y * Mathf.Deg2Rad;
        float diff = Mathf.Atan2(Mathf.Sin(facing - current), Mathf.Cos(facing - current));
        transform.rotation = Quaternion.Euler(0, (current + diff * Mathf.Min(1f, delta * TurnSpeed)) * Mathf.Rad2Deg, 0);

        // 垂直移動（水泳 or 通常重力）
        if (IsSwimming)
        {
            _velY += SwimBuoyancy * delta;
            if (jump) _velY = Mathf.Max(_velY, 2.5f);
            _velY *= SwimDrag;
            if (feetY + _velY * delta > WaterLevel - WaistHeight + 0.3f) _velY = Mathf.Min(_velY, 1.0f);
            _onGround = false;
        }
        else
        {
            if (jump && _onGround) { _velY = JumpVel; _onGround = false; }
            _velY += Gravity * delta;
            if (InWater) _velY *= 0.92f;
        }

        _cc.Move((horizontal + Vector3.up * _velY) * delta);

        if (_cc.isGrounded)
        {
            _onGround = true;
            if (_velY < 0) _velY = -2f;
        }
        else if (_velY > 0 || IsSwimming)
        {
            _onGround = false;
        }

        StatsManager.Instance?.UpdateStamina(IsSprinting);
    }

    public void StartDodge(Vector3 dir)
    {
        if (_dodgeTimer > 0) return;
        _dodgeDir = dir.sqrMagnitude > 0.01f ? dir.normalized : transform.forward;
        _dodgeTimer = DodgeDuration;
    }

    public void WarpTo(Vector3 pos)
    {
        _cc.enabled = false;
        transform.position = pos;
        _cc.enabled = true;
        _velY = 0;
    }
}
