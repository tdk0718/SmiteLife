#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "SmiteLifeGameMode.generated.h"

UCLASS()
class SMITELIFE_API ASmiteLifeGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    ASmiteLifeGameMode();

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Respawn")
    float RespawnDelay = 5.0f;

    UFUNCTION(BlueprintCallable, Category = "Respawn")
    void RespawnPlayer(AController* Controller);
};
