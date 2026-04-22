import { MESSAGE_TOPIC, type ConferenceMessage } from '../session';

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

  constructor(private publish: (msg: ConferenceMessage) => void) {}

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setupListeners();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  initBg(canvas: HTMLCanvasElement) {
    this.bgCanvas = canvas;
    this.bgCtx = canvas.getContext('2d');
    this.resize();
  }

  private resize() {
    if (!this.canvas || !this.ctx) return;
    
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    // Save current drawing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) tempCtx.drawImage(this.canvas, 0, 0);
    
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    
    // Restore and scale drawing
    this.ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, this.canvas.width, this.canvas.height);

    if (this.bgCanvas && this.bgCtx) {
        this.bgCanvas.width = rect.width;
        this.bgCanvas.height = rect.height;
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
        // Wait a bit to see if we clicked Enter
        window.setTimeout(() => {
            if (document.body.contains(input)) finishText();
        }, 100);
    });
  }

  private getCoords(e: MouseEvent | Touch) {
    if (!this.canvas) return { x: 0, y: 0 };
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  setTool(tool: 'draw' | 'text-sm' | 'text-lg') {
    this.tool = tool;
  }

  setColor(color: string) {
    this.color = color;
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
    this.bgCtx.clearRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);

    if (this.background === 'staff') {
        this.drawStaff();
    } else if (this.background === 'grid') {
        this.drawGrid();
    }
  }

  private drawStaff() {
    if (!this.bgCtx || !this.bgCanvas) return;
    const ctx = this.bgCtx;
    const w = this.bgCanvas.width;
    const h = this.bgCanvas.height;

    // Use a reference height of 1000px to calculate proportional scale
    const scale = h / 1000;
    const gap = 20 * scale;
    const topMargin = 20 * scale;
    const staffHeight = gap * 4;
    const spacing = staffHeight * 1.5;
    const totalBlock = staffHeight + spacing;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = Math.max(1, 1 * scale);

    for (let y = topMargin + gap; y < h; y += totalBlock) {
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

  private drawGrid() {
    if (!this.bgCtx || !this.bgCanvas) return;
    const ctx = this.bgCtx;
    const w = this.bgCanvas.width;
    const h = this.bgCanvas.height;

    const scale = h / 1000;
    const gap = 20 * scale;

    ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
    ctx.lineWidth = Math.max(1, 1 * scale);

    // Horizontal lines
    for (let y = 0; y < h; y += gap) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Vertical lines
    for (let x = 0; x < w; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }
  }

  handleStroke(stroke: WhiteboardStroke, broadcast = false) {
    if (!this.ctx || !this.canvas) return;

    const x = stroke.x * this.canvas.width;
    const y = stroke.y * this.canvas.height;
    const scale = this.canvas.height / 1000;

    if (stroke.action === 'start') {
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.ctx.strokeStyle = stroke.color;
      this.ctx.lineWidth = Math.max(1.5, 2 * scale);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    } else if (stroke.action === 'draw') {
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    } else if (stroke.action === 'end') {
      this.ctx.closePath();
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

    const x = textData.x * this.canvas.width;
    const y = textData.y * this.canvas.height;
    const scale = this.canvas.height / 1000;

    const fontSize = (textData.size === 'lg' ? 24 : 14) * scale;
    const lineHeight = (textData.size === 'lg' ? 28 : 18) * scale;

    this.ctx.fillStyle = textData.color;
    this.ctx.font = `${textData.size === 'lg' ? 'bold ' : ''}${fontSize}px sans-serif`;
    this.ctx.textBaseline = 'top';
    
    // Support multiple lines
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
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    if (broadcast) {
      this.publish({ type: 'whiteboard-clear' });
    }
  }
}
