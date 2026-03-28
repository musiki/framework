import { normalizeText } from '../core/normalize';
import type { ConferenceMessage, ParticipantRole } from '../session';

type ChatMessage = Extract<ConferenceMessage, { type: 'chat' }>;

type CreateRoomChatControllerOptions = {
  chatDownloadButton: HTMLButtonElement;
  chatFocusButton?: HTMLButtonElement | null;
  chatInput: HTMLInputElement | HTMLTextAreaElement;
  chatList: HTMLElement;
  chatSection?: Element | null;
  chatSendButton: HTMLButtonElement;
  chatUnreadDot?: HTMLElement | null;
  ensureSidebarOpen: () => void;
  formatError: (error: unknown) => string;
  getIdentity: () => string;
  getName: () => string;
  getRole: () => ParticipantRole;
  getRoomName: () => string;
  isConnected: () => boolean;
  publishMessage: (message: ChatMessage) => Promise<void>;
  reportStatus: (message: string) => void;
};

export type RoomChatController = {
  appendMessage: (message: ChatMessage, isSent?: boolean) => void;
  bind: () => void;
  downloadTranscript: () => void;
  focusComposer: () => void;
  resetUnread: () => void;
  sendMessage: () => Promise<void>;
  syncControlState: () => void;
};

const getFirstName = (value: string) =>
  normalizeText(value).split(/\s+/).filter(Boolean)[0] || normalizeText(value);

const DIRECT_IMAGE_URL_REGEX = /\.(png|jpe?g|gif|webp|svg|avif)(?:$|[?#])/i;
const DIRECT_AUDIO_URL_REGEX = /\.(mp3|wav|ogg|m4a|aac|flac)(?:$|[?#])/i;
const DIRECT_VIDEO_URL_REGEX = /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i;
const KNOWN_IMAGE_HOST_REGEX =
  /(imagedelivery\.net|cdn\.shopify\.com|images\.unsplash\.com|res\.cloudinary\.com)/i;
const URL_TOKEN_REGEX = /(https?:\/\/[^\s<]+)/gi;
const CHAT_EMOTICON_REGEX = /:\)|:\(|:>/g;
const CHAT_EMOTICON_MAP: Record<string, { glyph: string; label: string }> = {
  ':)': { glyph: '☺︎', label: 'sonrisa' },
  ':(': { glyph: '☹︎', label: 'triste' },
  ':>': { glyph: '☻', label: 'sonrisa lateral' },
};
const CHAT_COLORS = [
  '#00f5ff',
  '#39ff14',
  '#ff6ec7',
  '#ff9d00',
  '#ffe600',
  '#c264ff',
  '#4da8ff',
  '#ff4f4f',
  '#ccff00',
  '#00ffcc',
  '#ee00cc',
  '#ffb300',
] as const;

const isLikelyImageUrl = (value: string) =>
  DIRECT_IMAGE_URL_REGEX.test(value) || KNOWN_IMAGE_HOST_REGEX.test(value);
const isLikelyAudioUrl = (value: string) => DIRECT_AUDIO_URL_REGEX.test(value);
const isLikelyVideoUrl = (value: string) => DIRECT_VIDEO_URL_REGEX.test(value);

const chatUserColor = (identity: string): string => {
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = (hash * 31 + identity.charCodeAt(index)) >>> 0;
  }
  return CHAT_COLORS[hash % CHAT_COLORS.length];
};

const appendConferenceTextNode = (container: HTMLElement, text: string) => {
  if (!text) return;
  let lastIndex = 0;

  text.replace(CHAT_EMOTICON_REGEX, (match, offset) => {
    const chunk = text.slice(lastIndex, offset);
    if (chunk) {
      container.appendChild(document.createTextNode(chunk));
    }

    const emojiConfig = CHAT_EMOTICON_MAP[match];
    if (emojiConfig) {
      const emoji = document.createElement('span');
      emoji.className = 'conference-chat-emoji';
      emoji.textContent = emojiConfig.glyph;
      emoji.title = emojiConfig.label;
      emoji.setAttribute('aria-label', emojiConfig.label);
      container.appendChild(emoji);
    } else {
      container.appendChild(document.createTextNode(match));
    }

    lastIndex = offset + match.length;
    return match;
  });

  const trailing = text.slice(lastIndex);
  if (trailing) {
    container.appendChild(document.createTextNode(trailing));
  }
};

const appendConferenceUrlNode = (container: HTMLElement, rawUrl: string) => {
  const href = normalizeText(rawUrl);
  if (!href) return;

  if (isLikelyImageUrl(href)) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer noopener';
    anchor.className = 'conference-chat-link conference-chat-link--media';

    const image = document.createElement('img');
    image.src = href;
    image.alt = 'Media compartido en el chat';
    image.loading = 'lazy';
    anchor.appendChild(image);
    container.appendChild(anchor);
    return;
  }

  if (isLikelyVideoUrl(href)) {
    const video = document.createElement('video');
    video.className = 'conference-chat-media conference-chat-media--video';
    video.src = href;
    video.controls = true;
    video.preload = 'metadata';
    container.appendChild(video);
    return;
  }

  if (isLikelyAudioUrl(href)) {
    const audio = document.createElement('audio');
    audio.className = 'conference-chat-media conference-chat-media--audio';
    audio.src = href;
    audio.controls = true;
    audio.preload = 'metadata';
    container.appendChild(audio);
    return;
  }

  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.target = '_blank';
  anchor.rel = 'noreferrer noopener';
  anchor.className = 'conference-chat-link';
  anchor.textContent = href;
  container.appendChild(anchor);
};

const setConferenceChatBody = (container: HTMLElement, text: string) => {
  container.replaceChildren();
  const normalizedBody = String(text || '');
  const lines = normalizedBody.split(/\n/g);

  lines.forEach((line, lineIndex) => {
    const lineWrapper = document.createElement('div');
    lineWrapper.className = 'conference-chat-line';
    let lastIndex = 0;
    let hasContent = false;

    line.replace(URL_TOKEN_REGEX, (match, _capture, offset) => {
      appendConferenceTextNode(lineWrapper, line.slice(lastIndex, offset));
      appendConferenceUrlNode(lineWrapper, match);
      lastIndex = offset + match.length;
      hasContent = true;
      return match;
    });

    appendConferenceTextNode(lineWrapper, line.slice(lastIndex));
    hasContent = hasContent || lineWrapper.childNodes.length > 0;

    if (!hasContent) {
      lineWrapper.appendChild(document.createElement('br'));
    }

    container.appendChild(lineWrapper);
    if (lineIndex < lines.length - 1 && !hasContent) {
      container.appendChild(document.createElement('br'));
    }
  });
};

export const createRoomChatController = ({
  chatDownloadButton,
  chatFocusButton,
  chatInput,
  chatList,
  chatSection,
  chatSendButton,
  chatUnreadDot,
  ensureSidebarOpen,
  formatError,
  getIdentity,
  getName,
  getRole,
  getRoomName,
  isConnected,
  publishMessage,
  reportStatus,
}: CreateRoomChatControllerOptions): RoomChatController => {
  const chatMessages: ChatMessage[] = [];
  let chatAttentionFlashTimer = 0;
  let chatUnreadCount = 0;

  const syncUnreadDot = () => {
    if (!(chatUnreadDot instanceof HTMLElement)) return;
    if (chatUnreadCount <= 0) {
      chatUnreadDot.hidden = true;
      chatUnreadDot.textContent = '';
      return;
    }

    chatUnreadDot.hidden = false;
    chatUnreadDot.textContent = chatUnreadCount > 9 ? '9+' : String(chatUnreadCount);
  };

  const renderChat = () => {
    chatList.innerHTML = '';
    chatDownloadButton.disabled = chatMessages.length === 0;

    if (chatMessages.length === 0) return;

    chatMessages.slice(-60).forEach((message) => {
      const item = document.createElement('li');
      item.className = 'conference-chat-item';

      const header = document.createElement('div');
      header.className = 'conference-chat-header';

      const sender = document.createElement('span');
      sender.className = 'conference-chat-author';
      sender.textContent = getFirstName(message.name);
      sender.style.color = chatUserColor(message.identity);

      const separator = document.createElement('span');
      separator.className = 'conference-chat-header-separator';
      separator.textContent = '·';

      const sentAt = document.createElement('time');
      sentAt.className = 'conference-chat-stamp';
      sentAt.dateTime = message.sentAt;
      sentAt.textContent = new Date(message.sentAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      const body = document.createElement('div');
      body.className = 'conference-chat-text';
      setConferenceChatBody(body, message.text);

      header.append(sender, separator, sentAt);
      item.append(header, body);
      chatList.appendChild(item);
    });

    chatList.scrollTop = chatList.scrollHeight;
  };

  const resetUnread = () => {
    chatUnreadCount = 0;
    syncUnreadDot();
  };

  const focusComposer = () => {
    ensureSidebarOpen();
    if (chatSection instanceof HTMLDetailsElement) {
      chatSection.open = true;
    }
    if (chatSection instanceof HTMLElement) {
      if (chatAttentionFlashTimer) {
        window.clearTimeout(chatAttentionFlashTimer);
        chatAttentionFlashTimer = 0;
      }
      chatSection.classList.remove('is-attention-flash');
      void chatSection.offsetWidth;
      chatSection.classList.add('is-attention-flash');
      chatAttentionFlashTimer = window.setTimeout(() => {
        chatSection.classList.remove('is-attention-flash');
        chatAttentionFlashTimer = 0;
      }, 90);
    }
    resetUnread();
    window.requestAnimationFrame(() => {
      chatInput.focus();
      chatInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const appendMessage = (message: ChatMessage, isSent = false) => {
    if (chatMessages.some((entry) => entry.id === message.id)) return;
    chatMessages.push(message);
    if (chatMessages.length > 80) {
      chatMessages.splice(0, chatMessages.length - 80);
    }
    if (!isSent) {
      chatUnreadCount += 1;
      syncUnreadDot();
    }
    renderChat();
  };

  const downloadTranscript = () => {
    if (chatMessages.length === 0) return;

    const roomName = normalizeText(getRoomName()) || 'room';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const lines = chatMessages.map((message) => {
      const timeLabel = new Date(message.sentAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      return `${message.name} ${timeLabel}\n${message.text}\n`;
    });

    const blob = new Blob([lines.join('\n')], {
      type: 'text/plain;charset=utf-8',
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${roomName}-chat-${stamp}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(href);
    }, 1000);
  };

  const syncControlState = () => {
    const connected = isConnected();
    chatInput.disabled = !connected;
    chatSendButton.disabled = !connected;
    chatDownloadButton.disabled = chatMessages.length === 0;
  };

  const sendMessage = async () => {
    if (!isConnected()) return;

    const text = normalizeText(chatInput.value);
    if (!text) return;

    const identity = normalizeText(getIdentity());
    const message: ChatMessage = {
      type: 'chat',
      id: `chat-${crypto.randomUUID()}`,
      identity,
      name: normalizeText(getName()) || identity || 'Participant',
      role: getRole(),
      sentAt: new Date().toISOString(),
      text,
    };

    appendMessage(message, true);
    chatInput.value = '';
    syncControlState();

    try {
      await publishMessage(message);
    } catch (error) {
      reportStatus(formatError(error));
    }
  };

  const bind = () => {
    if (chatFocusButton instanceof HTMLButtonElement) {
      chatFocusButton.addEventListener('click', () => {
        focusComposer();
      });
    }

    chatInput.addEventListener('focus', () => {
      resetUnread();
    });

    chatSendButton.addEventListener('click', () => {
      void sendMessage();
    });

    chatDownloadButton.addEventListener('click', () => {
      downloadTranscript();
    });

    chatInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      void sendMessage();
    });
  };

  syncControlState();

  return {
    appendMessage,
    bind,
    downloadTranscript,
    focusComposer,
    resetUnread,
    sendMessage,
    syncControlState,
  };
};
