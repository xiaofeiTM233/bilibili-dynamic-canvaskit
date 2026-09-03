/**
 * 冒烟测试：验证 CanvasKit 在 Node 环境下的关键能力
 * 1. WASM 加载  2. Paragraph API 与 ICU  3. 字体加载  4. Surface 渲染与 PNG 输出
 */
const fs = require('fs');
const path = require('path');
const CanvasKitInit = require('canvaskit-wasm/bin/canvaskit.js');

async function main() {
  const ck = await CanvasKitInit({
    locateFile: (file) => require.resolve('canvaskit-wasm/bin/' + file),
  });
  console.log('[1] CanvasKit 加载成功');

  const needsICU = ck.ParagraphBuilder.RequiresClientICU();
  console.log('[2] RequiresClientICU:', needsICU, needsICU ? '(无ICU, CJK断行需客户端提供)' : '(自带ICU, CJK断行可用)');

  const fontBuf = fs.readFileSync(path.join(__dirname, '../assets/font/FansCard.ttf'));
  const fontMgr = ck.FontMgr.FromData(fontBuf);
  console.log('[3] FontMgr 族数:', fontMgr.countFamilies(), '| 首族:', fontMgr.getFamilyName(0));

  const paraStyle = new ck.ParagraphStyle({
    textStyle: { color: ck.BLACK, fontFamilies: [fontMgr.getFamilyName(0)], fontSize: 32 },
    textAlign: ck.TextAlign.Left,
    maxLines: 2,
    ellipsis: '...',
  });
  const builder = ck.ParagraphBuilder.Make(paraStyle, fontMgr);
  builder.addText('Hello Bili Card 12345');
  const para = builder.build();
  para.layout(400);
  console.log('[4] Paragraph 排版成功 | 高度:', para.getHeight(), '| 行数:', para.getLineMetrics().length);

  const surface = ck.MakeSurface(500, 120);
  const canvas = surface.getCanvas();
  canvas.clear(ck.Color4f(0.83, 0.93, 0.98, 1));

  const paint = new ck.Paint();
  paint.setColor(ck.Color4f(0.98, 0.45, 0.6, 1));
  paint.setAntiAlias(true);
  canvas.drawRRect(ck.RRectXY(ck.LTRBRect(30, 20, 470, 100), 15, 15), paint);
  canvas.drawParagraph(para, 50, 40);

  const img = surface.makeImageSnapshot();
  const png = img.encodeToBytes();
  fs.writeFileSync(path.join(__dirname, 'smoke.png'), png);
  console.log('[5] PNG 输出成功:', png.length, 'bytes');

  para.delete();
  builder.delete();
  fontMgr.delete();
  img.delete();
  surface.delete();

  console.log('SMOKE OK');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
