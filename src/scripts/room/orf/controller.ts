import { normalizeText } from '../core/normalize';
import type { ConferenceMessage, ParticipantRole } from '../session';
import {
  labelForOrfAction,
  normalizeOrfResponse,
  stringifyOrfForHumans,
  type NormalizedOrfAction,
  type NormalizedOrfResponse,
} from '../../../lib/orf/schema';

type OrfMessage = {
  actions?: NormalizedOrfAction[];
  executedActions?: string[];
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
  dispatchLocalMidiNote?: (note: { note: number; velocity: number; action: 'on' | 'off' }) => void;
  dispatchBoardNote?: (note: { x: number; y: number; text: string; color: string; size: 'sm' | 'lg' }) => void;
  dispatchBoardStroke?: (stroke: { x: number; y: number; action: 'start' | 'draw' | 'end'; color: string }) => void;
  ensurePod?: (podId: 'chat' | 'notes' | 'lily-code' | 'lily-render' | 'whiteboard' | 'hyperpiano') => void;
  reportStatus: (message: string) => void;
  scopeLabel?: HTMLElement | null;
  scroller?: HTMLElement | null;
  sendButton: HTMLButtonElement;
  clearButton?: HTMLButtonElement | null;
  status?: HTMLElement | null;
  reasoningContainer?: HTMLElement | null;
  testHButton?: HTMLButtonElement | null;
};

export type RoomOrfController = {
  ask: (text?: string, options?: { directToChat?: boolean }) => Promise<void>;
  bind: () => void;
  bindElements: (elements: Partial<Pick<
    CreateRoomOrfControllerOptions,
    'input' | 'list' | 'modelSelect' | 'scopeLabel' | 'scroller' | 'sendButton' | 'clearButton' | 'status' | 'reasoningContainer' | 'testHButton'
  >>) => void;
  executeAction: (action: NormalizedOrfAction, message?: OrfMessage) => Promise<string | null>;
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

const waitForWritableTextarea = async (selector: string, attempts = 12): Promise<HTMLTextAreaElement | null> => {
  for (let index = 0; index < attempts; index += 1) {
    const textarea = findWritableTextarea(selector);
    if (textarea) return textarea;
    await new Promise((resolve) => window.setTimeout(resolve, 70));
  }
  return null;
};

const unwrapOrfOutput = (payload: any): NormalizedOrfResponse => {
  const output = payload?.output?.structured ?? payload?.output ?? {};
  return normalizeOrfResponse(output);
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
  let currentReasoning = options.reasoningContainer;
  let currentTestHButton = options.testHButton;
  const messages: OrfMessage[] = [];
  const boundInputs = new WeakSet<HTMLTextAreaElement>();
  const boundButtons = new WeakSet<HTMLButtonElement>();

  const setStatus = (message: string) => {
    if (currentStatus) currentStatus.textContent = message;
    if (message) options.reportStatus(message);
  };

  const setReasoning = (text: string) => {
    if (!currentReasoning) return;
    if (!text) {
      currentReasoning.hidden = true;
      currentReasoning.textContent = '';
      return;
    }
    currentReasoning.textContent = text;
    currentReasoning.hidden = false;
    currentReasoning.scrollTop = currentReasoning.scrollHeight;
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

  const executeAction = async (action: NormalizedOrfAction, message?: OrfMessage): Promise<string | null> => {
    if (action.type === 'lilypond.score') {
      options.ensurePod?.('lily-code');
      if (action.renderPreview) options.ensurePod?.('lily-render');
      const textarea = await waitForWritableTextarea('[data-lilypond-body]');
      if (!textarea) {
        setStatus('Abrí un pod LILY-CODE primero.');
        window.dispatchEvent(new CustomEvent('musiki:lilypond:write', { detail: { content: action.source } }));
        return null;
      }
      appendToTextarea(textarea, action.source);
      if (action.renderPreview) {
        window.setTimeout(() => {
          const renderButton = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-lilypond-save]'))
            .find((button) => !button.closest('#musiki-pod-templates'));
          renderButton?.click();
        }, 160);
      }
      return 'LilyPond enviado a LILY-CODE.';
    }

    if (action.type === 'notes.write') {
      options.ensurePod?.('notes');
      const textarea = await waitForWritableTextarea('[data-notes-body]');
      if (!textarea) {
        setStatus('Abrí un pod NOTAS primero.');
        window.dispatchEvent(new CustomEvent('musiki:notes:write', { detail: { content: action.markdown } }));
        return null;
      }
      appendToTextarea(textarea, action.markdown);
      return 'Nota escrita en NOTAS.';
    }

    if (action.type === 'chat.message') {
      options.ensurePod?.('chat');
      if (!options.isConnected()) {
        setStatus('Conectate a la sala para publicar en chat.');
        return null;
      }
      const model = normalizeText(message?.model || currentModelSelect?.value) || 'local';
      const chatMessage: Extract<ConferenceMessage, { type: 'chat' }> = {
        type: 'chat',
        id: `orf-chat-${crypto.randomUUID()}`,
        identity: `orf:${model}`,
        name: `Orf-${model}`,
        role: 'external',
        sentAt: new Date().toISOString(),
        text: action.markdown,
      };
      await options.publishChatMessage(chatMessage);
      return 'Publicado en el chat.';
    }

    if (action.type === 'midi.sequence') {
      options.ensurePod?.('hyperpiano');
      const midiNotes = action.events;
      if (midiNotes.length === 0 || (!options.publishMidiNote && !options.dispatchLocalMidiNote)) {
        setStatus('La propuesta no incluye notas MIDI ejecutables.');
        return null;
      }
      
      setStatus('Tocando...');
      
      midiNotes.slice(0, 128).forEach((item: any) => {
        const note = Number(item.note);
        if (!Number.isFinite(note)) return;
        
        const velocity = Number.isFinite(Number(item.velocity)) ? (item.velocity > 1 ? item.velocity / 127 : item.velocity) : 0.7;
        const startMs = Number.isFinite(Number(item.startMs)) ? Number(item.startMs) : 0;
        const durationMs = Number.isFinite(Number(item.durationMs)) ? Math.max(50, Number(item.durationMs)) : 400;

        window.setTimeout(async () => {
          const noteOn = { note: Math.round(note), velocity, action: 'on' as const };
          options.dispatchLocalMidiNote?.(noteOn);
          await options.publishMidiNote?.(noteOn);
          
          window.setTimeout(async () => {
            const noteOff = { note: Math.round(note), velocity: 0, action: 'off' as const };
            options.dispatchLocalMidiNote?.(noteOff);
            await options.publishMidiNote?.(noteOff);
          }, durationMs);
        }, startMs);
      });
      
      return 'Secuencia enviada al HYPERPIANO.';
    }

    if (action.type === 'board.note') {
      options.ensurePod?.('whiteboard');
      if (!options.dispatchBoardNote) {
        setStatus('Abrí un pod PIZARRA primero.');
        return null;
      }
      options.dispatchBoardNote({
        color: action.color || '#ffffff',
        size: action.size || 'sm',
        text: action.text,
        x: action.x,
        y: action.y,
      });
      return 'Texto escrito en PIZARRA.';
    }

    if (action.type === 'board.draw') {
      options.ensurePod?.('whiteboard');
      if (!options.dispatchBoardStroke) {
        setStatus('Abrí un pod PIZARRA primero.');
        return null;
      }
      action.strokes.forEach((stroke) => {
        const points = stroke.points;
        points.forEach((point, index) => {
          const nextAction = point.action || (index === 0 ? 'start' : 'draw');
          options.dispatchBoardStroke?.({
            action: nextAction,
            color: stroke.color || '#ffffff',
            x: point.x,
            y: point.y,
          });
        });
        const last = points[points.length - 1];
        if (last) {
          options.dispatchBoardStroke?.({
            action: 'end',
            color: stroke.color || '#ffffff',
            x: last.x,
            y: last.y,
          });
        }
      });
      return 'Dibujo enviado a PIZARRA.';
    }

    return null;
  };

  const executeActions = async (actions: NormalizedOrfAction[], message: OrfMessage) => {
    const applied: string[] = [];
    for (const action of actions) {
      const result = await executeAction(action, message);
      if (result) applied.push(result);
    }
    message.executedActions = applied;
    if (applied.length) {
      setStatus(applied[applied.length - 1]);
      render();
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
        <div class="conference-chat-text">Preguntame algo de la clase. Puedo escribir en LILY-CODE, NOTAS, chat, PIZARRA o tocar el HYPERPIANO cuando el pedido lo implique.</div>
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
        const applied = message.executedActions?.length ? message.executedActions : message.actions.map((action) => `Preparando ${labelForOrfAction(action)}...`);
        applied.forEach((label) => {
          const badge = document.createElement('span');
          badge.className = 'conference-orf-action';
          badge.textContent = label;
          actionsEl.appendChild(badge);
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
    setReasoning('');

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
      const output = unwrapOrfOutput(payload);
      const answer = stringifyOrfForHumans(output) || 'No tengo una respuesta útil todavía.';
      const orfModel = normalizeText(payload.model || model) || 'local';
      const reasoning = normalizeText(payload.reasoning);

      if (reasoning) {
        setReasoning(reasoning);
      }
      
      const orfMessage: OrfMessage = {
        actions: output.actions,
        id: 'orf-' + crypto.randomUUID(),
        model: orfModel,
        role: 'orf',
        text: answer,
        ts: new Date().toISOString(),
      };
      messages.push(orfMessage);
      
      if (isDirect) {
        const chatMessage: Extract<ConferenceMessage, { type: 'chat' }> = {
          type: 'chat',
          id: `orf-chat-${crypto.randomUUID()}`,
          identity: `orf:${orfModel}`,
          name: `Orf-${orfModel}`,
          role: 'external',
          sentAt: new Date().toISOString(),
          text: answer,
        };
        await options.publishChatMessage(chatMessage);
      }

      setStatus('');
      render();
      if (orfMessage.actions?.length) {
        await executeActions(orfMessage.actions, orfMessage);
      }
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
      
      const autoResize = () => {
        currentInput.style.height = 'auto';
        const lineHeight = 16;
        const padding = 16;
        const maxLines = 4;
        const maxHeight = (lineHeight * maxLines) + padding;
        const newHeight = Math.min(maxHeight, currentInput.scrollHeight);
        currentInput.style.height = newHeight + 'px';
        currentInput.style.overflowY = currentInput.scrollHeight > maxHeight ? 'auto' : 'hidden';
      };

      currentInput.addEventListener('input', () => {
        autoResize();
        syncControls(false);
      });

      currentInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        void ask().then(() => {
          currentInput.style.height = '1.8rem';
          currentInput.style.overflowY = 'hidden';
        });
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
    if (currentTestHButton && !boundButtons.has(currentTestHButton)) {
      boundButtons.add(currentTestHButton);
      currentTestHButton.addEventListener('click', () => {
        const pitch = 60 + Math.floor(Math.random() * 12);
        void executeAction({
          events: [{ durationMs: 500, note: pitch, startMs: 0, velocity: 0.72 }],
          id: `orf-test-${crypto.randomUUID()}`,
          label: 'hyperpiano',
          risk: 'high',
          target: 'hyperpiano',
          type: 'midi.sequence',
        });
      });
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
    if (elements.reasoningContainer instanceof HTMLElement) currentReasoning = elements.reasoningContainer;
    if (elements.testHButton instanceof HTMLButtonElement) currentTestHButton = elements.testHButton;
    bind();
  };

  return { ask, bind, bindElements, executeAction };
};
