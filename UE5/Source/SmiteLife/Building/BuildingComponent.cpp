#include "BuildingComponent.h"
#include "../Crafting/InventoryComponent.h"
#include "GameFramework/Actor.h"
#include "Engine/World.h"
#include "DrawDebugHelpers.h"
#include "Kismet/GameplayStatics.h"

UBuildingComponent::UBuildingComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
}

void UBuildingComponent::TickComponent(float DeltaTime, ELevelTick TickType,
    FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    if (bBuildingMode && CurrentPieceClass)
    {
        UpdatePreview();
    }
}

void UBuildingComponent::ToggleBuildingMode()
{
    bBuildingMode = !bBuildingMode;

    if (!bBuildingMode)
    {
        DestroyPreview();
    }
}

void UBuildingComponent::SetCurrentPiece(TSubclassOf<ABuildingPiece> PieceClass)
{
    CurrentPieceClass = PieceClass;
    DestroyPreview();
}

void UBuildingComponent::UpdatePreview()
{
    AActor* Owner = GetOwner();
    if (!Owner) return;

    APlayerController* PC = Owner->GetWorld()->GetFirstPlayerController();
    if (!PC) return;

    FVector CamLoc;
    FRotator CamRot;
    PC->GetPlayerViewPoint(CamLoc, CamRot);

    FVector TraceEnd = CamLoc + CamRot.Vector() * TraceDistance;

    FHitResult Hit;
    FCollisionQueryParams Params;
    Params.AddIgnoredActor(Owner);
    if (PreviewPiece) Params.AddIgnoredActor(PreviewPiece);

    bool bHit = GetWorld()->LineTraceSingleByChannel(Hit, CamLoc, TraceEnd, ECC_WorldStatic, Params);

    if (!bHit)
    {
        if (PreviewPiece) PreviewPiece->SetActorHiddenInGame(true);
        bCanPlace = false;
        return;
    }

    FVector PlaceLocation;
    FRotator PlaceRotation;
    FindSnapLocation(Hit.Location, PlaceLocation, PlaceRotation);

    // プレビュー生成または更新
    if (!PreviewPiece)
    {
        FActorSpawnParameters SpawnParams;
        SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
        PreviewPiece = GetWorld()->SpawnActor<ABuildingPiece>(CurrentPieceClass, PlaceLocation, PlaceRotation, SpawnParams);
        if (PreviewPiece) PreviewPiece->SetPreviewMode(true);
    }
    else
    {
        PreviewPiece->SetActorHiddenInGame(false);
        PreviewPiece->SetActorLocationAndRotation(PlaceLocation, PlaceRotation);
    }

    bCanPlace = true;
}

bool UBuildingComponent::FindSnapLocation(const FVector& HitLocation, FVector& OutLocation, FRotator& OutRotation)
{
    OutLocation = HitLocation;
    OutRotation = FRotator::ZeroRotator;

    // 近接の BuildingPiece を検索してスナップ
    TArray<AActor*> FoundPieces;
    UGameplayStatics::GetAllActorsOfClass(GetWorld(), ABuildingPiece::StaticClass(), FoundPieces);

    float BestDist = SnapRadius;
    FVector BestSnap = HitLocation;

    for (AActor* Actor : FoundPieces)
    {
        ABuildingPiece* Piece = Cast<ABuildingPiece>(Actor);
        if (!Piece || Piece == PreviewPiece || Piece->bIsPreview) continue;

        for (const FVector& LocalSnap : Piece->SnapPoints)
        {
            FVector WorldSnap = Piece->GetTransform().TransformPosition(LocalSnap);
            float Dist = FVector::Dist(HitLocation, WorldSnap);
            if (Dist < BestDist)
            {
                BestDist = Dist;
                BestSnap = WorldSnap;
                OutRotation = Piece->GetActorRotation();
            }
        }
    }

    OutLocation = BestSnap;
    return BestDist < SnapRadius;
}

void UBuildingComponent::PlacePiece()
{
    if (!bBuildingMode || !bCanPlace || !PreviewPiece) return;

    // インベントリから素材消費
    UInventoryComponent* Inventory = GetOwner()->FindComponentByClass<UInventoryComponent>();
    if (Inventory)
    {
        for (const auto& Cost : PlacementCost)
        {
            if (!Inventory->HasItem(Cost.Key, Cost.Value))
            {
                UE_LOG(LogTemp, Warning, TEXT("BuildingComponent: Not enough materials to place."));
                return;
            }
        }
        for (const auto& Cost : PlacementCost)
        {
            Inventory->RemoveItem(Cost.Key, Cost.Value);
        }
    }

    PreviewPiece->FinalizePlace();
    PreviewPiece = nullptr;
    bCanPlace = false;
}

void UBuildingComponent::DemolishPiece(ABuildingPiece* Piece)
{
    if (Piece)
    {
        Piece->Destroy();
    }
}

void UBuildingComponent::DestroyPreview()
{
    if (PreviewPiece)
    {
        PreviewPiece->Destroy();
        PreviewPiece = nullptr;
    }
    bCanPlace = false;
}
