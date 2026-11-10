// Lista de temas (claro, oscuro, invulne, dracula, lyt) que abren el sol del
// Ribbon y el del Header. La lógica de aplicar el tema vive en
// window.musikiAppearance (BaseHead); acá sólo se arma y se ubica el menú.
// Estilos: .theme-menu* en src/styles/global.css.

type AppearanceApi = {
  themes: { id: string; label: string; dark: boolean }[];
  get: () => string;
  set: (id: string) => void;
};

/** side: a la derecha del botón (ribbon vertical). below: debajo, alineado a su borde derecho (header). */
export type ThemeMenuPlacement = 'side' | 'below';

const appearance = () => (window as unknown as { musikiAppearance?: AppearanceApi }).musikiAppearance;

let menu: HTMLElement | null = null;
let anchorButton: HTMLElement | null = null;

export const closeThemeMenu = () => {
  if (!menu) return;
  menu.hidden = true;
  anchorButton?.setAttribute('aria-expanded', 'false');
  anchorButton = null;
};

const placeMenu = (anchor: HTMLElement, placement: ThemeMenuPlacement) => {
  if (!menu) return;
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left: number;
  let top: number;
  if (placement === 'below') {
    left = Math.min(rect.right - menuRect.width, window.innerWidth - menuRect.width - 8);
    top = rect.bottom + 6;
  } else if (rect.top > window.innerHeight - 120) {
    // Ribbon como barra inferior en mobile: el menú va arriba.
    left = Math.min(rect.left, window.innerWidth - menuRect.width - 8);
    top = rect.top - menuRect.height - 6;
  } else {
    left = rect.right + 6;
    top = Math.min(rect.top, window.innerHeight - menuRect.height - 8);
  }
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
};

export const toggleThemeMenu = (anchor: HTMLElement, placement: ThemeMenuPlacement) => {
  const api = appearance();
  if (!api) return;
  const wasOpenHere = menu && !menu.hidden && anchorButton === anchor;
  closeThemeMenu();
  if (wasOpenHere) return;
  if (!menu || !menu.isConnected) {
    menu = document.createElement('div');
    menu.className = 'theme-menu';
    menu.setAttribute('role', 'menu');
    menu.addEventListener('click', (event) => {
      const option = (event.target as Element).closest<HTMLElement>('[data-appearance]');
      if (!option) return;
      appearance()?.set(option.dataset.appearance || '');
      closeThemeMenu();
    });
    document.body.appendChild(menu);
  }
  const active = api.get();
  menu.replaceChildren(...api.themes.map((theme) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-menu-option';
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-checked', theme.id === active ? 'true' : 'false');
    option.dataset.appearance = theme.id;
    const swatch = document.createElement('span');
    swatch.className = 'theme-menu-swatch';
    swatch.dataset.swatch = theme.id;
    option.append(swatch, document.createTextNode(theme.label));
    return option;
  }));
  menu.hidden = false;
  anchorButton = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  placeMenu(anchor, placement);
  menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
};

/** Conecta un botón al menú. Idempotente: se puede llamar en cada astro:page-load. */
export const bindThemeMenuButton = (button: HTMLElement | null, placement: ThemeMenuPlacement) => {
  if (!button || button.dataset.themeMenuBound) return;
  button.dataset.themeMenuBound = 'true';
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleThemeMenu(button, placement);
  });
};

// Un módulo se evalúa una sola vez: estos listeners no se duplican.
if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    if (menu && !menu.hidden && !menu.contains(event.target as Node)) closeThemeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeThemeMenu();
  });
  document.addEventListener('astro:before-swap', closeThemeMenu);
}
