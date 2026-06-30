#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BuildingPiece.h"
#include "BuildingComponent.generated.h"

class UInventoryComponent;

UCLASS(ClassGroup=(Custom), meta=(BlueprintSpawnableComponent))
class SMITELIFE_API UBuildingComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UBuildingComponent();

    virtual void TickComponent(float DeltaTime, ELevelTick TickType,
        FActorComponentTickFunction* ThisTickFunction) override;

    UFUNCTION(BlueprintCallable, Category = "Building")
    void ToggleBuildingMode();

    UFUNCTION(BlueprintCallable, Category = "Building")
    void SetCurrentPiece(TSubclassOf<ABuildingPiece> PieceClass);

    UFUNCTION(BlueprintCallable, Category = "Building")
    void PlacePiece();

    UFUNCTION(BlueprintCallable, Category = "Building")
    void DemolishPiece(ABuildingPiece* Piece);

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Building")
    bool bBuildingMode = false;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    TSubclassOf<ABuildingPiece> CurrentPieceClass;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    TMap<FName, int32> PlacementCost;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    float TraceDistance = 500.f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    float SnapRadius = 100.f;

private:
    UPROPERTY()
    ABuildingPiece* PreviewPiece = nullptr;

    bool bCanPlace = false;

    void UpdatePreview();
    void DestroyPreview();
    bool FindSnapLocation(const FVector& HitLocation, FVector& OutLocation, FRotator& OutRotation);
};
