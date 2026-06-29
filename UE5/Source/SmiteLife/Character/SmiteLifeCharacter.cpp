#include "SmiteLifeCharacter.h"
#include "GameFramework/SpringArmComponent.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "../Survival/SurvivalComponent.h"
#include "../Crafting/InventoryComponent.h"
#include "../Building/BuildingComponent.h"

ASmiteLifeCharacter::ASmiteLifeCharacter()
{
    PrimaryActorTick.bCanEverTick = true;

    // SpringArm
    SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
    SpringArm->SetupAttachment(RootComponent);
    SpringArm->TargetArmLength = 400.f;
    SpringArm->bUsePawnControlRotation = true;

    // Camera
    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(SpringArm, USpringArmComponent::SocketName);
    Camera->bUsePawnControlRotation = false;

    // Survival
    SurvivalComponent = CreateDefaultSubobject<USurvivalComponent>(TEXT("SurvivalComponent"));

    // Inventory
    InventoryComponent = CreateDefaultSubobject<UInventoryComponent>(TEXT("InventoryComponent"));

    // Building
    BuildingComponent = CreateDefaultSubobject<UBuildingComponent>(TEXT("BuildingComponent"));

    // 移動設定
    bUseControllerRotationPitch = false;
    bUseControllerRotationYaw = false;
    bUseControllerRotationRoll = false;
    GetCharacterMovement()->bOrientRotationToMovement = true;
    GetCharacterMovement()->RotationRate = FRotator(0.f, 500.f, 0.f);
}

void ASmiteLifeCharacter::BeginPlay()
{
    Super::BeginPlay();

    if (APlayerController* PC = Cast<APlayerController>(Controller))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
            ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
        {
            if (DefaultMappingContext)
            {
                Subsystem->AddMappingContext(DefaultMappingContext, 0);
            }
        }
    }

    // 死亡時ログ（HUDバインドはBlueprint側で行う）
    SurvivalComponent->OnDeath.AddDynamic(this, &ASmiteLifeCharacter::OnDeath_Implementation);
}

// 死亡ハンドラ（BlueprintImplementableEventとして拡張可能）
void ASmiteLifeCharacter::OnDeath_Implementation()
{
    UE_LOG(LogTemp, Warning, TEXT("SmiteLifeCharacter: Player died."));
}

void ASmiteLifeCharacter::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);

    if (bIsSprinting)
    {
        SurvivalComponent->ConsumeStamina(SprintStaminaCost * DeltaTime);
        if (SurvivalComponent->Stamina <= 0.f)
        {
            bIsSprinting = false;
            GetCharacterMovement()->MaxWalkSpeed = 600.f;
        }
    }
}

void ASmiteLifeCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);

    if (UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent))
    {
        if (IA_Move)      EIC->BindAction(IA_Move,      ETriggerEvent::Triggered, this, &ASmiteLifeCharacter::Move);
        if (IA_Look)      EIC->BindAction(IA_Look,      ETriggerEvent::Triggered, this, &ASmiteLifeCharacter::Look);
        if (IA_Jump)      EIC->BindAction(IA_Jump,      ETriggerEvent::Started,   this, &ACharacter::Jump);
        if (IA_Jump)      EIC->BindAction(IA_Jump,      ETriggerEvent::Completed, this, &ACharacter::StopJumping);
        if (IA_Sprint)    EIC->BindAction(IA_Sprint,    ETriggerEvent::Started,   this, &ASmiteLifeCharacter::StartSprint);
        if (IA_Sprint)    EIC->BindAction(IA_Sprint,    ETriggerEvent::Completed, this, &ASmiteLifeCharacter::StopSprint);
        if (IA_Interact)  EIC->BindAction(IA_Interact,  ETriggerEvent::Started,   this, &ASmiteLifeCharacter::Interact);
        if (IA_Inventory) EIC->BindAction(IA_Inventory, ETriggerEvent::Started,   this, &ASmiteLifeCharacter::ToggleInventory);
        if (IA_BuildMode) EIC->BindAction(IA_BuildMode, ETriggerEvent::Started,   this, &ASmiteLifeCharacter::ToggleBuildMode);
        if (IA_PlacePiece)EIC->BindAction(IA_PlacePiece,ETriggerEvent::Started,   this, &ASmiteLifeCharacter::PlaceBuildingPiece);
    }
}

void ASmiteLifeCharacter::Move(const FInputActionValue& Value)
{
    FVector2D Input = Value.Get<FVector2D>();
    if (Controller && Input != FVector2D::ZeroVector)
    {
        const FRotator Yaw(0.f, Controller->GetControlRotation().Yaw, 0.f);
        AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::X), Input.Y);
        AddMovementInput(FRotationMatrix(Yaw).GetUnitAxis(EAxis::Y), Input.X);
    }
}

void ASmiteLifeCharacter::Look(const FInputActionValue& Value)
{
    FVector2D Input = Value.Get<FVector2D>();
    AddControllerYawInput(Input.X);
    AddControllerPitchInput(Input.Y);
}

void ASmiteLifeCharacter::StartSprint(const FInputActionValue& Value)
{
    if (SurvivalComponent->Stamina > 0.f)
    {
        bIsSprinting = true;
        GetCharacterMovement()->MaxWalkSpeed = 900.f;
    }
}

void ASmiteLifeCharacter::StopSprint(const FInputActionValue& Value)
{
    bIsSprinting = false;
    GetCharacterMovement()->MaxWalkSpeed = 600.f;
}

void ASmiteLifeCharacter::Interact(const FInputActionValue& Value)
{
    FVector Start = Camera->GetComponentLocation();
    FVector End = Start + Camera->GetForwardVector() * InteractDistance;

    FHitResult Hit;
    FCollisionQueryParams Params;
    Params.AddIgnoredActor(this);

    if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
    {
        if (AActor* HitActor = Hit.GetActor())
        {
            UE_LOG(LogTemp, Log, TEXT("Interacted with: %s"), *HitActor->GetName());
            // IInteractable インターフェース実装後に呼び出しを追加
        }
    }
}

void ASmiteLifeCharacter::ToggleInventory(const FInputActionValue& Value)
{
    UE_LOG(LogTemp, Log, TEXT("SmiteLifeCharacter: Inventory toggled."));
    // WBP_HUD 実装後にウィジェット表示切替を追加
}

void ASmiteLifeCharacter::ToggleBuildMode(const FInputActionValue& Value)
{
    BuildingComponent->ToggleBuildingMode();
}

void ASmiteLifeCharacter::PlaceBuildingPiece(const FInputActionValue& Value)
{
    BuildingComponent->PlacePiece();
}
