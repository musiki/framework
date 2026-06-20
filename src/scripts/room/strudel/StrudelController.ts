const DEFAULT_STRUDEL_CODE = `setcps(0.75)
s("bd sd [~ bd] sd")
  .bank("RolandTR909")
  .gain(0.8)`;

type StrudelMirror = {
  code?: string;
  evaluate: (autostart?: boolean) => Promise<void>;
  setCode: (code: string) => void;
  stop: () => Promise<void>;
};

type StrudelEditorElement = HTMLElement & {
  editor?: StrudelMirror | null;
};

type StrudelControllerOptions = {
  container: HTMLElement;
  getAudioContext?: () => AudioContext | null | Promise<AudioContext | null>;
  getOutputNode?: () => AudioNode | null;
  onCodeChange?: (code: string) => void;
  onTransportChange?: (playing: boolean, code: string) => void;
};

export class StrudelController {
  private container: HTMLElement;
  private getAudioContext?: StrudelControllerOptions['getAudioContext'];
  private getOutputNode?: StrudelControllerOptions['getOutputNode'];
  private onCodeChange?: StrudelControllerOptions['onCodeChange'];
  private onTransportChange?: StrudelControllerOptions['onTransportChange'];
  private editorElement: StrudelEditorElement | null = null;
  private editor: StrudelMirror | null = null;
  private transportButton: HTMLButtonElement | null = null;
  private initializing: Promise<void> | null = null;
  private playing = false;
  private disposed = false;
  private routedOutput: AudioNode | null = null;
  private codeBroadcastTimer = 0;
  private lastBroadcastCode = '';

  constructor(options: StrudelControllerOptions) {
    this.container = options.container;
    this.getAudioContext = options.getAudioContext;
    this.getOutputNode = options.getOutputNode;
    this.onCodeChange = options.onCodeChange;
    this.onTransportChange = options.onTransportChange;
    this.transportButton = this.container
      .closest('.pod-diy-shell')
      ?.querySelector<HTMLButtonElement>('[data-strudel-transport]') ?? null;
    this.container.addEventListener('musiki:strudel-transport-toggle', this.handleTransport as EventListener);
    this.initializing = this.initialize();
  }

  private handleTransport = () => {
    void this.toggle();
  };

  private async initialize() {
    const host = this.container.querySelector<HTMLElement>('[data-strudel-host]');
    if (!host) return;

    try {
      const roomContext = await this.getAudioContext?.();
      const superdough = await import('superdough');
      if (roomContext) superdough.setAudioContext(roomContext);

      await import('@strudel/repl');
      if (this.disposed) return;

      await customElements.whenDefined('strudel-editor');
      const editor = document.createElement('strudel-editor') as StrudelEditorElement;
      editor.setAttribute('code', DEFAULT_STRUDEL_CODE);
      editor.addEventListener('update', this.handleEditorUpdate as EventListener);
      host.appendChild(editor);
      this.editorElement = editor;

      await this.waitForEditor(editor);
      this.editor = editor.editor ?? null;
      this.routeOutput(superdough);
      host.dataset.ready = 'true';
      this.syncTransport();
    } catch (error) {
      const status = host.querySelector<HTMLElement>('[data-strudel-status]');
      if (status) status.textContent = 'STRUDEL ERROR';
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
      console.warn('[StrudelController] could not route output to STRD mixer channel', error);
    }
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
    const next = detail.started ?? detail.playing ?? detail.running;
    if (typeof next === 'boolean') {
      this.playing = next;
      this.syncTransport();
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
        if (context?.state === 'suspended') await context.resume();
        await editor.evaluate(true);
      } else {
        await editor.stop();
      }
    } catch (error) {
      this.playing = false;
      this.syncTransport();
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

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.codeBroadcastTimer);
    this.container.removeEventListener('musiki:strudel-transport-toggle', this.handleTransport as EventListener);
    this.editorElement?.removeEventListener('update', this.handleEditorUpdate as EventListener);
    void this.editor?.stop();
    if (this.routedOutput) {
      try { this.routedOutput.disconnect(); } catch { /* already disconnected */ }
    }
    this.editorElement = null;
    this.editor = null;
  }
}
