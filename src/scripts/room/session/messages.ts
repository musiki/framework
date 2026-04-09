import { normalizeLayoutMode, type LayoutMode } from '../../layout-controller';
import { normalizePreviewZoom, normalizeText } from '../core/normalize';

export type ParticipantRole = 'teacher' | 'student';
export type ReactionKind = 'clap' | 'heart' | 'joy' | 'tada' | 'thumbsup' | 'wow';

export type SlideState = {
  indexf: number;
  indexh: number;
  indexv: number;
  zoom: number;
};

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
};

export type ConferenceMessage =
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
      type: 'circle-move';
      x: number;
      y: number;
      identity: string;
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
      currentTime: number;
      mediaId: string;
      playbackState: ExternalMediaPlaybackState;
      provider: ExternalMediaProvider;
      sourceUrl: string;
      title: string;
      type: 'external-media';
    };

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

export const normalizeRole = (value: unknown): ParticipantRole =>
  isTeacherRole(normalizeText(value).toLowerCase()) ? 'teacher' : 'student';

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
  };
};

const isReactionKind = (value: string): value is ReactionKind => value in REACTION_EMOJIS;
const isExternalMediaPlaybackState = (value: string): value is ExternalMediaPlaybackState =>
  value === 'playing' || value === 'paused' || value === 'ended';
const isPresentationMediaProvider = (value: string): value is PresentationMediaProvider => value === 'youtube';

export const parseConferenceMessage = (payload: Uint8Array): ConferenceMessage | null => {
  try {
    const parsed = JSON.parse(textDecoder.decode(payload));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
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
      };
    }

    if (parsed.type === 'presentation-zoom') {
      return {
        type: 'presentation-zoom',
        zoom: Number((parsed as { zoom?: number }).zoom) || 1,
      };
    }

    return null;
  } catch {
    return null;
  }
};
