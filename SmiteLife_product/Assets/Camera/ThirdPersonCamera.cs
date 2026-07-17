using UnityEngine;

// camera.js の移植:
//   ・カメラはプレイヤー背後 (sin(yaw), cos(yaw)) 方向・距離8/高さ3に位置し、毎フレーム lerp で追従
//   ・A/D キー（PlayerController から Rotate 経由）とマウスドラッグで yaw/pitch を回す
//   ・カメラ衝突補正は原典に存在しないため行わない
public class ThirdPersonCamera : MonoBehaviour
{
    public Transform target;

    const float Distance = 8f;
    const float Height = 3f;
    const float LerpPerFrame = 0.1f;  // 原典は 60fps 前提の 0.1/frame
    const float RotateSpeed = 2.2f;   // A/D の回転速度（rad/s）
    const float FpEyeHeight = 1.65f;

    float _yaw;
    float _pitch = 0.3f;
    bool _fpMode;
    Vector3 _currentPos;
    bool _initialized;
    Vector3 _lastMouse;
    bool _dragging;
    bool _renderersVisible = true;

    // ラジアンの yaw（player.js 互換の座標系）
    public float YawRad => _yaw;
    public bool FPMode => _fpMode;

    void Start()
    {
        _currentPos = transform.position;
        _initialized = false;
        Cursor.lockState = CursorLockMode.None; // 原典はドラッグ操作（カーソル表示）
    }

    // A/D キーでの回転（PlayerController から毎フレーム呼ぶ）
    public void Rotate(float delta, bool left, bool right)
    {
        if (left) _yaw -= RotateSpeed * delta;
        if (right) _yaw += RotateSpeed * delta;
    }

    void Update()
    {
        bool wantsFp = PlacementSystem.Instance?.SelectedItem != null
            || FindAnyObjectByType<CombatAbilitySystem>()?.IsAiming == true;
        SetFPMode(wantsFp);

        // マウスドラッグで視点回転（原典: yaw -= dx*0.005, pitch += dy*0.005）
        if (Input.GetMouseButtonDown(1) || Input.GetMouseButtonDown(0))
        {
            _dragging = true;
            _lastMouse = Input.mousePosition;
        }
        if (!Input.GetMouseButton(0) && !Input.GetMouseButton(1)) _dragging = false;
        if (_dragging)
        {
            Vector3 d = Input.mousePosition - _lastMouse;
            _lastMouse = Input.mousePosition;
            _yaw -= d.x * 0.005f;
            // スクリーンY軸は上向きが正（ブラウザと逆）なので符号を反転
            _pitch = Mathf.Clamp(_pitch - d.y * 0.005f, 0.05f, 1.2f);
        }
    }

    void LateUpdate()
    {
        if (target == null) return;

        if (_fpMode)
        {
            // 一人称（設置/狙い）視点: 目の高さから facing 方向（-sin/-cos）を見る
            float fpAngle = -(_pitch - 0.3f) * 1.2f;
            transform.position = target.position + Vector3.up * FpEyeHeight;
            float hLen = Mathf.Cos(fpAngle);
            const float lookDist = 20f;
            transform.LookAt(new Vector3(
                target.position.x - Mathf.Sin(_yaw) * hLen * lookDist,
                target.position.y + FpEyeHeight + Mathf.Sin(fpAngle) * lookDist,
                target.position.z - Mathf.Cos(_yaw) * hLen * lookDist));
            return;
        }

        Vector3 desired = new(
            target.position.x + Distance * Mathf.Sin(_yaw) * Mathf.Cos(_pitch),
            target.position.y + Height + Distance * Mathf.Sin(_pitch),
            target.position.z + Distance * Mathf.Cos(_yaw) * Mathf.Cos(_pitch));

        if (!_initialized)
        {
            _currentPos = desired;
            _initialized = true;
        }
        else
        {
            // フレームレート非依存化した lerp 0.1/frame（60fps 基準）
            float t = 1f - Mathf.Pow(1f - LerpPerFrame, Time.deltaTime * 60f);
            _currentPos = Vector3.Lerp(_currentPos, desired, t);
        }
        transform.position = _currentPos;
        transform.LookAt(target.position + Vector3.up * 1.0f);
    }

    public void SetFPMode(bool enabled)
    {
        if (_fpMode == enabled)
        {
            SetTargetRenderersVisible(!enabled);
            return;
        }
        _fpMode = enabled;
        SetTargetRenderersVisible(!enabled);
        if (!enabled)
        {
            _currentPos = transform.position; // FP 位置から TP へなめらかに戻す
            _initialized = true;
        }
    }

    // 画面中央の視線レイ（設置モード・弓/炎の狙い用）
    public Ray GetAimRay()
    {
        float fpAngle = -(_pitch - 0.3f) * 1.2f;
        float hLen = Mathf.Cos(fpAngle);
        var dir = new Vector3(
            -Mathf.Sin(_yaw) * hLen,
            Mathf.Sin(fpAngle),
            -Mathf.Cos(_yaw) * hLen).normalized;
        return new Ray(transform.position, dir);
    }

    void SetTargetRenderersVisible(bool visible)
    {
        if (target == null || _renderersVisible == visible) return;
        _renderersVisible = visible;
        foreach (var renderer in target.GetComponentsInChildren<Renderer>(true))
            renderer.enabled = visible;
    }
}
