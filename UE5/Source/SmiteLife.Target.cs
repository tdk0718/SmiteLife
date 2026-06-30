using UnrealBuildTool;
using System.Collections.Generic;

public class SmiteLifeTarget : TargetRules
{
    public SmiteLifeTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V3;
        ExtraModuleNames.Add("SmiteLife");
    }
}
