#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "InputActionValue.h"
#include "SmiteLifeCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UInputMappingContext;
class UInputAction;
class USurvivalComponent;
class UInventoryComponent;
class UBuildingComponent;

UCLASS()
class SMITELIFE_API ASmiteLifeCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    ASmiteLifeCharacter();

    virtual void BeginPlay() override;
    virtual void Tick(float DeltaTime) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    // カメラ
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
    USpringArmComponent* SpringArm;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Camera")
    UCameraComponent* Camera;

    // コンポーネント
    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    USurvivalComponent* SurvivalComponent;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    UInventoryComponent* InventoryComponent;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    UBuildingComponent* BuildingComponent;

    // Enhanced Input
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputMappingContext* DefaultMappingContext;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_Move;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_Look;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_Jump;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_Sprint;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_Interact;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_Inventory;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_BuildMode;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Input")
    UInputAction* IA_PlacePiece;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Movement")
    float SprintStaminaCost = 10.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interact")
    float InteractDistance = 300.0f;

private:
    bool bIsSprinting = false;

    void Move(const FInputActionValue& Value);
    void Look(const FInputActionValue& Value);
    void StartSprint(const FInputActionValue& Value);
    void StopSprint(const FInputActionValue& Value);
    void Interact(const FInputActionValue& Value);
    void ToggleInventory(const FInputActionValue& Value);
    void ToggleBuildMode(const FInputActionValue& Value);
    void PlaceBuildingPiece(const FInputActionValue& Value);

    UFUNCTION()
    void OnDeath_Implementation();
};
