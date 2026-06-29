#include "SmiteLifeGameMode.h"
#include "Character/SmiteLifeCharacter.h"
#include "GameFramework/Controller.h"
#include "TimerManager.h"

ASmiteLifeGameMode::ASmiteLifeGameMode()
{
    DefaultPawnClass = ASmiteLifeCharacter::StaticClass();
}

void ASmiteLifeGameMode::RespawnPlayer(AController* Controller)
{
    if (!Controller) return;

    FTimerHandle TimerHandle;
    FTimerDelegate TimerDelegate;
    TimerDelegate.BindLambda([this, Controller]()
    {
        if (Controller)
        {
            RestartPlayer(Controller);
        }
    });

    GetWorldTimerManager().SetTimer(TimerHandle, TimerDelegate, RespawnDelay, false);
}
