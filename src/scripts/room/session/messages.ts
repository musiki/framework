import { normalizeLayoutMode, type LayoutMode } from '../../layout-controller';
import { normalizePreviewZoom, normalizeText } from '../core/normalize';

export type ParticipantRole = 'teacher' | 'student' | 'external' | 'admin';
export type ReactionKind = 'clap' | 'heart' | 'joy' | 'tada' | 'thumbsup' | 'wow';

export type SlideState = {
  indexf: number;
  indexh: number;
  indexv: number;
  zoom: number;
  pointerMode?: boolean;
  scrollTop?: number;
};

export type PresentationPointerKind = 'move' | 'mark' | 'clear';

export type ExternalMediaProvider = 'youtube';
export type ExternalMediaPlaybackState = 'playing' | 'paused' | 'ended';
export type PresentationMediaProvider = 'youtube';
export type PresentationMediaPlaybackState = ExternalMediaPlaybackState;
export type PresentationMediaState = {
  capturedAt: number;
  currentTime: number;
  embedId: string;
  mediaId: string;
  playbackState: PresentationMediaPlaybackState;
  provider: PresentationMediaProvider;
  volume: number;
  muted: boolean;
  force?: boolean;
};

export type ConferenceMessage =
  | {
      type: 'session-kick';
      identity: string;
    }
  | {
      type: 'layout';
      layout: LayoutMode;
    }
  | {
      type: 'graph';
      open: boolean;
    }
  | {
      type: 'session-control';
      allowInstruments: boolean;
    }
  | {
      type: 'session-setup';
      previewZoom: number;
      showCircle: boolean;
      circleSize?: number;
    }
  | {
      type: 'session-leader';
      identity: string;
    }
  | {
      id: string;
      identity: string;
      name: string;
      role: ParticipantRole;
      sentAt: string;
      text: string;
      type: 'chat';
    }
  | {
      type: 'presentation';
      href: string | null;
    }
  | {
      type: 'mute-all';
    }
  | {
      type: 'presentation-state-request';
    }
  | {
      id: string;
      identity: string;
      name: string;
      reaction: ReactionKind;
      role: ParticipantRole;
      sentAt: string;
      type: 'reaction';
    }
  | ({
      type: 'slide-state';
    } & SlideState)
  | ({
      type: 'presentation-media';
    } & PresentationMediaState)
  | {
      type: 'presentation-zoom';
      zoom: number;
    }
  | {
      type: 'presentation-pointer';
      active: boolean;
      kind: PresentationPointerKind;
      x: number;
      y: number;
    }
  | {
      type: 'whiteboard-draw';
      x: number;
      y: number;
      action: 'start' | 'draw' | 'end';
      color: string;
    }
  | {
      type: 'whiteboard-clear';
    }
  | {
      type: 'whiteboard-text';
      x: number;
      y: number;
      text: string;
      color: string;
      size: 'sm' | 'lg';
    }
  | {
      type: 'whiteboard-bg';
      bg: 'none' | 'staff' | 'grid';
    }
  | {
      type: 'lilypond-live';
      anchor: number;
      head: number;
      body?: string;
    }
  | {
      type: 'lilypond-render';
      body: string;
      url?: string;
      midiUrl?: string;
      pdfUrl?: string;
    }
  | {
      type: 'lilypond-play';
      action: 'start' | 'stop';
      url?: string;
    }
  | {
      type: 'hyperpiano';
      note: number;
      velocity: number;
      action: 'on' | 'off';
    }
  | {
      type: 'lilypond-setup';
      allowStudents: boolean;
    }
  | {
      type: 'session-workspace';
      layout: any;
    }
  | {
      type: 'concept-load';
      href: string | null;
    }
  | {
      type: 'layout-split';
      left: LayoutMode;
      right: LayoutMode;
    }
  | {
      type: 'layout-overlay';
      overlay: LayoutMode | null;
    }
  | {
      type: 'circle-move';
      x: number;
      y: number;
      identity: string;
      zoom?: number;
      size?: number;
      show?: boolean;
    }
  | {
      type: 'break-rooms';
      rooms: Array<{ name: string; label: string }>;
      assignments: Record<string, string>;
      mode: string;
    }
  | {
      type: 'break-rooms-end';
      countdown: number;
      mainRoom: string;
    }
  | {
      type: 'break-rooms-kill';
      mainRoom: string;
    }
  | {
      action: 'close';
      type: 'external-media';
    }
  | {
      action: 'open' | 'sync';
      capturedAt: number;
      currentTime: number;
      mediaId: string;
      playbackState: ExternalMediaPlaybackState;
      provider: ExternalMediaProvider;
      sourceUrl: string;
      title: string;
      type: 'external-media';
    }
  | {
      type: 'sa-file-sync';
      url: string;
      fileName: string;
      senderName: string;
      key: string;
      scale: string;
      bpm: number;
    }
  | {
      type: 'sa-state';
      active: boolean;
    }
  | {
      type: 'sv-playback';
      action: 'play' | 'pause' | 'seek';
      offset: number;
    }
  | {
      type: 'sv-vtab';
      tab: string;
    }
  | {
      type: 'sv-layer';
      layer: string;
      visible: boolean;
    }
  | {
      type: 'sv-loop';
      inPoint: number;
      outPoint: number;
      enabled: boolean;
    }
  | {
      type: 'vs-state';
      url: string | null;
      name: string;
      kind: 'pdf' | 'img' | null;
      page: number;
      zoomMode: 'fit' | 'width' | 'actual' | 'custom';
      zoom: number;
    }
  | { type: 'recursos:sync'; items: any[]; allowStudents: boolean }
  | { type: 'recursos:allow-students'; allow: boolean };

export const MESSAGE_TOPIC = 'conference-ui';

export const REACTION_SHORTCUTS_BY_CODE: Record<string, ReactionKind> = {
  Digit4: 'clap',
  Digit5: 'thumbsup',
  Digit6: 'heart',
  Digit7: 'joy',
  Digit8: 'wow',
  Digit9: 'tada',
};

export const REACTION_EMOJIS: Record<ReactionKind, string> = {
  clap: '👏',
  heart: '❤️',
  joy: '😂',
  tada: '🎉',
  thumbsup: '👍',
  wow: '😮',
};

const textDecoder = new TextDecoder();

const isTeacherRole = (value: unknown): value is ParticipantRole =>
  normalizeText(value).toLowerCase() === 'teacher';

const isExternalRole = (value: unknown): value is ParticipantRole =>
  normalizeText(value).toLowerCase() === 'external';

export const normalizeRole = (value: unknown): ParticipantRole => {
  const val = normalizeText(value).toLowerCase();
  if (val === 'admin') return 'admin';
  if (val === 'teacher') return 'teacher';
  if (val === 'external') return 'external';
  return 'student';
};

export const normalizeSlideState = (value: Partial<SlideState> | null | undefined): SlideState | null => {
  if (!value || typeof value !== 'object') return null;
  const indexh = Number(value.indexh);
  const indexv = Number(value.indexv);
  const indexf = Number(value.indexf);
  const zoom = Number(value.zoom);
  if (!Number.isFinite(indexh) || !Number.isFinite(indexv) || !Number.isFinite(indexf)) {
    return null;
  }

  return {
    indexf: Math.max(0, Math.round(indexf)),
    indexh: Math.max(0, Math.round(indexh)),
    indexv: Math.max(0, Math.round(indexv)),
    zoom: Math.min(1.4, Math.max(0.45, Number.isFinite(zoom) ? zoom : 1)),
    pointerMode: Boolean(value.pointerMode),
    scrollTop: Number.isFinite(value.scrollTop) ? Number(value.scrollTop) : undefined,
  };
};

const isReactionKind = (value: string): value is ReactionKind => value in REACTION_EMOJIS;
const isExternalMediaPlaybackState = (value: string): value is ExternalMediaPlaybackState =>
  value === 'playing' || value === 'paused' || value === 'ended';
const isPresentationMediaProvider = (value: string): value is PresentationMediaProvider => value === 'youtube';
const isPresentationPointerKind = (value: string): value is PresentationPointerKind =>
  value === 'move' || value === 'mark' || value === 'clear';

export const parseConferenceMessage = (payload: Uint8Array): ConferenceMessage | null => {
  try {
    const parsed = JSON.parse(textDecoder.decode(payload));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }

    if (parsed.type === 'session-kick') {
      return {
        type: 'session-kick',
        identity: normalizeText((parsed as { identity?: string }).identity),
      };
    }

    if (parsed.type === 'layout') {
      return {
        type: 'layout',
        layout: normalizeLayoutMode((parsed as { layout?: string }).layout),
      };
    }

    if (parsed.type === 'presentation') {
      return {
        type: 'presentation',
        href: typeof (parsed as { href?: string | null }).href === 'string'
          ? (parsed as { href: string }).href
          : null,
      };
    }

    if (parsed.type === 'graph') {
      return {
        type: 'graph',
        open: (parsed as { open?: boolean }).open !== false,
      };
    }

    if (parsed.type === 'session-setup') {
      return {
        type: 'session-setup',
        previewZoom: normalizePreviewZoom((parsed as { previewZoom?: number }).previewZoom, 1),
        showCircle: Boolean((parsed as { showCircle?: boolean }).showCircle),
        circleSize: Number((parsed as { circleSize?: number }).circleSize) || 180,
      };
    }

    if (parsed.type === 'session-control') {
      return {
        type: 'session-control',
        allowInstruments: (parsed as { allowInstruments?: boolean }).allowInstruments !== false,
      };
    }

    if (parsed.type === 'session-leader') {
      return {
        type: 'session-leader',
        identity: normalizeText((parsed as { identity?: string }).identity),
      };
    }

    if (parsed.type === 'slide-state') {
      const slideState = normalizeSlideState(parsed as Partial<SlideState>);
      if (!slideState) return null;
      return {
        type: 'slide-state',
        ...slideState,
      };
    }

    if (parsed.type === 'chat') {
      const text = normalizeText((parsed as { text?: string }).text);
      const id = normalizeText((parsed as { id?: string }).id);
      if (!text || !id) return null;

      return {
        type: 'chat',
        id,
        identity: normalizeText((parsed as { identity?: string }).identity),
        name: normalizeText((parsed as { name?: string }).name) || 'Participant',
        role: normalizeRole((parsed as { role?: string }).role),
        sentAt: normalizeText((parsed as { sentAt?: string }).sentAt) || new Date().toISOString(),
        text,
      };
    }

    if (parsed.type === 'reaction') {
      const reaction = normalizeText((parsed as { reaction?: string }).reaction);
      const id = normalizeText((parsed as { id?: string }).id);
      if (!id || !isReactionKind(reaction)) return null;

      return {
        type: 'reaction',
        id,
        identity: normalizeText((parsed as { identity?: string }).identity),
        name: normalizeText((parsed as { name?: string }).name) || 'Participant',
        reaction,
        role: normalizeRole((parsed as { role?: string }).role),
        sentAt: normalizeText((parsed as { sentAt?: string }).sentAt) || new Date().toISOString(),
      };
    }

    if (parsed.type === 'mute-all') {
      return {
        type: 'mute-all',
      };
    }

    if (parsed.type === 'presentation-state-request') {
      return {
        type: 'presentation-state-request',
      };
    }

    if (parsed.type === 'presentation-media') {
      const provider = normalizeText((parsed as { provider?: string }).provider);
      const playbackState = normalizeText((parsed as { playbackState?: string }).playbackState);
      const embedId = normalizeText((parsed as { embedId?: string }).embedId);
      const mediaId = normalizeText((parsed as { mediaId?: string }).mediaId);

      if (
        !isPresentationMediaProvider(provider) ||
        !isExternalMediaPlaybackState(playbackState) ||
        !embedId ||
        !mediaId
      ) {
        return null;
      }

      return {
        type: 'presentation-media',
        capturedAt: Math.max(0, Number((parsed as { capturedAt?: number }).capturedAt) || Date.now()),
        currentTime: Math.max(0, Number((parsed as { currentTime?: number }).currentTime) || 0),
        embedId,
        mediaId,
        playbackState,
        provider,
        volume: Math.min(100, Math.max(0, Number((parsed as { volume?: number }).volume) ?? 100)),
        muted: Boolean((parsed as { muted?: boolean }).muted),
        force: Boolean((parsed as { force?: boolean }).force),
      };
    }

    if (parsed.type === 'external-media') {
      const action = normalizeText((parsed as { action?: string }).action);
      if (action === 'close') {
        return {
          action: 'close',
          type: 'external-media',
        };
      }

      const provider = normalizeText((parsed as { provider?: string }).provider);
      const playbackState = normalizeText((parsed as { playbackState?: string }).playbackState);
      const mediaId = normalizeText((parsed as { mediaId?: string }).mediaId);
      const sourceUrl = normalizeText((parsed as { sourceUrl?: string }).sourceUrl);

      if (
        (action !== 'open' && action !== 'sync') ||
        provider !== 'youtube' ||
        !isExternalMediaPlaybackState(playbackState) ||
        !mediaId ||
        !sourceUrl
      ) {
        return null;
      }

      return {
        action,
        capturedAt: Math.max(0, Number((parsed as { capturedAt?: number }).capturedAt) || Date.now()),
        currentTime: Math.max(0, Number((parsed as { currentTime?: number }).currentTime) || 0),
        mediaId,
        playbackState,
        provider: 'youtube',
        sourceUrl,
        title: normalizeText((parsed as { title?: string }).title) || 'YouTube',
        type: 'external-media',
      };
    }

    if (parsed.type === 'break-rooms') {
      return {
        type: 'break-rooms',
        rooms: Array.isArray((parsed as { rooms?: unknown }).rooms)
          ? (parsed as { rooms: { name: string; label: string }[] }).rooms
          : [],
        assignments: (parsed as { assignments?: Record<string, string> }).assignments ?? {},
        mode: normalizeText((parsed as { mode?: string }).mode),
      };
    }

    if (parsed.type === 'break-rooms-end') {
      return {
        type: 'break-rooms-end',
        countdown: Number((parsed as { countdown?: number }).countdown) || 60,
        mainRoom: normalizeText((parsed as { mainRoom?: string }).mainRoom),
      };
    }

    if (parsed.type === 'break-rooms-kill') {
      return {
        type: 'break-rooms-kill',
        mainRoom: normalizeText((parsed as { mainRoom?: string }).mainRoom),
      };
    }

    if (parsed.type === 'circle-move') {
      return {
        type: 'circle-move',
        x: Number((parsed as { x?: number }).x) || 0,
        y: Number((parsed as { y?: number }).y) || 0,
        identity: normalizeText((parsed as { identity?: string }).identity),
        zoom: (parsed as { zoom?: number }).zoom,
        size: (parsed as { size?: number }).size,
        show: (parsed as { show?: boolean }).show,
      };
    }

    if (parsed.type === 'presentation-zoom') {
      return {
        type: 'presentation-zoom',
        zoom: Number((parsed as { zoom?: number }).zoom) || 1,
      };
    }

    if (parsed.type === 'presentation-pointer') {
      const kind = normalizeText((parsed as { kind?: string }).kind);
      if (!isPresentationPointerKind(kind)) {
        return null;
      }

      return {
        type: 'presentation-pointer',
        active: Boolean((parsed as { active?: boolean }).active),
        kind,
        x: Math.min(1, Math.max(0, Number((parsed as { x?: number }).x) || 0)),
        y: Math.min(1, Math.max(0, Number((parsed as { y?: number }).y) || 0)),
      };
    }

    if (parsed.type === 'whiteboard-draw') {
      return {
        type: 'whiteboard-draw',
        x: Number((parsed as { x?: number }).x) || 0,
        y: Number((parsed as { y?: number }).y) || 0,
        action: (parsed as { action?: 'start' | 'draw' | 'end' }).action || 'draw',
        color: normalizeText((parsed as { color?: string }).color) || '#ffffff',
      };
    }

    if (parsed.type === 'whiteboard-clear') {
      return {
        type: 'whiteboard-clear',
      };
    }

    if (parsed.type === 'whiteboard-text') {
      return {
        type: 'whiteboard-text',
        x: Number((parsed as { x?: number }).x) || 0,
        y: Number((parsed as { y?: number }).y) || 0,
        text: normalizeText((parsed as { text?: string }).text),
        color: normalizeText((parsed as { color?: string }).color) || '#ffffff',
        size: (parsed as { size?: string }).size === 'lg' ? 'lg' : 'sm',
      };
    }

    if (parsed.type === 'whiteboard-bg') {
      const bg = (parsed as { bg?: string }).bg;
      return {
        type: 'whiteboard-bg',
        bg: bg === 'staff' || bg === 'grid' ? bg : 'none',
      };
    }

    if (parsed.type === 'lilypond-live') {
      const anchor = Number((parsed as { anchor?: number }).anchor);
      const head = Number((parsed as { head?: number }).head);
      return {
        type: 'lilypond-live',
        anchor: Number.isFinite(anchor) ? Math.max(0, Math.round(anchor)) : 0,
        head: Number.isFinite(head) ? Math.max(0, Math.round(head)) : 0,
        body: typeof (parsed as { body?: string }).body === 'string'
          ? (parsed as { body: string }).body
          : undefined,
      };
    }

    if (parsed.type === 'lilypond-render') {
      const body = typeof (parsed as { body?: string }).body === 'string'
        ? (parsed as { body: string }).body
        : '';
      const url = typeof (parsed as { url?: string }).url === 'string'
        ? (parsed as { url: string }).url
        : undefined;
      const midiUrl = typeof (parsed as { midiUrl?: string }).midiUrl === 'string'
        ? (parsed as { midiUrl: string }).midiUrl
        : undefined;
      const pdfUrl = typeof (parsed as { pdfUrl?: string }).pdfUrl === 'string'
        ? (parsed as { pdfUrl: string }).pdfUrl
        : undefined;

      return {
        type: 'lilypond-render',
        body,
        url,
        midiUrl,
        pdfUrl,
      };
    }

    if (parsed.type === 'lilypond-play') {
      const action = (parsed as { action: string }).action;
      return {
        type: 'lilypond-play',
        action: action === 'start' ? 'start' : 'stop',
        url: (parsed as { url?: string }).url,
      };
    }

    if (parsed.type === 'hyperpiano') {
      const action = (parsed as { action: string }).action;
      return {
        type: 'hyperpiano',
        note: Number((parsed as { note: number }).note) || 0,
        velocity: Number((parsed as { velocity: number }).velocity) || 0,
        action: action === 'on' ? 'on' : 'off',
      };
    }

    if (parsed.type === 'lilypond-setup') {
      return {
        type: 'lilypond-setup',
        allowStudents: Boolean((parsed as { allowStudents?: boolean }).allowStudents),
      };
    }

    if (parsed.type === 'session-workspace') {
      return {
        type: 'session-workspace',
        layout: (parsed as { layout: any }).layout,
      };
    }

    if (parsed.type === 'concept-load') {
      return {
        type: 'concept-load',
        href: typeof (parsed as { href?: string | null }).href === 'string'
          ? (parsed as { href: string }).href
          : null,
      };
    }

    if (parsed.type === 'layout-split') {
      return {
        type: 'layout-split',
        left: normalizeLayoutMode((parsed as { left?: string }).left),
        right: normalizeLayoutMode((parsed as { right?: string }).right),
      };
    }

    if (parsed.type === 'layout-overlay') {
      const overlay = (parsed as { overlay?: string | null }).overlay;
      return {
        type: 'layout-overlay',
        overlay: overlay ? normalizeLayoutMode(overlay) : null,
      };
    }

    if (parsed.type === 'sa-file-sync') {
      const url = normalizeText((parsed as { url?: string }).url);
      if (!url) return null;
      return {
        type: 'sa-file-sync',
        url,
        fileName: normalizeText((parsed as { fileName?: string }).fileName) || 'audio',
        senderName: normalizeText((parsed as { senderName?: string }).senderName) || 'Participant',
        key: normalizeText((parsed as { key?: string }).key) || '',
        scale: normalizeText((parsed as { scale?: string }).scale) || '',
        bpm: Math.max(0, Number((parsed as { bpm?: number }).bpm) || 0),
      };
    }

    if (parsed.type === 'sa-state') {
      return {
        type: 'sa-state',
        active: Boolean((parsed as { active?: boolean }).active),
      };
    }

    if (parsed.type === 'sv-playback') {
      const action = normalizeText((parsed as { action?: string }).action);
      if (action !== 'play' && action !== 'pause' && action !== 'seek') return null;
      return {
        type: 'sv-playback',
        action,
        offset: Math.max(0, Number((parsed as { offset?: number }).offset) || 0),
      };
    }

    if (parsed.type === 'sv-vtab') {
      return {
        type: 'sv-vtab',
        tab: normalizeText((parsed as { tab?: string }).tab) || 'mel',
      };
    }

    if (parsed.type === 'sv-layer') {
      return {
        type:    'sv-layer',
        layer:   normalizeText((parsed as { layer?: string }).layer) || '',
        visible: Boolean((parsed as { visible?: boolean }).visible),
      };
    }

    if (parsed.type === 'sv-loop') {
      return {
        type:     'sv-loop',
        inPoint:  Math.max(0, Number((parsed as { inPoint?: number }).inPoint)  || 0),
        outPoint: Math.max(0, Number((parsed as { outPoint?: number }).outPoint) || 0),
        enabled:  Boolean((parsed as { enabled?: boolean }).enabled),
      };
    }

    if (parsed.type === 'vs-state') {
      const url = normalizeText((parsed as { url?: string | null }).url);
      const rawKind = normalizeText((parsed as { kind?: string | null }).kind);
      const rawZoomMode = normalizeText((parsed as { zoomMode?: string }).zoomMode);
      const zoomMode =
        rawZoomMode === 'width' || rawZoomMode === 'actual' || rawZoomMode === 'custom'
          ? rawZoomMode
          : 'fit';
      return {
        type: 'vs-state',
        url: url || null,
        name: normalizeText((parsed as { name?: string }).name) || 'document',
        kind: rawKind === 'pdf' || rawKind === 'img' ? rawKind : null,
        page: Math.max(1, Math.round(Number((parsed as { page?: number }).page) || 1)),
        zoomMode,
        zoom: Math.min(400, Math.max(25, Math.round(Number((parsed as { zoom?: number }).zoom) || 100))),
      };
    }

    if (parsed.type === 'recursos:sync') {
      return {
        type: 'recursos:sync',
        items: Array.isArray((parsed as any).items) ? (parsed as any).items : [],
        allowStudents: Boolean((parsed as any).allowStudents),
      };
    }

    if (parsed.type === 'recursos:allow-students') {
      return {
        type: 'recursos:allow-students',
        allow: Boolean((parsed as any).allow),
      };
    }

    return null;
  } catch {
    return null;
  }
};
