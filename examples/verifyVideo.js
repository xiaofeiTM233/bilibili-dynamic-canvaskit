/**
 * 验证 demo-video.png 的视觉元素：渐变底、封面、封面遮罩、时长标签、文字
 */
const fs = require('fs');
const path = require('path');
const CanvasKitInit = require('canvaskit-wasm/bin/canvaskit.js');

async function main() {
  const ck = await CanvasKitInit({
    locateFile: (file) => require.resolve('canvaskit-wasm/bin/' + file),
  });
  const buf = new Uint8Array(fs.readFileSync(path.join(__dirname, 'demo-video.png')));
  const img = ck.MakeImageFromEncoded(buf);
  const W = img.width();
  const H = img.height();
  const surface = ck.MakeSurface(W, H);
  const canvas = surface.getCanvas();
  canvas.drawImage(img, 0, 0);
  const px = canvas.readPixels(0, 0, {
    width: W, height: H,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  const at = (x, y) => {
    const i = (y * W + x) * 4;
    return [px[i], px[i + 1], px[i + 2]];
  };

  console.log('[尺寸]', W, 'x', H);
  console.log('[渐变底-左上]', at(5, 5), '期望浅蓝 (191,201,255) 附近');
  console.log('[渐变底-右下]', at(W - 5, H - 5), '期望浅蓝绿');

  // 封面区域：作者区(约140高)之后。封面主色应为 (51,89,191)->(191,77,166) 渐变
  console.log('[封面-左上]', at(200, 260));
  console.log('[封面-中部]', at(500, 500));

  // 封面底部遮罩：应显著变暗
  const mask = at(500, 730);
  console.log('[封面遮罩区]', mask, '亮度', (0.299 * mask[0] + 0.587 * mask[1] + 0.114 * mask[2]).toFixed(0));

  // 文字检测：全图最暗像素
  let minLuma = 255;
  for (let y = 140; y < H; y += 3) {
    for (let x = 40; x < W - 40; x += 3) {
      const i = (y * W + x) * 4;
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (l < minLuma) minLuma = l;
    }
  }
  console.log('[最暗像素亮度]', minLuma.toFixed(1), minLuma < 100 ? '→ 文字/遮罩存在' : '→ 疑缺失');

  console.log('VERIFY DONE');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
