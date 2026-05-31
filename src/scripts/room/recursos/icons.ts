export const TYPE_ICON: Record<string, { char: string; color: string }> = {
  pdf:          { char: '■', color: '#e06666' },
  pptx:         { char: '▣', color: '#f6b26b' },
  img:          { char: '▪', color: '#76d3ff' },
  md:           { char: '■', color: '#45d384' },
  tex:          { char: '■', color: '#f6b26b' },
  ly:           { char: '♩', color: '#ffd966' },
  audio:        { char: '♪', color: '#93c47d' },
  video:        { char: '▤', color: '#7ec8e3' },
  'link-video': { char: '▶', color: '#e8541e' },
  link:         { char: '⬡', color: '#8e7cc3' },
  other:        { char: '·', color: '#666'    },
};

const LINK_VIDEO_RE = /youtube\.com|youtu\.be|vimeo\.com|soundcloud\.com/;
const URL_EXT_RE = /\.([a-z0-9]+)(?:\?|#|$)/i;

const VIDEO_EXT_RE = /\.(mp4|mov|webm)(?:\?|#|$)/i;

export function iconFor(type: string, url?: string, name?: string): { char: string; color: string } {
  const isSco = (name && /(?:^|[\s_#-])[sS][cC][oO](?:$|[\s_#.-])/.test(name)) || (url && /(?:^|[\s_#-])[sS][cC][oO](?:$|[\s_#.-])/.test(url));
  if (isSco) {
    return { char: '■', color: '#13c2c2' }; // Sheet music (SCO) cyan/teal color
  }

  if (type === 'link' && url && LINK_VIDEO_RE.test(url)) return TYPE_ICON['link-video'];
  // Stored type may be 'audio' for video files — correct via URL
  if (type === 'audio' && url && VIDEO_EXT_RE.test(url)) return TYPE_ICON['video'];
  if (type === 'other' && url) {
    const ext = URL_EXT_RE.exec(url)?.[1]?.toLowerCase();
    if (ext) {
      // avoid importing from metadata to keep this module self-contained
      const EXT_FALLBACK: Record<string, string> = {
        pdf: 'pdf', pptx: 'pptx', ppt: 'pptx', ptx: 'pptx',
        jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', webp: 'img', svg: 'img',
        mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
        mov: 'video', mp4: 'video', webm: 'video',
        md: 'md', tex: 'tex', ly: 'ly',
      };
      const inferred = EXT_FALLBACK[ext];
      if (inferred && TYPE_ICON[inferred]) return TYPE_ICON[inferred];
    }
  }
  return TYPE_ICON[type] ?? TYPE_ICON.other;
}
