#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "BuildingPiece.generated.h"

UENUM(BlueprintType)
enum class EBuildingPieceType : uint8
{
    Foundation UMETA(DisplayName = "Foundation"),
    Wall       UMETA(DisplayName = "Wall"),
    Roof       UMETA(DisplayName = "Roof"),
    Stair      UMETA(DisplayName = "Stair"),
    Doorway    UMETA(DisplayName = "Doorway"),
};

UCLASS()
class SMITELIFE_API ABuildingPiece : public AActor
{
    GENERATED_BODY()

public:
    ABuildingPiece();

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Building")
    UStaticMeshComponent* Mesh;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    TArray<FVector> SnapPoints;

    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Building")
    EBuildingPieceType PieceType = EBuildingPieceType::Foundation;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Building")
    bool bIsPreview = false;

    UFUNCTION(BlueprintCallable, Category = "Building")
    void SetPreviewMode(bool bPreview);

    UFUNCTION(BlueprintCallable, Category = "Building")
    void FinalizePlace();

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    UMaterialInterface* PreviewMaterialValid;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Building")
    UMaterialInterface* PreviewMaterialInvalid;

private:
    TArray<UMaterialInterface*> OriginalMaterials;
};
