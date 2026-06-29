#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "ItemData.generated.h"

UENUM(BlueprintType)
enum class EItemCategory : uint8
{
    Ore        UMETA(DisplayName = "Ore"),
    Ingot      UMETA(DisplayName = "Ingot"),
    Weapon     UMETA(DisplayName = "Weapon"),
    Tool       UMETA(DisplayName = "Tool"),
    Food       UMETA(DisplayName = "Food"),
    Material   UMETA(DisplayName = "Material"),
    Building   UMETA(DisplayName = "Building"),
};

USTRUCT(BlueprintType)
struct SMITELIFE_API FItemData : public FTableRowBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    FName ItemID;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    FText ItemName;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    EItemCategory Category = EItemCategory::Material;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    float Weight = 1.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    int32 MaxStack = 99;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    bool bIsFood = false;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item", meta = (EditCondition = "bIsFood"))
    float FoodValue = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item")
    bool bIsEquipment = false;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item", meta = (EditCondition = "bIsEquipment"))
    float AttackPower = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item", meta = (EditCondition = "bIsEquipment"))
    float DefenseValue = 0.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Item", meta = (EditCondition = "bIsEquipment"))
    float Durability = 100.f;
};

USTRUCT(BlueprintType)
struct SMITELIFE_API FCraftingRecipe : public FTableRowBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Recipe")
    FName RecipeID;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Recipe")
    FName OutputItemID;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Recipe")
    int32 OutputAmount = 1;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Recipe")
    TMap<FName, int32> RequiredMaterials;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Recipe")
    bool bRequiresAnvil = false;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Recipe")
    float CraftingTime = 1.0f;
};
