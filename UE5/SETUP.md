# SmiteLife UE5 セットアップ手順

## 1. Visual Studio プロジェクト生成

1. エクスプローラーで `SmiteLife.uproject` を右クリック
2. **Generate Visual Studio project files** を選択
3. `SmiteLife.sln` が生成される

## 2. ビルド

1. `SmiteLife.sln` を Visual Studio 2022 で開く
2. 構成を **Development Editor** / プラットフォームを **Win64** に設定
3. **SmiteLifeEditor** をビルド（初回は10〜20分かかる場合あり）

## 3. Blueprint 作業（UE5 エディタ）

### BP_SmiteLifeCharacter
- `ASmiteLifeCharacter` を親クラスに設定
- SkeletalMesh を割り当て
- **DefaultMappingContext** に IMC_Default を設定
- 各 InputAction（IA_Move / IA_Look / IA_Jump / IA_Sprint / IA_Interact / IA_Inventory / IA_BuildMode / IA_PlacePiece）を割り当て

### DT_Items（DataTable）
- 行構造体: `FItemData`
- 登録例：

| RowName    | ItemID      | ItemName   | Category | Weight | MaxStack |
|------------|-------------|------------|----------|--------|----------|
| IronOre    | IronOre     | 鉄鉱石     | Ore      | 2.0    | 50       |
| IronIngot  | IronIngot   | 鉄インゴット | Ingot  | 1.5    | 30       |
| Hammer     | Hammer      | ハンマー    | Tool    | 3.0    | 1        |
| Bread      | Bread       | パン        | Food    | 0.5    | 10       |

### DT_Recipes（DataTable）
- 行構造体: `FCraftingRecipe`
- 登録例：

| RowName       | OutputItemID | RequiredMaterials         | bRequiresAnvil |
|---------------|--------------|---------------------------|----------------|
| Recipe_Ingot  | IronIngot    | IronOre×2                 | false          |
| Recipe_Hammer | Hammer       | IronIngot×3, Wood×2       | true           |

### BP_BuildingPiece_Foundation / _Wall / _Roof
- `ABuildingPiece` を親クラスに設定
- StaticMesh を割り当て
- SnapPoints をローカル座標で設定（例: Foundation の四隅: (±200, ±200, 0)）

### WBP_HUD
- HP / 空腹 / スタミナ / 体温の ProgressBar を配置
- `SurvivalComponent` の各デリゲートにバインド：
  - `OnHPChanged` → HP ProgressBar の Percent
  - `OnHungerChanged` → Hunger ProgressBar の Percent
  - `OnStaminaChanged` → Stamina ProgressBar の Percent
  - `OnTemperatureChanged` → Temperature ProgressBar の Percent

### GameMode 設定
1. プロジェクト設定 → Maps & Modes
2. **Default GameMode** に `BP_SmiteLifeGameMode` を設定

---

## 操作キー一覧

| キー             | 操作                   |
|------------------|----------------------|
| W / A / S / D    | 移動                   |
| マウス移動         | カメラ回転               |
| Space            | ジャンプ                |
| Shift（長押し）    | ダッシュ（スタミナ消費）   |
| E                | インタラクト             |
| I                | インベントリ開閉          |
| B                | 建築モード切替            |
| 左クリック         | 建築ピース設置（建築モード時）|
| 右クリック         | 建築ピース解体（建築モード時）|

---

## 次のステップ（優先順位）

### ① 建築システム（最優先）
- StaticMesh・SnapPoints を各 BP_BuildingPiece に設定
- 実際のメッシュで配置・スナップの動作確認
- 建築ピースのマテリアル（半透明プレビュー用）作成

### ② 恐竜テイム・騎乗
- `ADinoCharacter` : `ACharacter` を実装
- テイムシステム: 餌やり → 信頼度上昇 → テイム完了
- 騎乗: `ASmiteLifeCharacter::MountDino()` → Possess or AttachToActor

### ③ サバイバル・クラフト拡充
- WBP_HUD の実装
- クラフト UI（WBP_CraftingMenu）
- アイテム・レシピの DataTable 拡充
