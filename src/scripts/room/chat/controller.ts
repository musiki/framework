import { normalizeText } from '../core/normalize';
import type { ConferenceMessage, ParticipantRole } from '../session';
import { participantAppearanceStore } from '../participants/appearance';

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
  getParticipants: () => Array<{ identity: string; name: string; role: string }>;
  onOrfMention?: (text: string) => Promise<void>;
  onOrfAction?: (action: any) => Promise<void>;
  publishMessage: (message: ChatMessage, destinationIdentities?: string[]) => Promise<void>;
  reportStatus: (message: string) => void;
};

export type RoomChatController = {
  appendMessage: (message: ChatMessage, isSent?: boolean) => void;
  handleReaction: (reaction: { messageId: string; emoji: string; name: string; identity: string }) => void;
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
  updateParticipantsList: () => void;
  dispose: () => void;
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
const isLikelyImageUrl = (value: string) =>
  DIRECT_IMAGE_URL_REGEX.test(value) || KNOWN_IMAGE_HOST_REGEX.test(value);
const isLikelyAudioUrl = (value: string) => DIRECT_AUDIO_URL_REGEX.test(value);
const isLikelyVideoUrl = (value: string) => DIRECT_VIDEO_URL_REGEX.test(value);

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

/**
 * Attempt to repair common AI-generated JSON errors:
 * 1. Unescaped backticks (```) or markdown blocks inside values.
 * 2. Structural errors like "], { ... } ] }" (misplaced array closers).
 * 3. Loose commas and trailing punctuation.
 */
const salvageHallucinatedJson = (raw: string): any => {
  let text = raw.trim();
  
  // 1. Strip markdown wrappers if the model put the whole JSON in a block
  text = text.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();

  // 2. Handle unescaped backticks inside JSON (very common in Llama)
  // We iteratively find "content": ``` ... ``` pattern even if it has text in between
  // This version is more aggressive: it tries to capture everything between the first ``` and the LAST ``` 
  // following a key like "content" or "source".
  text = text.replace(/"(content|source|markdown)":\s*```([a-z]*)\n?([\s\S]*?)```(?=[,\s\}])/gi, (_, key, lang, code) => {
    return `"${key}": ${JSON.stringify(code.trim())}`;
  });

  // 3. Fix misplaced array closers in "actions" (like "], { ... } ] }")
  if (text.includes('"actions"')) {
    // Replace "], {" with ", {" to merge split action objects
    text = text.replace(/\],(\s*)\{/g, ',$1{');
    // Replace "} ] }" with "} ]" if it looks like a double-close mistake
    // This is safe if it's at the very end of the string
    text = text.replace(/\}\s*\]\s*\}\s*\]/g, '} ]');
    text = text.replace(/\}\s*\]\s*\}\s*$/g, '} ] }');
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    // Last ditch: try to fix escaping issues by stringifying potential problematic areas
    try {
      const semiCleaned = text.replace(/"""/g, '"').replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
      return JSON.parse(semiCleaned);
    } catch (e2) {
      // Regex extraction fallback: just get the message if nothing else works
      const msgMatch = text.match(/"message":\s*"([\s\S]*?)"(?=[,\s\}])/);
      if (msgMatch) {
        return { message: msgMatch[1], actions: [] };
      }
      return null;
    }
  }
};

const setConferenceChatBody = (container: HTMLElement, text: string, _onAction?: (a: any) => void) => {
  container.replaceChildren();
  const normalizedBody = (typeof text === 'object' ? JSON.stringify(text) : String(text || '').replace(/\[object Object\]/g, '')).trim();

  // 1. Try to parse as Orf JSON response
  // We use a more robust check: does it contain a JSON object with "message"?
  const jsonMatch = normalizedBody.match(/\{[\s\S]*"(summary|message)"[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = salvageHallucinatedJson(jsonMatch[0]);
    if (parsed && (parsed.summary || parsed.message)) {
      const msgEl = document.createElement('div');
      msgEl.className = 'conference-chat-text-inner';
      setConferenceChatBody(msgEl, parsed.summary || parsed.message);
      container.appendChild(msgEl);
      return;
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
  onOrfAction,
  publishMessage,
  reportStatus,
}: CreateRoomChatControllerOptions): RoomChatController => {
  const chatMessages: ChatMessage[] = [];
  let chatAttentionFlashTimer = 0;
  let chatUnreadCount = 0;
  let activeReplyTarget: ChatMessage | null = null;

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
  const boundDropZones = new WeakSet<HTMLElement>();
  let unsubscribeAppearance: (() => void) | null = null;

  const setReplyTarget = (message: ChatMessage) => {
    activeReplyTarget = message;
    const preview = document.querySelector('[data-chat-reply-preview]') as HTMLElement | null;
    const authorEl = document.querySelector('[data-chat-reply-preview-author]') as HTMLElement | null;
    const textEl = document.querySelector('[data-chat-reply-preview-text]') as HTMLElement | null;
    if (preview && authorEl && textEl) {
      authorEl.textContent = getFirstName(message.name);
      textEl.textContent = message.text;
      preview.hidden = false;
    }
    currentChatInput.focus();
  };

  const cancelReply = () => {
    activeReplyTarget = null;
    const preview = document.querySelector('[data-chat-reply-preview]') as HTMLElement | null;
    if (preview) {
      preview.hidden = true;
    }
  };

  let mentionQuery = '';
  let mentionStartIndex = -1;
  let suggestionIndex = 0;
  let activeSuggestions: Array<{ identity: string; name: string; role: string }> = [];

  const updateMentionSuggestions = () => {
    const container = document.querySelector('[data-chat-mention-suggestions]') as HTMLElement | null;
    if (!container) return;

    const list = container.querySelector('.mention-suggestions-list');
    if (!list) return;

    list.innerHTML = '';

    if (activeSuggestions.length === 0) {
      container.hidden = true;
      return;
    }

    activeSuggestions.forEach((s, idx) => {
      const li = document.createElement('li');
      li.className = 'mention-suggestion-item';
      li.dataset.selected = idx === suggestionIndex ? 'true' : 'false';
      li.innerHTML = `
        <span>@${s.name}</span>
        <span class="mention-suggestion-role">${s.role}</span>
      `;
      li.addEventListener('click', () => {
        insertMention(s.name);
      });
      list.appendChild(li);
    });

    container.hidden = false;
  };

  const insertMention = (name: string) => {
    const val = currentChatInput.value;
    const before = val.slice(0, mentionStartIndex);
    const after = val.slice(currentChatInput.selectionEnd);
    currentChatInput.value = before + `@${name} ` + after;
    currentChatInput.focus();

    const newPos = mentionStartIndex + name.length + 2;
    currentChatInput.setSelectionRange(newPos, newPos);

    closeMentions();
  };

  const closeMentions = () => {
    activeSuggestions = [];
    mentionStartIndex = -1;
    mentionQuery = '';
    const container = document.querySelector('[data-chat-mention-suggestions]') as HTMLElement | null;
    if (container) container.hidden = true;
  };

  const updateParticipantsList = () => {
    const select = document.querySelector('[data-chat-recipient-select]') as HTMLSelectElement | null;
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="all">Público (Todos)</option>';

    const participants = getParticipants();
    participants.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.identity;
      opt.textContent = `Privado: ${getFirstName(p.name)}`;
      select.appendChild(opt);
    });

    if (participants.some((p) => p.identity === currentValue)) {
      select.value = currentValue;
    } else {
      select.value = 'all';
    }
  };

  const playMentionSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.08);
      
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {
      console.warn("Mention sound play failed:", e);
    }
  };

  const handleReaction = (reaction: { messageId: string; emoji: string; name: string; identity: string }) => {
    const msg = chatMessages.find(m => m.id === reaction.messageId);
    if (!msg) return;

    if (!msg.reactions) {
      msg.reactions = {};
    }
    if (!msg.reactions[reaction.emoji]) {
      msg.reactions[reaction.emoji] = [];
    }

    const index = msg.reactions[reaction.emoji].indexOf(reaction.name);
    if (index > -1) {
      msg.reactions[reaction.emoji].splice(index, 1);
      if (msg.reactions[reaction.emoji].length === 0) {
        delete msg.reactions[reaction.emoji];
      }
    } else {
      msg.reactions[reaction.emoji].push(reaction.name);
    }

    renderChat();
  };

  const showReactionTooltip = (anchor: HTMLElement, messageId: string) => {
    const existing = document.getElementById('chat-reaction-tooltip');
    if (existing) existing.remove();

    const tooltip = document.createElement('div');
    tooltip.id = 'chat-reaction-tooltip';
    Object.assign(tooltip.style, {
      position: 'fixed',
      zIndex: '999999',
      background: 'rgba(15, 15, 20, 0.95)',
      backdropFilter: 'blur(12px)',
      webkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '20px',
      padding: '4px 8px',
      boxShadow: '0 5px 15px rgba(0,0,0,0.5)',
      display: 'flex',
      gap: '6px'
    });

    const emojis = ['👍', '❤️', '😂', '🎉', '😮', '👏'];
    emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      Object.assign(btn.style, {
        background: 'transparent',
        border: 'none',
        fontSize: '0.9rem',
        cursor: 'pointer',
        padding: '2px',
        transition: 'transform 0.1s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });
      btn.onmouseover = () => btn.style.transform = 'scale(1.25)';
      btn.onmouseout = () => btn.style.transform = 'scale(1)';
      btn.onclick = async () => {
        tooltip.remove();
        if (isConnected()) {
          const reactionMsg = {
            type: 'chat-reaction' as const,
            id: `react-${crypto.randomUUID()}`,
            messageId,
            emoji,
            name: normalizeText(getName()) || 'Participant',
            identity: normalizeText(getIdentity())
          };
          await publishMessage(reactionMsg as any);
          handleReaction(reactionMsg);
        }
      };
      tooltip.appendChild(btn);
    });

    const rect = anchor.getBoundingClientRect();
    document.body.appendChild(tooltip);
    const tooltipRect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${rect.left + (rect.width / 2) - (tooltipRect.width / 2)}px`;
    tooltip.style.top = `${rect.top - tooltipRect.height - 6}px`;

    const outsideClick = (e: MouseEvent) => {
      if (!tooltip.contains(e.target as Node) && e.target !== anchor) {
        tooltip.remove();
        document.removeEventListener('click', outsideClick);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', outsideClick);
    }, 50);
  };


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

      const myName = getName().toLowerCase();
      const myFirstName = getFirstName(getName()).toLowerCase();
      const cleanText = (message.text || '').toLowerCase();
      const isMentioned = Boolean(myName && (cleanText.includes(`@${myName}`) || cleanText.includes(`@${myFirstName}`)));
      if (isMentioned) {
        item.dataset.isMention = 'true';
      }

      if (message.recipientId) {
        item.dataset.isPrivate = 'true';
      }

      const header = document.createElement('div');
      header.className = 'conference-chat-header';

      if (message.recipientId) {
        const privBadge = document.createElement('span');
        privBadge.className = 'chat-private-badge';
        if (message.identity === getIdentity()) {
          privBadge.textContent = `Pry a ${getFirstName(message.recipientName || 'alguien')}`;
        } else {
          privBadge.textContent = 'Pry para ti';
        }
        header.appendChild(privBadge);
      } else if (isMentioned) {
        const mentionBadge = document.createElement('span');
        mentionBadge.className = 'chat-mention-badge';
        mentionBadge.textContent = 'Mención';
        header.appendChild(mentionBadge);
      }

      const sender = document.createElement('span');
      sender.className = 'conference-chat-author';
      sender.textContent = getFirstName(message.name);

      const appearance = participantAppearanceStore.get(message.identity);
      if (appearance) {
        sender.style.color = appearance.color.stroke;
      }

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

      // Reply Quote Rendering
      if (message.replyTo) {
        const replyQuote = document.createElement('div');
        replyQuote.className = 'chat-reply-quote';
        Object.assign(replyQuote.style, {
          background: 'rgba(255, 255, 255, 0.04)',
          borderLeft: '2px solid rgba(255, 255, 255, 0.2)',
          padding: '2px 8px',
          margin: '2px 0 6px 0',
          fontSize: '0.75rem',
          borderRadius: '2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '100%',
          opacity: '0.7'
        });
        
        const quoteAuthor = document.createElement('span');
        quoteAuthor.textContent = `${getFirstName(message.replyTo.name)}: `;
        quoteAuthor.style.fontWeight = '700';
        quoteAuthor.style.marginRight = '4px';

        const quoteText = document.createElement('span');
        quoteText.textContent = message.replyTo.text;
        
        replyQuote.append(quoteAuthor, quoteText);
        body.insertBefore(replyQuote, body.firstChild);

        // Indent reply messages
        item.style.paddingLeft = '1.25rem';
        item.style.borderLeft = '2px solid var(--conference-accent, #2a87ff)';
        item.style.marginLeft = '0.5rem';
      }

      // Hover action buttons (like/reply)
      const actions = document.createElement('div');
      actions.className = 'chat-item-actions';

      const reactBtn = document.createElement('button');
      reactBtn.type = 'button';
      reactBtn.className = 'chat-action-btn';
      reactBtn.title = 'Reaccionar';
      reactBtn.innerHTML = '☺︎';
      reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showReactionTooltip(reactBtn, message.id);
      });

      const replyBtn = document.createElement('button');
      replyBtn.type = 'button';
      replyBtn.className = 'chat-action-btn';
      replyBtn.title = 'Responder';
      replyBtn.innerHTML = '➦';
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setReplyTarget(message);
      });

      actions.append(reactBtn, replyBtn);
      item.append(actions);

      // Render Reactions badge block
      if (message.reactions && Object.keys(message.reactions).length > 0) {
        const reactionsWrap = document.createElement('div');
        reactionsWrap.className = 'chat-message-reactions';
        Object.assign(reactionsWrap.style, {
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          marginTop: '4px'
        });

        Object.entries(message.reactions).forEach(([emoji, users]) => {
          if (users.length === 0) return;
          const badge = document.createElement('span');
          badge.className = 'chat-reaction-badge';
          badge.textContent = `${emoji} ${users.length}`;
          badge.title = users.join(', ');
          Object.assign(badge.style, {
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '10px',
            padding: '1px 6px',
            fontSize: '0.65rem',
            cursor: 'pointer',
            userSelect: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px'
          });

          badge.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isConnected()) {
              const reactionMsg = {
                type: 'chat-reaction' as const,
                id: `react-${crypto.randomUUID()}`,
                messageId: message.id,
                emoji,
                name: normalizeText(getName()) || 'Participant',
                identity: normalizeText(getIdentity())
              };
              await publishMessage(reactionMsg as any);
              handleReaction(reactionMsg);
            }
          });

          reactionsWrap.appendChild(badge);
        });

        body.appendChild(reactionsWrap);
      }

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

  const playMessageSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(440, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      
      gain1.gain.setValueAtTime(0.08, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.12);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(554.37, ctx.currentTime + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(1108.73, ctx.currentTime + 0.18);
      
      gain2.gain.setValueAtTime(0, ctx.currentTime + 0.08);
      gain2.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.08);
      osc2.stop(ctx.currentTime + 0.22);
    } catch (e) {
      console.warn("Sound play failed:", e);
    }
  };

  const appendMessage = (message: ChatMessage, isSent = false) => {
    if (chatMessages.some((entry) => entry.id === message.id)) return;
    chatMessages.push(message);
    if (chatMessages.length > 80) {
      chatMessages.splice(0, chatMessages.length - 80);
    }
    if (!isSent) {
      const myName = getName().toLowerCase();
      const myFirstName = getFirstName(getName()).toLowerCase();
      const cleanText = (message.text || '').toLowerCase();
      const isMentioned = Boolean(myName && (cleanText.includes(`@${myName}`) || cleanText.includes(`@${myFirstName}`)));

      chatUnreadCount += 1;
      syncUnreadDot();
      if (isMentioned) {
        (message as any).isMention = true;
        playMentionSound();
      } else {
        playMessageSound();
      }
    }
    const urlMatches = (message.text || '').match(/(https?:\/\/[^\s"'<>(){}|\\^`[\]]{4,})/gi) ?? [];
    for (const url of urlMatches) {
      window.dispatchEvent(new CustomEvent('musiki:recursos:chat-url', { detail: { url } }));
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

    const recipientSelect = document.querySelector('[data-chat-recipient-select]') as HTMLSelectElement | null;
    const recipientId = recipientSelect && recipientSelect.value !== 'all' ? recipientSelect.value : undefined;
    const recipientName = recipientSelect && recipientSelect.value !== 'all' ? recipientSelect.options[recipientSelect.selectedIndex].textContent?.replace('Privado: ', '') : undefined;

    const identity = normalizeText(getIdentity());
    const message: ChatMessage = {
      type: 'chat',
      id: `chat-${crypto.randomUUID()}`,
      identity,
      name: normalizeText(getName()) || identity || 'Participant',
      role: getRole(),
      sentAt: new Date().toISOString(),
      text,
      recipientId,
      recipientName,
    };

    if (activeReplyTarget) {
      message.replyTo = {
        id: activeReplyTarget.id,
        name: activeReplyTarget.name,
        text: activeReplyTarget.text
      };
      cancelReply();
    }

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
      const dest = recipientId ? [recipientId] : undefined;
      await publishMessage(message, dest);
    } catch (error) {
      reportStatus(formatError(error));
    }
  };

  const uploadChatFile = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/room/re-store', { method: 'POST', body: form });
    if (!response.ok) {
      let detail = '';
      try {
        detail = normalizeText((await response.json())?.error);
      } catch {
        detail = '';
      }
      throw new Error(detail || `Upload failed (${response.status})`);
    }
    const payload = await response.json();
    const url = normalizeText(payload?.url);
    if (!url) throw new Error('Upload did not return a URL.');
    return url;
  };

  const publishFileMessage = async (file: File, url: string) => {
    const identity = normalizeText(getIdentity());
    const safeName = normalizeText(file.name) || 'archivo';
    const message: ChatMessage = {
      type: 'chat',
      id: `chat-${crypto.randomUUID()}`,
      identity,
      name: normalizeText(getName()) || identity || 'Participant',
      role: getRole(),
      sentAt: new Date().toISOString(),
      text: `${safeName}\n${url}`,
    };

    appendMessage(message, true);
    await publishMessage(message);
  };

  const handleFileDrop = async (files: File[]) => {
    if (!files.length) return;
    if (!isConnected()) {
      reportStatus('Conectate al room para enviar archivos en el chat.');
      return;
    }

    for (const file of files) {
      try {
        if (currentChatStatus) {
          currentChatStatus.textContent = `Subiendo ${normalizeText(file.name) || 'archivo'}...`;
          currentChatStatus.hidden = false;
          scrollToEnd();
        }
        const url = await uploadChatFile(file);
        await publishFileMessage(file, url);
      } catch (error) {
        reportStatus(formatError(error));
      } finally {
        if (currentChatStatus) {
          currentChatStatus.hidden = true;
          currentChatStatus.textContent = '';
        }
      }
    }
  };

  const bindFileDropZone = () => {
    const zone = currentChatSection instanceof HTMLElement
      ? currentChatSection
      : currentChatScroller instanceof HTMLElement
        ? currentChatScroller
        : currentChatList;
    if (!(zone instanceof HTMLElement) || boundDropZones.has(zone)) return;
    boundDropZones.add(zone);

    zone.addEventListener('dragenter', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      zone.dataset.fileDragActive = 'true';
      if (currentChatStatus) {
        currentChatStatus.textContent = 'Soltar archivo para enviar';
        currentChatStatus.hidden = false;
      }
    });
    zone.addEventListener('dragleave', (event) => {
      if (zone.contains(event.relatedTarget as Node)) return;
      delete zone.dataset.fileDragActive;
      if (currentChatStatus) currentChatStatus.hidden = true;
    });
    zone.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = isConnected() ? 'copy' : 'none';
    });
    zone.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      delete zone.dataset.fileDragActive;
      void handleFileDrop(Array.from(event.dataTransfer.files ?? []));
    });
  };

  const bind = () => {
    if (!unsubscribeAppearance) {
      unsubscribeAppearance = participantAppearanceStore.subscribeAll(() => {
        renderChat();
      });
    }

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

      const autoResize = () => {
        currentChatInput.style.height = 'auto';
        const lineHeight = 16; // approx
        const padding = 16; // 0.5rem top + 0.5rem bottom
        const maxLines = 4;
        const maxHeight = (lineHeight * maxLines) + padding;
        const newHeight = Math.min(maxHeight, currentChatInput.scrollHeight);
        currentChatInput.style.height = newHeight + 'px';
        
        // If we reached max height, enable scrollbar, otherwise hide it
        currentChatInput.style.overflowY = currentChatInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
      };

      currentChatInput.addEventListener('input', () => {
        autoResize();
        const val = currentChatInput.value;
        const cursor = currentChatInput.selectionStart ?? 0;
        const lastAt = val.lastIndexOf('@', cursor - 1);

        if (lastAt !== -1 && !/\s/.test(val.slice(lastAt, cursor))) {
          mentionStartIndex = lastAt;
          mentionQuery = val.slice(lastAt + 1, cursor).toLowerCase();
          activeSuggestions = getParticipants().filter(p =>
            p.name.toLowerCase().includes(mentionQuery)
          );
          suggestionIndex = 0;
          updateMentionSuggestions();
        } else {
          closeMentions();
        }
      });

      currentChatInput.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent)) return;

        if (activeSuggestions.length > 0) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            suggestionIndex = (suggestionIndex + 1) % activeSuggestions.length;
            updateMentionSuggestions();
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            suggestionIndex = (suggestionIndex - 1 + activeSuggestions.length) % activeSuggestions.length;
            updateMentionSuggestions();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            closeMentions();
            return;
          }
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            const selected = activeSuggestions[suggestionIndex];
            if (selected) {
              insertMention(selected.name);
            }
            return;
          }
        }

        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        void sendMessage().then(() => {
          currentChatInput.style.height = '1.8rem'; // Reset to 1 line
          currentChatInput.style.overflowY = 'hidden';
        });
      });
    }

    if (!boundButtons.has(currentChatSendButton)) {
      boundButtons.add(currentChatSendButton);
      currentChatSendButton.addEventListener('click', () => {
        void sendMessage();
      });
    }

    const cancelBtn = document.querySelector('[data-action="chat-reply-cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        cancelReply();
      });
    }

    if (!boundButtons.has(currentChatDownloadButton)) {
      boundButtons.add(currentChatDownloadButton);
      currentChatDownloadButton.addEventListener('click', () => {
        downloadTranscript();
      });
    }

    bindFileDropZone();
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

  const dispose = () => {
    if (unsubscribeAppearance) {
      unsubscribeAppearance();
      unsubscribeAppearance = null;
    }
  };

  syncControlState();

  return {
    appendMessage,
    handleReaction,
    bind,
    bindElements,
    downloadTranscript,
    focusComposer,
    resetUnread,
    sendMessage,
    syncControlState,
    updateParticipantsList,
    dispose,
  };
};
