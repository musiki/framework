import { type ConferenceMessage } from '../session';

export interface WhiteboardStroke {
  x: number;
  y: number;
  action: 'start' | 'draw' | 'end';
  color: string;
}

export interface WhiteboardText {
  x: number;
  y: number;
  text: string;
  color: string;
  size: 'sm' | 'lg';
}

export class WhiteboardController {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgCtx: CanvasRenderingContext2D | null = null;
  private isDrawing = false;
  private color = '#ffffff';
  private tool: 'draw' | 'text-sm' | 'text-lg' = 'draw';
  private background: 'none' | 'staff' | 'grid' = 'none';
  private snapToGrid = false;
  
  private readonly VIRTUAL_COORD_BASE = 2000; 

  constructor(private publish: (msg: ConferenceMessage) => void) {}

  init(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.setupListeners();
    this.setupResizeObserver();
  }

  initBg(canvas: HTMLCanvasElement) {
    if (this.bgCanvas === canvas) return;
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d', { alpha: true });
    this.setupResizeObserver();
  }

  private setupResizeObserver() {
    const parent = this.canvas?.parentElement || this.bgCanvas?.parentElement;
    if (!parent) return;

    const ro = new ResizeObserver(() => {
      this.resize();
    });
    ro.observe(parent);
  }

  private resize() {
    const parent = this.canvas?.parentElement || this.bgCanvas?.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const targetWidth = rect.width;
    const targetHeight = rect.height;

    if (this.canvas && this.ctx) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.canvas.width;
      tempCanvas.height = this.canvas.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) tempCtx.drawImage(this.canvas, 0, 0);

      this.canvas.width = targetWidth * dpr;
      this.canvas.height = targetHeight * dpr;
      this.canvas.style.width = `${targetWidth}px`;
      this.canvas.style.height = `${targetHeight}px`;

      this.ctx.resetTransform();
      this.ctx.scale(dpr, dpr);
      
      if (tempCanvas.width > 0) {
        this.ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, targetWidth, targetHeight);
      }
    }

    if (this.bgCanvas && this.bgCtx) {
      this.bgCanvas.width = targetWidth * dpr;
      this.bgCanvas.height = targetHeight * dpr;
      this.bgCanvas.style.width = `${targetWidth}px`;
      this.bgCanvas.style.height = `${targetHeight}px`;

      this.bgCtx.resetTransform();
      this.bgCtx.scale(dpr, dpr);
      this.drawBackground();
    }
  }

  private setupListeners() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousedown', (e) => this.handleStart(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMove(e));
    this.canvas.addEventListener('mouseup', () => this.handleEnd());
    this.canvas.addEventListener('mouseleave', () => this.handleEnd());

    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.handleStart(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      this.handleMove(e.touches[0]);
    }, { passive: false });
    this.canvas.addEventListener('touchend', () => this.handleEnd());
  }

  private handleStart(e: MouseEvent | Touch) {
    if (this.tool === 'draw') {
      this.isDrawing = true;
      const { x, y } = this.getCoords(e);
      this.handleStroke({ x, y, action: 'start', color: this.color }, true);
    } else {
      this.spawnTextInput(e);
    }
  }

  private handleMove(e: MouseEvent | Touch) {
    if (!this.isDrawing || this.tool !== 'draw') return;
    const { x, y } = this.getCoords(e);
    this.handleStroke({ x, y, action: 'draw', color: this.color }, true);
  }

  private handleEnd() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.handleStroke({ x: 0, y: 0, action: 'end', color: this.color }, true);
  }

  private spawnTextInput(e: MouseEvent | Touch) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const container = this.canvas.parentElement;
    if (!container) return;

    const input = document.createElement('textarea');
    input.className = 'conference-whiteboard-text-input';
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    input.style.color = this.color;
    input.style.fontSize = this.tool === 'text-lg' ? '24px' : '14px';
    input.style.fontWeight = this.tool === 'text-lg' ? 'bold' : 'normal';
    input.style.width = '200px';
    input.style.height = 'auto';
    input.placeholder = 'Escribe aquí...';

    container.appendChild(input);
    window.setTimeout(() => input.focus(), 0);

    const finishText = () => {
      const text = input.value.trim();
      if (text) {
        const normalizedX = x / rect.width;
        const normalizedY = y / rect.height;
        this.drawText({
          x: normalizedX,
          y: normalizedY,
          text,
          color: this.color,
          size: this.tool === 'text-lg' ? 'lg' : 'sm'
        }, true);
      }
      input.remove();
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        finishText();
      }
      if (ev.key === 'Escape') input.remove();
    });
    input.addEventListener('blur', () => {
        window.setTimeout(() => {
            if (document.body.contains(input)) finishText();
        }, 100);
    });
  }

  private getCoords(e: MouseEvent | Touch) {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    if (this.snapToGrid) {
      if (this.background === 'grid') {
        const gap = 40;
        const topShift = 26;
        x = Math.round(x / gap) * gap;
        y = Math.round((y - topShift) / gap) * gap + topShift;
      } else if (this.background === 'staff') {
        const gap = 12; 
        const topShift = 26;
        const staffHeight = gap * 4;
        const spacing = staffHeight * 1.5;
        const totalBlock = staffHeight + spacing;
        
        // Horizontal snap to nearest staff line
        const blockIndex = Math.floor((y - topShift + spacing / 2) / totalBlock);
        const blockTop = topShift + blockIndex * totalBlock;
        const lineIndex = Math.round((y - blockTop) / gap);
        
        if (lineIndex >= 0 && lineIndex <= 4) {
          y = blockTop + lineIndex * gap;
        }
        
        // Vertical snap to a reasonable increment if needed, 
        // but user asked for "vertical and horizontal straights"
        // Let's snap X to a 20px grid for vertical alignment
        x = Math.round(x / 20) * 20;
      }
    }

    return {
      x: x / rect.width,
      y: y / rect.height,
    };
  }

  setTool(tool: 'draw' | 'text-sm' | 'text-lg') {
    this.tool = tool;
  }

  setColor(color: string) {
    this.color = color;
  }

  setSnap(snap: boolean) {
    this.snapToGrid = snap;
  }

  setBackground(bg: 'none' | 'staff' | 'grid', broadcast = false) {
    this.background = bg;
    this.drawBackground();

    if (broadcast) {
        this.publish({
            type: 'whiteboard-bg',
            bg
        });
    }
  }

  private drawBackground() {
    if (!this.bgCtx || !this.bgCanvas) return;
    const parent = this.bgCanvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    
    this.bgCtx.clearRect(0, 0, rect.width, rect.height);

    if (this.background === 'staff') {
        this.drawStaff(rect.width, rect.height);
    } else if (this.background === 'grid') {
        this.drawGrid(rect.width, rect.height);
    }
  }

  private drawStaff(w: number, h: number) {
    if (!this.bgCtx) return;
    const ctx = this.bgCtx;

    const topShift = 26; 
    const gap = 12; 
    const staffHeight = gap * 4;
    const spacing = staffHeight * 1.5;
    const totalBlock = staffHeight + spacing;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;

    for (let y = topShift; y < h; y += totalBlock) {
        for (let i = 0; i < 5; i++) {
            const lineY = y + i * gap;
            if (lineY > h) break;
            ctx.beginPath();
            ctx.moveTo(0, lineY);
            ctx.lineTo(w, lineY);
            ctx.stroke();
        }
    }
  }

  private drawGrid(w: number, h: number) {
    if (!this.bgCtx) return;
    const ctx = this.bgCtx;
    const topShift = 26;
    const gap = 40;

    ctx.strokeStyle = 'rgba(100, 200, 255, 0.1)';
    ctx.lineWidth = 1;

    for (let y = topShift; y < h; y += gap) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let x = 0; x < w; x += gap) {
        ctx.beginPath(); ctx.moveTo(x, topShift); ctx.lineTo(x, h); ctx.stroke();
    }
  }

  handleStroke(stroke: WhiteboardStroke, broadcast = false) {
    if (!this.ctx || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();

    const x = stroke.x * rect.width;
    const y = stroke.y * rect.height;

    if (stroke.action === 'start') {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.ctx.strokeStyle = stroke.color;
      this.ctx.lineWidth = 2.5;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    } else if (stroke.action === 'draw') {
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    }

    if (broadcast) {
      this.publish({
        type: 'whiteboard-draw',
        ...stroke
      });
    }
  }

  drawText(textData: WhiteboardText, broadcast = false) {
    if (!this.ctx || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();

    const x = textData.x * rect.width;
    const y = textData.y * rect.height;

    const fontSize = textData.size === 'lg' ? 24 : 14;
    const lineHeight = textData.size === 'lg' ? 28 : 18;

    this.ctx.fillStyle = textData.color;
    this.ctx.font = `${textData.size === 'lg' ? 'bold ' : ''}${fontSize}px sans-serif`;
    this.ctx.textBaseline = 'top';
    
    const lines = textData.text.split('\n');
    lines.forEach((line, index) => {
        this.ctx?.fillText(line, x, y + index * lineHeight);
    });

    if (broadcast) {
      this.publish({
        type: 'whiteboard-text',
        ...textData
      });
    }
  }

  clear(broadcast = false) {
    if (!this.ctx || !this.canvas) return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    
    if (broadcast) {
      this.publish({ type: 'whiteboard-clear' });
    }
  }
}
