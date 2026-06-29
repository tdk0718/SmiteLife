using UnrealBuildTool;
using System.Collections.Generic;

public class SmiteLifeEditorTarget : TargetRules
{
    public SmiteLifeEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V3;
        ExtraModuleNames.Add("SmiteLife");
    }
}
