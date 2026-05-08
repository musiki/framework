import { DockviewComponent } from 'dockview-core';
import type { HyperpianoController } from '../hyperpiano/HyperpianoController';

export class RoomWorkspaceManager {
  private dockview: DockviewComponent | null = null;
  private container: HTMLElement;
  private canLeadSession: () => boolean;
  private onLayoutChange: (layout: any) => void;
  private onHyperpianoInit?: (element: HTMLElement) => HyperpianoController;
  private onWhiteboardInit?: (element: HTMLElement) => void;
  private onLilypondInit?: (element: HTMLElement) => void;
  private onConceptInit?: (element: HTMLElement) => void;
  private onMediaInit?: (element: HTMLElement) => void;
  private onClaseInit?: (element: HTMLElement) => void;
  private onChatInit?: (element: HTMLElement) => void;
  private onOrfInit?: (element: HTMLElement) => void;
  private onScoreInit?: (element: HTMLElement) => void;
  private onSonicAnalyzerInit?: (element: HTMLElement) => void;
  private onSonicVisualizerInit?: (element: HTMLElement) => void;
  private onRecursosInit?: (element: HTMLElement) => void;
  private isApplyingRemoteLayout = false;
  private currentWorkspaceKey = 'full-win-speaker';
  public hyperpianoController: HyperpianoController | null = null;
  private podControllers = new Map<string, any>();
  private dragOverPanelId: string | null = null;
  private activeDraggingId: string | null = null;
  private savedDragTarget: string | null = null;
  private savedDragDir = 'right';

  private POD_TYPES = [
    { id: 'presentation', title: 'PRESENTACIÓN', icon: 'Pr', atomic: 1, color: '#6FA8DC', cat: 'structured' },
    { id: 'clase', title: 'CLASE', icon: 'Cl', atomic: 2, color: '#6FA8DC', cat: 'structured' },
    { id: 'lily-code', title: 'LILYCODE', icon: 'Lc', atomic: 3, color: '#E06666', cat: 'structured' },
    { id: 'lily-render', title: 'LILY-RENDER', icon: 'Lr', atomic: 4, color: '#F6B26B', cat: 'structured' },
    { id: 'concept', title: 'CONCEPTOS', icon: 'Co', atomic: 5, color: '#93C47D', cat: 'structured' },
    { id: 'chat', title: 'CHAT', icon: 'Ch', atomic: 6, color: '#93C47D', cat: 'comm' },
    { id: 'orf', title: 'ORF', icon: 'Or', atomic: 7, color: '#76D3FF', cat: 'comm' },
    { id: 'notes', title: 'NOTAS', icon: 'Nt', atomic: 8, color: '#93C47D', cat: 'comm' },
    { id: 'whiteboard', title: 'PIZARRA', icon: 'Pi', atomic: 9, color: '#76D3FF', cat: 'comm' },
    { id: 'grid-videos', title: 'GRID', icon: 'Gr', atomic: 10, color: '#B4A7D6', cat: 'presence' },
    { id: 'roster', title: 'ROSTER', icon: 'Ro', atomic: 11, color: '#B4A7D6', cat: 'presence' },
    { id: 'teacher', title: 'SPEAKER', icon: 'Sp', atomic: 12, color: '#E06666', cat: 'focus' },
    { id: 'screen', title: 'SCREEN', icon: 'Sc', atomic: 13, color: '#E06666', cat: 'focus' },
    { id: 'external-media', title: 'MEDIA', icon: 'Me', atomic: 14, color: '#8E7CC3', cat: 'media' },
    { id: 'graph', title: 'GRAPH', icon: 'Gr', atomic: 15, color: '#93C47D', cat: 'tools' },
    { id: 'forum', title: 'FORO', icon: 'Fo', atomic: 16, color: '#93C47D', cat: 'comm' },
    { id: 'hyperpiano', title: 'HYPERPIANO', icon: 'Hp', atomic: 17, color: '#FFD966', cat: 'tools' },
    { id: 'instant-score', title: 'SCORE', icon: 'Is', atomic: 18, color: '#F1C232', cat: 'tools' },
    { id: 'sonic-analyzer',   title: 'SA', icon: 'Sa', atomic: 19, color: '#45D384', cat: 'tools' },
    { id: 'sonic-visualizer', title: 'SV', icon: 'Sv', atomic: 20, color: '#45D384', cat: 'tools' },
    { id: 'recursos', title: 'RECURSOS', icon: 'Re', atomic: 21, color: '#6fa8dc', cat: 'comm' }
  ];

  constructor(
    container: HTMLElement,
    canLeadSession: () => boolean,
    onLayoutChange: (layout: any) => void,
    onHyperpianoInit?: (element: HTMLElement) => HyperpianoController,
    onWhiteboardInit?: (element: HTMLElement) => void,
    onLilypondInit?: (element: HTMLElement) => void,
    onConceptInit?: (element: HTMLElement) => void,
    onMediaInit?: (element: HTMLElement) => void,
    onClaseInit?: (element: HTMLElement) => void,
    onChatInit?: (element: HTMLElement) => void,
    onOrfInit?: (element: HTMLElement) => void,
    onScoreInit?: (element: HTMLElement) => void,
    onSonicAnalyzerInit?: (element: HTMLElement) => void,
    onSonicVisualizerInit?: (element: HTMLElement) => void,
    onRecursosInit?: (element: HTMLElement) => void
  ) {
    this.container = container;
    this.canLeadSession = canLeadSession;
    this.onLayoutChange = onLayoutChange;
    this.onHyperpianoInit = onHyperpianoInit;
    this.onWhiteboardInit = onWhiteboardInit;
    this.onLilypondInit = onLilypondInit;
    this.onConceptInit = onConceptInit;
    this.onMediaInit = onMediaInit;
    this.onClaseInit = onClaseInit;
    this.onChatInit = onChatInit;
    this.onOrfInit = onOrfInit;
    this.onScoreInit = onScoreInit;
    this.onSonicAnalyzerInit   = onSonicAnalyzerInit;
    this.onSonicVisualizerInit = onSonicVisualizerInit;
    this.onRecursosInit        = onRecursosInit;
  }

  public init() {
    if (!this.container) return;
    this.container.classList.add('dockview-container');
    
    setTimeout(() => {
      try {
        if (this.dockview) return;

        this.dockview = new DockviewComponent(this.container, {
          disableProportionalLayout: true,
          hideTabs: true, // Use our DIY headers instead
          createComponent: (options) => {
            const rawId = options.id;
            // Find which pod type this is by checking if the ID starts with any known POD_TYPE id
            const podType = this.POD_TYPES.find(t => rawId === t.id || rawId.startsWith(t.id + '-'));
            let id = podType ? podType.id : rawId.split('-')[0];
            
            // Map old IDs to new ones if necessary
            if (id === 'lilypond-editor') id = 'lily-code';
            if (id === 'lilypond-preview') id = 'lily-render';

            const templateDiv = document.getElementById('musiki-pod-templates');
            const dataScript = document.getElementById('musiki-presentation-data');
            const presentationOptions = dataScript ? JSON.parse(dataScript.textContent || '[]') : [];
            
            let element = templateDiv?.querySelector(`[data-pod="${id}"]`) as HTMLElement;

            if (element) {
                // ALWAYS CLONE from template storage so we never exhaust the source
                element = element.cloneNode(true) as HTMLElement;
                element.removeAttribute('hidden');
                element.style.display = 'block';
            } else {
                console.warn(`[RoomWorkspaceManager] Template for pod "${id}" (resolved from ${rawId}) not found.`);
            }
            
            // Create DIY Shell
            const shell = document.createElement('div');
            shell.className = 'pod-diy-shell';
            shell.dataset.panelId = options.id;
            
            const title = podType ? podType.title : id.toUpperCase().replace(/-/g, '');
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
              if ((id === 'lily-code' || id === 'lily-render') && this.onLilypondInit) {
                this.onLilypondInit(element);
              }
              if (id === 'concept' && this.onConceptInit) {
                this.onConceptInit(element);
              }
              if (id === 'external-media' && this.onMediaInit) {
                this.onMediaInit(element);
              }
              if (id === 'clase' && this.onClaseInit) {
                this.onClaseInit(element);
              }
              if (id === 'chat' && this.onChatInit) {
                this.onChatInit(element);
              }
              if (id === 'orf' && this.onOrfInit) {
                this.onOrfInit(element);
              }
              if (id === 'instant-score' && this.onScoreInit) {
                this.onScoreInit(element);
              }
              if (id === 'sonic-analyzer' && this.onSonicAnalyzerInit) {
                this.onSonicAnalyzerInit(element);
              }
              if (id === 'sonic-visualizer' && this.onSonicVisualizerInit) {
                this.onSonicVisualizerInit(element);
              }
              if (id === 'recursos' && this.onRecursosInit) {
                this.onRecursosInit(element);
              }
              if (id === 'graph') {
                delete element.dataset.graphPodReady;
                window.setTimeout(() => {
                  (window as any).MusikiGraphPodInit?.(element);
                }, 100);
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
                if (id === 'whiteboard' && element && this.onWhiteboardInit) {
                  this.onWhiteboardInit(element);
                }
              },
              update: (params: any) => {},
              dispose: () => {
                 if (element) element.remove();
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
          this.activeDraggingId = type.id;
          item.classList.add('is-dragging');
      });

      item.addEventListener('dragend', () => {
          this.activeDraggingId = null;
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
        
        let shellEl = (e.target as HTMLElement).closest('.pod-diy-shell') as HTMLElement;
        if (!shellEl) {
            const handleEl = (e.target as HTMLElement).closest('.pod-diy-handle');
            if (handleEl) {
                shellEl = handleEl.closest('.pod-diy-shell') as HTMLElement;
            }
        }

        if (shellEl && shellEl.dataset.panelId !== this.activeDraggingId) {
            // Calculate direction for preview
            const rect = shellEl.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            
            let direction = 'within';
            if (relX < 0.2) direction = 'left';
            else if (relX > 0.8) direction = 'right';
            else if (relY < 0.2) direction = 'above';
            else if (relY > 0.8) direction = 'below';
            
            // Clear others first to be safe, then set current
            this.container.querySelectorAll('.pod-diy-shell.is-drag-over').forEach(el => {
                if (el !== shellEl) el.classList.remove('is-drag-over');
            });
            
            shellEl.classList.add('is-drag-over');
            shellEl.setAttribute('data-drag-dir', direction);
            this.dragOverPanelId = shellEl.dataset.panelId ?? null;
            this.savedDragTarget = this.dragOverPanelId;
            this.savedDragDir = direction;
        } else {
            this.container.querySelectorAll('.pod-diy-shell.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
            this.dragOverPanelId = null;
            // savedDragTarget intentionally NOT cleared here — preserved for dragend
        }
    });

    this.container.addEventListener('dragleave', (e) => {
        const shellEl = (e.target as HTMLElement).closest('.pod-diy-shell') as HTMLElement;
        if (shellEl && !shellEl.contains(e.relatedTarget as Node)) {
            shellEl.classList.remove('is-drag-over');
            shellEl.removeAttribute('data-drag-dir');
        }
    });

    this.container.addEventListener('drop', (e) => {
        e.preventDefault();
        
        const shellEl = (e.target as HTMLElement).closest('.pod-diy-shell') as HTMLElement;
        const direction = shellEl?.getAttribute('data-drag-dir') || 'right';

        // Clear highlights
        this.container.querySelectorAll('.pod-diy-shell.is-drag-over').forEach(el => {
            el.classList.remove('is-drag-over');
            el.removeAttribute('data-drag-dir');
        });
        
        if (!this.dockview) return;

        const podId = e.dataTransfer?.getData('musiki/pod-id');

        this.dragOverPanelId = null;

        if (podId) {
            // Gallery pod drop: place relative to last valid hover target
            const position = this.savedDragTarget
                ? { referencePanel: this.savedDragTarget, direction: this.savedDragDir as any }
                : undefined;
            this.togglePod(podId, true, position);
            this.savedDragTarget = null;
            this.activeDraggingId = null;
        }
        // Panel-to-panel moves are handled in handle's dragend (more reliable timing)
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
    const oldId = oldPanel.id;
    
    // If it's the same base pod type, do nothing
    if (oldId.split('-')[0] === newId) return;

    const titleObj = this.POD_TYPES.find(t => t.id === newId);
    const canHaveMultiple = ['concept', 'whiteboard', 'hyperpiano', 'graph', 'forum', 'clase', 'lily-code', 'lily-render'].includes(newId);
    const panelId = canHaveMultiple ? `${newId}-${Date.now()}` : newId;

    // ADD NEW PANEL FIRST relative to the old one's position
    this.dockview.addPanel({
        id: panelId,
        component: newId,
        title: titleObj ? titleObj.title : newId.toUpperCase().replace('-', ' '),
        position: { referencePanel: oldId, direction: 'within' as any }
    });
    
    // NOW CLOSE OLD
    setTimeout(() => {
        if (oldPanel.api) oldPanel.api.close();
    }, 50);
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
          const root = document.querySelector<HTMLElement>('[data-conference-root]');
          const showCircle = root?.dataset.showCircle === 'true';
          const gridSlot = root?.querySelector<HTMLElement>('[data-slot="grid"]');
          const gridSize = gridSlot?.dataset.gridSize || 'normal';
          
          localStorage.setItem(`musiki:workspace:${name}`, JSON.stringify({
            dockview: layout,
            settings: { showCircle, gridSize },
          }));
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
          this.activeDraggingId = panelId;
          header.classList.add('is-dragging');
      });
      handle.addEventListener('dragend', () => {
          // Perform the move here — more reliable than drop event for same-window DnD
          if (this.savedDragTarget && this.dockview && panelId !== this.savedDragTarget) {
              const movingPanel = this.dockview.getPanel(panelId);
              const targetPanel = this.dockview.getPanel(this.savedDragTarget);
              if (movingPanel && targetPanel) {
                  const dirMap: Record<string, string> = { left: 'left', right: 'right', above: 'top', below: 'bottom', within: 'center' };
                  this.dockview.moveGroupOrPanel({
                      from: { groupId: (movingPanel as any).group.id, panelId: movingPanel.id },
                      to: { group: (targetPanel as any).group, position: (dirMap[this.savedDragDir] ?? 'right') as any }
                  });
              }
          }
          this.savedDragTarget = null;
          this.savedDragDir = 'right';
          this.activeDraggingId = null;
          header.classList.remove('is-dragging');
          this.container.querySelectorAll('.pod-diy-shell.is-drag-over').forEach(el => {
              el.classList.remove('is-drag-over');
              el.removeAttribute('data-drag-dir');
          });
          this.dragOverPanelId = null;
      });

      const titleEl = document.createElement('div');
      titleEl.className = 'pod-diy-title';
      titleEl.textContent = title || id.toUpperCase().replace(/-/g, '');

      const actions = document.createElement('div');
      actions.className = 'pod-diy-actions';
      
      const closeBtn = document.createElement('button');
      closeBtn.className = 'pod-diy-btn pod-diy-btn--close';
      closeBtn.type = 'button';
      closeBtn.innerHTML = '×';
      closeBtn.title = 'Cerrar pod';
      closeBtn.style.cursor = 'pointer';
      closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); }); 
      closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const panel = this.dockview?.getPanel(panelId);
          if (panel) {
              panel.api.close();
          } else {
              // Try finding by base ID as fallback
              const baseId = panelId.split('-')[0];
              const found = this.dockview?.panels.find(p => p.id === baseId || p.id.startsWith(baseId + '-'));
              found?.api.close();
          }
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
      { selector: '[data-layout-choice="screenshare"]', pods: ['screen'], master: 'screenshare' },
      { selector: '[data-layout-choice="presentation"]', pods: ['presentation'], master: 'presentation' },
      { selector: '[data-layout-choice="grid"]', pods: ['grid-videos'], master: 'grid' },
      { selector: '[data-action="external-media-toggle"]', pods: ['external-media'], master: 'external-media' },
      
      { selector: '[data-layout-choice="clase"]', pods: ['clase'] },
      { selector: '[data-layout-choice="whiteboard"]', pods: ['whiteboard'], master: 'whiteboard' },
      { selector: '[data-layout-choice="lilypond"]', pods: ['lily-code', 'lily-render'], master: 'lilypond' },

      { selector: '[data-action="chat-focus"]', pods: ['chat'] },
      { selector: '[data-action="forum-toggle"]', pods: ['forum'] },
      { selector: '[data-action="concepts-toggle"]', pods: ['concept'] },
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
                   this.dockview?.addPanel({ id: 'lily-render', component: 'lily-render', title: 'LILY-RENDER' });
                   this.dockview?.addPanel({ id: 'lily-code', component: 'lily-code', title: 'LILYCODE', position: { referencePanel: 'lily-render', direction: 'left' } });
                 }

             return;
          }

          if (selector.includes('chat-focus')) {
             e.preventDefault(); e.stopPropagation();
             this.focusOrOpenChat();
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

  public togglePod(id: string, forceOpen = false, position?: any) {
    if (!this.dockview) return;
    try {
        const canHaveMultiple = ['concept', 'whiteboard', 'hyperpiano', 'graph', 'forum', 'clase', 'lily-code', 'lily-render'].includes(id); 
        const existing = this.dockview.getPanel(id);
        
        if (existing && !canHaveMultiple) {
          if (forceOpen) {
              existing.api.setActive();
              if (position) {
                  this.dockview.moveGroupOrPanel({
                      from: existing as any,
                      to: position as any
                  });
              }
          }
          else existing.api.close();
        } else {
          const titleObj = this.POD_TYPES.find(t => t.id === id);
          const panelId = canHaveMultiple ? `${id}-${Date.now()}` : id;
          this.dockview.addPanel({
            id: panelId,
            component: id,
            title: titleObj ? titleObj.title : id.toUpperCase().replace(/-/g, ''),
            position: position
          });
        }

    } catch (err) { console.warn(`TogglePod failed for ${id}:`, err); }
  }

  private findPanelByBaseId(id: string) {
    return this.dockview?.panels.find((panel) => panel.id === id || panel.id.startsWith(`${id}-`)) ?? null;
  }

  public focusOrOpenChat() {
    if (!this.dockview) return;
    const existing = this.findPanelByBaseId('chat');
    if (existing) {
      existing.api.setActive();
      window.dispatchEvent(new CustomEvent('musiki:chat:focus-request'));
      return;
    }

    const referencePanel = this.dockview.panels.find((panel) => panel.id !== 'chat');
    const cW = this.container.getBoundingClientRect().width || this.container.offsetWidth || 1280;
    this.dockview.addPanel({
      id: 'chat',
      component: 'chat',
      title: 'CHAT',
      position: referencePanel ? { referencePanel: referencePanel.id, direction: 'right' } : undefined,
      initialWidth: Math.round(cW * 0.25),
    });
    window.setTimeout(() => {
      this.dockview?.getPanel('chat')?.api.setActive();
      window.dispatchEvent(new CustomEvent('musiki:chat:focus-request'));
    }, 80);
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
    this.applyLayoutByKey(window.innerWidth <= 500 ? 'mobile' : 'presentation');
  }

  public applyLayoutByKey(key: string) {
    if (!this.dockview) return;

    // Check if there's a saved override for this master key
    const custom = localStorage.getItem(`musiki:workspace:${key}`);
    if (custom) {
      this.applyLayout(JSON.parse(custom));
      this.currentWorkspaceKey = key;
      this.renderQuickLists();
      return;
    }

    // Pixel sizes for addPanel (Dockview 5.x uses initialWidth/initialHeight, not size)
    // Use offsetWidth/offsetHeight as fallback when getBoundingClientRect returns 0 at init time
    const rect = this.container.getBoundingClientRect();
    const W = rect.width > 10 ? rect.width : (this.container.offsetWidth || 1280);
    const H = rect.height > 10 ? rect.height : (this.container.offsetHeight || 720);
    const side = Math.round(W * 0.2);      // right sidebar: 20%
    const lilyLeft = Math.round(W * 0.4);  // lily-code left panel: 40%
    const q = Math.round(H * 0.25);        // sidebar quarter-height (4 equal rows)
    const t = Math.round(H * 0.33);        // sidebar third-height  (3 equal rows)

    if (key === 'full-win-speaker') {
      // F — SPEAKER main + right sidebar
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'teacher', component: 'teacher', title: 'SPEAKER' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'teacher', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'full-win-speaker';
      this.renderQuickLists();
    } else if (key === 'screenshare') {
      // S — SCREEN SHARE main + right sidebar
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'screen', component: 'screen', title: 'SCREEN' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'screen', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'screenshare';
      this.renderQuickLists();
    } else if (key === 'presentation') {
      // P — PRESENTACIÓN main + right sidebar
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'presentation', component: 'presentation', title: 'PRESENTACIÓN' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'presentation', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'presentation';
      this.renderQuickLists();
    } else if (key === 'debate' || key === 'grid') {
      // G — GRID main + right sidebar (no grid in sidebar)
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID' });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: t });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: t });
      this.currentWorkspaceKey = key;
      this.renderQuickLists();
    } else if (key === 'external-media') {
      // E — EXTERNAL MEDIA main + right sidebar
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'external-media', component: 'external-media', title: 'MEDIA' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'external-media', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'external-media';
      this.renderQuickLists();
    } else if (key === 'whiteboard') {
      // Z — PIZARRA main + right sidebar
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'whiteboard', component: 'whiteboard', title: 'PIZARRA' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'whiteboard', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'whiteboard';
      this.renderQuickLists();
    } else if (key === 'lilypond') {
      // L — LILY-CODE + LILY-RENDER (left 80%) + right sidebar
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'lily-render', component: 'lily-render', title: 'LILY-RENDER' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'lily-render', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'lily-code', component: 'lily-code', title: 'LILY-CODE', position: { referencePanel: 'lily-render', direction: 'left' }, initialWidth: lilyLeft });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'lilypond';
      this.renderQuickLists();
    } else if (key === 'collab') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'notes', component: 'notes', title: 'NOTAS' });
      this.dockview.addPanel({ id: 'lily-code', component: 'lily-code', title: 'LILY-CODE', position: { referencePanel: 'notes', direction: 'right' } });
      this.dockview.addPanel({ id: 'lily-render', component: 'lily-render', title: 'LILY-RENDER', position: { referencePanel: 'lily-code', direction: 'below' } });
      this.currentWorkspaceKey = 'collab';
      this.renderQuickLists();
    } else if (key === 'clase') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'clase', component: 'clase', title: 'CLASE' });
      this.dockview.addPanel({ id: 'grid-videos', component: 'grid-videos', title: 'GRID', position: { referencePanel: 'clase', direction: 'right' }, initialWidth: side });
      this.dockview.addPanel({ id: 'roster', component: 'roster', title: 'ROSTER', position: { referencePanel: 'grid-videos', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'recursos', component: 'recursos', title: 'RECURSOS', position: { referencePanel: 'roster', direction: 'below' }, initialHeight: q });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'recursos', direction: 'below' }, initialHeight: q });
      this.currentWorkspaceKey = 'clase';
      this.renderQuickLists();
    } else if (key === 'mobile') {
      this.clearAllPanels();
      this.dockview.addPanel({ id: 'teacher', component: 'teacher', title: 'SPEAKER' });
      this.dockview.addPanel({ id: 'chat', component: 'chat', title: 'CHAT', position: { referencePanel: 'teacher', direction: 'below' }, initialHeight: Math.round(H * 0.35) });
      this.currentWorkspaceKey = 'mobile';
      this.renderQuickLists();
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
      else {
        const dockviewLayout = layout.dockview ?? layout;
        this.dockview.fromJSON(dockviewLayout);
        if (layout.settings) {
          window.dispatchEvent(new CustomEvent('musiki:workspace:settings', {
            detail: layout.settings,
          }));
        }
      }
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
  .pod-diy-shell.is-drag-over {
    outline: 1px solid rgba(255, 255, 255, 0.2) !important;
  }
  .pod-diy-shell.is-drag-over::after {
    content: '';
    position: absolute;
    background: var(--conference-accent-hi, #76d3ff);
    opacity: 0.4;
    z-index: 1000;
    pointer-events: none;
    transition: all 0.1s ease;
  }
  .pod-diy-shell.is-drag-over[data-drag-dir="left"]::after { left: 0; top: 0; bottom: 0; width: 30%; }
  .pod-diy-shell.is-drag-over[data-drag-dir="right"]::after { right: 0; top: 0; bottom: 0; width: 30%; }
  .pod-diy-shell.is-drag-over[data-drag-dir="above"]::after { left: 0; right: 0; top: 0; height: 30%; }
  .pod-diy-shell.is-drag-over[data-drag-dir="below"]::after { left: 0; right: 0; bottom: 0; height: 30%; }
  .pod-diy-shell.is-drag-over[data-drag-dir="within"]::after { inset: 10%; opacity: 0.2; }
  .pod-diy-shell {
    position: relative;
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }
  .pod-diy-header {
    position: relative;
    width: 100%;
    height: 18px;
    display: flex;
    align-items: center;
    background: transparent !important;
    color: #fff;
    padding: 0 4px;
    gap: 6px;
    border-top: 1px solid var(--pod-color, #444);
    z-index: 100;
    flex-shrink: 0;
  }
  .pod-diy-header.is-dragging {
      opacity: 0.5;
  }
  .pod-diy-arrow, .pod-diy-handle, .pod-diy-btn {
    pointer-events: auto !important;
    z-index: 1000 !important;
  }
  .pod-diy-arrow {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 2px;
    background: transparent !important;
    color: #fff;
  }
  .pod-diy-arrow-inner {
    width: 4px;
    height: 4px;
    border-right: 1px solid currentColor;
    border-bottom: 1px solid currentColor;
    transform: rotate(45deg);
    margin-top: -2px;
  }
  .pod-diy-handle {
    display: grid;
    grid-template-columns: repeat(2, 2px);
    grid-template-rows: repeat(3, 2px);
    gap: 1.5px;
    padding: 2px;
    opacity: 0.8;
    cursor: grab;
  }
  .pod-diy-handle-dot {
    width: 2px;
    height: 2px;
    background: #fff;
    border-radius: 50%;
  }
  .pod-diy-title {
    font-size: 0.58rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--pod-color, #fff) !important;
    text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 1px rgba(0,0,0,0.7);
    opacity: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1;
    flex: 1;
  }
  .pod-diy-btn {
    background: transparent !important;
    border: none;
    color: #fff !important;
    opacity: 0.7;
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
  .pod-diy-btn.pod-diy-btn--close {
    font-size: 16px;
    font-weight: 400;
    line-height: 1;
    z-index: 1001 !important;
  }
  .pod-diy-btn:hover {
    opacity: 1;
    background: rgba(255,255,255,0.1);
  }
  .pod-diy-body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .pod-diy-body > * {
    flex: 1;
    height: 100% !important;
  }

  /* Aggressive Dockview Header Hiding - Kill the Abyss - Scoped to container */
  .dockview-container .dv-header, 
  .dockview-container .dv-tab-container, 
  .dockview-container .dv-tab, 
  .dockview-container .dv-tab-divider, 
  .dockview-container .dv-tab-separator, 
  .dockview-container .dv-tabs-and-actions-container {
    height: 0 !important;
    min-height: 0 !important;
    max-height: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    visibility: hidden !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* Restore separator for splitting functionality */
  .dockview-container .dv-separator {
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    background: rgba(255, 255, 255, 0.05) !important;
  }

  .musiki-pod[data-pod="lily-code"] .conference-stage-panel--lilypond,
  .musiki-pod[data-pod="lily-render"] .conference-stage-panel--lilypond {
    visibility: visible !important;
    opacity: 1 !important;
    pointer-events: auto !important;
    display: flex !important;
  }

  .musiki-pod[data-pod="lily-code"] .musiki-pod-toolbar,
  .musiki-pod[data-pod="lily-render"] .musiki-pod-toolbar {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    z-index: 500 !important;
    position: relative !important;
  }

  .pod-picker-menu {
    position: fixed;
    background: #111;
    border: 1px solid #333;
    border-radius: 4px;
    padding: 4px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    min-width: 140px;
  }
  .pod-picker-item {
    background: none;
    border: none;
    color: #ccc;
    padding: 6px 8px;
    text-align: left;
    font-size: 11px;
    cursor: pointer;
    border-radius: 2px;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  .pod-picker-item:hover {
    background: rgba(255,255,255,0.1);
    color: #fff;
  }
  .pod-picker-item.active {
    background: rgba(255,255,255,0.05);
    color: var(--pod-color);
  }
  .pod-picker-icon {
    font-size: 10px;
    font-weight: bold;
    width: 16px;
    text-align: center;
  }

  @media (max-width: 500px) {
    .pod-diy-shell { touch-action: none; }
    .pod-diy-handle { display: none; }
    .pod-diy-arrow { display: none; }
    .dockview-container .dv-view-container { flex-direction: column !important; }
    .dockview-container .dv-view { width: 100% !important; flex: 1 1 auto !important; }
    .dockview-container .dv-separator-handle-container { display: none !important; }
  }
`;
document.head.appendChild(style);
