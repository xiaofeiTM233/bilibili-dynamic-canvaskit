/**
 * 装饰绘制回归检查：粉丝卡片（FanCard）必须真的画进卡片里
 *
 * 背景：drawAuthorGeneral 里 `drawOrnament(...)` 漏了 await，而 drawOrnament 内部要先
 * await 下载装饰图。漏 await 导致它和紧随其后的 makeImageSnapshot/dispose 并发，
 * 装饰画不进卡片（静默丢失）；一旦 surface 的像素缓冲被真正释放，还会变成
 * `memory access out of bounds` 崩溃。
 *
 * 用法：node examples/ornament-check.js
 * 通过条件：带装饰图与不带装饰图渲染出的 PNG 必须不同。
 */
const { initCanvasKit, makeSurface, renderDynamicCard } = require('../dist/index.js');

async function main() {
  const ck = await initCanvasKit();

  // 造一张 100x50 的纯红 PNG，作为「粉丝卡片」素材
  const s = makeSurface(ck, 100, 50);
  const canvas = s.getCanvas();
  const paint = new ck.Paint();
  paint.setColor(ck.Color4f(1, 0, 0, 1));
  paint.setAntiAlias(true);
  canvas.drawRect(ck.LTRBRect(0, 0, 100, 50), paint);
  paint.delete();
  const fanPng = Buffer.from(s.makeImageSnapshot().encodeToBytes());
  s.dispose();

  // 用桩 fetch 提供该素材（离线可跑）
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => fanPng.buffer.slice(fanPng.byteOffset, fanPng.byteOffset + fanPng.byteLength),
  });

  const base = {
    author: { mid: 2, name: '测试UP主', face: '', pendant: null, verifyType: 0, fanType: 3, fanNumStr: '1234' },
    time: '2026年09月20日 18:00:00',
    link: 'https://t.bilibili.com/1',
    id: '1',
    moduleImages: [],
    themeColorHex: '#d3edfa',
    isForward: false,
    // 不传 imageConfig，使用 DEFAULT_IMAGE_CONFIG（cardOrnament 即 FanCard）
  };

  const withOrnament = await renderDynamicCard({ ...base, author: { ...base.author, fanCardUrl: 'https://example.com/fan.png' } });
  const withoutOrnament = await renderDynamicCard({ ...base, author: { ...base.author, fanCardUrl: null } });
  global.fetch = realFetch;

  const same = Buffer.compare(Buffer.from(withOrnament), Buffer.from(withoutOrnament)) === 0;
  console.log(`带装饰图 PNG ${withOrnament.length}B / 不带 ${withoutOrnament.length}B`);
  console.log(same ? '❌ 两张图完全一致 —— 装饰没有被绘制（await 缺失）' : '✅ 装饰已绘制，两张图不同');
  process.exit(same ? 1 : 0);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
