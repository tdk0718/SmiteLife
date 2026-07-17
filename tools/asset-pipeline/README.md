# アセットパイプライン

小物・背景オブジェクト(武器、木、岩、建物など)を
**プロンプト → コンセプト画像 → 3Dメッシュ → ゲーム用GLB** まで自動生成するパイプライン。

```
assets.json のプロンプト
  → ① コンセプト画像生成 (OpenAI gpt-image / または手動画像)
  → ② Meshy image-to-3D (GLB + テクスチャ)
  → ③ Blender ヘッドレス最適化 (ポリ削減・原点/スケール正規化)
  → ④ 検証レンダー4枚出力
  → ⑤ public/models/<name>.glb に配置
```

## セットアップ (初回のみ)

1. Blender をインストール: `brew install --cask blender` (済)
2. `.env.example` を `.env` にコピーし、APIキーを記入
   - `MESHY_API_KEY` … 必須。https://www.meshy.ai/settings/api で取得(無料枠あり)
   - `OPENAI_API_KEY` … 任意。無い場合は画像を手動で用意する(下記)

## 使い方

```sh
# assets.json にアセットを定義してから:
node tools/asset-pipeline/pipeline.mjs sword_01        # 1体だけ
node tools/asset-pipeline/pipeline.mjs tree_01 rock_01 # 複数
node tools/asset-pipeline/pipeline.mjs --all           # 全部
node tools/asset-pipeline/pipeline.mjs sword_01 --force # 作り直し
```

各ステップの成果物は `work/<name>/` に残り、**存在するステップは自動でスキップ**されます
(失敗しても途中から再開できる)。

- `work/<name>/concept.png` … コンセプト画像
- `work/<name>/raw.glb` … Meshy が生成した生メッシュ
- `work/<name>/<name>.glb` … 最適化済み最終GLB
- `work/<name>/renders/view_*.png` … 検証用4方向レンダー(ここを目視チェック)

## アセット定義 (assets.json)

```jsonc
{
  "defaults": { "targetTris": 4000, "style": "…共通スタイル…" },
  "assets": {
    "sword_01": {
      "prompt": "a fantasy iron short sword ...", // 見た目の英語プロンプト
      "targetTris": 2000,  // 三角形数の上限目安
      "size": 1.2          // ゲーム内の最大辺の長さ (m)。原点は底面中心
    }
  }
}
```

## OPENAI_API_KEY が無い場合 (ChatGPT/codex で画像を作る運用)

サブスク枠の ChatGPT や codex で画像を生成し、
`work/<name>/concept.png` に保存してから pipeline を実行すれば、①だけ手動・②以降は自動で動く。
プロンプトのコツ: 「single object, centered, plain light gray background, 3/4 view, no text」を付ける。

## ゲームでの読み込み (three.js)

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('models/tree_01.glb', (gltf) => {
  const model = gltf.scene;
  model.position.set(x, groundY, z); // 原点は底面中心なので地面の高さに置くだけ
  scene.add(model);
});
```

## 制約・運用メモ

- 生成品質は確率的。気に入らなければ `--force` で作り直すか、プロンプトを調整する
  (「10回作って良い3体を採用」くらいの感覚で)。
- Meshy はタスクごとにクレジットを消費する(ログに消費量が出る)。
- キャラクター(リギングが必要なもの)はこのパイプラインの対象外。
- Blender だけ再実行したい場合: `work/<name>/<name>.glb` を消して再実行。
