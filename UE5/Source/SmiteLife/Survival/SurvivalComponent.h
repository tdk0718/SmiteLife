#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "SurvivalComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnStatChanged, float, NewValue);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnDeath);

UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class SMITELIFE_API USurvivalComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    USurvivalComponent();

    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime, ELevelTick TickType,
        FActorComponentTickFunction* ThisTickFunction) override;

    UFUNCTION(BlueprintCallable, Category = "Survival")
    void ConsumeStamina(float Amount);

    UFUNCTION(BlueprintCallable, Category = "Survival")
    void HealHP(float Amount);

    UFUNCTION(BlueprintCallable, Category = "Survival")
    void AddHunger(float Amount);

    UPROPERTY(BlueprintAssignable, Category = "Survival")
    FOnStatChanged OnHPChanged;

    UPROPERTY(BlueprintAssignable, Category = "Survival")
    FOnStatChanged OnHungerChanged;

    UPROPERTY(BlueprintAssignable, Category = "Survival")
    FOnStatChanged OnStaminaChanged;

    UPROPERTY(BlueprintAssignable, Category = "Survival")
    FOnStatChanged OnTemperatureChanged;

    UPROPERTY(BlueprintAssignable, Category = "Survival")
    FOnDeath OnDeath;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float HP = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float MaxHP = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float Hunger = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float MaxHunger = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float Stamina = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float MaxStamina = 100.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float Temperature = 37.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float MinTemperature = 10.f;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Survival")
    float MaxTemperature = 40.f;

private:
    float AccumulatedTime = 0.f;
    bool bIsDead = false;
};
