#include "InventoryComponent.h"

UInventoryComponent::UInventoryComponent()
{
    PrimaryComponentTick.bCanEverTick = false;
    Slots.SetNum(MaxSlots);
}

bool UInventoryComponent::AddItem(FName ItemID, int32 Amount)
{
    if (ItemID == NAME_None || Amount <= 0) return false;

    int32 Remaining = Amount;
    int32 MaxStack = GetMaxStack(ItemID);

    // 既存スロットに積む
    for (FInventorySlot& Slot : Slots)
    {
        if (Slot.ItemID == ItemID && Slot.Amount < MaxStack)
        {
            int32 Space = MaxStack - Slot.Amount;
            int32 Add = FMath::Min(Space, Remaining);
            Slot.Amount += Add;
            Remaining -= Add;
            if (Remaining <= 0) break;
        }
    }

    // 空きスロットに追加
    for (FInventorySlot& Slot : Slots)
    {
        if (Remaining <= 0) break;
        if (Slot.ItemID == NAME_None)
        {
            Slot.ItemID = ItemID;
            Slot.Amount = FMath::Min(MaxStack, Remaining);
            Remaining -= Slot.Amount;
        }
    }

    if (Remaining < Amount)
    {
        OnInventoryChanged.Broadcast();
        return true;
    }
    return false;
}

bool UInventoryComponent::RemoveItem(FName ItemID, int32 Amount)
{
    if (!HasItem(ItemID, Amount)) return false;

    int32 Remaining = Amount;
    for (FInventorySlot& Slot : Slots)
    {
        if (Remaining <= 0) break;
        if (Slot.ItemID == ItemID)
        {
            int32 Remove = FMath::Min(Slot.Amount, Remaining);
            Slot.Amount -= Remove;
            Remaining -= Remove;
            if (Slot.Amount <= 0)
            {
                Slot.ItemID = NAME_None;
                Slot.Amount = 0;
            }
        }
    }

    OnInventoryChanged.Broadcast();
    return true;
}

bool UInventoryComponent::HasItem(FName ItemID, int32 Amount) const
{
    return GetItemCount(ItemID) >= Amount;
}

int32 UInventoryComponent::GetItemCount(FName ItemID) const
{
    int32 Total = 0;
    for (const FInventorySlot& Slot : Slots)
    {
        if (Slot.ItemID == ItemID) Total += Slot.Amount;
    }
    return Total;
}

bool UInventoryComponent::CanCraft(const FCraftingRecipe& Recipe) const
{
    for (const auto& Pair : Recipe.RequiredMaterials)
    {
        if (!HasItem(Pair.Key, Pair.Value)) return false;
    }
    return true;
}

bool UInventoryComponent::DoCraft(const FCraftingRecipe& Recipe)
{
    if (!CanCraft(Recipe)) return false;

    for (const auto& Pair : Recipe.RequiredMaterials)
    {
        RemoveItem(Pair.Key, Pair.Value);
    }
    AddItem(Recipe.OutputItemID, Recipe.OutputAmount);
    return true;
}

int32 UInventoryComponent::GetMaxStack(FName ItemID) const
{
    if (!ItemDataTable) return 99;

    const FItemData* Row = ItemDataTable->FindRow<FItemData>(ItemID, TEXT("GetMaxStack"));
    return Row ? Row->MaxStack : 99;
}
