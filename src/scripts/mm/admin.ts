// mm admin page (/admin): invitations, access rules, members, open joining
// and forums. Lists come from the admin JSON APIs (same-origin) and are built
// with createElement/textContent only; nothing from the server is parsed as
// HTML. Each section has a polite status region for results and an alert
// region for errors (429 included, via mmApi); focus moves to a sensible
// place after every change so keyboard and screen-reader users keep context.

import { mmApi, errorText, pageStrings, ApiFailure } from './api.ts';
import { adminErrorKind, libraryPickerOptions, type PickerLibrary } from '../../lib/mm/client-core.ts';
import { formatDate } from '../../lib/mm/view.ts';

type Role = 'admin' | 'curator' | 'member' | 'guest';
const ALL_ROLES: Role[] = ['admin', 'curator', 'member', 'guest'];

type Invite = { id: string; email: string; role: string; expiresAt: string };
type Rule = { id: string; kind: 'email' | 'domain'; value: string; role: string };
type Member = { userId: string; name: string | null; email: string | null; role: Role; joinedAt: string };
type Forum = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  isArchived: boolean;
  /** Group of a channel; null for a top-level forum. */
  parentId: string | null;
  /** The forum's own settings (a channel's empty keys use its group's). */
  settings: { seshatLibraryId?: string; zoteroCollection?: string; ownerEmail?: string };
};

const root = document.querySelector<HTMLElement>('[data-mm-admin]');

function S(key: string, vars: Record<string, string | number> = {}): string {
  const raw = pageStrings()[`admin.${key}`] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

const roleLabel = (role: string) => (ALL_ROLES.includes(role as Role) ? S(`roles.${role}`) : role);

type Attrs = Record<string, string | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null) el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiFailure) {
    const kind = adminErrorKind(err.status, err.detail);
    if (kind === 'lastAdmin') return S('members.lastAdmin');
    if (kind === 'self') return S('members.self');
    if (kind === 'slugTaken') return S('forums.slugTaken');
  }
  return errorText(err);
}

function busy(el: HTMLElement, on: boolean): void {
  el.setAttribute('aria-busy', on ? 'true' : 'false');
  const buttons = el instanceof HTMLButtonElement ? [el] : [...el.querySelectorAll<HTMLButtonElement>('button')];
  for (const b of buttons) b.disabled = on;
}

class Section {
  el: HTMLElement;
  okEl: HTMLElement;
  errEl: HTMLElement;
  list: HTMLElement | null;
  constructor(name: string) {
    this.el = root!.querySelector<HTMLElement>(`[data-section="${name}"]`)!;
    this.okEl = this.el.querySelector<HTMLElement>(':scope > [data-ok]')!;
    this.errEl = this.el.querySelector<HTMLElement>(':scope > [data-err]')!;
    this.list = this.el.querySelector<HTMLElement>(':scope > [data-list]');
  }
  ok(message: string | Node[]): void {
    this.errEl.hidden = true;
    this.errEl.textContent = '';
    this.okEl.replaceChildren(...(typeof message === 'string' ? [h('p', { text: message })] : message));
  }
  err(message: string): void {
    this.okEl.replaceChildren();
    this.errEl.textContent = message;
    this.errEl.hidden = false;
  }
  clear(): void {
    this.okEl.replaceChildren();
    this.errEl.hidden = true;
  }
  /** Loads a list; on failure shows the error and a retry button in its place. */
  async load<T>(url: string, pick: (data: any) => T, render: (value: T) => void): Promise<boolean> {
    const list = this.list!;
    list.setAttribute('aria-busy', 'true');
    try {
      render(pick(await mmApi(url)));
      return true;
    } catch (err) {
      const retry = h('button', { type: 'button', class: 'mm-button mm-button-small mm-button-quiet', text: S('retry') });
      retry.addEventListener('click', () => void this.load(url, pick, render));
      list.replaceChildren(h('p', { class: 'mm-alert', role: 'alert', text: `${S('loadFailed')} ${errorMessage(err)}` }), retry);
      return false;
    } finally {
      list.setAttribute('aria-busy', 'false');
    }
  }
}

/** Client-side check before sending: the first invalid field gets focus and its browser message. */
function invalidField(form: HTMLFormElement): HTMLInputElement | HTMLTextAreaElement | null {
  for (const f of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
    if (f.type !== 'radio') f.value = f.type === 'email' ? f.value.trim() : f.value;
    if (!f.checkValidity()) return f;
  }
  return null;
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const v = new FormData(form).get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function focusLater(el: HTMLElement | null | undefined): void {
  if (el) setTimeout(() => el.focus(), 0);
}

// ——— Invitations ———
function initInvites(): void {
  const sec = new Section('invites');
  const form = sec.el.querySelector<HTMLFormElement>('[data-admin-form="invite"]')!;
  const heading = sec.el.querySelector<HTMLElement>('#mm-a-invites-list');
  const lang = root!.dataset.mmLang as 'en' | 'nb';

  const render = (invites: Invite[]) => {
    if (!invites.length) {
      sec.list!.replaceChildren(h('p', { class: 'mm-muted', text: S('invites.empty') }));
      return;
    }
    const ul = h('ul', { class: 'mm-admin-list' });
    for (const inv of invites) {
      const revoke = h('button', {
        type: 'button', class: 'mm-button mm-button-small mm-button-quiet',
        'aria-label': S('invites.revokeLabel', { email: inv.email }), text: S('invites.revoke'),
      });
      revoke.addEventListener('click', async () => {
        busy(revoke, true);
        try {
          await mmApi(`/api/mm/admin/invites?id=${encodeURIComponent(inv.id)}`, { method: 'DELETE' });
          sec.ok(S('invites.revoked', { email: inv.email }));
          await reload();
          focusLater(heading);
        } catch (err) {
          sec.err(errorMessage(err));
          busy(revoke, false);
        }
      });
      ul.append(h('li', {},
        h('span', { class: 'mm-admin-main' },
          h('strong', { text: inv.email }), ' ',
          h('span', { class: 'mm-badge mm-badge-quiet', text: roleLabel(inv.role) }), ' ',
          h('span', { class: 'mm-meta', text: S('invites.expires', { date: formatDate(inv.expiresAt, lang) }) })),
        revoke));
    }
    sec.list!.replaceChildren(ul);
  };
  const reload = () => sec.load('/api/mm/admin/invites', (d) => (d?.invites ?? []) as Invite[], render);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    const bad = invalidField(form);
    if (bad) {
      sec.err(bad.validationMessage);
      bad.focus();
      return;
    }
    busy(form, true);
    try {
      const r = await mmApi<{ url: string; email: string; role: string; expiresInDays: number }>('/api/mm/admin/invites', {
        method: 'POST', body: { email: fieldValue(form, 'email'), role: fieldValue(form, 'role') },
      });
      sec.ok([
        h('p', { text: S('invites.created', { email: r.email, role: roleLabel(r.role), days: r.expiresInDays }) }),
        h('p', {}, `${S('invites.linkLead')} `, h('code', { class: 'mm-admin-link', text: r.url })),
      ]);
      (form.elements.namedItem('email') as HTMLInputElement).value = '';
      await reload();
      focusLater(form.elements.namedItem('email') as HTMLInputElement);
    } catch (err) {
      sec.err(errorMessage(err));
      focusLater(form.elements.namedItem('email') as HTMLInputElement);
    } finally {
      busy(form, false);
    }
  });
  void reload();
}

// ——— Access rules ———
function initRules(): void {
  const sec = new Section('rules');
  const form = sec.el.querySelector<HTMLFormElement>('[data-admin-form="rule"]')!;
  const heading = sec.el.querySelector<HTMLElement>('#mm-a-rules-list');
  const valueInput = form.elements.namedItem('value') as HTMLInputElement;

  const render = (rules: Rule[]) => {
    if (!rules.length) {
      sec.list!.replaceChildren(h('p', { class: 'mm-muted', text: S('rules.empty') }));
      return;
    }
    const ul = h('ul', { class: 'mm-admin-list' });
    for (const rule of rules) {
      const shown = rule.kind === 'domain' ? `@${rule.value}` : rule.value;
      const del = h('button', {
        type: 'button', class: 'mm-button mm-button-small mm-button-quiet',
        'aria-label': S('rules.deleteLabel', { value: shown }), text: S('rules.delete'),
      });
      del.addEventListener('click', async () => {
        busy(del, true);
        try {
          await mmApi(`/api/mm/admin/rules?ruleId=${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
          sec.ok(S('rules.deleted', { value: shown }));
          await reload();
          focusLater(heading);
        } catch (err) {
          sec.err(errorMessage(err));
          busy(del, false);
        }
      });
      ul.append(h('li', {},
        h('span', { class: 'mm-admin-main' },
          h('strong', { text: S(rule.kind === 'domain' ? 'rules.domainRule' : 'rules.emailRule', { value: rule.value }) }), ' ',
          h('span', { class: 'mm-badge mm-badge-quiet', text: roleLabel(rule.role) })),
        del));
    }
    sec.list!.replaceChildren(ul);
  };
  const reload = () => sec.load('/api/mm/admin/rules', (d) => (d?.rules ?? []) as Rule[], render);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.getAttribute('aria-busy') === 'true') return;
    const bad = invalidField(form);
    if (bad) {
      sec.err(bad.validationMessage);
      bad.focus();
      return;
    }
    const kind = fieldValue(form, 'kind') === 'domain' ? 'domain' : 'email';
    const raw = fieldValue(form, 'value');
    const value = kind === 'domain' ? raw.replace(/^@/, '') : raw;
    busy(form, true);
    try {
      await mmApi('/api/mm/admin/rules', { method: 'POST', body: { kind, value, role: fieldValue(form, 'role') } });
      sec.ok(S('rules.added'));
      valueInput.value = '';
      await reload();
    } catch (err) {
      sec.err(errorMessage(err));
    } finally {
      busy(form, false);
      focusLater(valueInput);
    }
  });
  void reload();
}

// ——— Members ———
function initMembers(): void {
  const sec = new Section('members');
  const heading = sec.el.querySelector<HTMLElement>('#mm-a-members');
  const selfId = root!.dataset.mmSelf ?? '';
  const lang = root!.dataset.mmLang as 'en' | 'nb';
  const dialog = root!.querySelector<HTMLDialogElement>('[data-confirm-remove]')!;
  const dialogLead = dialog.querySelector<HTMLElement>('[data-confirm-lead]')!;
  let pending: { member: Member; name: string; opener: HTMLButtonElement } | null = null;

  const nameOf = (m: Member) => m.name?.trim() || m.email || S('members.noName');

  const render = (members: Member[]) => {
    if (!members.length) {
      sec.list!.replaceChildren(h('p', { class: 'mm-muted', text: S('members.empty') }));
      return;
    }
    const tbody = h('tbody');
    for (const m of members) {
      const name = nameOf(m);
      const isSelf = m.userId === selfId;
      const nameCell = h('td', {}, h('span', { text: m.name?.trim() || S('members.noName') }));
      if (isSelf) nameCell.append(' ', h('span', { class: 'mm-badge mm-badge-quiet', text: S('members.you') }));
      const roleCell = h('td');
      const actions = h('td');
      if (isSelf) {
        roleCell.append(h('span', { text: roleLabel(m.role) }));
      } else {
        const select = h('select', { 'aria-label': S('members.roleLabel', { name }), 'data-member-role': m.userId });
        for (const r of ALL_ROLES) {
          const opt = h('option', { value: r, text: roleLabel(r) });
          if (r === m.role) opt.selected = true;
          select.append(opt);
        }
        const save = h('button', {
          type: 'button', class: 'mm-button mm-button-small', 'aria-label': S('members.saveLabel', { name }), text: S('members.save'),
        });
        save.addEventListener('click', async () => {
          if (select.value === m.role) {
            sec.ok(S('members.unchanged', { name }));
            return;
          }
          busy(save, true);
          select.disabled = true;
          try {
            const r = await mmApi<{ role: string }>('/api/mm/admin/members', {
              method: 'PATCH', body: { userId: m.userId, role: select.value },
            });
            sec.ok(S('members.changed', { name, role: roleLabel(r.role) }));
            await reload();
            focusLater(sec.list!.querySelector<HTMLElement>(`[data-member-role="${m.userId}"]`) ?? heading);
          } catch (err) {
            sec.err(errorMessage(err));
            busy(save, false);
            select.value = m.role; // show the role the member still has
            select.disabled = false;
            focusLater(select);
          }
        });
        roleCell.append(h('span', { class: 'mm-admin-role' }, select, save));
        const remove = h('button', {
          type: 'button', class: 'mm-button mm-button-small mm-button-quiet', 'aria-label': S('members.removeLabel', { name }),
          text: S('members.remove'),
        });
        remove.addEventListener('click', () => {
          pending = { member: m, name, opener: remove };
          dialogLead.textContent = S('members.confirmLead', { name });
          dialog.showModal();
        });
        actions.append(remove);
      }
      // data-label: the column name shown on phones, where rows stack (mm-app.css).
      nameCell.dataset.label = S('members.name');
      roleCell.dataset.label = S('members.role');
      actions.dataset.label = S('members.actions');
      tbody.append(h('tr', {},
        nameCell,
        h('td', { class: 'mm-admin-email', 'data-label': S('members.email'), text: m.email ?? '' }),
        roleCell,
        h('td', { class: 'mm-nowrap', 'data-label': S('members.joined'), text: formatDate(m.joinedAt, lang) }),
        actions));
    }
    const head = h('tr', {}, ...(['name', 'email', 'role', 'joined', 'actions'] as const).map((k) => h('th', { scope: 'col', text: S(`members.${k}`) })));
    sec.list!.replaceChildren(h('div', { class: 'mm-table-wrap' }, h('table', { class: 'mm-table mm-admin-members' }, h('thead', {}, head), tbody)));
  };
  const reload = () => sec.load('/api/mm/admin/members', (d) => (d?.members ?? []) as Member[], render);

  // The dialog's own form (method="dialog") closes it; the choice is read
  // from the submitter here rather than from the asynchronous close event.
  const settle = async (confirmed: boolean) => {
    const p = pending;
    pending = null;
    if (!p) return;
    if (!confirmed) {
      focusLater(p.opener);
      return;
    }
    busy(p.opener, true);
    try {
      await mmApi(`/api/mm/admin/members?userId=${encodeURIComponent(p.member.userId)}`, { method: 'DELETE' });
      sec.ok(S('members.removed', { name: p.name }));
      await reload();
      focusLater(heading);
    } catch (err) {
      sec.err(errorMessage(err));
      busy(p.opener, false);
      focusLater(p.opener);
    }
  };
  dialog.querySelector('form')!.addEventListener('submit', (event) => {
    const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
    void settle(submitter?.value === 'confirm');
  });
  dialog.addEventListener('cancel', () => void settle(false)); // Escape
  void reload();
}

// ——— Open joining ———
function initOpenJoin(): void {
  const sec = new Section('open');
  const box = sec.el.querySelector<HTMLInputElement>('[data-open-join]')!;
  void (async () => {
    try {
      const r = await mmApi<{ openJoin: boolean }>('/api/mm/admin/settings');
      box.checked = r.openJoin === true;
      box.disabled = false;
    } catch (err) {
      sec.err(`${S('loadFailed')} ${errorMessage(err)}`);
    }
  })();
  box.addEventListener('change', async () => {
    const want = box.checked;
    box.disabled = true;
    try {
      const r = await mmApi<{ openJoin: boolean }>('/api/mm/admin/settings', { method: 'PATCH', body: { openJoin: want } });
      box.checked = r.openJoin === true;
      sec.ok(S(box.checked ? 'openJoin.on' : 'openJoin.off'));
    } catch (err) {
      box.checked = !want;
      sec.err(errorMessage(err));
    } finally {
      box.disabled = false;
      focusLater(box);
    }
  });
}

// ——— Seshat library picker ———
type LibraryListing = { available: boolean; libraries: PickerLibrary[] };
const LIBRARY_TTL_MS = 60_000;
const libraryCache = new Map<string, { at: number; listing: Promise<LibraryListing> }>();

/** The owner's Seshat libraries (admin API), cached per owner for a minute. */
function ownerLibraries(owner: string): Promise<LibraryListing> {
  const hit = libraryCache.get(owner);
  if (hit && Date.now() - hit.at < LIBRARY_TTL_MS) return hit.listing;
  const listing = mmApi<LibraryListing>(`/api/mm/admin/seshat-libraries?owner=${encodeURIComponent(owner)}`).then((r) => ({
    available: r?.available === true,
    libraries: Array.isArray(r?.libraries) ? r.libraries : [],
  }));
  libraryCache.set(owner, { at: Date.now(), listing });
  listing.catch(() => libraryCache.delete(owner));
  return listing;
}

/**
 * Wires a forum form's bibliography fieldset: once the owner email is valid,
 * the owner's libraries fill an accessible <select> whose choice is written
 * into the seshatLibraryId field; that field stays available under
 * "Enter id manually" (opened when the list is unavailable or empty).
 */
function attachLibraryPicker(form: HTMLFormElement): { refresh: () => Promise<void> } {
  const ownerInput = form.elements.namedItem('ownerEmail') as HTMLInputElement;
  const idInput = form.elements.namedItem('seshatLibraryId') as HTMLInputElement;
  const row = form.querySelector<HTMLElement>('[data-lib-picker]')!;
  const select = form.querySelector<HTMLSelectElement>('[data-lib-select]')!;
  const status = form.querySelector<HTMLElement>('[data-lib-status]')!;
  const manual = form.querySelector<HTMLDetailsElement>('[data-lib-manual]')!;
  let libraries: PickerLibrary[] | null = null;
  let seq = 0;

  const fillOptions = () => {
    if (!libraries) return;
    const options = libraryPickerOptions(libraries, idInput.value, {
      none: S('forums.seshatNone'), option: S('forums.seshatOption'), unknown: S('forums.seshatUnknown'),
    });
    select.replaceChildren(...options.map((o) => {
      const el = h('option', { value: o.value, text: o.label });
      el.selected = o.selected;
      return el;
    }));
  };
  const fallBack = (message: string) => {
    libraries = null;
    row.hidden = true;
    status.textContent = message;
    manual.open = true;
  };

  const refresh = async () => {
    const n = ++seq;
    const owner = ownerInput.value.trim().toLowerCase();
    if (!owner || !ownerInput.checkValidity()) {
      libraries = null;
      row.hidden = true;
      status.textContent = S('forums.seshatNeedOwner');
      if (idInput.value.trim()) manual.open = true;
      return;
    }
    status.textContent = S('forums.seshatLoading');
    select.disabled = true;
    try {
      const listing = await ownerLibraries(owner);
      if (n !== seq) return;
      if (!listing.available) return fallBack(S('forums.seshatUnavailable'));
      libraries = listing.libraries;
      fillOptions();
      row.hidden = false;
      select.disabled = false;
      status.textContent = libraries.length ? S('forums.seshatLoaded', { count: libraries.length }) : S('forums.seshatEmpty');
      if (!libraries.length) manual.open = true;
    } catch (err) {
      if (n === seq) fallBack(`${S('forums.seshatUnavailable')} (${errorMessage(err)})`);
    }
  };

  select.addEventListener('change', () => {
    idInput.value = select.value;
  });
  idInput.addEventListener('change', fillOptions);
  let timer: ReturnType<typeof setTimeout> | undefined;
  ownerInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 600);
  });
  ownerInput.addEventListener('change', () => {
    clearTimeout(timer);
    void refresh();
  });
  return { refresh };
}

// ——— Forums ———
function initForums(): void {
  const sec = new Section('forums');
  const heading = sec.el.querySelector<HTMLElement>('#mm-a-forums-list');
  const createForm = sec.el.querySelector<HTMLFormElement>('[data-admin-form="forum-create"]')!;
  const tpl = root!.querySelector<HTMLTemplateElement>('template[data-tpl="forum-edit"]')!;
  const channelTpl = root!.querySelector<HTMLTemplateElement>('template[data-tpl="channel-create"]')!;
  const BIB = ['seshatLibraryId', 'zoteroCollection', 'ownerEmail'] as const;

  const formErr = (form: HTMLFormElement, message: string | null) => {
    const el = form.querySelector<HTMLElement>('[data-form-err]')!;
    el.textContent = message ?? '';
    el.hidden = !message;
    if (message) sec.okEl.replaceChildren();
  };

  /** A form cloned from a template, with ids made unique by `suffix`. */
  const cloneForm = (template: HTMLTemplateElement, suffix: string): HTMLFormElement => {
    const frag = template.content.cloneNode(true) as DocumentFragment;
    const form = frag.querySelector('form')!;
    for (const el of form.querySelectorAll<HTMLElement>('[id]')) el.id += suffix;
    for (const el of form.querySelectorAll<HTMLLabelElement>('label[for]')) el.htmlFor += suffix;
    for (const el of form.querySelectorAll<HTMLElement>('[aria-describedby]')) {
      el.setAttribute('aria-describedby', el.getAttribute('aria-describedby')!.split(/\s+/).map((id) => id + suffix).join(' '));
    }
    return form;
  };

  /** The edit form from the template, with ids made unique per forum. */
  const editForm = (forum: Forum, n: number): HTMLFormElement => {
    const form = cloneForm(tpl, `-${n}`);
    const set = (name: string, value: string | null | undefined) => {
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value = value ?? '';
    };
    set('title', forum.title);
    set('description', forum.description);
    for (const k of BIB) set(k, forum.settings?.[k]);
    // A channel's bibliography fields are an override of its group's.
    const channelHelp = form.querySelector<HTMLElement>('[data-channel-bib-help]');
    if (channelHelp) channelHelp.hidden = !forum.parentId;
    form.setAttribute('aria-label', S('forums.editLabel', { title: forum.title }));
    return form;
  };

  const channelErrorMessage = (err: unknown) =>
    err instanceof ApiFailure && adminErrorKind(err.status, err.detail) === 'slugTaken' ? S('forums.channelSlugTaken') : errorMessage(err);

  /** "Add channel" toggle + form (slug, title, description, collapsed bibliography override). */
  const channelCreator = (group: Forum, n: number): HTMLElement => {
    const slotId = `mm-channel-new-${n}`;
    const add = h('button', {
      type: 'button', class: 'mm-button mm-button-small', 'aria-expanded': 'false', 'aria-controls': slotId,
      'aria-label': S('forums.addChannelLabel', { title: group.title }), text: S('forums.addChannel'), 'data-add-channel': group.id,
    });
    const slot = h('div', { id: slotId });
    const close = () => {
      slot.replaceChildren();
      add.setAttribute('aria-expanded', 'false');
    };
    add.addEventListener('click', () => {
      if (add.getAttribute('aria-expanded') === 'true') return close();
      const form = cloneForm(channelTpl, `-${n}`);
      form.setAttribute('aria-label', S('forums.addChannelLabel', { title: group.title }));
      form.querySelector<HTMLElement>('[data-channel-slug-help]')!.textContent = S('forums.channelSlugHelp', { group: group.slug });
      const picker = attachLibraryPicker(form);
      form.querySelector<HTMLDetailsElement>('[data-bib-override]')!.addEventListener('toggle', () => void picker.refresh());
      form.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => {
        close();
        focusLater(add);
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (form.getAttribute('aria-busy') === 'true') return;
        const bad = invalidField(form);
        if (bad) {
          const override = form.querySelector<HTMLDetailsElement>('[data-bib-override]')!;
          if (override.contains(bad)) override.open = true;
          formErr(form, bad.validationMessage);
          bad.focus();
          return;
        }
        formErr(form, null);
        const body: Record<string, unknown> = { title: fieldValue(form, 'title') };
        const slug = fieldValue(form, 'slug');
        const description = fieldValue(form, 'description');
        if (slug) body.slug = slug;
        if (description) body.description = description;
        const settings: Record<string, string> = {};
        for (const k of BIB) {
          const v = fieldValue(form, k);
          if (v) settings[k] = v;
        }
        if (Object.keys(settings).length) body.settings = settings;
        busy(form, true);
        try {
          const r = await mmApi<{ forum: Forum }>(`/api/mm/forums/${encodeURIComponent(group.id)}/channels`, { method: 'POST', body });
          sec.ok(S('forums.channelCreated', { title: r.forum?.title ?? String(body.title), group: group.title }));
          await reload();
          focusLater(sec.list!.querySelector<HTMLElement>(`[data-add-channel="${group.id}"]`) ?? heading);
        } catch (err) {
          formErr(form, channelErrorMessage(err));
          busy(form, false);
        }
      });
      slot.replaceChildren(form);
      add.setAttribute('aria-expanded', 'true');
      focusLater(form.elements.namedItem('title') as HTMLInputElement);
    });
    return h('div', {}, h('div', { class: 'mm-form-actions' }, add), slot);
  };

  const render = (forums: Forum[]) => {
    if (!forums.length) {
      sec.list!.replaceChildren(h('p', { class: 'mm-muted', text: S('forums.empty') }));
      return;
    }
    const groups = forums.filter((f) => !f.parentId);
    const channelsOf = (g: Forum) => forums.filter((f) => f.parentId === g.id);
    let counter = 0;
    const ul = h('ul', { class: 'mm-admin-forums' });
    for (const group of groups) {
      const li = item(group, counter++, null);
      const channels = channelsOf(group);
      const headingId = `mm-channels-of-${counter}`;
      li.append(h('p', { class: 'mm-admin-channels-title', id: headingId }, h('strong', { text: S('forums.channelsTitle', { title: group.title }) })));
      if (channels.length) {
        const sub = h('ul', { class: 'mm-admin-channels', 'aria-labelledby': headingId });
        for (const ch of channels) sub.append(item(ch, counter++, group));
        li.append(sub);
      } else {
        li.append(h('p', { class: 'mm-muted', text: S('forums.noChannels') }));
      }
      if (!group.isArchived) li.append(channelCreator(group, counter++));
      ul.append(li);
    }
    sec.list!.replaceChildren(ul);
  };

  /** One forum (group) or channel entry: title, address, bibliography, edit/archive. */
  const item = (forum: Forum, n: number, group: Forum | null): HTMLLIElement => {
    const li = h('li', { 'data-forum-id': forum.id });
    const title = h('p', { class: 'mm-admin-forum-title' }, h('strong', { text: forum.title }));
    if (forum.isArchived) title.append(' ', h('span', { class: 'mm-badge mm-badge-quiet', text: S('forums.archived') }));
    const meta = h('p', { class: 'mm-meta' });
    const address = group
      ? S('forums.channelAddress', { group: group.slug, slug: forum.slug })
      : S('forums.address', { slug: forum.slug });
    const href = group
      ? `/f/${encodeURIComponent(group.slug)}/${encodeURIComponent(forum.slug)}`
      : `/f/${encodeURIComponent(forum.slug)}`;
    meta.append(forum.isArchived || group?.isArchived
      ? h('span', { text: address })
      : h('a', { href, text: address }));
    const bib = h('dl', { class: 'mm-admin-dl' });
    const labels: Record<(typeof BIB)[number], string> = {
      seshatLibraryId: S('forums.seshat'), zoteroCollection: S('forums.zotero'), ownerEmail: S('forums.owner'),
    };
    for (const k of BIB) {
      const v = forum.settings?.[k];
      if (v) bib.append(h('dt', { text: labels[k] }), h('dd', { text: v }));
    }
    const linkedId = forum.settings?.seshatLibraryId;
    const linkedOwner = forum.settings?.ownerEmail?.trim().toLowerCase();
    if (linkedId && linkedOwner) {
      ownerLibraries(linkedOwner).then((listing) => {
        const lib = listing.libraries.find((l) => l.id === linkedId);
        if (lib) bib.append(h('dt', { text: S('forums.seshatPick') }), h('dd', { text: lib.path || lib.name }));
      }, () => { /* the id above is enough */ });
    }
    const desc = forum.description ? h('p', { class: 'mm-list-desc mm-pre-line', text: forum.description }) : null;
    const inherits = group && !BIB.some((k) => forum.settings?.[k]) ? h('p', { class: 'mm-help', text: S('forums.inheritsBib') }) : null;

    const editId = `mm-forum-edit-${n}`;
    const edit = h('button', {
      type: 'button', class: 'mm-button mm-button-small', 'aria-expanded': 'false', 'aria-controls': editId,
      'aria-label': S('forums.editLabel', { title: forum.title }), text: S('forums.edit'), 'data-edit': forum.id,
    });
    const archive = h('button', {
      type: 'button', class: 'mm-button mm-button-small mm-button-quiet', 'data-archive': forum.id,
      'aria-label': S(forum.isArchived ? 'forums.restoreLabel' : 'forums.archiveLabel', { title: forum.title }),
      text: S(forum.isArchived ? 'forums.restore' : 'forums.archive'),
    });
    const actions = h('div', { class: 'mm-form-actions' }, edit, archive);
    const slot = h('div', { id: editId });

    edit.addEventListener('click', () => {
      if (edit.getAttribute('aria-expanded') === 'true') {
        slot.replaceChildren();
        edit.setAttribute('aria-expanded', 'false');
        return;
      }
      const form = editForm(forum, n);
      form.querySelector<HTMLButtonElement>('[data-cancel]')!.addEventListener('click', () => {
        slot.replaceChildren();
        edit.setAttribute('aria-expanded', 'false');
        focusLater(edit);
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (form.getAttribute('aria-busy') === 'true') return;
        const bad = invalidField(form);
        if (bad) {
          formErr(form, bad.validationMessage);
          bad.focus();
          return;
        }
        formErr(form, null);
        const settings: Record<string, string> = {};
        for (const k of BIB) settings[k] = fieldValue(form, k); // '' clears the key
        const newTitle = fieldValue(form, 'title');
        busy(form, true);
        try {
          await mmApi(`/api/mm/forums/${encodeURIComponent(forum.id)}`, {
            method: 'PATCH', body: { title: newTitle, description: fieldValue(form, 'description'), settings },
          });
          sec.ok(S('forums.saved', { title: newTitle }));
          await reload();
          focusLater(sec.list!.querySelector<HTMLElement>(`[data-edit="${forum.id}"]`) ?? heading);
        } catch (err) {
          formErr(form, errorMessage(err));
          busy(form, false);
        }
      });
      slot.replaceChildren(form);
      void attachLibraryPicker(form).refresh();
      edit.setAttribute('aria-expanded', 'true');
      focusLater(form.elements.namedItem('title') as HTMLInputElement);
    });

    archive.addEventListener('click', async () => {
      busy(archive, true);
      try {
        await mmApi(`/api/mm/forums/${encodeURIComponent(forum.id)}`, { method: 'PATCH', body: { isArchived: !forum.isArchived } });
        sec.ok(S(forum.isArchived ? 'forums.restoredDone' : 'forums.archivedDone', { title: forum.title }));
        await reload();
        focusLater(sec.list!.querySelector<HTMLElement>(`[data-archive="${forum.id}"]`) ?? heading);
      } catch (err) {
        sec.err(errorMessage(err));
        busy(archive, false);
      }
    });

    li.append(title, meta, desc ?? '', bib.childElementCount ? bib : '', inherits ?? '', actions, slot);
    return li;
  };
  const reload = () => sec.load('/api/mm/admin/forums', (d) => (d?.forums ?? []) as Forum[], render);

  // New forums default to the signed-in admin as the bibliography owner.
  const selfEmail = root!.dataset.mmSelfEmail ?? '';
  const createOwner = createForm.elements.namedItem('ownerEmail') as HTMLInputElement;
  const createPicker = attachLibraryPicker(createForm);
  const resetCreateOwner = () => {
    if (selfEmail && !createOwner.value) createOwner.value = selfEmail;
    void createPicker.refresh();
  };
  resetCreateOwner();

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (createForm.getAttribute('aria-busy') === 'true') return;
    const bad = invalidField(createForm);
    if (bad) {
      formErr(createForm, bad.validationMessage);
      bad.focus();
      return;
    }
    formErr(createForm, null);
    const body: Record<string, unknown> = { title: fieldValue(createForm, 'title') };
    const slug = fieldValue(createForm, 'slug');
    const description = fieldValue(createForm, 'description');
    if (slug) body.slug = slug;
    if (description) body.description = description;
    const settings: Record<string, string> = {};
    for (const k of BIB) {
      const v = fieldValue(createForm, k);
      if (v) settings[k] = v;
    }
    if (Object.keys(settings).length) body.settings = settings;
    busy(createForm, true);
    try {
      const r = await mmApi<{ forum: Forum }>('/api/mm/forums', { method: 'POST', body });
      sec.ok(S('forums.created', { title: r.forum?.title ?? String(body.title) }));
      createForm.reset();
      resetCreateOwner();
      await reload();
      focusLater(heading);
    } catch (err) {
      formErr(createForm, errorMessage(err));
    } finally {
      busy(createForm, false);
    }
  });
  void reload();
}

if (root) {
  initInvites();
  initRules();
  initMembers();
  initOpenJoin();
  initForums();
}
