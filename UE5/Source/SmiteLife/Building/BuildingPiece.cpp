#include "BuildingPiece.h"
#include "Components/StaticMeshComponent.h"

ABuildingPiece::ABuildingPiece()
{
    PrimaryActorTick.bCanEverTick = false;

    Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
    RootComponent = Mesh;
    Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
}

void ABuildingPiece::SetPreviewMode(bool bPreview)
{
    bIsPreview = bPreview;

    if (bPreview)
    {
        // 元マテリアルを保存
        OriginalMaterials.Empty();
        for (int32 i = 0; i < Mesh->GetNumMaterials(); i++)
        {
            OriginalMaterials.Add(Mesh->GetMaterial(i));
        }

        Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
    }
    else
    {
        // 元マテリアルに戻す
        for (int32 i = 0; i < OriginalMaterials.Num(); i++)
        {
            Mesh->SetMaterial(i, OriginalMaterials[i]);
        }

        Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
    }
}

void ABuildingPiece::FinalizePlace()
{
    bIsPreview = false;
    Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);

    // 元マテリアルに戻す
    for (int32 i = 0; i < OriginalMaterials.Num(); i++)
    {
        Mesh->SetMaterial(i, OriginalMaterials[i]);
    }
    OriginalMaterials.Empty();
}
