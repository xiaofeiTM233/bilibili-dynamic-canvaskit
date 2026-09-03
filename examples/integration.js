/**
 * 集成测试：真实字体 + 真实渲染管线
 * 验证：字体加载 -> 作者区 -> 正文（逐字符换行）-> 卡片组装 -> 渐变底图 -> PNG
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const {
  initCanvasKit,
  createRuntime,
  drawModuleDynamic,
  drawAuthorGeneral,
  assembleCard,
  composeDynamicCard,
  colorFromHex,
} = require('../dist/index');

async function main() {
  // 使用系统黑体（TTF 单字体，含 CJK）
  const fontPath = 'C:/Windows/Fonts/simhei.ttf';
  if (!fs.existsSync(fontPath)) {
    throw new Error('未找到系统字体 ' + fontPath);
  }
  const fontBuf = new Uint8Array(fs.readFileSync(fontPath));

  const ck = await initCanvasKit();

  // resvg 预渲染角标图标（对应 SVGDOM.makeImage）
  const badgeSvg = fs.readFileSync(path.join(__dirname, '../assets/icon/BILIBILI_LOGO.svg'));
  const resvg = new Resvg(badgeSvg, { fitTo: { mode: 'width', value: 32 } });
  const badgeImg = ck.MakeImageFromEncoded(new Uint8Array(resvg.render().asPng()));
  console.log('[1] 角标图标渲染成功:', badgeImg.width(), 'x', badgeImg.height());

  const rt = await createRuntime(ck, { fontBuffers: [fontBuf] });
  console.log('[2] 运行时创建成功 | 主字体族:', rt.textEnv.mainFontFamily || '(首族)');

  const text = '这是一条集成测试动态：验证逐字符换行算法与 Paragraph 排版在 Node 环境下的渲染效果 Hello World 12345';
  const moduleImages = await drawModuleDynamic(rt, {
    desc: { text, richTextNodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', origText: text, text }] },
  });
  console.log('[3] 正文模块绘制成功:', moduleImages.length, '张 |', moduleImages.map((i) => `${i.width()}x${i.height()}`).join(', '));

  const authorImage = await drawAuthorGeneral(
    rt,
    { name: '测试用户TestUser', mid: 2, face: null, pendant: null, verifyType: null },
    '2026-09-01 23:00',
    'https://t.bilibili.com/123456',
    colorFromHex('#d3edfa'),
    null,
  );
  console.log('[4] 作者区绘制成功:', authorImage.width(), 'x', authorImage.height());

  const card = assembleCard(rt, [authorImage, ...moduleImages], {
    id: '123456',
    footer: 'ID: 123456',
    badgeIcon: badgeImg,
  });
  console.log('[5] 卡片组装成功:', card.width(), 'x', card.height());

  const final = composeDynamicCard(rt, card, [colorFromHex('#d3edfa')]);
  const png = final.encodeToBytes();
  const outPath = path.join(__dirname, 'integration.png');
  fs.writeFileSync(outPath, png);
  console.log('[6] PNG 输出成功:', png.length, 'bytes ->', outPath);

  console.log('INTEGRATION OK');
}

main().catch((e) => {
  console.error('INTEGRATION FAILED:', e);
  process.exit(1);
});
