import { normalizeText } from '../core/normalize';
import type { ConferenceMessage, ParticipantRole } from '../session';

type OrfActionKind = 'write_to_lily_code' | 'write_to_notes' | 'publish_to_room_chat' | 'send_midi_to_hyperpiano';

type OrfAction = {
  kind: OrfActionKind;
  label?: string;
  content?: string;
  proposal?: any;
};

type OrfMessage = {
  actions?: OrfAction[];
  id: string;
  model?: string;
  role: 'user' | 'orf' | 'system';
  text: string;
  ts: string;
};

type CreateRoomOrfControllerOptions = {
  formatError: (error: unknown) => string;
  getCourseId: () => string | null;
  getIdentity: () => string;
  getName: () => string;
  getRole: () => ParticipantRole;
  getRoomName: () => string;
  getSessionId: () => string | null;
  input: HTMLTextAreaElement;
  isConnected: () => boolean;
  list: HTMLElement;
  modelSelect?: HTMLSelectElement | null;
  publishChatMessage: (message: Extract<ConferenceMessage, { type: 'chat' }>) => Promise<void>;
  publishMidiNote?: (note: { note: number; velocity: number; action: 'on' | 'off' }) => Promise<void>;
  reportStatus: (message: string) => void;
  scopeLabel?: HTMLElement | null;
  scroller?: HTMLElement | null;
  sendButton: HTMLButtonElement;
  clearButton?: HTMLButtonElement | null;
  status?: HTMLElement | null;
};

export type RoomOrfController = {
  ask: (text?: string, options?: { directToChat?: boolean }) => Promise<void>;
  bind: () => void;
  bindElements: (elements: Partial<Pick<
    CreateRoomOrfControllerOptions,
    'input' | 'list' | 'modelSelect' | 'scopeLabel' | 'scroller' | 'sendButton' | 'clearButton' | 'status'
  >>) => void;
  executeAction: (action: any, message?: any) => Promise<void>;
};

const appendText = (container: HTMLElement, text: string) => {
  container.replaceChildren();
  String(text || '').split(/\n/g).forEach((line, index, lines) => {
    const row = document.createElement('div');
    row.className = 'conference-chat-line';
    row.textContent = line || '';
    if (!line) row.appendChild(document.createElement('br'));
    container.appendChild(row);
    if (index < lines.length - 1 && !line) container.appendChild(document.createElement('br'));
  });
};

const firstName = (value: string) => normalizeText(value).split(/\s+/).filter(Boolean)[0] || normalizeText(value);

const findWritableTextarea = (selector: string): HTMLTextAreaElement | null => {
  const candidates = Array.from(document.querySelectorAll<HTMLTextAreaElement>(selector))
    .filter((element) => element.isConnected);
  return candidates.find((element) => !element.closest('#musiki-pod-templates')) ?? candidates[0] ?? null;
};

const appendToTextarea = (textarea: HTMLTextAreaElement, content: string) => {
  const current = textarea.value || '';
  const spacer = current.trim() ? '\n\n' : '';
  textarea.value = `${current}${spacer}${content}`;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
};

const normalizeActions = (value: unknown): OrfAction[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, any> => item && typeof item === 'object')
    .map((item) => ({
      kind: normalizeText(item.kind) as OrfActionKind,
      label: normalizeText(item.label || item.promptLabel),
      content: item.content,
      proposal: item.proposal && typeof item.proposal === 'object' ? item.proposal : item,
    }))
    .filter((item) => (
      item.kind === 'write_to_lily_code' ||
      item.kind === 'write_to_notes' ||
      item.kind === 'publish_to_room_chat' ||
      item.kind === 'send_midi_to_hyperpiano'
    ));
};

export const createRoomOrfController = (options: CreateRoomOrfControllerOptions): RoomOrfController => {
  let currentInput = options.input;
  let currentList = options.list;
  let currentModelSelect = options.modelSelect;
  let currentScopeLabel = options.scopeLabel;
  let currentScroller = options.scroller;
  let currentSendButton = options.sendButton;
  let currentClearButton = options.clearButton;
  let currentStatus = options.status;
  const messages: OrfMessage[] = [];
  const boundInputs = new WeakSet<HTMLTextAreaElement>();
  const boundButtons = new WeakSet<HTMLButtonElement>();

  const setStatus = (message: string) => {
    if (currentStatus) currentStatus.textContent = message;
    if (message) options.reportStatus(message);
  };

  const syncScope = () => {
    if (!currentScopeLabel) return;
    const courseId = normalizeText(options.getCourseId());
    const sessionId = normalizeText(options.getSessionId());
    currentScopeLabel.textContent = `contexto: ${courseId || 'curso'}${sessionId ? ' / clase' : ''}`;
  };

  const syncControls = (busy = false) => {
    const text = normalizeText(currentInput.value);
    currentSendButton.disabled = busy || !text;
    if (currentClearButton) currentClearButton.disabled = busy || messages.length === 0;
    currentInput.disabled = busy;
    if (currentModelSelect) currentModelSelect.disabled = busy;
  };

  const scrollToEnd = () => {
    window.setTimeout(() => {
      const last = currentList.lastElementChild;
      if (last instanceof HTMLElement) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
      else if (currentScroller) currentScroller.scrollTop = currentScroller.scrollHeight;
    }, 80);
  };

  const executeAction = async (action: OrfAction, message?: OrfMessage) => {
    const proposal = action.proposal || {};
    let rawContent = action.content ||
      proposal.source ||
      proposal.markdown ||
      proposal.content ||
      message?.text ||
      '';

    if (Array.isArray(rawContent)) {
      rawContent = rawContent.join('\n');
    }

    let content = normalizeText(String(rawContent));

    if (action.kind === 'write_to_lily_code') {
      const textarea = findWritableTextarea('[data-lilypond-body]');
      if (!textarea) {
        setStatus('Abrí un pod LILY-CODE primero.');
        return;
      }
      // Strip markdown code blocks if present
      if (content.includes('```')) {
        content = content.replace(/```[a-z]*\n?([\s\S]*?)```/g, '$1').trim();
      }
      appendToTextarea(textarea, content);
      setStatus('Enviado a LILY-CODE.');
      return;
    }

    if (action.kind === 'write_to_notes') {
      const textarea = findWritableTextarea('[data-notes-body]');
      if (!textarea) {
        setStatus('Abrí un pod NOTAS primero.');
        return;
      }
      appendToTextarea(textarea, content);
      setStatus('Enviado a NOTAS.');
      return;
    }

    if (action.kind === 'publish_to_room_chat') {
      if (!options.isConnected()) {
        setStatus('Conectate a la sala para publicar en chat.');
        return;
      }
      const model = normalizeText(message?.model || currentModelSelect?.value) || 'local';
      const chatMessage: Extract<ConferenceMessage, { type: 'chat' }> = {
        type: 'chat',
        id: `orf-chat-${crypto.randomUUID()}`,
        identity: `orf:${model}`,
        name: `Orf-${model}`,
        role: 'external',
        sentAt: new Date().toISOString(),
        text: content,
      };
      await options.publishChatMessage(chatMessage);
      setStatus('Publicado en el chat.');
      return;
    }

    if (action.kind === 'send_midi_to_hyperpiano') {
      const midiNotes = Array.isArray(proposal.midiNotes) ? proposal.midiNotes : [];
      if (midiNotes.length === 0 || !options.publishMidiNote) {
        setStatus('La propuesta no incluye notas MIDI ejecutables.');
        console.warn('[orf-execute] No midiNotes found in proposal', proposal);
        return;
      }
      
      setStatus('Tocando...');
      
      midiNotes.slice(0, 64).forEach((item: any) => {
        const note = Number(item.pitch);
        if (!Number.isFinite(note)) return;
        
        const velocity = Number.isFinite(Number(item.velocity)) ? Number(item.velocity) : 0.7;
        const startMs = Number.isFinite(Number(item.startMs)) ? Number(item.startMs) : 0;
        const durationMs = Number.isFinite(Number(item.durationMs)) ? Math.max(50, Number(item.durationMs)) : 400;

        window.setTimeout(async () => {
          await options.publishMidiNote?.({ note: Math.round(note), velocity, action: 'on' });
          window.setTimeout(() => {
            void options.publishMidiNote?.({ note: Math.round(note), velocity: 0, action: 'off' });
          }, durationMs);
        }, startMs);
      });
      
      return;
    }
  };

  const render = () => {
    if (!currentList) return;
    currentList.innerHTML = '';
    if (messages.length === 0) {
      const item = document.createElement('li');
      item.className = 'conference-chat-item conference-orf-empty';
      item.innerHTML = `
        <div class="conference-chat-header">
          <span class="conference-chat-author">Orf</span>
          <span class="conference-chat-header-separator">·</span>
          <span class="conference-chat-stamp">local</span>
        </div>
        <div class="conference-chat-text">Preguntame algo de la clase. Puedo preparar una propuesta para LILY-CODE, NOTAS, chat o HYPERPIANO.</div>
      `;
      currentList.appendChild(item);
      return;
    }

    messages.slice(-40).forEach((message) => {
      const item = document.createElement('li');
      item.className = 'conference-chat-item';
      const header = document.createElement('div');
      header.className = 'conference-chat-header';
      const sender = document.createElement('span');
      sender.className = 'conference-chat-author';
      sender.textContent = message.role === 'orf'
        ? `Orf${message.model ? `-${message.model}` : ''}`
        : firstName(options.getName()) || 'Yo';
      sender.style.color = message.role === 'orf' ? 'var(--conference-accent, #76d3ff)' : '#fff';
      const separator = document.createElement('span');
      separator.className = 'conference-chat-header-separator';
      separator.textContent = '·';
      const sentAt = document.createElement('time');
      sentAt.className = 'conference-chat-stamp';
      sentAt.dateTime = message.ts;
      sentAt.textContent = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      header.append(sender, separator, sentAt);

      const body = document.createElement('div');
      body.className = 'conference-chat-text';
      appendText(body, message.text);
      item.append(header, body);

      if (message.role === 'orf' && message.actions?.length) {
        const actionsEl = document.createElement('div');
        actionsEl.className = 'conference-orf-actions';
        message.actions.forEach((action) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'musiki-pod-btn conference-orf-action';
          button.textContent = action.label || (
            action.kind === 'write_to_lily_code' ? 'LILY-CODE' :
            action.kind === 'write_to_notes' ? 'NOTAS' :
            action.kind === 'publish_to_room_chat' ? 'CHAT' :
            'HYPERPIANO'
          );
          button.addEventListener('click', () => {
            void executeAction(action, message).catch((error) => setStatus(options.formatError(error)));
          });
          actionsEl.appendChild(button);
        });
        item.appendChild(actionsEl);
      }

      currentList.appendChild(item);
    });
    scrollToEnd();
  };

  const ask = async (externalText?: string, askOptions?: { directToChat?: boolean }) => {
    const text = normalizeText(externalText ?? currentInput?.value);
    if (!text) return;
    const model = normalizeText(currentModelSelect?.value);
    const isDirect = askOptions?.directToChat === true;

    if (!externalText) {
      messages.push({
        id: `orf-user-${crypto.randomUUID()}`,
        role: 'user',
        text,
        ts: new Date().toISOString(),
      });
      if (currentInput) {
        currentInput.value = '';
        currentInput.dispatchEvent(new Event('input'));
      }
      render();
    }

    syncControls(true);
    setStatus('Orf está pensando...');

    try {
      const response = await fetch('/api/ai/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'chat',
          scope: {
            courseId: normalizeText(options.getCourseId()),
            sessionId: normalizeText(options.getSessionId()),
            podId: 'orf',
          },
          input: { message: text },
          context: { mode: 'session' },
          options: { provider: 'ollama', model: model || undefined },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || 'Orf no pudo responder');
      }
      const output = payload?.output || {};
      const answer = normalizeText(output.message) || 'No tengo una respuesta útil todavía.';
      const orfModel = normalizeText(payload.model || model) || 'local';
      
      messages.push({
        actions: normalizeActions(output.actions),
        id: `orf-${crypto.randomUUID()}`,
        model: orfModel,
        role: 'orf',
        text: answer,
        ts: new Date().toISOString(),
      });

      if (isDirect) {
        const chatMessage: Extract<ConferenceMessage, { type: 'chat' }> = {
          type: 'chat',
          id: `orf-chat-${crypto.randomUUID()}`,
          identity: `orf:${orfModel}`,
          name: `Orf-${orfModel}`,
          role: 'external',
          sentAt: new Date().toISOString(),
          text: JSON.stringify(output), // Send raw structured JSON so chat controller can render actions
        };
        await options.publishChatMessage(chatMessage);
      }

      setStatus('');
    } catch (error) {
      const errorText = options.formatError(error);
      messages.push({
        id: `orf-error-${crypto.randomUUID()}`,
        role: 'system',
        text: errorText,
        ts: new Date().toISOString(),
      });
      setStatus('Error de Orf.');

      if (isDirect) {
        await options.publishChatMessage({
          type: 'chat',
          id: `orf-error-${crypto.randomUUID()}`,
          identity: 'system',
          name: 'Orf (Error)',
          role: 'external',
          sentAt: new Date().toISOString(),
          text: `⚠️ No pude responder: ${errorText}`,
        });
      }
    } finally {
      render();
      syncControls(false);
    }
  };

  const clear = () => {
    messages.splice(0, messages.length);
    setStatus('');
    render();
    syncControls(false);
  };

  const bind = () => {
    syncScope();
    render();
    syncControls(false);
    if (!boundInputs.has(currentInput)) {
      boundInputs.add(currentInput);
      currentInput.addEventListener('input', () => syncControls(false));
      currentInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        void ask();
      });
    }
    if (!boundButtons.has(currentSendButton)) {
      boundButtons.add(currentSendButton);
      currentSendButton.addEventListener('click', () => void ask());
    }
    if (currentClearButton && !boundButtons.has(currentClearButton)) {
      boundButtons.add(currentClearButton);
      currentClearButton.addEventListener('click', clear);
    }
  };

  const bindElements: RoomOrfController['bindElements'] = (elements) => {
    if (elements.input instanceof HTMLTextAreaElement) currentInput = elements.input;
    if (elements.list instanceof HTMLElement) currentList = elements.list;
    if (elements.modelSelect instanceof HTMLSelectElement) currentModelSelect = elements.modelSelect;
    if (elements.scopeLabel instanceof HTMLElement) currentScopeLabel = elements.scopeLabel;
    if (elements.scroller instanceof HTMLElement) currentScroller = elements.scroller;
    if (elements.sendButton instanceof HTMLButtonElement) currentSendButton = elements.sendButton;
    if (elements.clearButton instanceof HTMLButtonElement) currentClearButton = elements.clearButton;
    if (elements.status instanceof HTMLElement) currentStatus = elements.status;
    bind();
  };

  return { ask, bind, bindElements, executeAction };
};
