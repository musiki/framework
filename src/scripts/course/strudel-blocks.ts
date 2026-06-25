import { StrudelController } from '../room/strudel/StrudelController';

const controllers = new WeakMap<HTMLElement, StrudelController>();
const activeControllers = new Set<StrudelController>();

let audioContext: AudioContext | null = null;
let outputGain: GainNode | null = null;

function decodeBase64Url(value: string) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
    outputGain = audioContext.createGain();
    outputGain.connect(audioContext.destination);
  }
  return audioContext;
}

function disposeDisconnectedControllers() {
  for (const controller of activeControllers) {
    const maybeContainer = (controller as unknown as { container?: HTMLElement }).container;
    if (maybeContainer?.isConnected) continue;
    controller.dispose();
    activeControllers.delete(controller);
  }
}

function initBlock(block: HTMLElement) {
  if (controllers.has(block)) return;

  const transport = block.querySelector<HTMLButtonElement>('[data-strudel-transport]');
  if (!transport) return;

  let initialCode = '';
  try {
    initialCode = decodeBase64Url(block.dataset.strudelCode || '');
  } catch (error) {
    console.warn('[strudel-blocks] could not decode block source', error);
  }

  const controller = new StrudelController({
    container: block,
    initialCode,
    getAudioContext: ensureAudioContext,
    getOutputNode: () => outputGain,
    transportButton: transport,
  });

  controllers.set(block, controller);
  activeControllers.add(controller);
  block.dataset.strudelReady = 'true';

  transport.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void controller.toggle();
  });
}

export function initStrudelBlocks(root: ParentNode = document) {
  disposeDisconnectedControllers();
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-strudel-block]'));
  blocks.forEach(initBlock);
}

if (typeof window !== 'undefined') {
  const win = window as typeof window & {
    __musikiStrudelBlocksCleanupBound?: boolean;
  };

  if (win.__musikiStrudelBlocksCleanupBound !== true) {
    win.__musikiStrudelBlocksCleanupBound = true;
    document.addEventListener('astro:before-swap', () => {
      for (const controller of activeControllers) controller.dispose();
      activeControllers.clear();
    });
  }
}
