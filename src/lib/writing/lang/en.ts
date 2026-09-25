import type { LangPack } from './index.ts';

export const en: LangPack = {
  lang: 'en',
  stopwords: new Set([
    'that', 'with', 'this', 'have', 'from', 'they', 'will', 'been', 'were',
    'said', 'each', 'which', 'their', 'there', 'when', 'what', 'make', 'like',
    'time', 'just', 'know', 'take', 'into', 'year', 'your', 'good', 'some',
    'could', 'them', 'then', 'than', 'more', 'only', 'come', 'over', 'also',
    'back', 'after', 'first', 'well', 'most', 'about', 'would', 'very', 'these',
    'those', 'such', 'other', 'being', 'both', 'here', 'many', 'does', 'where',
    'through', 'because', 'between', 'without', 'during', 'before', 'should',
    'might', 'while', 'since', 'until', 'whether',
  ]),
  connectors: [
    'however', 'but', 'therefore', 'consequently', 'for example', 'for instance',
    'thus', 'then', 'moreover', 'furthermore', 'nevertheless', 'hence',
    'in contrast', 'on the other hand', 'when', 'finally', 'meanwhile',
    'later', 'afterwards', 'in addition',
  ],
};
