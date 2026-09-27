#!/usr/bin/env node
/**
 * コーチの顔写真を、アプリが使う形に整える。
 *
 * 顔写真は 176x176 の webp。**大きい画像をそのまま置かない。**
 * 8人ぶんが毎回読まれるので、1枚あたり数KBに収める。
 *
 *   node scripts/coach-photos.mjs <元画像のフォルダ>
 *
 * フォルダの中は、コーチの id をファイル名にしておく:
 *   logic.png / blaze.png / veteran.png / sage.png
 *   ace.png / warm.png / spark.png / allure.png
 *
 * 拡張子は png / jpg / jpeg / webp のどれでもよい。
 * 入っているものだけ書き出すので、1枚だけ差し替える使い方もできる。
 */

import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';

/** 画面に出る最大の大きさ（96px）の2倍。細い端末でもぼけない。 */
const SIZE = 176;
const OUT = 'public/coaches';
const SOURCES = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const from = process.argv[2];
if (!from || !existsSync(from)) {
  console.error('元画像のフォルダを渡してください: node scripts/coach-photos.mjs <フォルダ>');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const files = readdirSync(from).filter((name) => SOURCES.has(extname(name).toLowerCase()));
if (files.length === 0) {
  console.error(`${from} に画像がありません（png / jpg / webp）。`);
  process.exit(1);
}

/**
 * 顔が画面いっぱいに来るように切る。
 *
 * **正方形の写真をそのまま縮めない。** 生成した写真は胸から上が写っているので、
 * そのまま 176px に縮めると、40pxの丸に描かれた時に顔が小さすぎて誰か分からない。
 * 上寄りの正方形を切り出して、頭と肩だけにする。
 */
function headAndShoulders(width, height) {
  const side = Math.round(Math.min(width, height) * 0.78);
  return {
    left: Math.max(0, Math.round((width - side) / 2)),
    // 頭の上に少しだけ余白を残す。詰めすぎると窮屈に見える。
    top: Math.max(0, Math.round(height * 0.07)),
    width: side,
    height: Math.min(side, height - Math.round(height * 0.07)),
  };
}

let done = 0;
for (const name of files) {
  const id = basename(name, extname(name));
  const target = join(OUT, `${id}.webp`);

  const image = sharp(join(from, name));
  const { width, height } = await image.metadata();

  await image
    .extract(headAndShoulders(width, height))
    .resize(SIZE, SIZE, { fit: 'cover' })
    .webp({ quality: 72 })
    .toFile(target);

  console.log(`${id.padEnd(8)} → ${target}  ${statSync(target).size}B`);
  done += 1;
}

console.log(`\n${done}枚を書き出しました。`);
