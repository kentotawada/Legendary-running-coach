/**
 * アプリのアイコンを書き出す。
 *
 * 元になるのは scripts/brand/mark.png（白で抜いた絵。透明の背景）。
 * **色と余白は、ここだけで決める。** 書き出した PNG を手で直すと、
 * 次に作り直した時に元へ戻る。
 *
 *   node scripts/icons.mjs
 */
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const MARK = path.join(here, 'brand', 'mark.png');

/**
 * アプリの色。globals.css の --bg-elevated / --accent と同じ値。
 *
 * **白を下地にして、絵を橙で置く。**
 * 以前は逆（橙の板に白い絵）だった。ホーム画面にずらりとアイコンが並ぶ中では、
 * 面で色を主張するより、白く抜けているほうが見つけやすい。
 */
const PLATE = { r: 0xfd, g: 0xfc, b: 0xfa };
const INK = { r: 0xcf, g: 0x4d, b: 0x18 };

/**
 * 絵が板に占める割合。
 * **maskable だけ小さくする。** Android は円や角丸で好きに切るので、
 * 外周2割は削られる前提で置かないと、靴のつま先が消える。
 */
const FILL = 0.76;
const FILL_MASKABLE = 0.56;

async function icon(size, { fill = FILL } = {}) {
  const inner = Math.round(size * fill);

  /**
   * 白で抜いた絵を、アプリの生成り色に置き換える。
   * **透明度だけを引き継ぐ。** 元の絵の白を塗り替えるのではなく、
   * 形（どこが不透明か）だけを取って、色はこちらで決める。
   */
  const { data, info } = await sharp(MARK)
    .resize(inner, inner, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i += 1) {
    rgba[i * 4] = INK.r;
    rgba[i * 4 + 1] = INK.g;
    rgba[i * 4 + 2] = INK.b;
    rgba[i * 4 + 3] = data[i * info.channels + info.channels - 1];
  }
  const art = await sharp(rgba, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  // **角は丸めない。** iOS も Android も、切り抜くのは OS の側。
  // こちらで丸めると、その外側が透明になって白い枠が出る。
  return sharp({ create: { width: size, height: size, channels: 4, background: PLATE } })
    .composite([{ input: art, gravity: 'centre' }])
    .png()
    .toBuffer();
}

const jobs = [
  ['public/icon-192.png', 192, {}],
  ['public/icon-512.png', 512, {}],
  ['public/icon-maskable-512.png', 512, { fill: FILL_MASKABLE }],
  ['public/apple-touch-icon.png', 180, {}],
  ['public/icon-32.png', 32, {}],
];

for (const [out, size, options] of jobs) {
  await sharp(await icon(size, options)).toFile(path.join(root, out));
  console.log('書き出し', out, `${size}x${size}`);
}
