using UnrealBuildTool;

public class SmiteLife : ModuleRules
{
    public SmiteLife(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "EnhancedInput",
            "UMG",
            "GameplayAbilities",
            "GameplayTags",
            "AIModule",
            "NavigationSystem",
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore",
        });
    }
}
