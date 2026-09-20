/**
 * 渲染内存回归检查：连续渲染高卡片，确认 WASM 堆不再增长
 *
 * 背景：CanvasKit 的 MakeSurface 自行 _malloc 一块 W*H*4 的像素缓冲并挂在 surface.Ve 上，
 * 只有 dispose() 会 _free 它，delete() 仅销毁 embind 外壳。历史上所有渲染路径都用 delete()，
 * 于是每渲染一张 1000x2284 的卡就漏约 9MB，跑几十张后 MakeSurface 直接返回 null，
 * 报「创建 Surface 失败: 1000x2284」。本脚本用于防止该问题回归。
 *
 * 用法：node examples/leak-check.js [次数]
 * 通过条件：WASM 堆增量为 0。
 */
const fs = require('fs');
const path = require('path');

const {
  initCanvasKit,
  makeSurface,
  createRuntime,
  disposeRuntime,
  renderDynamicCard,
} = require('../dist/index.js');

const TIMES = Number(process.argv[2] ?? 30);
const W = 1000;

const mb = (n) => (n / 1048576).toFixed(1) + 'MB';

async function main() {
  const ck = await initCanvasKit();
  const heap = () => ck.HEAPU8.byteLength;

  // 1) 直接压测 makeSurface：这是泄漏的最小复现单元
  const before1 = heap();
  for (let i = 0; i < TIMES; i++) {
    const s = makeSurface(ck, W, 2284);
    s.dispose();
  }
  const grow1 = heap() - before1;
  console.log(`[1] makeSurface(1000x2284) + dispose() x${TIMES}  WASM 堆增量 ${mb(grow1)}`);

  // 2) 反复创建/释放运行时：disposeRuntime 必须连 FontMgr 与 Typeface 一起释放
  {
    const warm = await createRuntime(ck, {});
    disposeRuntime(warm);
    const before = heap();
    for (let i = 0; i < TIMES; i++) {
      const rt = await createRuntime(ck, {});
      disposeRuntime(rt);
    }
    const grow = heap() - before;
    console.log(`[2] createRuntime + disposeRuntime x${TIMES}  WASM 堆增量 ${mb(grow)}`);
    if (grow !== 0) {
      console.log('❌ 存在泄漏（disposeRuntime 未释放 FontMgr / Typeface）');
      process.exit(1);
    }
  }

  // 2) 完整渲染一张高卡片（约 1000x2100），模拟真实动态推送
  const base = makeSurface(ck, W, 2000);
  const canvas = base.getCanvas();
  const paint = new ck.Paint();
  paint.setColor(ck.Color4f(0.85, 0.93, 0.98, 1));
  paint.setAntiAlias(true);
  canvas.drawRect(ck.LTRBRect(0, 0, W, 2000), paint);
  paint.delete();
  const tallModule = base.makeImageSnapshot();
  base.dispose();

  await renderDynamicCard({
    author: { mid: 2, name: '测试UP主', face: '', pendant: null, verifyType: 0 },
    time: '2026年09月20日 13:00:00',
    link: 'https://t.bilibili.com/1250008158063034377',
    id: '1250008158063034377',
    moduleImages: [tallModule],
    themeColorHex: '#d3edfa',
    isForward: true,
    badgeIcon: null,
  });

  const before2 = heap();
  let png = 0;
  for (let i = 0; i < TIMES; i++) {
    png = (await renderDynamicCard({
      author: { mid: 2, name: '测试UP主', face: '', pendant: null, verifyType: 0 },
      time: '2026年09月20日 13:00:00',
      link: 'https://t.bilibili.com/1250008158063034377',
      id: '1250008158063034377',
      moduleImages: [tallModule],
      themeColorHex: '#d3edfa',
      isForward: true,
      badgeIcon: null,
    })).length;
  }
  const grow2 = heap() - before2;
  console.log(`[3] renderDynamicCard（含 1000x2000 模块图，PNG ${(png / 1024).toFixed(0)}KB）x${TIMES}  WASM 堆增量 ${mb(grow2)}`);

  tallModule.delete();

  const ok = grow1 === 0 && grow2 === 0;
  console.log(ok ? '✅ 无泄漏' : '❌ 存在泄漏');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
