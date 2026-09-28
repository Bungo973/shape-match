// 把 assets/ 中的原图缩放并转为 WebP，输出到 public/game/ 供游戏加载。
// 原图保留为源文件；换素材或改尺寸后重新运行：npm run assets
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SRC = 'assets/candidates/first-batch';
const OUT = 'public/game';

// icon：裁掉透明边后放进正方形透明画布，保证不同图标视觉大小一致
// 尺寸按逻辑像素的两倍导出，适配高清屏
const jobs = [
  { src: 'tile-attack.png', out: 'tile-attack', kind: 'icon', size: 160 },
  { src: 'tile-shield.png', out: 'tile-shield', kind: 'icon', size: 160 },
  { src: 'tile-poison.png', out: 'tile-poison', kind: 'icon', size: 160 },
  { src: 'tile-catalyst.png', out: 'tile-catalyst', kind: 'icon', size: 160 },
  { src: 'bomb-line-horizontal.png', out: 'bomb-line', kind: 'icon', size: 160 },
  { src: 'bomb-area-3x3.png', out: 'bomb-area', kind: 'icon', size: 160 },
  { src: 'bomb-color-clear.png', out: 'bomb-color', kind: 'icon', size: 160 },
  { src: 'alchemist-full.png', out: 'alchemist', kind: 'sprite', width: 900 },
  { src: 'crystal-mole.png', out: 'mole', kind: 'sprite', width: 1000 },
  { src: 'underground-entrance.png', out: 'bg-entrance', kind: 'opaque', width: 1672 },
  { src: 'board-empty-framed.png', out: 'board-frame', kind: 'opaque', width: 1254 },
];

await mkdir(OUT, { recursive: true });
for (const job of jobs) {
  let img = sharp(`${SRC}/${job.src}`);
  if (job.kind === 'icon') {
    const trimmed = await img.trim().toBuffer();
    img = sharp(trimmed).resize(job.size, job.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  } else {
    img = img.resize({ width: job.width, withoutEnlargement: true });
  }
  const info = await img.webp({ quality: job.kind === 'opaque' ? 82 : 90, alphaQuality: 100 }).toFile(`${OUT}/${job.out}.webp`);
  console.log(`${job.out}.webp  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)}KB`);
}
