#!/usr/bin/env node
/**
 * 姿勢推定の実行ファイルを、公開フォルダへ置く。
 *
 * **CDN から読まない。** 人の体を映しているカメラの映像を扱う機能が、
 * よそのサーバーの都合で動いたり動かなかったりするのは困る。
 * 自分のところから配る。
 *
 * wasm は合計30MB以上あるのでリポジトリには入れない。
 * node_modules から毎回コピーする（ネットワークは要らない）。
 * dev と build の前に自動で走る。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FROM = 'node_modules/@mediapipe/tasks-vision/wasm';
const TO = 'public/pose/wasm';

if (!existsSync(FROM)) {
  console.error(`${FROM} がありません。npm install を先に走らせてください。`);
  process.exit(1);
}

mkdirSync(TO, { recursive: true });
cpSync(FROM, TO, { recursive: true });

const bytes = readdirSync(TO).reduce((sum, name) => sum + statSync(join(TO, name)).size, 0);
console.log(`姿勢推定の実行ファイルを置きました: ${TO}（${Math.round(bytes / 1024 / 1024)}MB）`);
