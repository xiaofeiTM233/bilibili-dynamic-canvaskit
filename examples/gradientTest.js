/**
 * 渐变最小复现：定位背景色异常（(1,1,1) 而非浅蓝渐变）
 */
const CanvasKitInit = require('canvaskit-wasm/bin/canvaskit.js');

async function main() {
  const ck = await CanvasKitInit({
    locateFile: (file) => require.resolve('canvaskit-wasm/bin/' + file),
  });

  const surface = ck.MakeSurface(120, 120);
  const canvas = surface.getCanvas();
  const paint = new ck.Paint();
  paint.setStyle(ck.PaintStyle.Fill);

  const colors = [
    ck.Color4f(191 / 255, 202 / 255, 1, 1),
    ck.Color4f(191 / 255, 234 / 255, 1, 1),
    ck.Color4f(191 / 255, 1, 244 / 255, 1),
  ];
  console.log('colors[0]:', Array.from(colors[0]));

  paint.setShader(
    ck.Shader.MakeLinearGradient([0, 0], [120, 120], colors, null, ck.TileMode.Clamp),
  );
  canvas.drawRect(ck.LTRBRect(0, 0, 120, 120), paint);

  const img = surface.makeImageSnapshot();
  const bytes = img.encodeToBytes();
  console.log('PNG bytes:', bytes.length);

  // 重新解码读像素
  const decoded = ck.MakeImageFromEncoded(bytes);
  const s2 = ck.MakeSurface(120, 120);
  const c2 = s2.getCanvas();
  c2.drawImage(decoded, 0, 0);
  const px = c2.readPixels(0, 0, {
    width: 120,
    height: 120,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  const at = (x, y) => [px[(y * 120 + x) * 4], px[(y * 120 + x) * 4 + 1], px[(y * 120 + x) * 4 + 2]];

  console.log('(2,2)   :', at(2, 2), '期望约 (191,202,255)');
  console.log('(60,60) :', at(60, 60));
  console.log('(118,118):', at(118, 118), '期望约 (191,255,244)');

  // 测试 drawImage 全流程：原图直接读像素（不经 PNG 编码）
  const s3 = ck.MakeSurface(120, 120);
  const c3 = s3.getCanvas();
  c3.drawImage(img, 0, 0);
  const px3 = c3.readPixels(0, 0, {
    width: 120,
    height: 120,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  const at3 = (x, y) => [px3[(y * 120 + x) * 4], px3[(y * 120 + x) * 4 + 1], px3[(y * 120 + x) * 4 + 2]];
  console.log('直读(2,2)  :', at3(2, 2));
  console.log('直读(118,118):', at3(118, 118));

  console.log('GRADIENT TEST DONE');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
