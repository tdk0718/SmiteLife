#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "ItemData.h"
#include "InventoryComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnInventoryChanged);

USTRUCT(BlueprintType)
struct FInventorySlot
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    FName ItemID = NAME_None;

    UPROPERTY(EditAnywhere, BlueprintReadWrite)
    int32 Amount = 0;
};

UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class SMITELIFE_API UInventoryComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UInventoryComponent();

    UPROPERTY(BlueprintAssignable, Category = "Inventory")
    FOnInventoryChanged OnInventoryChanged;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Inventory")
    UDataTable* ItemDataTable;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Inventory")
    TArray<FInventorySlot> Slots;

    UFUNCTION(BlueprintCallable, Category = "Inventory")
    bool AddItem(FName ItemID, int32 Amount);

    UFUNCTION(BlueprintCallable, Category = "Inventory")
    bool RemoveItem(FName ItemID, int32 Amount);

    UFUNCTION(BlueprintCallable, Category = "Inventory")
    bool HasItem(FName ItemID, int32 Amount) const;

    UFUNCTION(BlueprintCallable, Category = "Inventory")
    int32 GetItemCount(FName ItemID) const;

    UFUNCTION(BlueprintCallable, Category = "Inventory")
    bool CanCraft(const FCraftingRecipe& Recipe) const;

    UFUNCTION(BlueprintCallable, Category = "Inventory")
    bool DoCraft(const FCraftingRecipe& Recipe);

private:
    static constexpr int32 MaxSlots = 40;

    int32 GetMaxStack(FName ItemID) const;
};
