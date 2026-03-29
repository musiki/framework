import { Room } from 'livekit-client';

import { normalizeText } from '../core/normalize';

export type DevicePanelKind = 'audio' | 'video';

type CreateRoomDeviceSelectControllerOptions = {
  audioInputPanel?: HTMLElement | null;
  audioInputSelects: HTMLSelectElement[];
  getActiveAudioDeviceId: () => string;
  getActiveVideoDeviceId: () => string;
  getPreferredAudioInputId: () => string;
  getPreferredVideoInputId: () => string;
  onAudioInputChange: (deviceId: string) => Promise<void>;
  onVideoInputChange: (deviceId: string) => Promise<void>;
  syncControlState: () => void;
  videoInputPanel?: HTMLElement | null;
  videoInputSelects: HTMLSelectElement[];
};

export type RoomDeviceSelectController = {
  bind: () => void;
  closePanels: () => void;
  cycleVideoInput: () => void;
  getActivePanel: () => DevicePanelKind | null;
  hasChoices: (kind: DevicePanelKind) => boolean;
  refreshOptions: (requestPermissions?: boolean) => Promise<void>;
  syncGroupValue: (kind: DevicePanelKind, nextValue: string) => void;
  togglePanel: (kind: DevicePanelKind) => void;
};

const fallbackDeviceLabel = (kind: 'audioinput' | 'videoinput', index: number) =>
  kind === 'audioinput' ? `Microfono ${index + 1}` : `Camara ${index + 1}`;

const populateDeviceSelect = ({
  activeDeviceId,
  devices,
  emptyLabel,
  kind,
  select,
}: {
  activeDeviceId?: string;
  devices: MediaDeviceInfo[];
  emptyLabel: string;
  kind: 'audioinput' | 'videoinput';
  select: HTMLSelectElement;
}) => {
  const previousValue = normalizeText(select.value);
  select.innerHTML = '';

  if (devices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = emptyLabel;
    select.appendChild(option);
    return;
  }

  devices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = normalizeText(device.label) || fallbackDeviceLabel(kind, index);
    select.appendChild(option);
  });

  const preferredValue = [activeDeviceId, previousValue, devices[0]?.deviceId]
    .map((value) => normalizeText(value))
    .find((value) => value && devices.some((device) => device.deviceId === value));

  if (preferredValue) {
    select.value = preferredValue;
  }
};

const setDevicePanelVisibility = (panel: HTMLElement | null | undefined, visible: boolean) => {
  if (!panel) return;
  panel.hidden = !visible;
  panel.dataset.open = visible ? 'true' : 'false';
};

export const createRoomDeviceSelectController = ({
  audioInputPanel,
  audioInputSelects,
  getActiveAudioDeviceId,
  getActiveVideoDeviceId,
  getPreferredAudioInputId,
  getPreferredVideoInputId,
  onAudioInputChange,
  onVideoInputChange,
  syncControlState,
  videoInputPanel,
  videoInputSelects,
}: CreateRoomDeviceSelectControllerOptions): RoomDeviceSelectController => {
  let activeDevicePanel: DevicePanelKind | null = null;

  const syncSelectGroupValue = (selects: HTMLSelectElement[], nextValue: string) => {
    selects.forEach((select) => {
      if (normalizeText(select.value) === nextValue) return;
      select.value = nextValue;
    });
  };

  const closePanels = () => {
    activeDevicePanel = null;
    setDevicePanelVisibility(audioInputPanel, false);
    setDevicePanelVisibility(videoInputPanel, false);
  };

  const openPanel = (kind: DevicePanelKind) => {
    activeDevicePanel = kind;
    setDevicePanelVisibility(audioInputPanel, kind === 'audio');
    setDevicePanelVisibility(videoInputPanel, kind === 'video');
  };

  const togglePanel = (kind: DevicePanelKind) => {
    if (activeDevicePanel === kind) {
      closePanels();
      return;
    }

    openPanel(kind);
  };

  const refreshOptions = async (requestPermissions = false) => {
    const deviceTasks: Promise<void>[] = [];

    if (audioInputSelects.length > 0) {
      deviceTasks.push(
        Room.getLocalDevices('audioinput', requestPermissions)
          .then((devices) => {
            audioInputSelects.forEach((select) => {
              populateDeviceSelect({
                activeDeviceId: getActiveAudioDeviceId() || getPreferredAudioInputId(),
                devices,
                emptyLabel: 'No se detectaron microfonos',
                kind: 'audioinput',
                select,
              });
            });
          })
          .catch(() => {
            audioInputSelects.forEach((select) => {
              populateDeviceSelect({
                devices: [],
                emptyLabel: 'No se detectaron microfonos',
                kind: 'audioinput',
                select,
              });
            });
          }),
      );
    }

    if (videoInputSelects.length > 0) {
      deviceTasks.push(
        Room.getLocalDevices('videoinput', requestPermissions)
          .then((devices) => {
            videoInputSelects.forEach((select) => {
              populateDeviceSelect({
                activeDeviceId: getActiveVideoDeviceId() || getPreferredVideoInputId(),
                devices,
                emptyLabel: 'No se detectaron camaras',
                kind: 'videoinput',
                select,
              });
            });
          })
          .catch(() => {
            videoInputSelects.forEach((select) => {
              populateDeviceSelect({
                devices: [],
                emptyLabel: 'No se detectaron camaras',
                kind: 'videoinput',
                select,
              });
            });
          }),
      );
    }

    await Promise.all(deviceTasks);
    syncControlState();
  };

  const bindSelects = (selects: HTMLSelectElement[], kind: DevicePanelKind) => {
    selects.forEach((select) => {
      if (select.dataset.roomDeviceBound === 'true') return;
      select.dataset.roomDeviceBound = 'true';
      select.addEventListener('change', () => {
        const nextDeviceId = normalizeText(select.value);
        if (!nextDeviceId) return;

        syncSelectGroupValue(kind === 'audio' ? audioInputSelects : videoInputSelects, nextDeviceId);
        void (kind === 'audio' ? onAudioInputChange(nextDeviceId) : onVideoInputChange(nextDeviceId));
      });
    });
  };

  return {
    bind() {
      bindSelects(audioInputSelects, 'audio');
      bindSelects(videoInputSelects, 'video');
    },
    closePanels,
    cycleVideoInput() {
      const select = videoInputSelects.find((entry) => entry.options.length > 0);
      if (!(select instanceof HTMLSelectElement)) return;

      const options = Array.from(select.options)
        .map((option) => normalizeText(option.value))
        .filter(Boolean);

      if (options.length === 0) return;

      const currentValue =
        normalizeText(select.value) ||
        normalizeText(getActiveVideoDeviceId()) ||
        normalizeText(getPreferredVideoInputId());

      const currentIndex = Math.max(0, options.indexOf(currentValue));
      const nextValue = options[(currentIndex + 1) % options.length];
      syncSelectGroupValue(videoInputSelects, nextValue);
      select.value = nextValue;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    },
    getActivePanel() {
      return activeDevicePanel;
    },
    hasChoices(kind) {
      const selects = kind === 'audio' ? audioInputSelects : videoInputSelects;
      return selects.some((select) => Array.from(select.options).some((option) => option.value));
    },
    refreshOptions,
    syncGroupValue(kind, nextValue) {
      syncSelectGroupValue(kind === 'audio' ? audioInputSelects : videoInputSelects, nextValue);
    },
    togglePanel,
  };
};
