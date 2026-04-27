import { DockviewComponent } from 'dockview-core';
import type { HyperpianoController } from '../hyperpiano/HyperpianoController';

export class RoomWorkspaceManager {
  private dockview: DockviewComponent | null = null;
  private container: HTMLElement;
  private canLeadSession: () => boolean;
  private onLayoutChange: (layout: any) => void;
  private onHyperpianoInit?: (element: HTMLElement) => HyperpianoController;
  private onWhiteboardInit?: (element: HTMLElement) => void;
  private isApplyingRemoteLayout = false;
  private currentWorkspaceKey = 'full-win-speaker';
  public hyperpianoController: HyperpianoController | null = null;
  private podControllers = new Map<string, any>();
  private dragOverPanelId: string | null = null;

  private POD_TYPES = [
    { id: 'presentation', title: 'PRESENTACIÓN', icon: 'Pr', atomic: 1, color: '#6FA8DC', cat: 'structured' },
    { id: 'clase', title: 'CLASE', icon: 'Cl', atomic: 2, color: '#6FA8DC', cat: 'structured' },
    { id: 'lilypond-editor', title: 'LILY CODE', icon: 'Lc', atomic: 3, color: '#6FA8DC', cat: 'structured' },
    { id: 'lilypond-preview', title: 'LILY RENDER', icon: 'Lr', atomic: 4, color: '#6FA8DC', cat: 'structured' },
    { id: 'concept', title: 'CONCEPTOS', icon: 'Co', atomic: 5, color: '#6FA8DC', cat: 'structured' },
    { id: 'chat', title: 'CHAT', icon: 'Ch', atomic: 6, color: '#93C47D', cat: 'comm' },
    { id: 'notes', title: 'NOTAS', icon: 'Nt', atomic: 7, color: '#93C47D', cat: 'comm' },
    { id: 'whiteboard', title: 'PIZARRA', icon: 'Pi', atomic: 8, color: '#93C47D', cat: 'comm' },
    { id: 'grid-videos', title: 'GRID', icon: 'Gr', atomic: 9, color: '#F6B26B', cat: 'presence' },
    { id: 'roster', title: 'ROSTER', icon: 'Ro', atomic: 10, color: '#F6B26B', cat: 'presence' },
    { id: 'teacher', title: 'SPEAKER', icon: 'Sp', atomic: 11, color: '#E06666', cat: 'focus' },
    { id: 'screen', title: 'SCREEN', icon: 'Sc', atomic: 12, color: '#E06666', cat: 'focus' },
    { id: 'external-media', title: 'MEDIA', icon: 'Me', atomic: 13, color: '#8E7CC3', cat: 'media' },
    { id: 'graph', title: 'GRAPH', icon: 'Gr', atomic: 14, color: '#93C47D', cat: 'tools' },
    { id: 'forum', title: 'FORO', icon: 'Fo', atomic: 15, color: '#93C47D', cat: 'comm' },
    { id: 'hyperpiano', title: 'HYPERPIANO', icon: 'Hp', atomic: 16, color: '#FFD966', cat: 'tools' }
  ];

  constructor(
    container: HTMLElement,
    canLeadSession: () => boolean,
    onLayoutChange: (layout: any) => void,
    onHyperpianoInit?: (element: HTMLElement) => HyperpianoController,
    onWhiteboardInit?: (element: HTMLElement) => void
  ) {
    this.container = container;
    this.canLeadSession = canLeadSession;
    this.onLayoutChange = onLayoutChange;
    this.onHyperpianoInit = onHyperpianoInit;
    this.onWhiteboardInit = onWhiteboardInit;
  }

  public init() {
    if (!this.container) return;
    
    setTimeout(() => {
      try {
        if (this.dockview) return;

        this.dockview = new DockviewComponent(this.container, {
          disableProportionalLayout: true,
          hideTabs: true, // Use our DIY headers instead
          createComponent: (options) => {
            const id = options.id.split('-')[0];
            const isOriginal = options.id === id;
            let element = document.querySelector(`[data-pod="${id}"]`) as HTMLElement;

            if (element) {
                if (!isOriginal) {
                    element = element.cloneNode(true) as HTMLElement;
                    element.removeAttribute('id');
                }
                element.removeAttribute('hidden');
                element.style.display = 'block';
            }
            
            // Create DIY Shell
            const shell = document.createElement('div');
            shell.className = 'pod-diy-shell';
            shell.dataset.panelId = options.id;
            
            const type = this.POD_TYPES.find(t => t.id === id);
            const title = type ? type.title : id.toUpperCase();
            const header = this.createPodHeader(options.id, title, element);
            shell.appendChild(header);

            const body = document.createElement('div');
            body.className = 'pod-diy-body';
            if (element) body.appendChild(element);
            shell.appendChild(body);

            if (element) {
              if (id === 'forum') {
                this.bindForum(element);
              }
              if (id === 'hyperpiano' && this.onHyperpianoInit) {
                const hp = this.onHyperpianoInit(element);
                this.podControllers.set(options.id, hp);
              }
            }
            
            return {
              element: shell,
              init: (params: any) => {
                if (id === 'hyperpiano') {
                  params.api.onDidFocusChange((focused: boolean) => {
                    this.podControllers.get(options.id)?.setFocused(focused);
                  });
                }
                if (id === 'whiteboard' && !isOriginal && element && this.onWhiteboardInit) {
                  this.onWhiteboardInit(element);
                }
              },
              update: (params: any) => {},
              dispose: () => {
                 const hiddenStorage = document.getElementById('musiki-pod-templates');
                 if (hiddenStorage && element) {
                   if (isOriginal) {
                       element.style.display = 'none';
                       hiddenStorage.appendChild(element);
                   } else {
                       element.remove();
                   }
                 }
                 if (id === 'hyperpiano') {
                   this.podControllers.get(options.id)?.dispose();
                 }
                 this.podControllers.delete(options.id);
              }
            };
          }
        });

        const rect = this.container.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          this.dockview.layout(rect.width, rect.height);
        }

        this.dockview.onDidLayoutChange(() => {
          if (this.canLeadSession() && !this.isApplyingRemoteLayout) {
            const layout = this.dockview?.toJSON();
            if (layout) this.onLayoutChange(layout);
          }
          window.dispatchEvent(new CustomEvent('musiki:workspace:changed'));
        });

        this.setupUI();
        this.setupDefaultLayout();
        this.bindBottomBarButtons();
        this.initPodGallery();
      } catch (err) {
        console.error('Dockview init failed:', err);
      }
    }, 200);
  }

  public getActivePods() {
      if (!this.dockview) return [];
      return this.dockview.panels.map(p => ({
          id: p.id,
          controller: this.podControllers.get(p.id)
      }));
  }

  private initPodGallery() {
    const gallery = document.querySelector('[data-pod-gallery-list]');
    if (!gallery) return;
    gallery.innerHTML = '';
    this.POD_TYPES.forEach(type => {
      const item = document.createElement('div');
      item.className = 'pod-gallery-item';
      item.draggable = true;
      item.style.setProperty('--pod-color', type.color);
      item.innerHTML = `
        <div class="pod-gallery-atomic">${type.atomic}</div>
        <div class="pod-gallery-item-icon">${type.icon}</div>
        <div class="pod-gallery-item-title">${type.title}</div>
      `;
      
      item.addEventListener('dragstart', (e) => {
          if (e.dataTransfer) {
              e.dataTransfer.setData('musiki/pod-id', type.id);
              e.dataTransfer.effectAllowed = 'move';
          }
          item.classList.add('is-dragging');
      });

      item.addEventListener('dragend', () => {
          item.classList.remove('is-dragging');
      });

      item.addEventListener('click', () => {
        this.togglePod(type.id);
      });
      gallery.appendChild(item);
    });

    // Handle dropping into the dockview container
    this.container.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        const shellEl = (e.target as HTMLElement).closest('.pod-diy-shell') as HTMLElement;
        if (shellEl) {
            this.dragOverPanelId = shellEl.dataset.panelId ?? null;
        }
    });

    this.container.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!this.dockview) return;

        const podId = e.dataTransfer?.getData('musiki/pod-id');
        const panelId = e.dataTransfer?.getData('musiki/panel-id');

        // Logic to find drop direction based on mouse position relative to container center
        const rect = this.container.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;
        
        let direction: any = 'right';
        if (relX < 0.25) direction = 'left';
        else if (relX > 0.75) direction = 'right';
        else if (relY < 0.25) direction = 'above';
        else if (relY > 0.75) direction = 'below';
        else direction = 'within';

        if (podId) {
            // New pod from gallery
            this.togglePod(podId, true);
        } else if (panelId) {
            // Internal move of existing panel
            const panel = this.dockview.getPanel(panelId);
            if (panel) {
                const targetId = this.dragOverPanelId ?? this.dockview.panels.find(p => p.id !== panelId)?.id ?? null;
                
                if (targetId && targetId !== panelId) {
                    this.dockview.moveGroupOrPanel({
                        from: panel,
                        to: { referencePanel: targetId, direction }
                    });
                }
            }
        }
    });
  }

  private showPodPicker(anchor: HTMLElement, targetPanel: any) {
    const existing = document.querySelector('.pod-picker-menu');
    if (existing) existing.remove();
    const menu = document.createElement('div');
    menu.className = 'pod-picker-menu';
    this.POD_TYPES.forEach(type => {
      const item = document.createElement('button');
      item.className = 'pod-picker-item';
      if (type.id === targetPanel.id) item.classList.add('active');
      item.style.setProperty('--pod-color', type.color);
      item.innerHTML = `<span class="pod-picker-icon" style="color:${type.color}">${type.icon}</span> ${type.title}`;
      item.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.replacePod(targetPanel, type.id);
        menu.remove();
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 2}px`;
    menu.style.left = `${rect.left}px`;
    const closeMenu = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
      }
    };
    document.addEventListener('mousedown', closeMenu);
  }

  private replacePod(oldPanel: any, newId: string) {
    if (!this.dockview) return;
    const position = { referencePanel: oldPanel.id, direction: 'within' as any };
    if (oldPanel.api) oldPanel.api.close();
    const type = this.POD_TYPES.find(t => t.id === newId);
    this.dockview.addPanel({
      id: newId,
      component: newId,
      title: type ? type.title : newId.toUpperCase(),
      position
    });
  }

  private setupUI() {
    const saveBtn = document.querySelector<HTMLButtonElement>('[data-workspace-save]');
    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-workspace-delete]');

    if (saveBtn) {
      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.canLeadSession()) return;
        const name = window.prompt('Nombre del Workspace:');
        if (name) {
          const layout = this.dockview?.toJSON();
          localStorage.setItem(`musiki:workspace:${name}`, JSON.stringify(layout));
          this.currentWorkspaceKey = name;
          this.renderQuickLists();
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this.canLeadSession()) return;
        const val = this.currentWorkspaceKey;
        if (val && !['presentation', 'lilypond', 'debate', 'collab', 'full-win-speaker'].includes(val)) {
          if (window.confirm(`¿Borrar workspace "${val}"?`)) {
            localStorage.removeItem(`musiki:workspace:${val}`);
            this.currentWorkspaceKey = 'full-win-speaker';
            this.renderQuickLists();
            this.applyLayoutByKey('full-win-speaker');
          }
        }
      });
    }
    
    this.renderQuickLists();
  }

  private renderQuickLists() {
    const customList = document.querySelector('[data-workspace-custom-list]');
    const masterItems = document.querySelectorAll<HTMLButtonElement>('[data-workspace-master-list] .workspace-item');
    
    masterItems.forEach(item => {
      const val = item.dataset.workspaceVal || '';
      item.classList.toggle('active', this.currentWorkspaceKey === val);
      if (!item.dataset.bound) {
        item.addEventListener('click', () => {
          this.currentWorkspaceKey = val;
          this.applyLayoutByKey(val);
          this.renderQuickLists();
        });
        item.dataset.bound = 'true';
      }
    });

    if (customList) {
      customList.innerHTML = '';
      const customs: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('musiki:workspace:')) customs.push(key.replace('musiki:workspace:', ''));
      }
      
      if (customs.length > 0) {
        customs.sort().slice(0, 10).forEach(name => {
          const btn = document.createElement('button');
          btn.type = 'button'; 
          btn.className = 'workspace-item';
          if (this.currentWorkspaceKey === name) btn.classList.add('active');
          btn.textContent = name;
          btn.addEventListener('click', () => {
            this.currentWorkspaceKey = name;
            this.applyLayoutByKey(name);
            this.renderQuickLists();
          });
          customList.appendChild(btn);
        });
      }
    }
  }

  private createPodHeader(panelId: string, title: string, element: HTMLElement) {
      const header = document.createElement('div');
      header.className = 'pod-diy-header';
      
      const id = panelId.split('-')[0];
      const type = this.POD_TYPES.find(t => t.id === id);
      const color = type?.color || '#fff';
      header.style.setProperty('--pod-color', color);

      const arrow = document.createElement('div');
      arrow.className = 'pod-diy-arrow';
      const arrowInner = document.createElement('span');
      arrowInner.className = 'pod-diy-arrow-inner';
      arrow.appendChild(arrowInner);
      arrow.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          const panels = this.dockview?.panels || [];
          const targetPanel = panels.find(p => p.id === panelId);
          if (targetPanel) this.showPodPicker(arrow, targetPanel);
      });

      const handle = document.createElement('div');
      handle.className = 'pod-diy-handle';
      handle.innerHTML = `<div class="pod-diy-handle-dot"></div><div class="pod-diy-handle-dot"></div><div class="pod-diy-handle-dot"></div><div class="pod-diy-handle-dot"></div><div class="pod-diy-handle-dot"></div><div class="pod-diy-handle-dot"></div>`;
      handle.draggable = true;
      handle.addEventListener('dragstart', (e) => {
          if (e.dataTransfer) {
              e.dataTransfer.setData('musiki/panel-id', panelId);
              e.dataTransfer.setData('text/plain', panelId);
              e.dataTransfer.effectAllowed = 'move';
          }
          header.classList.add('is-dragging');
      });
      handle.addEventListener('dragend', () => {
          header.classList.remove('is-dragging');
          this.dragOverPanelId = null;
      });

      const titleEl = document.createElement('div');
      titleEl.className = 'pod-diy-title';
      titleEl.textContent = title;

      const actions = document.createElement('div');
      actions.className = 'pod-diy-actions';
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'pod-diy-btn pod-diy-btn--close';
      closeBtn.innerHTML = '×';
      closeBtn.addEventListener('click', () => {
          this.dockview?.getPanel(panelId)?.api.close();
      });
      
      header.appendChild(arrow);
      header.appendChild(handle);
      header.appendChild(titleEl);
      header.appendChild(actions);
      header.appendChild(closeBtn);
      
      return header;
  }

  private bindBottomBarButtons() {
    const mappings = [
      { selector: '[data-layout-choice="teacher"]', pods: ['teacher'], master: 'full-win-speaker' },
      { selector: '[data-layout-choice="screenshare"]', pods: ['screen'] },
      { selector: '[data-layout-choice="presentation"]', pods: ['presentation'], master: 'presentation' },
      { selector: '[data-layout-choice="clase"]', pods: ['clase'] },
      { selector: '[data-layout-choice="grid"]', pods: ['grid-videos'], master: 'debate' },
      { selector: '[data-layout-choice="whiteboard"]', pods: ['whiteboard'] },
      { selector: '[data-layout-choice="lilypond"]', pods: ['lilypond-editor', 'lilypond-preview'] },
      { selector: '[data-action="chat-focus"]', pods: ['chat'] },
      { selector: '[data-action="forum-toggle"]', pods: ['forum'] },
      { selector: '[data-action="concepts-toggle"]', pods: ['concept'] },
      { selector: '[data-action="external-media-toggle"]', pods: ['external-media'] },
      { selector: '[data-layout-choice="graph"]', pods: ['graph'] },
    ];
    mappings.forEach((mapping) => {
      const { selector, pods, master } = (mapping as any);
      const btn = document.querySelector(selector);
      if (btn) {
        btn.addEventListener('click', (e) => {
          if (master) {
             e.preventDefault(); e.stopPropagation();
             this.applyLayoutByKey(master);
             return;
          }
          if (selector.includes('lilypond')) {
             e.preventDefault(); e.stopPropagation();
             const hasOne = pods.some(id => this.dockview?.getPanel(id));
             if (hasOne) pods.forEach(id => this.dockview?.getPanel(id)?.api.close());
             else {
               this.dockview?.addPanel({ id: 'lilypond-preview', component: 'lilypond-preview', title: 'LILY RENDER' });
               this.dockview?.addPanel({ id: 'lilypond-editor', component: 'lilypond-editor', title: 'LILY CODE', position: { referencePanel: 'lilypond-preview', direction: 'left' } });
             }
             return;
          }
          if (selector.includes('data-action')) {
             e.preventDefault(); e.stopPropagation();
             pods.forEach(id => this.togglePod(id, true));
          }
          if (selector.includes('data-layout-choice')) pods.forEach(id => this.togglePod(id, true));
        }, true);
      }
    });
  }

  public togglePod(id: string, forceOpen = false) {
    if (!this.dockview) return;
    try {
        const canHaveMultiple = ['concept', 'whiteboard'].includes(id);
        const existing = this.dockview.getPanel(id);
        
        if (existing && !canHaveMultiple) {
          if (forceOpen) existing.api.setActive();
          else existing.api.close();
        } else {
          const titleObj = this.POD_TYPES.find(t => t.id === id);
          const panelId = canHaveMultiple ? `${id}-${Date.now()}` : id;
          this.dockview.addPanel({
            id: panelId, 
            component: id,
            title: titleObj ? titleObj.title : id.toUpperCase().replace('-', ' ')
          });
        }
    } catch (err) { console.warn(`TogglePod failed for ${id}:`, err); }
  }

  private bindForum(root: HTMLElement) {
    const frame = root.querySelector<HTMLIFrameElement>('[data-forum-frame]');
    const placeholder = root.querySelector<HTMLElement>('[data-forum-placeholder]');
    const homeBtn = root.querySelector<HTMLButtonElement>('[data-forum-action="home"]');
    if (!frame) return;
    const courseId = document.querySelector('[data-conference-root]')?.getAttribute('data-course-id') || '';
    const baseUrl = `/foro?course=${encodeURIComponent(courseId)}&view=board&scope=general&view_mode=embedded&theme=dark`;
    const loadHome = () => {
      frame.src = baseUrl;
      frame.hidden = false;
      if (placeholder) placeholder.hidden = true;
    };
    if (!frame.src || frame.src === 'about:blank' || frame.src === window.location.href) loadHome();
    homeBtn?.addEventListener('click', () => loadHome());
  }

  private setupDefaultLayout() {
    this.applyLayoutByKey('presentation');
  }

  public applyLayoutByKey(key: string) {
    if (!this.dockview) return;
    if (key === 'presentation') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'presentation', component: 'presentation', title: 'PRESENTACIÓN', size: 80 });
      this.dockview.addPanel({ id: 'teacher', component: 'teacher', title: 'SPEAKER', position: { referencePanel: 'presentation', direction: 'right' }, size: 20 });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'teacher', direction: 'below' }, size: 40 });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'grid-videos', direction: 'below' }, size: 40 });
      this.currentWorkspaceKey = 'presentation';
      this.renderQuickLists();
    } else if (key === 'clase') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'clase', component: 'clase', title: 'CLASE', size: 80 });
      this.dockview.addPanel({ id: 'teacher', component: 'teacher', title: 'SPEAKER', position: { referencePanel: 'clase', direction: 'right' }, size: 20 });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'teacher', direction: 'below' }, size: 40 });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'grid-videos', direction: 'below' }, size: 40 });
      this.currentWorkspaceKey = 'clase';
      this.renderQuickLists();
    } else if (key === 'debate') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', size: 80 });
      this.dockview.addPanel({ id: 'external-media', component: 'external-media', title: 'MEDIA', position: { referencePanel: 'grid-videos', direction: 'right' }, size: 20 });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'external-media', direction: 'below' }, size: 50 });
      this.currentWorkspaceKey = 'debate';
      this.renderQuickLists();
    } else if (key === 'lilypond') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'lilypond-preview', component: 'lilypond-preview', title: 'LILY RENDER', size: 60 });
      this.dockview.addPanel({ id: 'lilypond-editor', component: 'lilypond-editor', title: 'LILY CODE', position: { referencePanel: 'lilypond-preview', direction: 'left' }, size: 40 });
      this.dockview.addPanel({ id: 'notes', component: 'notes', title: 'NOTAS', position: { referencePanel: 'lilypond-preview', direction: 'right' }, size: 25 });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'notes', direction: 'below' } });
      this.currentWorkspaceKey = 'lilypond';
      this.renderQuickLists();
    } else if (key === 'grid') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID' });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'right' }, size: 20 });
      this.currentWorkspaceKey = 'grid';
      this.renderQuickLists();
    } else if (key === 'collab') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'notes', component: 'notes', title: 'NOTAS' });
      this.dockview.addPanel({ id: 'lilypond-editor', component: 'lilypond-editor', title: 'LILY CODE', position: { referencePanel: 'notes', direction: 'right' } });
      this.dockview.addPanel({ id: 'lilypond-preview', component: 'lilypond-preview', title: 'LILY RENDER', position: { referencePanel: 'lilypond-editor', direction: 'below' } });
      this.currentWorkspaceKey = 'collab';
      this.renderQuickLists();
    } else if (key === 'full-win-speaker') {
       this.clearAllPanels();
       this.dockview.addPanel({ id: 'teacher', component: 'teacher', title: 'SPEAKER' });
       this.currentWorkspaceKey = 'full-win-speaker';
       this.renderQuickLists();
    } else {
      const custom = localStorage.getItem(`musiki:workspace:${key}`);
      if (custom) this.applyLayout(JSON.parse(custom));
    }
  }

  private clearAllPanels() {
    if (!this.dockview) return;
    this.dockview.panels.forEach(p => p.api.close());
  }

  public applyLayout(layout: any) {
    if (!this.dockview || !layout) return;
    this.isApplyingRemoteLayout = true;
    try {
      if (typeof layout === 'string') this.applyLayoutByKey(layout);
      else this.dockview.fromJSON(layout);
    } catch (e) { console.error('Error applying remote layout:', e); }
    finally { this.isApplyingRemoteLayout = false; }
  }

  public getLayout() { return this.dockview?.toJSON(); }
}

// DIY Pod Styles
const style = document.createElement('style');
style.textContent = `
  .workspace-item {
    width: 100% !important;
    background: transparent !important;
    border: 1px solid rgba(255, 255, 255, 0.4) !important;
    color: #fff !important;
    padding: 0.35rem 0.6rem !important;
    border-radius: 3px !important;
    font-size: 0.7rem !important;
    text-align: left !important;
    cursor: pointer !important;
    text-transform: uppercase !important;
    letter-spacing: 0.05em !important;
    font-weight: 500 !important;
    transition: all 0.1s ease !important;
    margin-bottom: 4px;
  }
  .workspace-item:hover {
    background: rgba(255, 255, 255, 0.05) !important;
    border-color: #fff !important;
  }
  .workspace-item.active {
    background: #fff !important;
    color: #000 !important;
    border-color: #fff !important;
    font-weight: 900 !important;
  }

  /* DIY Integrated Shell */
  .pod-diy-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
    background: #000;
    position: relative;
  }
  .pod-diy-header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 18px;
    display: flex;
    align-items: center;
    background: transparent;
    padding: 0 4px;
    gap: 6px;
    border-top: 1px solid var(--pod-color, #444);
    z-index: 100;
    pointer-events: none;
  }
  .pod-diy-header.is-dragging {
      opacity: 0.5;
  }
  .pod-diy-arrow, .pod-diy-handle, .pod-diy-btn {
    pointer-events: auto;
  }
  .pod-diy-arrow {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 2px;
    background: rgba(255,255,255,0.05);
  }
  .pod-diy-arrow-inner {
    width: 4px;
    height: 4px;
    border-right: 1px solid var(--pod-color, #fff);
    border-bottom: 1px solid var(--pod-color, #fff);
    transform: rotate(45deg);
    margin-top: -2px;
  }
  .pod-diy-handle {
    display: grid;
    grid-template-columns: repeat(2, 2px);
    grid-template-rows: repeat(3, 2px);
    gap: 1.5px;
    padding: 2px;
    opacity: 0.3;
    mix-blend-mode: difference;
    cursor: grab;
  }
  .pod-diy-handle-dot {
    width: 2px;
    height: 2px;
    background: #fff;
    border-radius: 50%;
  }
  .pod-diy-title {
    font-size: 0.54rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #fff;
    mix-blend-mode: difference;
    opacity: 0.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1;
    flex: 1;
  }
  .pod-diy-btn {
    background: none;
    border: none;
    color: #fff;
    mix-blend-mode: difference;
    opacity: 0.5;
    cursor: pointer;
    font-size: 14px;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 2px;
    padding: 0;
  }
  .pod-diy-btn:hover {
    opacity: 1;
    background: rgba(255,255,255,0.1);
  }
  .pod-diy-body {
    flex: 1;
    min-height: 0;
    position: relative;
    height: 100%;
    padding-top: 18px; 
  }

  /* Aggressive Dockview Header Hiding - Kill the Abyss */
  .dv-header, .dv-tab-container, .dv-tab, .dv-separator, .dv-tab-divider, .dv-tab-separator, .dv-tabs-and-actions-container {
    display: none !important;
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    visibility: hidden !important;
    contain: strict !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
`;
document.head.appendChild(style);
document.head.appendChild(style);
