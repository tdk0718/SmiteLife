# SmiteLife Unity セットアップ手順

## 1. Unity のインストール

1. https://unity.com/ja/download から **Unity Hub** をダウンロード
2. Unity Hub を起動 → 「Installs」→「Install Editor」
3. **Unity 6 (LTS)** を選択し、以下のモジュールを追加:
   - WebGL Build Support
   - (Mac の場合) Mac Build Support

## 2. プロジェクト作成

1. Unity Hub → 「Projects」→「New project」
2. テンプレート: **3D (URP)**
3. プロジェクト名: `SmiteLife`
4. 場所: 任意のフォルダ

## 3. スクリプトのコピー

`SmiteLife-Unity/Assets/Scripts/` の全フォルダを Unity の  
`Assets/Scripts/` にコピーする。

## 4. FBX アセットのインポート

`public/chara/` の FBX ファイルを `Assets/Characters/` にドラッグ&ドロップ:

| ファイル | 用途 |
|---------|------|
| model.fbx | キャラクターモデル |
| anim_idle.fbx | 待機アニメーション |
| anim_walk.fbx | 歩行アニメーション |
| anim_run.fbx | 走行アニメーション |
| anim_attack.fbx | 攻撃アニメーション |
| anim_punch.fbx | パンチアニメーション |
| anim_swim.fbx | 水泳アニメーション |
| anim_jump.fbx | ジャンプアニメーション |

## 5. Animator Controller の設定

1. `Assets/Characters/` で右クリック → Create → Animator Controller
2. Controller をダブルクリックして Animator ウィンドウを開く
3. 以下のパラメータを追加:
   - `Speed` (Float)
   - `InWater` (Bool)
   - `IsGrounded` (Bool)
   - `Attack` (Trigger)
   - `Punch` (Trigger)
   - `Melee` (Trigger)
4. 各 FBX の AnimationClip をステートとして追加し、パラメータで遷移を設定

## 5.5. SmiteLife_product の狼モデル差し替え

`SmiteLife_product` では `Assets/Resources/WolfModel.prefab` が存在する場合、狼の見た目にその Prefab を自動使用します。

1. Unity Asset Store から `Realistic Furry Wolf (FREE sample REALISTIC FOREST ANIMALS)` をプロジェクトへインポート
2. インポートされた狼の Prefab を `Assets/Resources/` にコピー
3. Prefab 名を `WolfModel.prefab` に変更
4. 見た目の大きさ・向きが合わない場合は `WolfModel.prefab` 側の Transform で調整

`WolfModel.prefab` が無い場合は、従来のプリミティブ狼モデルにフォールバックします。

## 6. シーンのセットアップ

### Terrain（地形）
1. `GameObject` → `3D Object` → `Terrain`
2. Terrain Inspector で地形を Paint（高さブラシで海岸線を作成）
3. `Water Level = 0` に合わせて低地を作成

### 水面
1. URP の `Water System` または Simple Water Shader アセットを使用
2. Y=0 に配置

### NavMesh（敵AI用）
1. `Window` → `AI` → `Navigation`
2. シーン内の地形を「Static」にマーク
3. 水域の Terrain Area を「Not Walkable」に設定
4. 「Bake」をクリック

## 7. プレイヤー Prefab の組み立て

```
PlayerRoot (空の GameObject)
├── CharacterController コンポーネント
├── PlayerController.cs
├── GatherSystem.cs
└── model.fbx のメッシュ
    └── PlayerAnimatorController.cs
        └── Animator コンポーネント（Controller を割り当て）
```

## 8. Manager オブジェクトの配置

シーンに空の `Managers` オブジェクトを作成し、以下をアタッチ:
- `StatsManager.cs`
- `ProgressionManager.cs`
- `InventoryManager.cs`
- `SaveSystem.cs`

## 9. カメラのセットアップ

1. `Main Camera` に `ThirdPersonCamera.cs` をアタッチ
2. `Target` フィールドに PlayerRoot をドラッグ

## 10. WebGL ビルド

1. `File` → `Build Settings`
2. Platform: **WebGL** に切り替え → `Switch Platform`
3. `Player Settings` → WebGL:
   - Compression Format: Brotli
   - Template: Default
4. `Build` → 出力フォルダを選択
5. ローカルサーバー（`python3 -m http.server`）で確認

## 今後の実装（次フェーズ）

- [ ] インベントリ UI (Canvas / UI Toolkit)
- [ ] クラフトシステム
- [ ] 建築システム
- [ ] 天候システム
- [ ] 炎魔法・弓
- [ ] 魚・釣りシステム
