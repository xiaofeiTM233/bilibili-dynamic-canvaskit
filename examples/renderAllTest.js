/**
 * 全类型回归：用占位图跑通所有 major 类型与直播卡片，验证无逻辑崩溃
 */
const fs = require('fs');
const path = require('path');
const {
  initCanvasKit,
  createRuntime,
  drawMajor,
  drawLive,
  composeLiveCard,
  drawModuleDynamic,
} = require('../dist/index');

const FONT = 'C:/Windows/Fonts/simhei.ttf';
const MISS = 'https://img.example.com/miss.png'; // 下载失败 → 占位图

async function main() {
  if (!fs.existsSync(FONT)) throw new Error('未找到 ' + FONT);
  const ck = await initCanvasKit();
  const rt = await createRuntime(ck, { fontBuffers: [new Uint8Array(fs.readFileSync(FONT))] });

  const cases = [
    ['ARCHIVE', { type: 'MAJOR_TYPE_ARCHIVE', archive: { title: '测试视频标题测试视频标题测试视频标题', desc: '测试描述', cover: MISS, badge: { text: '视频' }, aid: 1, bvid: 'BV1xx', durationText: '10:00', stat: { play: '12345', danmaku: '100' } } }],
    ['DRAW-1', { type: 'MAJOR_TYPE_DRAW', draw: { items: [{ width: 100, height: 100, src: MISS }] } }],
    ['DRAW-9', { type: 'MAJOR_TYPE_DRAW', draw: { items: Array.from({ length: 9 }, (_, i) => ({ width: 200, height: 200, src: MISS })) } }],
    ['ARTICLE', { type: 'MAJOR_TYPE_ARTICLE', article: { title: '专栏标题', desc: '专栏描述', covers: [MISS], id: 1 } }],
    ['ARTICLE-3', { type: 'MAJOR_TYPE_ARTICLE', article: { title: '专栏标题', desc: '专栏描述', covers: [MISS, MISS, MISS], id: 2 } }],
    ['MUSIC', { type: 'MAJOR_TYPE_MUSIC', music: { title: '音乐标题', label: '歌手', cover: MISS, id: 1 } }],
    ['COMMON', { type: 'MAJOR_TYPE_COMMON', common: { cover: null, title: '通用标题', desc: '通用描述', label: '标签', badge: { text: 'badge' } } }],
    ['NONE', { type: 'MAJOR_TYPE_NONE', none: { tips: '没有更多了' } }],
    ['PGC', { type: 'MAJOR_TYPE_PGC', pgc: { title: '番剧标题', stat: { play: '100', danmaku: '10' }, cover: MISS, badge: { text: '番剧' }, epid: 1 } }],
    ['LIVE', { type: 'MAJOR_TYPE_LIVE', live: { title: '直播标题', descFirst: '分区', descSecond: '房间', cover: MISS, badge: { text: '直播' }, id: 1 } }],
    ['UGC_SEASON', { type: 'MAJOR_TYPE_UGC_SEASON', ugcSeason: { title: '合集标题', desc: '合集描述', cover: MISS, badge: { text: '合集' }, aid: 1, bvid: 'BV1yy', durationText: '05:00', stat: { play: '1', danmaku: '1' } } }],
    ['OPUS', { type: 'MAJOR_TYPE_OPUS', opus: { title: '图文标题', summary: { text: '图文正文内容', richTextNodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '图文正文内容' }] }, pics: [] } }],
    ['UNKNOWN', { type: 'MAJOR_TYPE_FUTURE', }],
  ];

  let fail = 0;
  for (const [name, major] of cases) {
    try {
      const img = await drawMajor(rt, major, { isForward: name === 'ARCHIVE' });
      const ok = img.width() > 0 && img.height() > 0;
      console.log(`[${name}] ${img.width()}x${img.height()} ${ok ? 'OK' : '异常尺寸'}`);
      img.delete();
      if (!ok) fail++;
    } catch (e) {
      console.log(`[${name}] 崩溃: ${e.message}`);
      fail++;
    }
  }

  // 直播整卡
  try {
    const liveImg = await drawLive(rt, {
      uid: 1, uname: '测试主播', roomId: 12345, title: '测试直播标题',
      face: MISS, cover: MISS, liveTimeText: '2026-09-01 23:00', area: '生活',
    });
    const composed = composeLiveCard(rt, liveImg, [0xffd3edfa]);
    console.log(`[LIVE-CARD] ${composed.width()}x${composed.height()} OK`);
    composed.delete();
    liveImg.delete();
  } catch (e) {
    console.log(`[LIVE-CARD] 崩溃: ${e.message}`);
    fail++;
  }

  // 正文 + 话题 + 附加卡片
  try {
    const mods = await drawModuleDynamic(rt, {
      topic: { name: '#测试话题#测试话题#测试话题' },
      desc: { text: '正文内容测试', richTextNodes: [{ type: 'RICH_TEXT_NODE_TYPE_TEXT', text: '正文内容测试' }] },
      additional: { type: 'ADDITIONAL_TYPE_VOTE', vote: { desc: '投票内容', endTimeText: '2026-09-02 00:00' } },
    });
    console.log(`[MODULES] ${mods.length} 张 OK:`, mods.map((m) => `${m.width()}x${m.height()}`).join(', '));
    mods.forEach((m) => m.delete());
  } catch (e) {
    console.log(`[MODULES] 崩溃: ${e.message}`);
    fail++;
  }

  console.log(fail === 0 ? 'ALL TYPES OK' : `${fail} 项失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
