/**
 * 动态数据最小接口 —— 仅声明绘制层实际消费的字段
 *
 * 原实现的完整数据模型在 data/Dynamic.kt（含全部 API 字段与默认值），
 * 此处按绘制需要收敛为宽松接口，由调用方从 B 站 API 响应中装配。
 */

/** 富文本节点，对应 ModuleDynamic.ContentDesc.RichTextNode */
export interface RichTextNode {
  type: string;
  origText?: string;
  text: string;
  emoji?: { iconUrl: string };
}

/** 动态正文，对应 ModuleDynamic.ContentDesc */
export interface ContentDesc {
  text: string;
  richTextNodes: RichTextNode[];
}

/** 角标，对应 Major 各模块的 badge */
export interface Badge {
  text: string;
  /** 自定义角标前景色（ARGB int），用于 badgeEnable 关闭时的 labelCard */
  color?: string | number;
  bgColor?: string | number;
}

export interface MajorArchive {
  title: string;
  desc?: string | null;
  cover: string;
  badge: Badge;
  aid: number;
  bvid: string;
  durationText: string;
  stat: { play: string | number; danmaku: string | number };
}

export interface MajorDrawItem {
  width: number;
  height: number;
  src: string;
}

export interface MajorArticle {
  title: string;
  desc?: string | null;
  covers: string[];
  id: number;
}

export interface MajorMusic {
  title: string;
  label: string;
  cover: string;
  id: number;
}

export interface MajorLive {
  title: string;
  descFirst?: string;
  descSecond?: string;
  cover: string;
  badge: Badge;
  id: number;
}

export interface MajorLiveRcmd {
  liveInfo: {
    livePlayInfo: {
      title: string;
      parentAreaName: string;
      areaName: string;
      cover: string;
      liveStatus: number;
      roomId: number;
    };
  };
}

export interface MajorPgc {
  title: string;
  stat: { play: string | number; danmaku: string | number };
  cover: string;
  badge: Badge;
  epid: number;
}

export interface MajorBlocked {
  bgImg: { imgDay: string };
  icon: { imgDay: string };
}

export interface MajorOpus {
  title?: string | null;
  /** 图文正文，复用 ContentDesc 绘制 */
  summary: ContentDesc;
  pics: MajorDrawItem[];
}

export interface MajorCommon {
  cover?: string | null;
  title: string;
  desc: string;
  label: string;
  badge: Badge;
}

export interface MajorNone {
  tips: string;
}

export type Major =
  | { type: 'MAJOR_TYPE_ARCHIVE'; archive: MajorArchive }
  | { type: 'MAJOR_TYPE_BLOCKED'; blocked: MajorBlocked }
  | { type: 'MAJOR_TYPE_DRAW'; draw: { items: MajorDrawItem[] } }
  | { type: 'MAJOR_TYPE_ARTICLE'; article: MajorArticle }
  | { type: 'MAJOR_TYPE_MUSIC'; music: MajorMusic }
  | { type: 'MAJOR_TYPE_LIVE'; live: MajorLive }
  | { type: 'MAJOR_TYPE_LIVE_RCMD'; liveRcmd: MajorLiveRcmd }
  | { type: 'MAJOR_TYPE_PGC'; pgc: MajorPgc }
  | { type: 'MAJOR_TYPE_UGC_SEASON'; ugcSeason: MajorArchive }
  | { type: 'MAJOR_TYPE_COMMON'; common: MajorCommon }
  | { type: 'MAJOR_TYPE_OPUS'; opus: MajorOpus }
  | { type: 'MAJOR_TYPE_NONE'; none: MajorNone }
  /** 未知类型的兜底分支，字段按上述结构可选 */
  | {
      type: string;
      archive?: MajorArchive;
      blocked?: MajorBlocked;
      draw?: { items: MajorDrawItem[] };
      article?: MajorArticle;
      music?: MajorMusic;
      live?: MajorLive;
      liveRcmd?: MajorLiveRcmd;
      pgc?: MajorPgc;
      ugcSeason?: MajorArchive;
      common?: MajorCommon;
      opus?: MajorOpus;
      none?: MajorNone;
    };

/** 附加卡片，对应 ModuleDynamic.Additional */
export interface Additional {
  type: string;
  common?: {
    headText: string;
    cover?: string | null;
    title: string;
    desc1: string;
    desc2?: string | null;
  };
  reserve?: {
    stype: number;
    premiere?: { cover: string } | null;
    title: string;
    desc1: { text: string };
    desc2: { text: string };
    desc3?: { text: string } | null;
  };
  vote?: {
    desc: string;
    /** 已格式化的结束时间文本 */
    endTimeText: string;
  };
  ugc?: {
    headText: string;
    cover: string;
    title: string;
    duration: string;
    descSecond: string;
  };
  goods?: {
    headText?: string;
    items: Array<{ cover?: string | null; name: string; price: string }>;
  };
  lottery?: {
    title: string;
    desc: { text: string };
  };
}

/** 动态模块，对应 ModuleDynamic */
export interface DynamicModules {
  topic?: { name: string } | null;
  desc?: ContentDesc | null;
  major?: Major | null;
  additional?: Additional | null;
  dispute?: { title: string } | null;
}
