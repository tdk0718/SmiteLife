#include "SurvivalComponent.h"

USurvivalComponent::USurvivalComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
}

void USurvivalComponent::BeginPlay()
{
    Super::BeginPlay();
}

void USurvivalComponent::TickComponent(float DeltaTime, ELevelTick TickType,
    FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    if (bIsDead) return;

    AccumulatedTime += DeltaTime;
    if (AccumulatedTime < 1.0f) return;
    AccumulatedTime -= 1.0f;

    // 空腹減少
    Hunger = FMath::Max(0.f, Hunger - 1.0f);
    OnHungerChanged.Broadcast(Hunger);

    // 空腹でHP減少
    if (Hunger <= 0.f)
    {
        HP = FMath::Max(0.f, HP - 5.0f);
        OnHPChanged.Broadcast(HP);
    }

    // スタミナ回復（空腹時は低下）
    float StaminaRegen = (Hunger > 0.f) ? 10.0f : 3.0f;
    Stamina = FMath::Min(MaxStamina, Stamina + StaminaRegen);
    OnStaminaChanged.Broadcast(Stamina);

    // 体温が極端だとHPダメージ
    if (Temperature < MinTemperature || Temperature > MaxTemperature)
    {
        HP = FMath::Max(0.f, HP - 2.0f);
        OnHPChanged.Broadcast(HP);
    }

    // 死亡判定
    if (HP <= 0.f && !bIsDead)
    {
        bIsDead = true;
        OnDeath.Broadcast();
    }
}

void USurvivalComponent::ConsumeStamina(float Amount)
{
    Stamina = FMath::Max(0.f, Stamina - Amount);
    OnStaminaChanged.Broadcast(Stamina);
}

void USurvivalComponent::HealHP(float Amount)
{
    HP = FMath::Min(MaxHP, HP + Amount);
    OnHPChanged.Broadcast(HP);
}

void USurvivalComponent::AddHunger(float Amount)
{
    Hunger = FMath::Min(MaxHunger, Hunger + Amount);
    OnHungerChanged.Broadcast(Hunger);
}
