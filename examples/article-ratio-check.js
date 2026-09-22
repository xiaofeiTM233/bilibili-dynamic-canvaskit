/** 专栏封面比例验证：封面区高度应跟随图片原始比例 */
const { initCanvasKit, createRuntime, disposeRuntime, drawArticle, makeSurface } = require('../dist/index.js');
const fs = require('node:fs');

;(async () => {
  const ck = await initCanvasKit();
  const rt = await createRuntime(ck, {
    fontBuffers: [new Uint8Array(fs.readFileSync('font/LXGWWenKai-Bold.ttf'))],
  });

  const makePng = (w, h) => {
    const s = makeSurface(ck, w, h);
    const p = new ck.Paint();
    p.setColor(ck.Color4f(0.2, 0.6, 1, 1));
    p.setAntiAlias(true);
    s.getCanvas().drawRect(ck.LTRBRect(0, 0, w, h), p);
    p.delete();
    const png = Buffer.from(s.makeImageSnapshot().encodeToBytes());
    s.dispose();
    return png;
  };

  const ratioOf = {
    '3.5:1（编辑器实际裁剪比例）': makePng(700, 200),
    '16:9': makePng(640, 360),
    '1:1（方图）': makePng(400, 400),
    '2:3（竖图）': makePng(400, 600),
  };

  for (const [name, png] of Object.entries(ratioOf)) {
    global.fetch = async () => ({
      ok: true,
      arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    });
    const card = await drawArticle(rt, {
      title: '专栏标题',
      desc: '专栏描述',
      covers: [`https://example.com/cover-${Math.random()}.jpg`],
      id: 1,
    });
    console.log(`封面 ${name.padEnd(20)} -> 专栏卡总高 ${card.height()}px`);
    card.delete();
  }
  // 加载失败场景：全部请求失败 -> 红色 IMAGE_MISS.png（1280x720）按自身比例占位
  global.fetch = async () => ({ ok: false, status: 404 });
  const missCard = await drawArticle(rt, { title: '专栏标题', desc: '专栏描述', covers: ['https://example.com/miss.jpg'], id: 9 });
  console.log(`加载失败 -> 红色占位图卡总高 ${missCard.height()}px（封面区 ${((940 * 720) / 1280).toFixed(0)}px）`);

  disposeRuntime(rt);
  console.log('（contentW≈940；封面区高 = 940 × 图片高宽比，无条件跟随原始比例）');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
