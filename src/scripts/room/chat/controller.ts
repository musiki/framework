import { normalizeText } from '../core/normalize';
import type { ConferenceMessage, ParticipantRole } from '../session';

type ChatMessage = Extract<ConferenceMessage, { type: 'chat' }>;

type CreateRoomChatControllerOptions = {
  chatDownloadButton: HTMLButtonElement;
  chatFocusButton?: HTMLButtonElement | null;
  chatInput: HTMLInputElement | HTMLTextAreaElement;
  chatList: HTMLElement;
  chatScroller?: HTMLElement | null;
  chatSection?: Element | null;
  chatSendButton: HTMLButtonElement;
  chatStatus?: HTMLElement | null;
  chatUnreadDot?: HTMLElement | null;
  ensureSidebarOpen: () => void;
  formatError: (error: unknown) => string;
  getIdentity: () => string;
  getName: () => string;
  getRole: () => ParticipantRole;
  getRoomName: () => string;
  isConnected: () => boolean;
  onOrfMention?: (text: string) => Promise<void>;
  onOrfAction?: (action: any) => Promise<void>;
  publishMessage: (message: ChatMessage) => Promise<void>;
  reportStatus: (message: string) => void;
};

export type RoomChatController = {
  appendMessage: (message: ChatMessage, isSent?: boolean) => void;
  bind: () => void;
  bindElements: (elements: Partial<Pick<
    CreateRoomChatControllerOptions,
    'chatDownloadButton' | 'chatFocusButton' | 'chatInput' | 'chatList' | 'chatScroller' | 'chatSection' | 'chatSendButton' | 'chatStatus' | 'chatUnreadDot'
  >>) => void;
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

const setConferenceChatBody = (container: HTMLElement, text: string, onAction?: (a: any) => void) => {
  container.replaceChildren();
  const normalizedBody = String(text || '').trim();

  // 1. Try to parse as Orf JSON response
  if (normalizedBody.startsWith('{') && normalizedBody.endsWith('}')) {
    try {
      // Loose parse for triple quotes or common model errors
      const cleaned = normalizedBody.replace(/"""/g, '"');
      const parsed = JSON.parse(cleaned);
      if (parsed.message) {
        const msgEl = document.createElement('div');
        msgEl.className = 'conference-chat-text-inner';
        setConferenceChatBody(msgEl, parsed.message);
        container.appendChild(msgEl);

        if (Array.isArray(parsed.actions) && parsed.actions.length > 0 && onAction) {
          const toolbar = document.createElement('div');
          toolbar.className = 'musiki-chat-actions-toolbar';
          parsed.actions.forEach((action: any) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'musiki-chat-action-btn';
            btn.textContent = action.label || action.kind.replace(/_/g, ' ').toUpperCase();
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onAction(action);
            });
            toolbar.appendChild(btn);
          });
          container.appendChild(toolbar);
        }
        return;
      }
    } catch (e) {
      // Not valid JSON or failed to parse, continue to normal rendering
    }
  }

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
  chatScroller,
  chatSection,
  chatSendButton,
  chatStatus,
  chatUnreadDot,
  ensureSidebarOpen,
  formatError,
  getIdentity,
  getName,
  getRole,
  getRoomName,
  isConnected,
  onOrfMention,
  publishMessage,
  reportStatus,
}: CreateRoomChatControllerOptions): RoomChatController => {
  const chatMessages: ChatMessage[] = [];
  let chatAttentionFlashTimer = 0;
  let chatUnreadCount = 0;
  let currentChatDownloadButton = chatDownloadButton;
  let currentChatFocusButton = chatFocusButton;
  let currentChatInput = chatInput;
  let currentChatList = chatList;
  let currentChatScroller = chatScroller;
  let currentChatSection = chatSection;
  let currentChatSendButton = chatSendButton;
  let currentChatStatus = chatStatus;
  let currentChatUnreadDot = chatUnreadDot;
  const boundInputs = new WeakSet<HTMLInputElement | HTMLTextAreaElement>();
  const boundButtons = new WeakSet<HTMLButtonElement>();

  const syncUnreadDot = () => {
    if (!(currentChatUnreadDot instanceof HTMLElement)) return;
    if (chatUnreadCount <= 0) {
      currentChatUnreadDot.hidden = true;
      currentChatUnreadDot.textContent = '';
      return;
    }

    currentChatUnreadDot.hidden = false;
    currentChatUnreadDot.textContent = chatUnreadCount > 9 ? '9+' : String(chatUnreadCount);
  };

  const scrollToEnd = () => {
    // Use a small timeout to ensure DOM is settled for scroll calculation
    window.setTimeout(() => {
        const lastItem = currentChatList.lastElementChild;
        if (lastItem instanceof HTMLElement) {
          lastItem.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
          const scroller = currentChatScroller instanceof HTMLElement ? currentChatScroller : currentChatList;
          scroller.scrollTop = scroller.scrollHeight;
        }
    }, 100);
  };

  const renderChat = () => {
    currentChatList.innerHTML = '';
    currentChatDownloadButton.disabled = chatMessages.length === 0;

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

      header.append(sender, separator, sentAt);

      const body = document.createElement('div');
      body.className = 'conference-chat-text';
      setConferenceChatBody(body, message.text, onOrfAction);

      item.append(header, body);


      currentChatList.appendChild(item);
    });

    scrollToEnd();
  };

  const resetUnread = () => {
    chatUnreadCount = 0;
    syncUnreadDot();
  };

  const focusComposer = () => {
    ensureSidebarOpen();
    if (currentChatSection instanceof HTMLDetailsElement) {
      currentChatSection.open = true;
    }
    if (currentChatSection instanceof HTMLElement) {
      if (chatAttentionFlashTimer) {
        window.clearTimeout(chatAttentionFlashTimer);
        chatAttentionFlashTimer = 0;
      }
      currentChatSection.classList.remove('is-attention-flash');
      void currentChatSection.offsetWidth;
      currentChatSection.classList.add('is-attention-flash');
      chatAttentionFlashTimer = window.setTimeout(() => {
        currentChatSection instanceof HTMLElement && currentChatSection.classList.remove('is-attention-flash');
        chatAttentionFlashTimer = 0;
      }, 90);
    }
    resetUnread();
    window.requestAnimationFrame(() => {
      currentChatInput.focus();
      currentChatInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    currentChatInput.disabled = !connected;
    currentChatSendButton.disabled = !connected;
    currentChatDownloadButton.disabled = chatMessages.length === 0;
  };

  const sendMessage = async () => {
    if (!isConnected()) return;

    const text = normalizeText(currentChatInput.value);
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
    currentChatInput.value = '';

    if (text.toLowerCase().startsWith('@orf') && onOrfMention) {
      const prompt = text.slice(4).trim();
      if (prompt) {
        if (currentChatStatus) {
          currentChatStatus.textContent = 'Orf está pensando...';
          currentChatStatus.hidden = false;
          scrollToEnd();
        }
        void onOrfMention(prompt).finally(() => {
          if (currentChatStatus) {
            currentChatStatus.hidden = true;
            currentChatStatus.textContent = '';
          }
        });
      }
    }
    
    // Force clear and resize in next tick
    window.requestAnimationFrame(() => {
        currentChatInput.value = '';
        currentChatInput.dispatchEvent(new Event('input'));
    });
    
    syncControlState();

    try {
      await publishMessage(message);
    } catch (error) {
      reportStatus(formatError(error));
    }
  };

  const bind = () => {
    if (currentChatFocusButton instanceof HTMLButtonElement && !boundButtons.has(currentChatFocusButton)) {
      boundButtons.add(currentChatFocusButton);
      currentChatFocusButton.addEventListener('click', () => {
        focusComposer();
      });
    }

    if (!boundInputs.has(currentChatInput)) {
      boundInputs.add(currentChatInput);
      currentChatInput.addEventListener('focus', () => {
        resetUnread();
      });

      currentChatInput.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent)) return;
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        void sendMessage();
      });
    }

    if (!boundButtons.has(currentChatSendButton)) {
      boundButtons.add(currentChatSendButton);
      currentChatSendButton.addEventListener('click', () => {
        void sendMessage();
      });
    }

    if (!boundButtons.has(currentChatDownloadButton)) {
      boundButtons.add(currentChatDownloadButton);
      currentChatDownloadButton.addEventListener('click', () => {
        downloadTranscript();
      });
    }
  };

  const bindElements: RoomChatController['bindElements'] = (elements) => {
    if (elements.chatDownloadButton instanceof HTMLButtonElement) currentChatDownloadButton = elements.chatDownloadButton;
    if (elements.chatFocusButton instanceof HTMLButtonElement) currentChatFocusButton = elements.chatFocusButton;
    if (
      elements.chatInput instanceof HTMLInputElement ||
      elements.chatInput instanceof HTMLTextAreaElement
    ) {
      currentChatInput = elements.chatInput;
    }
    if (elements.chatList instanceof HTMLElement) currentChatList = elements.chatList;
    if (elements.chatScroller instanceof HTMLElement) currentChatScroller = elements.chatScroller;
    if (elements.chatSection instanceof Element) currentChatSection = elements.chatSection;
    if (elements.chatSendButton instanceof HTMLButtonElement) currentChatSendButton = elements.chatSendButton;
    if (elements.chatStatus instanceof HTMLElement) currentChatStatus = elements.chatStatus;
    if (elements.chatUnreadDot instanceof HTMLElement) currentChatUnreadDot = elements.chatUnreadDot;
    bind();
    renderChat();
    syncUnreadDot();
    syncControlState();
  };

  syncControlState();

  return {
    appendMessage,
    bind,
    bindElements,
    downloadTranscript,
    focusComposer,
    resetUnread,
    sendMessage,
    syncControlState,
  };
};
