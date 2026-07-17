using UnityEngine;

// 敵/動物1体の行動（enemy.js の個体ロジックの移植）
// 移動は NavMesh ではなく地形高さサンプリング + 障害物押し出しで行う（ランタイム生成ワールドのため）
public class EnemyAI : MonoBehaviour
{
    const float WaterOffset = -0.10f;        // 水面からこの深さ未満は水
    const float WaterSurfaceOffset = -0.28f; // 水中でのフロート高さ
    const float WaterRepRange = 1.8f;        // 水域を検知するサンプル距離
    const float WaterRepStr = 2.2f;          // 水域回避力（追跡時は半減）
    const float FireFearDist = 9f;
    const float TamedFightRange = 10f;   // テイム動物が戦いに参加する範囲
    const float TamedWanderRadius = 6f;  // 追従時にプレイヤー周囲をうろつく範囲
    const float TamedLeashMax = 11f;     // これより離れたらプレイヤーの元へ戻る
    const float TamedRoamRadius = 12f;   // 放浪モード時のうろつき範囲
    const float StuckCheckSec = 0.5f;
    const float StuckMinMove = 0.15f;
    public const float BabyScale = 0.45f;
    public const float BabyStarveTime = 20f * 60f; // 餌なしで20分で餓死
    const float BabyBaitRange = 14f;

    public EnemyTypeDef type;
    public EnemyLevelTier tier;

    // ステータス
    public float hp;
    public float maxHp;
    public float damage;
    public float speedChase;
    public float speedWander;
    public int xp;
    public string sex = "male";

    // テイム関連
    public bool tamed;
    public int tamedLevel = 1;
    public int tamedXp;
    public float affection;
    public float tamedBaseScale = 1f;

    // 繁殖関連
    public bool pregnant;
    public float pregnancyTimer;
    public float breedCd;
    public bool baby;
    public float starveTimer;
    public float growTimer;

    // 内部状態
    public bool alive = true;
    public bool aggro;
    public float baseScale = 1f;
    float _attackCd;
    float _animTime;
    Vector3 _wander;
    float _wanderTimer;
    float _fleeTimer;
    float _eatCooldown;
    float _stuckTimer;
    Vector3 _stuckPos;
    float _avoidTimer;
    Vector3 _avoidDir;
    float _hitFlashTimer;
    int _wolfAnimState;
    float _wolfAnimRefresh;

    EnemyBodyParts _parts;
    Vector3 _bellyBaseScale;

    public Vector3 Position => transform.position;

    // 体の生成とステータス初期化。スポーン/復元の両方から呼ぶ。
    public void Setup(EnemyTypeDef t, EnemyLevelTier lv, string sexValue, bool aggroed = false)
    {
        type = t;
        tier = lv;
        sex = sexValue;
        _parts = EnemyBodyBuilder.Build(t.id, sexValue);
        _parts.root.transform.SetParent(transform, false);
        if (_parts.belly != null) _bellyBaseScale = _parts.belly.localScale;

        baseScale = lv.sizeScale;
        transform.localScale = Vector3.one * baseScale;
        maxHp = Mathf.Max(1, Mathf.Round(t.hp * lv.hpMult));
        hp = maxHp;
        damage = Mathf.Max(1, Mathf.Round(t.damage * lv.dmgMult));
        speedChase = t.speedChase * lv.speedMult;
        speedWander = t.speedWander;
        xp = Mathf.RoundToInt(t.xp * lv.xpMult);
        aggro = aggroed && !t.passive;
        _wander = transform.position;

        // 当たり判定（攻撃・投擲の対象）はカプセル1個に集約
        var col = gameObject.GetComponent<CapsuleCollider>();
        if (col == null) col = gameObject.AddComponent<CapsuleCollider>();
        col.center = Vector3.up * 0.55f;
        col.height = 1.1f;
        col.radius = 0.45f;
    }

    public void SetWanderTarget(Vector3 pos) => _wander = pos;

    float GroundHeight(float x, float z) =>
        RuntimeWorldBuilder.Instance != null ? RuntimeWorldBuilder.Instance.TerrainHeight(x, z) : 0f;

    float WaterY => RuntimeWorldBuilder.WaterLevel + WaterOffset;
    float WaterSurfaceY => RuntimeWorldBuilder.WaterLevel + WaterSurfaceOffset;

    void Update()
    {
        if (!alive) return;
        var mgr = EnemyManager.Instance;
        if (mgr == null || mgr.Player == null) return;
        float delta = Time.deltaTime;

        Vector3 playerPos = mgr.Player.position;
        float dx = playerPos.x - transform.position.x;
        float dz = playerPos.z - transform.position.z;
        float distToPlayer = Mathf.Sqrt(dx * dx + dz * dz);

        if (_hitFlashTimer > 0)
        {
            _hitFlashTimer -= delta;
            if (_hitFlashTimer <= 0) transform.localScale = Vector3.one * baseScale;
        }

        if (tamed) UpdateTamed(delta, playerPos, distToPlayer, dx, dz);
        else UpdateHostile(delta, playerPos, distToPlayer, dx, dz);
    }

    // ────────────────────────────────────────────────
    // テイム動物の AI
    // ────────────────────────────────────────────────
    void UpdateTamed(float delta, Vector3 playerPos, float distToPlayer, float dx, float dz)
    {
        var mgr = EnemyManager.Instance;

        // 妊娠・出産の進行
        if (breedCd > 0) breedCd -= delta;
        if (pregnant)
        {
            pregnancyTimer -= delta;
            if (pregnancyTimer <= 0) mgr.GiveBirth(this);
        }

        // 赤ちゃん: 空腹（餓死）と成長の進行
        ProjectileSystem.Bait baitGoal = null;
        if (baby)
        {
            starveTimer -= delta;
            if (starveTimer <= 0)
            {
                RuntimeHud.Toast($"💀 {type.icon} 赤ちゃんが餓死してしまった…もっと餌が必要だった");
                Kill();
                return;
            }
            growTimer += delta;
            float g = Mathf.Min(1f, growTimer / mgr.BabyGrowTime);
            baseScale = (BabyScale + (1f - BabyScale) * g) * tamedBaseScale;
            transform.localScale = Vector3.one * baseScale;
            if (g >= 1f)
            {
                baby = false;
                var st = EnemyTypes.TamedStatsFor(1);
                hp = maxHp = st.hp;
                RuntimeHud.Toast($"🎉 {type.icon} 赤ちゃんが立派な大人に成長した！");
            }
            // 餌（投げられた肉や魚）を探す
            if (_eatCooldown > 0) _eatCooldown -= delta;
            else if (ProjectileSystem.Instance != null)
            {
                float bestBd = BabyBaitRange;
                foreach (var b in ProjectileSystem.Instance.GetBaits())
                {
                    float bd = FlatDist(b.pos);
                    if (bd < bestBd) { bestBd = bd; baitGoal = b; }
                }
            }
        }

        var stats = EnemyTypes.TamedStatsFor(tamedLevel);
        float dirX = 0, dirZ = 0, speed = 0;
        bool moving = false;

        // 近くの敵を探す（赤ちゃんは戦わない。「攻撃しない」命令中も戦わない）
        EnemyAI fightTarget = null;
        float fightDist = TamedFightRange;
        if (!baby && mgr.TamedOrder == "attack")
        {
            foreach (var other in mgr.Enemies)
            {
                if (!other.alive || other.tamed || other == this) continue;
                float od = FlatDist(other.transform.position);
                if (od < fightDist) { fightDist = od; fightTarget = other; }
            }
        }

        if (baitGoal != null)
        {
            Vector3 toBait = baitGoal.pos - transform.position;
            float bd = Mathf.Sqrt(toBait.x * toBait.x + toBait.z * toBait.z);
            if (bd < 0.9f)
            {
                ProjectileSystem.Instance.ConsumeBait(baitGoal);
                _eatCooldown = 2.0f;
                starveTimer = BabyStarveTime;
                RuntimeHud.Toast($"🍼 {type.icon} 赤ちゃんが餌を食べた（満腹になった）");
            }
            else
            {
                dirX = toBait.x / bd; dirZ = toBait.z / bd;
                speed = stats.speed * 0.8f; moving = true;
            }
        }
        else if (fightTarget != null)
        {
            float fdx = fightTarget.transform.position.x - transform.position.x;
            float fdz = fightTarget.transform.position.z - transform.position.z;
            if (fightDist > type.attackRange)
            {
                dirX = fdx / fightDist; dirZ = fdz / fightDist;
                speed = stats.speed; moving = true;
            }
            else
            {
                _attackCd -= delta;
                if (_attackCd <= 0)
                {
                    _attackCd = type.attackCd;
                    PlayExternalWolfAttack();
                    fightTarget.hp -= stats.dmg;
                    fightTarget.HitFlash();
                    if (fightTarget.hp <= 0) mgr.OnTamedKill(this, fightTarget);
                }
                FaceDirection(fdx, fdz);
            }
        }
        else if (mgr.TamedMove == "follow" && distToPlayer > TamedLeashMax)
        {
            // 追従モード: 離れすぎたらプレイヤーの元へ戻る
            dirX = dx / distToPlayer; dirZ = dz / distToPlayer;
            speed = stats.speed * 0.9f; moving = true;
            _wanderTimer = 0;
        }
        else
        {
            // うろうろする（追従: プレイヤー周辺 / 放浪: 自分の現在地周辺）
            bool roam = mgr.TamedMove == "roam";
            _wanderTimer -= delta;
            if (_wanderTimer <= 0)
            {
                _wanderTimer = roam ? 2.5f + Random.value * 4f : 1.5f + Random.value * 2.5f;
                float cx = roam ? transform.position.x : playerPos.x;
                float cz = roam ? transform.position.z : playerPos.z;
                float a = Random.value * Mathf.PI * 2f;
                float r = Random.value * (roam ? TamedRoamRadius : TamedWanderRadius);
                float wx = cx + Mathf.Cos(a) * r;
                float wz = cz + Mathf.Sin(a) * r;
                // 水域が目標になったら中心寄り/反対側に修正
                if (GroundHeight(wx, wz) < WaterY)
                {
                    if (roam) { wx = cx - Mathf.Cos(a) * r * 0.7f; wz = cz - Mathf.Sin(a) * r * 0.7f; }
                    else      { wx = cx + Mathf.Cos(a) * r * 0.4f; wz = cz + Mathf.Sin(a) * r * 0.4f; }
                }
                _wander = new Vector3(wx, 0, wz);
            }
            float twx = _wander.x - transform.position.x, twz = _wander.z - transform.position.z;
            float wlen = Mathf.Sqrt(twx * twx + twz * twz);
            if (wlen > 0.5f)
            {
                dirX = twx / wlen; dirZ = twz / wlen;
                speed = stats.speed * 0.55f; moving = true; // 散歩ペース
            }
        }

        // スタック回避中は進行方向を横向きに上書き
        if (_avoidTimer > 0)
        {
            _avoidTimer -= delta;
            if (moving) { dirX = _avoidDir.x; dirZ = _avoidDir.z; }
        }

        if (moving)
        {
            var pos = transform.position;
            pos.x += dirX * speed * delta;
            pos.z += dirZ * speed * delta;
            transform.position = pos;
            PushOutOfObstacles();

            // スタック検知: 前進しているのに0.5秒間ほぼ動けていなければ方向転換
            _stuckTimer += delta;
            if (_stuckTimer >= StuckCheckSec)
            {
                float moved = FlatDist(_stuckPos);
                if (moved < StuckMinMove)
                {
                    float ang = Mathf.Atan2(dirX, dirZ)
                        + (Random.value < 0.5f ? 1f : -1f) * (Mathf.PI / 2f + Random.value * 0.9f);
                    _avoidDir = new Vector3(Mathf.Sin(ang), 0, Mathf.Cos(ang));
                    _avoidTimer = 0.7f + Random.value * 0.5f;
                    _wanderTimer = 0;
                }
                _stuckTimer = 0;
                _stuckPos = transform.position;
            }

            FaceDirection(dirX, dirZ);
            _animTime += delta * speed * 3.5f;
            AnimateLegs(Mathf.Sin(_animTime) * 0.7f);
            UpdateExternalWolfAnimation(delta, true, speed >= stats.speed * 0.75f);
            EaseBody(delta, 8f, 6f, 0f, 0f);
        }
        else
        {
            _stuckTimer = 0;
            _stuckPos = transform.position;
            RelaxLegs(0.85f);
            UpdateExternalWolfAnimation(delta, false, false);
            EaseBody(delta, 5f, 5f, 0f, 0f);
            if (_attackCd > 0) _attackCd -= delta;
        }

        SnapToGround(floatOnWater: false);
    }

    // ────────────────────────────────────────────────
    // 通常敵の AI
    // ────────────────────────────────────────────────
    void UpdateHostile(float delta, Vector3 playerPos, float distToPlayer, float dx, float dz)
    {
        var mgr = EnemyManager.Instance;
        bool playerDead = StatsManager.Instance != null && StatsManager.Instance.IsDead;

        // 火への恐怖チェック
        bool fleeFromFire = false;
        float fleeX = 0, fleeZ = 0;
        if (type.fearsFire)
        {
            foreach (var fp in mgr.FirePositions)
            {
                float fd = FlatDist(fp);
                if (fd < FireFearDist)
                {
                    float fx = transform.position.x - fp.x, fz = transform.position.z - fp.z;
                    float flen = Mathf.Max(0.001f, Mathf.Sqrt(fx * fx + fz * fz));
                    fleeX += fx / flen; fleeZ += fz / flen;
                    fleeFromFire = true;
                }
            }
            if (fleeFromFire)
            {
                aggro = false;
                float fl = Mathf.Max(0.001f, Mathf.Sqrt(fleeX * fleeX + fleeZ * fleeZ));
                fleeX /= fl; fleeZ /= fl;
            }
        }

        // 餌チェック: 近くに餌があれば誘引
        ProjectileSystem.Bait baitTarget = null;
        if (!fleeFromFire && _eatCooldown <= 0 && ProjectileSystem.Instance != null)
        {
            foreach (var b in ProjectileSystem.Instance.GetBaits())
            {
                if (FlatDist(b.pos) < type.detectRange * 0.9f) { baitTarget = b; break; }
            }
        }
        if (_eatCooldown > 0) _eatCooldown -= delta;

        // 攻撃されて逃走中（牛などの臆病な動物）
        if (_fleeTimer > 0) _fleeTimer -= delta;

        // アグロ判定（passive な動物は自分からは襲わない）
        if (!playerDead && !mgr.PlayerNearFire && !fleeFromFire && baitTarget == null && !type.passive
            && _fleeTimer <= 0 && distToPlayer <= type.detectRange) aggro = true;
        if (playerDead || mgr.PlayerNearFire || fleeFromFire || baitTarget != null || distToPlayer > type.leashRange)
        {
            if (baitTarget == null) aggro = false;
        }

        float dirX = 0, dirZ = 0, speed = 0;
        bool moving = false;

        if (fleeFromFire)
        {
            dirX = fleeX; dirZ = fleeZ;
            speed = type.fireFleeSpeed > 0 ? type.fireFleeSpeed : speedChase * 1.3f;
            moving = true;
        }
        else if (_fleeTimer > 0 && distToPlayer > 0.01f)
        {
            // プレイヤーから逃げる
            dirX = -dx / distToPlayer; dirZ = -dz / distToPlayer;
            speed = speedChase * 1.15f;
            moving = true;
            aggro = false;
        }
        else if (baitTarget != null)
        {
            Vector3 toBait = baitTarget.pos - transform.position;
            float bd = Mathf.Sqrt(toBait.x * toBait.x + toBait.z * toBait.z);
            if (bd < 0.9f)
            {
                // 餌を食べる
                ProjectileSystem.Instance.ConsumeBait(baitTarget);
                _eatCooldown = 2.5f;
                if (type.tameable)
                {
                    affection = Mathf.Min(100f, affection + type.tameAffection);
                    if (affection >= 100f) Tame();
                    else RuntimeHud.Toast($"{type.icon} {type.displayName}{SexLabel()} が餌を食べた（好感度 {affection:0}/100）");
                }
            }
            else
            {
                dirX = toBait.x / bd; dirZ = toBait.z / bd;
                speed = speedWander * 1.3f;
                moving = true;
                aggro = false;
            }
        }
        else if (aggro)
        {
            if (distToPlayer > type.attackRange)
            {
                dirX = dx / distToPlayer; dirZ = dz / distToPlayer;
                speed = speedChase; moving = true;
            }
            else
            {
                _attackCd -= delta;
                if (_attackCd <= 0)
                {
                    _attackCd = type.attackCd;
                    PlayExternalWolfAttack();
                    // テイム動物が近くにいればその動物がかばう（赤ちゃんはかばえない）
                    EnemyAI protector = null;
                    foreach (var w in mgr.Enemies)
                    {
                        if (!w.alive || !w.tamed || w.baby) continue;
                        if (w.FlatDist(transform.position) < type.attackRange * 1.8f) { protector = w; break; }
                    }
                    if (protector != null)
                    {
                        protector.hp -= damage;
                        RuntimeHud.Toast($"{protector.type.icon} 仲間の{protector.type.displayName}が身を挺してかばった！（残りHP: {Mathf.Max(0, protector.hp):0}）");
                        if (protector.hp <= 0)
                        {
                            RuntimeHud.Toast($"💔 仲間の{protector.type.displayName}が倒れた…");
                            protector.Kill();
                        }
                    }
                    else if (!mgr.PlayerDodging)
                    {
                        StatsManager.Instance?.TakeDamage(damage);
                    }
                }
                FaceDirection(dx, dz);
            }
        }
        else
        {
            _wanderTimer -= delta;
            if (_wanderTimer <= 0)
            {
                _wanderTimer = 2f + Random.value * 3f;
                float a = Random.value * Mathf.PI * 2f;
                float r = 4f + Random.value * 6f;
                float wx = transform.position.x + Mathf.Cos(a) * r;
                float wz = transform.position.z + Mathf.Sin(a) * r;
                // 水域へのワンダー目標は陸地側に反転
                if (GroundHeight(wx, wz) < WaterY)
                {
                    wx = transform.position.x - Mathf.Cos(a) * r * 0.7f;
                    wz = transform.position.z - Mathf.Sin(a) * r * 0.7f;
                }
                _wander = new Vector3(wx, 0, wz);
            }
            float twx = _wander.x - transform.position.x, twz = _wander.z - transform.position.z;
            float wlen = Mathf.Sqrt(twx * twx + twz * twz);
            if (wlen > 0.5f) { dirX = twx / wlen; dirZ = twz / wlen; speed = speedWander; moving = true; }
        }

        bool inWater = transform.position.y < WaterSurfaceY + 0.05f;

        if (moving)
        {
            // 水域回避: 陸上かつ水際なら斥力を加算（追跡時は半減）
            if (!inWater)
            {
                float rx = 0, rz = 0;
                float S = WaterRepRange;
                var p = transform.position;
                if (GroundHeight(p.x, p.z - S) < WaterY) rz += 1;
                if (GroundHeight(p.x, p.z + S) < WaterY) rz -= 1;
                if (GroundHeight(p.x - S, p.z) < WaterY) rx += 1;
                if (GroundHeight(p.x + S, p.z) < WaterY) rx -= 1;
                float rlen = Mathf.Sqrt(rx * rx + rz * rz);
                if (rlen > 0)
                {
                    float str = aggro ? WaterRepStr * 0.45f : WaterRepStr;
                    dirX += rx / rlen * str;
                    dirZ += rz / rlen * str;
                    float dl = Mathf.Sqrt(dirX * dirX + dirZ * dirZ);
                    if (dl > 0) { dirX /= dl; dirZ /= dl; }
                }
            }

            float waterMult = inWater ? 0.40f : 1.0f;
            var pos = transform.position;
            pos.x += dirX * speed * waterMult * delta;
            pos.z += dirZ * speed * waterMult * delta;
            transform.position = pos;
            FaceDirection(dirX, dirZ);
            PushOutOfObstacles();

            if (inWater)
            {
                // 水泳アニメ: ドッグパドル
                _animTime += delta * 4.5f;
                float paddle = Mathf.Sin(_animTime) * 0.55f;
                AnimatePaddle(paddle);
                UpdateExternalWolfAnimation(delta, true, false);
                EaseBody(delta, 5f, 4f, -0.32f + Mathf.Sin(_animTime * 1.3f) * 0.05f, 0.32f);
            }
            else
            {
                bool isRunning = aggro || fleeFromFire;
                float swingAmt = isRunning ? 0.90f : 0.45f;
                _animTime += delta * speed * (isRunning ? 4.8f : 3.0f);
                AnimateLegs(Mathf.Sin(_animTime) * swingAmt);
                UpdateExternalWolfAnimation(delta, true, isRunning);
                if (isRunning)
                    EaseBody(delta, 12f, 8f, Mathf.Abs(Mathf.Sin(_animTime * 2f)) * 0.07f, -0.18f);
                else
                    EaseBody(delta, 6f, 6f, 0f, 0f);
            }
        }
        else
        {
            RelaxLegs(0.8f);
            UpdateExternalWolfAnimation(delta, false, false);
            if (inWater)
            {
                _animTime += delta * 2f;
                EaseBody(delta, 4f, 4f, -0.32f + Mathf.Sin(_animTime * 1.3f) * 0.04f, 0.28f);
            }
            else
            {
                EaseBody(delta, 6f, 6f, 0f, 0f);
            }
            if (_attackCd > 0) _attackCd -= delta;
        }

        SnapToGround(floatOnWater: true);
    }

    // ── ダメージ・死亡 ─────────────────────────────
    // 返り値: 倒したら true
    public bool TakeDamage(float dmg)
    {
        if (!alive) return false;
        hp -= dmg;
        if (!tamed)
        {
            if (type.fleeOnHurt) _fleeTimer = 7f; // 臆病な動物は反撃せず逃げる
            else aggro = true;
        }

        // 与えたダメージを頭上に表示
        var headPos = transform.position + Vector3.up * 1.3f * baseScale;
        DamageTextSystem.Spawn(headPos, dmg, dmg >= 25f);
        HitFlash();

        if (hp > 0) return false;

        // ドロップ + 経験値
        var parts = new System.Collections.Generic.List<string>();
        foreach (var d in type.drops)
        {
            int qty = Random.Range(d.min, d.max + 1);
            if (qty <= 0) continue;
            InventoryManager.Instance?.Add(d.itemId, qty);
            var item = InventoryManager.Instance?.GetItem(d.itemId);
            parts.Add($"{item?.icon ?? ""} {item?.displayName ?? d.itemId} ×{qty}");
        }
        ProgressionManager.Instance?.AddXp(xp);
        RuntimeHud.Toast($"{tier?.label ?? ""} {type.displayName}を倒した！  {string.Join("  ", parts)}  (+{xp}EXP)");
        Kill();
        return true;
    }

    public void HitFlash()
    {
        transform.localScale = Vector3.one * baseScale * 0.9f;
        _hitFlashTimer = 0.09f;
    }

    public void Kill()
    {
        if (!alive) return;
        alive = false;
        EnemyManager.Instance?.Unregister(this);
        Destroy(gameObject);
    }

    // ── テイム ────────────────────────────────────
    public void Tame()
    {
        tamed = true;
        tamedLevel = 1;
        tamedXp = 0;
        aggro = false;
        var stats = EnemyTypes.TamedStatsFor(1);
        hp = maxHp = stats.hp;
        tamedBaseScale = baseScale; // テイム時点の体格を基準として記録
        ApplyTamedAppearance();
        RuntimeHud.Toast($"{type.icon} {type.displayName}{SexLabel()} がテイムされた！仲間になった！(Lv.{tamedLevel} HP:{maxHp:0})");
        SaveSystem.Instance?.Save();
    }

    // テイム動物の外観（金の首輪。狼は毛色を友好的な色に変える）
    public void ApplyTamedAppearance()
    {
        if (_parts == null) return;
        if (type.id == "wolf")
        {
            var tamedColor = new Color(0xa0 / 255f, 0xa8 / 255f, 0xc8 / 255f);
            foreach (var r in _parts.furRenderers)
                if (r != null) r.material.color = tamedColor;
        }
        var collar = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        Destroy(collar.GetComponent<Collider>());
        collar.name = "Collar";
        collar.transform.SetParent(_parts.root.transform, false);
        collar.transform.localPosition = new Vector3(0, type.collar.y, type.collar.z);
        collar.transform.localRotation = Quaternion.Euler(-17f, 0, 0); // 首の前傾に沿わせる
        collar.transform.localScale = new Vector3(type.collarRadius * 2f, 0.035f, type.collarRadius * 2f);
        var shader = Shader.Find("Universal Render Pipeline/Lit");
        if (shader == null) shader = Shader.Find("Standard");
        collar.GetComponent<Renderer>().material = new Material(shader) { color = new Color(0xd4 / 255f, 0xa0 / 255f, 0x20 / 255f) };
    }

    // テイム動物のレベルアップ確認（キャップなし・複数レベル同時対応）
    public void CheckTamedLevelUp()
    {
        bool leveled = false;
        while (tamedXp >= EnemyTypes.TamedXpForLevel(tamedLevel + 1))
        {
            tamedLevel += 1;
            leveled = true;
        }
        if (!leveled) return;

        var stats = EnemyTypes.TamedStatsFor(tamedLevel);
        maxHp = stats.hp;
        hp = Mathf.Min(hp + Mathf.Floor(stats.hp * 0.3f), maxHp);
        baseScale = tamedBaseScale * stats.scale;
        transform.localScale = Vector3.one * baseScale;
        RuntimeHud.Toast($"{type.icon} 仲間の{type.displayName}が Lv.{tamedLevel} に成長した！（HP:{maxHp:0} / ATK:{stats.dmg} / 体格{Mathf.RoundToInt(stats.scale * 100)}%）");
    }

    // 妊娠の見た目（腹をふっくらさせる）
    public void SetPregnantVisual(bool on)
    {
        if (_parts?.belly == null) return;
        _parts.belly.localScale = on ? _bellyBaseScale * 1.3f : _bellyBaseScale;
    }

    public string SexLabel() => sex == "female" ? "♀" : "♂";

    // ── 内部ヘルパー ──────────────────────────────
    public float FlatDist(Vector3 other)
    {
        float ox = other.x - transform.position.x;
        float oz = other.z - transform.position.z;
        return Mathf.Sqrt(ox * ox + oz * oz);
    }

    void FaceDirection(float x, float z)
    {
        if (Mathf.Abs(x) < 0.0001f && Mathf.Abs(z) < 0.0001f) return;
        transform.rotation = Quaternion.Euler(0, Mathf.Atan2(x, z) * Mathf.Rad2Deg, 0);
    }

    void AnimateLegs(float swing)
    {
        if (_parts == null || _parts.legs.Count != 4) return;
        float deg = swing * Mathf.Rad2Deg;
        _parts.legs[0].localRotation = Quaternion.Euler(deg, 0, 0);
        _parts.legs[1].localRotation = Quaternion.Euler(-deg, 0, 0);
        _parts.legs[2].localRotation = Quaternion.Euler(-deg, 0, 0);
        _parts.legs[3].localRotation = Quaternion.Euler(deg, 0, 0);
    }

    void AnimatePaddle(float paddle)
    {
        if (_parts == null || _parts.legs.Count != 4) return;
        float deg = paddle * Mathf.Rad2Deg;
        _parts.legs[0].localRotation = Quaternion.Euler(deg, 0, 0);
        _parts.legs[1].localRotation = Quaternion.Euler(-deg * 0.7f, 0, 0);
        _parts.legs[2].localRotation = Quaternion.Euler(-deg, 0, 0);
        _parts.legs[3].localRotation = Quaternion.Euler(deg * 0.7f, 0, 0);
    }

    void RelaxLegs(float damp)
    {
        if (_parts == null) return;
        foreach (var leg in _parts.legs)
            leg.localRotation = Quaternion.Slerp(leg.localRotation, Quaternion.identity, 1f - damp);
    }

    // 体の上下動と前傾（yOffset は bodyBaseY からの差、tiltRad は前傾ラジアン）
    void EaseBody(float delta, float posLerp, float rotLerp, float yOffset, float tiltRad)
    {
        if (_parts?.body == null) return;
        if (_parts.usesExternalModel)
        {
            yOffset = Mathf.Min(0f, yOffset);
            tiltRad *= 0.35f;
        }
        var lp = _parts.body.localPosition;
        lp.y = Mathf.Lerp(lp.y, _parts.bodyBaseY + yOffset, delta * posLerp);
        _parts.body.localPosition = lp;
        _parts.body.localRotation = Quaternion.Slerp(
            _parts.body.localRotation,
            Quaternion.Euler(tiltRad * Mathf.Rad2Deg, 0, 0),
            delta * rotLerp);
    }

    void UpdateExternalWolfAnimation(float delta, bool moving, bool running)
    {
        if (_parts?.animator == null || !_parts.usesExternalModel) return;

        _wolfAnimRefresh -= delta;
        int target = moving ? (running ? Animator.StringToHash("Running_New") : Animator.StringToHash("Walking_New"))
            : Animator.StringToHash("Idle_New");
        if (_wolfAnimState == target && _wolfAnimRefresh > 0f) return;

        _wolfAnimState = target;
        _wolfAnimRefresh = moving ? 0.45f : 1.0f;
        _parts.animator.CrossFade(target, 0.12f, 0);
    }

    void PlayExternalWolfAttack()
    {
        if (_parts?.animator == null || !_parts.usesExternalModel) return;
        _wolfAnimState = Random.value < 0.5f ? Animator.StringToHash("AttackL") : Animator.StringToHash("AttackR");
        _wolfAnimRefresh = 0.35f;
        _parts.animator.CrossFade(_wolfAnimState, 0.08f, 0);
    }

    // 資源ノード（木・岩）と設置物から押し出して、すり抜けを防ぐ
    void PushOutOfObstacles()
    {
        float er = 0.40f * baseScale;
        var pos = transform.position;
        foreach (var col in Physics.OverlapSphere(pos + Vector3.up * 0.4f, er + 1.2f))
        {
            float or_;
            Vector3 opos = col.transform.position;
            if (col.TryGetComponent(out ResourceNode node))
            {
                if (!node.Alive) continue;
                if (node.type == ResourceType.Grass || node.type == ResourceType.Mushroom) continue;
                float sc = node.sizeScale > 0 ? node.sizeScale : 1f;
                or_ = node.type == ResourceType.Wood ? 0.22f + 0.28f * sc : 0.35f * sc;
            }
            else if (col.GetComponent<RuntimePlacedObject>() != null)
            {
                or_ = Mathf.Max(col.bounds.extents.x, col.bounds.extents.z) * 0.8f;
            }
            else continue;

            float odx = pos.x - opos.x, odz = pos.z - opos.z;
            float od = Mathf.Sqrt(odx * odx + odz * odz);
            if (od < er + or_ && od > 0.001f)
            {
                float f = (er + or_ - od) / od;
                pos.x += odx * f;
                pos.z += odz * f;
            }
        }
        transform.position = pos;
    }

    void SnapToGround(bool floatOnWater)
    {
        var pos = transform.position;
        float terrH = GroundHeight(pos.x, pos.z);
        pos.y = floatOnWater && terrH < WaterSurfaceY ? WaterSurfaceY : terrH;
        transform.position = pos;
    }

    // ── セーブ/ロード ─────────────────────────────
    public EnemySaveData Serialize() => new()
    {
        typeId = type.id,
        tierLevel = tier?.level ?? 1,
        tamedLevel = tamedLevel,
        tamedXp = tamedXp,
        hp = hp,
        maxHp = maxHp,
        x = transform.position.x, y = transform.position.y, z = transform.position.z,
        tamedBaseScale = tamedBaseScale,
        sex = sex,
        pregnant = pregnant,
        pregnancyTimer = pregnancyTimer,
        breedCd = breedCd,
        baby = baby,
        starveTimer = starveTimer,
        growTimer = growTimer,
    };
}

[System.Serializable]
public class EnemySaveData
{
    public string typeId;
    public int tierLevel = 1;
    public int tamedLevel = 1;
    public int tamedXp;
    public float hp, maxHp;
    public float x, y, z;
    public float tamedBaseScale = 1f;
    public string sex;
    public bool pregnant;
    public float pregnancyTimer;
    public float breedCd;
    public bool baby;
    public float starveTimer;
    public float growTimer;
}

[System.Serializable]
public class EnemySaveDataList
{
    public System.Collections.Generic.List<EnemySaveData> items = new();
}
