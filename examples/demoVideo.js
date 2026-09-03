/**
 * 演示：渲染完整视频动态卡片 + 九宫格动态卡片
 * 封面/头像使用程序生成的图片注入缓存，不依赖网络
 */
const fs = require('fs');
const path = require('path');
const {
  initCanvasKit,
  createRuntime,
  drawAuthorGeneral,
  drawMajor,
  drawModuleDynamic,
  assembleCard,
  composeDynamicCard,
  colorFromHex,
} = require('../dist/index');

const FONT = 'C:/Windows/Fonts/simhei.ttf';

async function main() {
  if (!fs.existsSync(FONT)) throw new Error('未找到 ' + FONT);
  const ck = await initCanvasKit();
  const rt = await createRuntime(ck, { fontBuffers: [new Uint8Array(fs.readFileSync(FONT))] });

  // 程序生成封面：左上到右下渐变的图片
  function makeCover(w, h, c1, c2) {
    const s = ck.MakeSurface(w, h);
    const c = s.getCanvas();
    const p = new ck.Paint();
    p.setShader(ck.Shader.MakeLinearGradient([0, 0], [w, h], [c1, c2], null, ck.TileMode.Clamp));
    c.drawRect(ck.LTRBRect(0, 0, w, h), p);
    p.setShader(null);
    p.setColor(ck.Color4f(1, 1, 1, 0.25));
    c.drawRRect(ck.RRectXY(ck.LTRBRect(w / 2 - 60, h / 2 - 40, w / 2 + 60, h / 2 + 40), 12, 12), p);
    p.delete();
    const img = s.makeImageSnapshot();
    s.delete();
    return img;
  }

  const cover = makeCover(1000, 625, ck.Color4f(0.2, 0.35, 0.75, 1), ck.Color4f(0.75, 0.3, 0.65, 1));
  const face = makeCover(120, 120, ck.Color4f(0.9, 0.6, 0.2, 1), ck.Color4f(0.8, 0.2, 0.3, 1));
  rt.store.register('demo://cover', cover);
  rt.store.register('demo://face', face);

  const author = {
    name: '演示UP主DemoUser', mid: 114514, face: 'demo://face', pendant: null,
    verifyType: 1, fanCardUrl: null,
  };

  // ===== 视频动态 =====
  const authorImg = await drawAuthorGeneral(
    rt, author, '2026-09-01 23:00', 'https://www.bilibili.com/video/BV1Demo', colorFromHex('#d3edfa'), null,
  );
  const videoCard = await drawMajor(rt, {
    type: 'MAJOR_TYPE_ARCHIVE',
    archive: {
      title: '【演示】这是用 CanvasKit 移植版渲染的视频动态卡片标题，支持两行截断省略号',
      desc: '这是视频简介。描述段落最多显示三行，超出部分以省略号截断，换行由 Paragraph 排版引擎处理。',
      cover: 'demo://cover',
      badge: { text: '视频' }, aid: 12345, bvid: 'BV1Demo', durationText: '12:34',
      stat: { play: '123456', danmaku: '789' }, showStat: true,
    },
  });

  const card = assembleCard(rt, [authorImg, videoCard], { id: '123456789', badgeIcon: null });
  const final = composeDynamicCard(rt, card, [colorFromHex('#d3edfa')]);
  const png = final.encodeToBytes();
  const outVideo = path.join(__dirname, 'demo-video.png');
  fs.writeFileSync(outVideo, png);
  console.log('[视频动态]', final.width(), 'x', final.height(), '->', outVideo, png.length, 'bytes');
  final.delete(); card.delete(); videoCard.delete(); authorImg.delete();

  // ===== 九宫格动态 =====
  const pics = [];
  for (let i = 1; i <= 3; i++) {
    const pic = makeCover(400, 400,
      ck.Color4f(i * 0.15 + 0.2, 0.4, 0.8, 1), ck.Color4f(0.5, 0.1, i * 0.2 + 0.3, 1));
    rt.store.register(`demo://pic${i}`, pic);
    pics.push({ width: 400, height: 400, src: `demo://pic${i}` });
  }
  const grid = await drawMajor(rt, { type: 'MAJOR_TYPE_DRAW', draw: { items: pics } });
  const authorImg2 = await drawAuthorGeneral(
    rt, author, '2026-09-01 22:00', 'https://t.bilibili.com/98765', colorFromHex('#d3edfa'), null,
  );
  const descText = '这是一条九宫格图片动态的正文演示，包含换行与 Emoji 混排的渲染效果展示。';
  const descImgs = await drawModuleDynamic(rt, {
    desc: { text: descText, richTextNodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: descText }] },
  });
  const descImg = descImgs[0];
  descImgs.slice(1).forEach((m) => m.delete());

  const card2 = assembleCard(rt, [authorImg2, descImg, grid], { id: '987654321', badgeIcon: null });
  const final2 = composeDynamicCard(rt, card2, [colorFromHex('#d3edfa')]);
  const png2 = final2.encodeToBytes();
  const outGrid = path.join(__dirname, 'demo-grid.png');
  fs.writeFileSync(outGrid, png2);
  console.log('[九宫格动态]', final2.width(), 'x', final2.height(), '->', outGrid, png2.length, 'bytes');
  final2.delete(); card2.delete(); grid.delete(); authorImg2.delete(); descImg.delete();

  console.log('DEMO OK');
}

main().catch((e) => {
  console.error('DEMO FAILED:', e);
  process.exit(1);
});
