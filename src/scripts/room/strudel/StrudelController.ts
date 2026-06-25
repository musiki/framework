const DEFAULT_STRUDEL_CODE = `setcps(0.75)
s("bd sd [~ bd] sd")
  .bank("RolandTR909")
  .gain(0.8)`;

type StrudelMirror = {
  code?: string;
  evaluate: (autostart?: boolean) => Promise<void>;
  prebaked?: Promise<unknown>;
  setCode: (code: string) => void;
  stop: () => Promise<void>;
};

type StrudelEditorElement = HTMLElement & {
  editor?: StrudelMirror | null;
};

type StrudelConsoleLevel = 'ready' | 'info' | 'error';

type HydraInstance = {
  setResolution?: (width: number, height: number) => void;
};

type StrudelControllerOptions = {
  container: HTMLElement;
  initialCode?: string;
  getAudioContext?: () => AudioContext | null | Promise<AudioContext | null>;
  getOutputNode?: () => AudioNode | null;
  onCodeChange?: (code: string) => void;
  onTransportChange?: (playing: boolean, code: string) => void;
  transportButton?: HTMLButtonElement | null;
};

export class StrudelController {
  private container: HTMLElement;
  private getAudioContext?: StrudelControllerOptions['getAudioContext'];
  private getOutputNode?: StrudelControllerOptions['getOutputNode'];
  private onCodeChange?: StrudelControllerOptions['onCodeChange'];
  private onTransportChange?: StrudelControllerOptions['onTransportChange'];
  private initialCode: string;
  private editorElement: StrudelEditorElement | null = null;
  private editor: StrudelMirror | null = null;
  private consoleElement: HTMLElement | null = null;
  private transportButton: HTMLButtonElement | null = null;
  private initializing: Promise<void> | null = null;
  private playing = false;
  private disposed = false;
  private routedOutput: AudioNode | null = null;
  private hydraResizeObserver: ResizeObserver | null = null;
  private clearHydra: (() => void) | null = null;
  private codeBroadcastTimer = 0;
  private lastBroadcastCode = '';

  constructor(options: StrudelControllerOptions) {
    this.container = options.container;
    this.getAudioContext = options.getAudioContext;
    this.getOutputNode = options.getOutputNode;
    this.onCodeChange = options.onCodeChange;
    this.onTransportChange = options.onTransportChange;
    this.initialCode = typeof options.initialCode === 'string' ? options.initialCode : DEFAULT_STRUDEL_CODE;
    this.transportButton = options.transportButton ?? this.container
      .closest('.pod-diy-shell')
      ?.querySelector<HTMLButtonElement>('[data-strudel-transport]') ?? null;
    this.container.addEventListener('musiki:strudel-transport-toggle', this.handleTransport as EventListener);
    this.container.addEventListener('keydown', this.handleKeyboardTransport, true);
    document.addEventListener('strudel.log', this.handleStrudelLog as EventListener);
    this.initializing = this.initialize();
  }

  private handleTransport = () => {
    void this.toggle();
  };

  private handleKeyboardTransport = (event: KeyboardEvent) => {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;

    const play = event.key === 'Enter';
    const stop = event.key === '.' || event.code === 'Period';
    if (!play && !stop) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    void this.setPlaying(play, undefined, true);
  };

  private handleStrudelLog = (event: CustomEvent<Record<string, unknown>>) => {
    const detail = event.detail ?? {};
    const type = typeof detail.type === 'string' ? detail.type.toLowerCase() : '';
    const message = typeof detail.message === 'string' ? detail.message : '';
    if (!message || !['error', 'warning', 'warn'].includes(type)) return;
    this.writeConsole(message, type === 'error' ? 'error' : 'info');
  };

  private async initialize() {
    const host = this.container.querySelector<HTMLElement>('[data-strudel-host]');
    if (!host) return;
    this.consoleElement = this.container.querySelector<HTMLElement>('[data-strudel-console]');

    try {
      const roomContext = await this.getAudioContext?.();
      const superdough = await import('superdough');
      if (roomContext) superdough.setAudioContext(roomContext);

      await import('@strudel/repl');
      if (this.disposed) return;

      await customElements.whenDefined('strudel-editor');
      const editor = document.createElement('strudel-editor') as StrudelEditorElement;
      editor.setAttribute('code', this.initialCode);
      editor.addEventListener('update', this.handleEditorUpdate as EventListener);
      host.appendChild(editor);
      this.editorElement = editor;

      await this.waitForEditor(editor);
      this.editor = editor.editor ?? null;
      await this.editor?.prebaked;
      const globalScope = globalThis as typeof globalThis & Record<string, unknown>;
      globalScope.global = globalThis;
      const [xen, hydra, hydraSynth] = await Promise.all([
        import('@strudel/xen'),
        import('@strudel/hydra'),
        import('hydra-synth'),
      ]);
      const evalScope = (globalThis as typeof globalThis & {
        evalScope?: (...modules: unknown[]) => Promise<unknown>;
      }).evalScope;
      const register = (globalThis as typeof globalThis & {
        register?: (name: string, transform: (value: unknown, pattern: unknown) => unknown) => unknown;
      }).register;
      if (!evalScope || !register) throw new Error('Strudel evaluation scope is unavailable');
      globalScope.Hydra = hydraSynth.default;
      const initHydra = async (options: Record<string, unknown> = {}) => {
        const instance = await hydra.initHydra({ src: import.meta.url, ...options }) as HydraInstance;
        this.mountHydraCanvas(instance, Number(options.pixelRatio) || 1);
        return instance;
      };
      this.clearHydra = hydra.clearHydra;
      await evalScope({ ...hydra, initHydra }, xen);
      // Attach Xen to the REPL's active Pattern class even when Vite prebundles it with an isolated core.
      globalScope.xen = register('xen', (scale, pattern) => xen.xen(scale, pattern));
      globalScope.tuning = register('tuning', (scale, pattern) => xen.tuning(scale, pattern));
      this.routeOutput(superdough);
      host.dataset.ready = 'true';
      this.syncTransport();
      this.clearConsole('ready');
    } catch (error) {
      const status = host.querySelector<HTMLElement>('[data-strudel-status]');
      if (status) status.textContent = 'STRUDEL ERROR';
      this.writeConsole(error, 'error');
      console.error('[StrudelController] initialization failed', error);
    }
  }

  private waitForEditor(editor: StrudelEditorElement) {
    return new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        if (this.disposed) return resolve();
        if (editor.editor) return resolve();
        attempts += 1;
        if (attempts > 200) return reject(new Error('Strudel editor did not initialize'));
        window.setTimeout(check, 20);
      };
      check();
    });
  }

  private routeOutput(superdough: typeof import('superdough')) {
    const outputNode = this.getOutputNode?.();
    if (!outputNode) return;

    const destinationGain = superdough.getSuperdoughAudioController().output.destinationGain;
    if (!destinationGain || destinationGain.context !== outputNode.context) return;

    try {
      destinationGain.disconnect();
      destinationGain.connect(outputNode);
      this.routedOutput = destinationGain;
    } catch (error) {
      this.writeConsole(error, 'error');
      console.warn('[StrudelController] could not route output to STRD mixer channel', error);
    }
  }

  private mountHydraCanvas(instance: HydraInstance, pixelRatio: number) {
    const host = this.container.querySelector<HTMLElement>('[data-strudel-host]');
    const canvas = document.getElementById('hydra-canvas') as HTMLCanvasElement | null;
    if (!host || !canvas) return;

    host.prepend(canvas);
    canvas.style.cssText = [
      'position:absolute',
      'inset:0',
      'z-index:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'image-rendering:pixelated',
    ].join(';');

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width * pixelRatio));
      const height = Math.max(1, Math.round(bounds.height * pixelRatio));
      instance.setResolution?.(width, height);
    };
    this.hydraResizeObserver?.disconnect();
    this.hydraResizeObserver = new ResizeObserver(resize);
    this.hydraResizeObserver.observe(host);
    resize();
  }

  private handleEditorUpdate = (event: CustomEvent<Record<string, unknown>>) => {
    const detail = event.detail ?? {};
    const code = typeof detail.code === 'string' ? detail.code : '';
    if (code && code !== this.lastBroadcastCode) {
      window.clearTimeout(this.codeBroadcastTimer);
      this.codeBroadcastTimer = window.setTimeout(() => {
        this.lastBroadcastCode = code;
        this.onCodeChange?.(code);
      }, 120);
    }

    const error = detail.error ?? detail.evalError ?? detail.schedulerError;
    if (error) {
      this.writeConsole(error, 'error');
    } else if (detail.pending === true) {
      this.clearConsole('info');
    }

    const next = detail.started ?? detail.playing ?? detail.running;
    if (typeof next === 'boolean') {
      this.playing = next;
      this.syncTransport();
      if (!error && detail.pending !== true) {
        this.clearConsole(next ? 'info' : 'ready');
      }
    }
  };

  async toggle() {
    await this.setPlaying(!this.playing, undefined, true);
  }

  async setPlaying(playing: boolean, code?: string, broadcast = false) {
    await this.initializing;
    const editor = this.editor;
    if (!editor) return;

    try {
      if (typeof code === 'string' && code !== editor.code) editor.setCode(code);
      this.playing = playing;
      this.syncTransport();
      if (broadcast) this.onTransportChange?.(playing, editor.code ?? code ?? '');
      if (playing) {
        const context = await this.getAudioContext?.();
        if (context?.state === 'suspended') {
          void context.resume().catch((error) => this.writeConsole(error, 'error'));
        }
        await editor.evaluate(true);
      } else {
        await editor.stop();
        this.stopHydra();
        this.clearConsole('ready');
      }
    } catch (error) {
      this.playing = false;
      this.syncTransport();
      this.stopHydra();
      this.writeConsole(error, 'error');
      console.error('[StrudelController] transport failed', error);
    }
  }

  async setCode(code: string) {
    await this.initializing;
    const editor = this.editor;
    if (!editor || code === editor.code) return;
    this.lastBroadcastCode = code;
    editor.setCode(code);
  }

  private syncTransport() {
    if (!this.transportButton) return;
    this.transportButton.dataset.playing = this.playing ? 'true' : 'false';
    this.transportButton.textContent = this.playing ? '■' : '▶';
    this.transportButton.title = this.playing ? 'Stop Strudel' : 'Play Strudel';
    this.transportButton.setAttribute('aria-label', this.transportButton.title);
    this.transportButton.setAttribute('aria-pressed', String(this.playing));
  }

  private writeConsole(value: unknown, level: StrudelConsoleLevel) {
    if (!this.consoleElement) return;

    let message: string;
    if (value instanceof Error) {
      message = `${value.name}: ${value.message}`;
    } else if (value && typeof value === 'object' && 'message' in value) {
      message = String((value as { message: unknown }).message);
    } else {
      message = String(value ?? '');
    }

    const lines = message
      .replace(/\s+at\s+[^\n]+/g, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-2);
    this.consoleElement.textContent = lines.join('\n');
    this.consoleElement.dataset.level = level;
    this.consoleElement.hidden = level !== 'error' || lines.length === 0;
  }

  private clearConsole(level: StrudelConsoleLevel = 'ready') {
    if (!this.consoleElement) return;
    this.consoleElement.textContent = '';
    this.consoleElement.dataset.level = level;
    this.consoleElement.hidden = true;
  }

  private stopHydra() {
    this.hydraResizeObserver?.disconnect();
    this.hydraResizeObserver = null;
    this.clearHydra?.();
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.codeBroadcastTimer);
    this.container.removeEventListener('musiki:strudel-transport-toggle', this.handleTransport as EventListener);
    this.container.removeEventListener('keydown', this.handleKeyboardTransport, true);
    document.removeEventListener('strudel.log', this.handleStrudelLog as EventListener);
    this.editorElement?.removeEventListener('update', this.handleEditorUpdate as EventListener);
    void this.editor?.stop();
    this.stopHydra();
    this.clearHydra = null;
    if (this.routedOutput) {
      try { this.routedOutput.disconnect(); } catch { /* already disconnected */ }
    }
    this.editorElement = null;
    this.editor = null;
    this.consoleElement = null;
  }
}
