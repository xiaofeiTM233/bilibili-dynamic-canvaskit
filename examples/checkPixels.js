/**
 * 像素验证：解码 integration.png，采样关键位置，确认视觉元素真实存在
 */
const fs = require('fs');
const path = require('path');
const CanvasKitInit = require('canvaskit-wasm/bin/canvaskit.js');

async function main() {
  const ck = await CanvasKitInit({
    locateFile: (file) => require.resolve('canvaskit-wasm/bin/' + file),
  });

  const pngPath = path.join(__dirname, 'integration.png');
  const buf = new Uint8Array(fs.readFileSync(pngPath));
  const img = ck.MakeImageFromEncoded(buf);
  const W = img.width();
  const H = img.height();
  console.log('[尺寸]', W, 'x', H);

  const surface = ck.MakeSurface(W, H);
  const canvas = surface.getCanvas();
  canvas.drawImage(img, 0, 0);

  const pixels = canvas.readPixels(0, 0, {
    width: W,
    height: H,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });

  const sample = (x, y) => {
    const i = (y * W + x) * 4;
    return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
  };

  const fmt = (name, [r, g, b, a]) =>
    console.log(`[${name}] (${r},${g},${b},${a}) ${a < 255 ? '透明' : '不透明'}`);

  // 1. 左上角：渐变背景（浅蓝系 #d3edfa 附近，应有明显蓝色分量）
  fmt('左上背景', sample(5, 5));
  // 2. 渐变沿对角线变化：右下角应比左上更蓝/更深
  fmt('右下背景', sample(W - 5, H - 5));
  // 3. 卡片顶部左侧（角标区域之外，应见卡片白底）
  fmt('卡片内部', sample(200, 150));
  // 4. 正文区域（应存在深色文字像素，采样多个点找最小值亮度）
  let minLuma = 255;
  let minAt = null;
  for (let y = 160; y < 300; y += 4) {
    for (let x = 60; x < 900; x += 4) {
      const i = (y * W + x) * 4;
      const l = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      if (l < minLuma) {
        minLuma = l;
        minAt = [x, y];
      }
    }
  }
  console.log(`[文字像素] 最暗点 (${minAt?.[0]},${minAt?.[1]}) 亮度=${minLuma.toFixed(1)}`, minLuma < 120 ? '→ 文字已绘制' : '→ 疑似无文字!');

  // 5. 全图非透明像素占比（卡片应覆盖大部分）
  let opaque = 0;
  const total = W * H;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque++;
  console.log(`[覆盖率] 非透明像素 ${(opaque / total * 100).toFixed(1)}%`);

  console.log('CHECK OK');
}

main().catch((e) => {
  console.error('CHECK FAILED:', e);
  process.exit(1);
});
