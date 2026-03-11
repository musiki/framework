import { visit } from 'unist-util-visit';

const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']);

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function detectExtension(target) {
  const cleanTarget = String(target || '').split('#')[0].split('?')[0];
  const fileName = String(cleanTarget.split('/').pop() || '').trim();
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) return '';
  return fileName
    .slice(dot + 1)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+$/g, '');
}

function createMediaHtml(url) {
  const extension = detectExtension(url);
  if (AUDIO_EXTENSIONS.has(extension)) {
    return `<figure class="obsidian-media-embed-card obsidian-audio-card"><audio class="obsidian-audio-embed obsidian-media-embed" controls preload="metadata" src="${escapeHtml(
      url,
    )}"></audio></figure>`;
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return `<figure class="obsidian-media-embed-card obsidian-video-card"><video class="obsidian-video-embed obsidian-media-embed" controls preload="metadata" src="${escapeHtml(
      url,
    )}"></video></figure>`;
  }

  return '';
}

export default function remarkMediaEmbed() {
  return (tree) => {
    visit(tree, 'image', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;

      const mediaHtml = createMediaHtml(node.url);
      if (!mediaHtml) return;

      parent.children.splice(index, 1, {
        type: 'html',
        value: mediaHtml,
      });

      return index;
    });
  };
}
