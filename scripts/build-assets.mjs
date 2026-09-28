// 把 assets/ 中的原图缩放并转为 WebP，输出到 public/game/ 供游戏加载。
// 原图保留为源文件；换素材或改尺寸后重新运行：npm run assets
// 缺少的源文件会被跳过并提示，界面对缺失图标有占位处理。
import { access, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const BATCH1 = 'assets/candidates/first-batch';
const BATCH2 = 'assets/candidates/second-batch';
const OUT = 'public/game';

// icon：裁掉透明边后放进正方形透明画布，保证不同图标视觉大小一致
// 尺寸按逻辑像素的两倍导出，适配高清屏
const jobs = [
  { src: `${BATCH1}/tile-attack.png`, out: 'tile-attack', kind: 'icon', size: 160 },
  { src: `${BATCH1}/tile-shield.png`, out: 'tile-shield', kind: 'icon', size: 160 },
  { src: `${BATCH1}/tile-poison.png`, out: 'tile-poison', kind: 'icon', size: 160 },
  { src: `${BATCH1}/tile-catalyst.png`, out: 'tile-catalyst', kind: 'icon', size: 160 },
  { src: `${BATCH1}/bomb-line-horizontal.png`, out: 'bomb-line', kind: 'icon', size: 160 },
  { src: `${BATCH1}/bomb-area-3x3.png`, out: 'bomb-area', kind: 'icon', size: 160 },
  { src: `${BATCH1}/bomb-color-clear.png`, out: 'bomb-color', kind: 'icon', size: 160 },
  { src: `${BATCH1}/alchemist-full.png`, out: 'alchemist', kind: 'sprite', width: 900 },
  { src: `${BATCH1}/crystal-mole.png`, out: 'enemy-crystal-mole', kind: 'sprite', width: 1000 },
  { src: `${BATCH1}/underground-entrance.png`, out: 'bg-entrance', kind: 'opaque', width: 1672 },
  { src: `${BATCH1}/board-empty-framed.png`, out: 'board-frame', kind: 'opaque', width: 1254 },
  // 第二批：敌人
  { src: `${BATCH2}/enemy-cave-bats.png`, out: 'enemy-cave-bats', kind: 'sprite', width: 1000 },
  { src: `${BATCH2}/enemy-rock-crab.png`, out: 'enemy-rock-crab', kind: 'sprite', width: 1100 },
  // 第二批：神器图标（卡片上约 48–64 像素显示）
  ...[
    'sealed-vial',
    'reaction-coil',
    'chain-lens',
    'echo-bell',
    'treasure-map',
    'piercing-needle',
    'overload-fuse',
    'unstable-fuse',
    'resonance-base',
    'lock-resonator',
    'fine-chisel',
    'scavenger-goggles',
  ].map((name) => ({ src: `${BATCH2}/artifact-${name}.png`, out: `artifact-${name}`, kind: 'icon', size: 160 })),
  // 第二批：嵌片标志（奖励卡上显示；棋盘角标用代码矢量符号）
  ...['blade', 'bulwark', 'venom-sac', 'catalyst-salt', 'earth-powder', 'flammable', 'ember-clay', 'quake-stone', 'blast-powder'].map((name) => ({
    src: `${BATCH2}/insert-${name}.png`,
    out: `insert-${name}`,
    kind: 'icon',
    size: 192,
  })),
];

const exists = (p) => access(p).then(() => true, () => false);

await mkdir(OUT, { recursive: true });
const missing = [];
for (const job of jobs) {
  if (!(await exists(job.src))) {
    missing.push(job.src);
    continue;
  }
  let img = sharp(job.src);
  if (job.kind === 'icon') {
    const trimmed = await img.trim().toBuffer();
    img = sharp(trimmed).resize(job.size, job.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  } else if (job.kind === 'sprite') {
    // 裁掉透明边，保证角色脚底贴着画布底边，便于统一站位
    const trimmed = await img.trim().toBuffer();
    img = sharp(trimmed).resize({ width: job.width, withoutEnlargement: true });
  } else {
    img = img.resize({ width: job.width, withoutEnlargement: true });
  }
  const info = await img.webp({ quality: job.kind === 'opaque' ? 82 : 90, alphaQuality: 100 }).toFile(`${OUT}/${job.out}.webp`);
  console.log(`${job.out}.webp  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)}KB`);
}
if (missing.length) console.warn(`\n缺少 ${missing.length} 个源文件，已跳过：\n  ${missing.join('\n  ')}`);
