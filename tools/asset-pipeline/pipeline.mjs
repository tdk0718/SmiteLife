#!/usr/bin/env node
// SmiteLife アセットパイプライン
// コンセプト画像生成 → Meshy image-to-3D → Blender最適化 → public/models/ へ配置
//
// 使い方:
//   node tools/asset-pipeline/pipeline.mjs <asset名> [<asset名>...]
//   node tools/asset-pipeline/pipeline.mjs --all
//   オプション: --force (生成済みの成果物も作り直す)
//
// 必要な環境変数 (tools/asset-pipeline/.env にも書ける):
//   MESHY_API_KEY   … Meshy API キー (image-to-3D に必須)
//   OPENAI_API_KEY  … コンセプト画像の自動生成に使用 (無い場合は work/<name>/concept.png を手動で置く)
//   IMAGE_MODEL     … 画像生成モデル (省略時 gpt-image-1)
//   BLENDER_PATH    … Blender 実行ファイルのパス (省略時は自動検出)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ROOT, '..', '..');
const WORK = path.join(ROOT, 'work');
const MODELS_DIR = path.join(REPO, 'public', 'models');
const MESHY_BASE = 'https://api.meshy.ai';

loadDotEnv(path.join(ROOT, '.env'));

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function log(name, msg) {
  console.log(`[${name}] ${msg}`);
}

function findBlender() {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH;
  const candidates = [
    '/Applications/Blender.app/Contents/MacOS/Blender',
    `${process.env.HOME}/Applications/Blender.app/Contents/MacOS/Blender`,
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const r = spawnSync('which', ['blender'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim();
  throw new Error('Blender が見つかりません。インストールするか BLENDER_PATH を設定してください。');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- ステップ1: コンセプト画像 ----------
async function ensureConceptImage(name, asset, conceptPath, force) {
  if (fs.existsSync(conceptPath) && !force) {
    log(name, `コンセプト画像あり (スキップ): ${path.relative(REPO, conceptPath)}`);
    return;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      `コンセプト画像がありません: ${conceptPath}\n` +
      `  → OPENAI_API_KEY を設定して自動生成するか、ChatGPT/codex 等で生成した画像を上記パスに置いて再実行してください。`
    );
  }
  const style = asset.style ?? '';
  const prompt =
    `${asset.prompt}. ${style}. single object, centered, ` +
    `plain light gray studio background, 3/4 view from slightly above, ` +
    `evenly lit, no ground shadow, no text, game asset reference image`;
  log(name, `コンセプト画像を生成中 (${process.env.IMAGE_MODEL || 'gpt-image-1'})...`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.IMAGE_MODEL || 'gpt-image-1',
      prompt,
      size: '1024x1024',
      quality: 'medium',
    }),
  });
  if (!res.ok) throw new Error(`画像生成API エラー ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error(`画像生成APIの応答に画像がありません: ${JSON.stringify(data).slice(0, 300)}`);
  fs.writeFileSync(conceptPath, Buffer.from(b64, 'base64'));
  log(name, `コンセプト画像を保存: ${path.relative(REPO, conceptPath)}`);
}

// ---------- ステップ2: Meshy image-to-3D ----------
async function meshyFetch(method, endpoint, body) {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error('MESHY_API_KEY が設定されていません (tools/asset-pipeline/.env に記載可)。');
  const res = await fetch(`${MESHY_BASE}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Meshy API エラー ${res.status} (${endpoint}): ${await res.text()}`);
  return res.json();
}

async function imageTo3D(name, asset, conceptPath, rawGlbPath, force) {
  if (fs.existsSync(rawGlbPath) && !force) {
    log(name, `3Dメッシュあり (スキップ): ${path.relative(REPO, rawGlbPath)}`);
    return;
  }
  const b64 = fs.readFileSync(conceptPath).toString('base64');
  log(name, 'Meshy image-to-3D タスクを作成中...');
  const created = await meshyFetch('POST', '/openapi/v1/image-to-3d', {
    image_url: `data:image/png;base64,${b64}`,
    ai_model: 'latest',
    should_texture: true,
    enable_pbr: false,
    should_remesh: true,
    topology: 'triangle',
    target_polycount: asset.targetTris,
    target_formats: ['glb'],
  });
  const taskId = created.result;
  log(name, `タスクID: ${taskId} — 完了を待機中 (通常1〜3分)`);

  const deadline = Date.now() + 20 * 60 * 1000;
  let task;
  for (;;) {
    await sleep(10_000);
    task = await meshyFetch('GET', `/openapi/v1/image-to-3d/${taskId}`);
    if (task.status === 'SUCCEEDED') break;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`Meshy タスクが失敗しました (${task.status}): ${task.task_error?.message ?? ''}`);
    }
    log(name, `  進捗 ${task.progress ?? 0}% (${task.status})`);
    if (Date.now() > deadline) throw new Error('Meshy タスクがタイムアウトしました (20分)。');
  }
  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) throw new Error(`GLB の URL が応答にありません: ${JSON.stringify(task.model_urls)}`);
  log(name, 'GLB をダウンロード中...');
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB ダウンロード失敗 ${res.status}`);
  fs.writeFileSync(rawGlbPath, Buffer.from(await res.arrayBuffer()));
  log(name, `保存: ${path.relative(REPO, rawGlbPath)} (消費クレジット: ${task.consumed_credits ?? '?'})`);
}

// ---------- ステップ3: Blender 最適化 + 検証レンダー ----------
function optimizeWithBlender(name, asset, rawGlbPath, outGlbPath, rendersDir, force) {
  if (fs.existsSync(outGlbPath) && !force) {
    log(name, `最適化済みGLBあり (スキップ): ${path.relative(REPO, outGlbPath)}`);
    return;
  }
  const blender = findBlender();
  fs.mkdirSync(rendersDir, { recursive: true });
  const args = [
    '-b', '--python', path.join(ROOT, 'blender', 'optimize.py'), '--',
    '--input', rawGlbPath,
    '--output', outGlbPath,
    '--target-tris', String(asset.targetTris),
    '--renders', rendersDir,
  ];
  if (asset.size != null) args.push('--size', String(asset.size));
  log(name, 'Blender で最適化中...');
  const r = spawnSync(blender, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`Blender の実行が失敗しました (exit ${r.status})`);
  if (!fs.existsSync(outGlbPath)) throw new Error('Blender は完了しましたが出力GLBがありません。');
  log(name, `最適化完了: ${path.relative(REPO, outGlbPath)}`);
}

// ---------- ステップ4: ゲームへ配置 ----------
function deploy(name, outGlbPath) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const dest = path.join(MODELS_DIR, `${name}.glb`);
  fs.copyFileSync(outGlbPath, dest);
  const kb = (fs.statSync(dest).size / 1024).toFixed(0);
  log(name, `配置完了: public/models/${name}.glb (${kb} KB)`);
}

// ---------- メイン ----------
async function processAsset(name, asset, force) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(dir, { recursive: true });
  const conceptPath = path.join(dir, 'concept.png');
  const rawGlbPath = path.join(dir, 'raw.glb');
  const outGlbPath = path.join(dir, `${name}.glb`);
  const rendersDir = path.join(dir, 'renders');

  if (fs.existsSync(rawGlbPath) && !force) {
    log(name, `3Dメッシュあり — 画像生成/Meshy をスキップ`);
  } else {
    await ensureConceptImage(name, asset, conceptPath, force);
    await imageTo3D(name, asset, conceptPath, rawGlbPath, force);
  }
  optimizeWithBlender(name, asset, rawGlbPath, outGlbPath, rendersDir, force);
  deploy(name, outGlbPath);
  log(name, `検証レンダー: ${path.relative(REPO, rendersDir)}/view_*.png`);
}

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const all = argv.includes('--all');
  const names = argv.filter((a) => !a.startsWith('--'));

  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets.json'), 'utf8'));
  const defaults = config.defaults ?? {};
  const targets = all ? Object.keys(config.assets) : names;
  if (targets.length === 0) {
    console.log('使い方: node tools/asset-pipeline/pipeline.mjs <asset名>... | --all [--force]');
    console.log(`定義済みアセット: ${Object.keys(config.assets).join(', ')}`);
    process.exit(1);
  }

  const failed = [];
  for (const name of targets) {
    const asset = config.assets[name];
    if (!asset) {
      console.error(`[${name}] assets.json に定義がありません — スキップ`);
      failed.push(name);
      continue;
    }
    try {
      await processAsset(name, { ...defaults, ...asset }, force);
    } catch (e) {
      console.error(`[${name}] 失敗: ${e.message}`);
      failed.push(name);
    }
  }
  if (failed.length > 0) {
    console.error(`\n失敗したアセット: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\nすべて完了しました。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
