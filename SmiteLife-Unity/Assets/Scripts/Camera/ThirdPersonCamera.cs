using UnityEngine;

public class ThirdPersonCamera : MonoBehaviour
{
    [Header("Third-Person")]
    public Transform target;
    public float distance    = 8f;
    public float height      = 3f;
    public float sensitivity = 200f;
    public float smoothSpeed = 10f;
    public float minPitch    = 5f;
    public float maxPitch    = 70f;

    [Header("First-Person")]
    public float eyeHeight = 1.65f;

    float _yaw;
    float _pitch = 20f;
    bool  _fpMode;
    Vector3 _currentPos;
    bool    _initialized;

    public float Yaw   => _yaw;
    public bool  FPMode => _fpMode;

    void Start()
    {
        _currentPos   = transform.position;
        _initialized  = false;
        Cursor.lockState = CursorLockMode.Locked;
    }

    void LateUpdate()
    {
        if (target == null) return;

        float mx = Input.GetAxis("Mouse X") * sensitivity * Time.deltaTime;
        float my = Input.GetAxis("Mouse Y") * sensitivity * Time.deltaTime;
        _yaw   += mx;
        _pitch  = Mathf.Clamp(_pitch - my, minPitch, maxPitch);

        if (_fpMode)
        {
            transform.position = target.position + Vector3.up * eyeHeight;
            transform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
        }
        else
        {
            Vector3 offset = Quaternion.Euler(_pitch, _yaw, 0f) * new Vector3(0, 0, -distance);
            Vector3 desired = target.position + Vector3.up * height * 0.5f + offset;

            if (!_initialized) { _currentPos = desired; _initialized = true; }
            _currentPos = Vector3.Lerp(_currentPos, desired, Time.deltaTime * smoothSpeed);

            // カメラが地形に埋まらないよう簡易チェック
            if (Physics.Linecast(target.position + Vector3.up, _currentPos, out RaycastHit hit))
                _currentPos = hit.point + hit.normal * 0.2f;

            transform.position = _currentPos;
            transform.LookAt(target.position + Vector3.up * 1.0f);
        }

        // PlayerController にカメラの向きを渡す
        if (target.TryGetComponent(out PlayerController pc))
            pc.CameraYaw = _yaw;
    }

    public void SetFPMode(bool enabled)
    {
        _fpMode = enabled;
        if (!enabled) _currentPos = transform.position;
    }

    // 画面中心の射線（炎魔法・弓の狙い用）
    public Ray GetAimRay() => new Ray(transform.position, transform.forward);
}
