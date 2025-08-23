import { appState } from './state.js';

// Utility to enforce even numbers
const roundEven = (n) => Math.max(0, Math.floor(n / 2) * 2);

export class CropOverlay {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.root = document.createElement('div');
    this.root.className = 'crop-overlay-root';
    this.box = document.createElement('div');
    this.box.className = 'crop-box';
    this.sizeLabel = document.createElement('div');
    this.sizeLabel.className = 'crop-size-label';
    this.box.appendChild(this.sizeLabel);

    // 8 handles
    const handles = ['nw','n','ne','e','se','s','sw','w'];
    this.handles = {};
    for (const h of handles) {
      const el = document.createElement('div');
      el.className = `crop-handle handle-${h}`;
      el.dataset.handle = h;
      this.box.appendChild(el);
      this.handles[h] = el;
    }

    this.root.appendChild(this.box);
    // Position overlay within the same offset parent as canvas
    const parent = this.canvas.parentElement || document.body;
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(this.root);

    // Interaction state
    this.dragging = false;
    this.resizing = false;
    this.handle = null;
    this.startX = 0;
    this.startY = 0;
    this.startRect = null; // normalized rect

    this.attachEvents();
    this.renderFromState();
    appState.subscribe('cropRect', () => this.renderFromState());
    window.addEventListener('resize', () => this.renderFromState());
  }

  // Get canvas client rect for coordinate conversion
  getCanvasRect() {
    return this.canvas.getBoundingClientRect();
  }

  attachEvents() {
    // Start drag inside box (move)
    this.box.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('crop-handle')) return; // handled by handle
      const rect = appState.getState('cropRect') || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      this.dragging = true;
      this.startRect = rect;
      this.startX = e.clientX;
      this.startY = e.clientY;
      e.preventDefault();
    });

    // Handle resize
    Object.values(this.handles).forEach((h) => {
      h.addEventListener('mousedown', (e) => {
        const rect = appState.getState('cropRect') || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
        this.resizing = true;
        this.handle = e.target.dataset.handle;
        this.startRect = rect;
        this.startX = e.clientX;
        this.startY = e.clientY;
        e.stopPropagation();
        e.preventDefault();
      });
    });

    // Create rect on canvas click if none
    this.canvas.addEventListener('mousedown', (e) => {
      if (appState.getState('cropRect')) return;
      const { x, y } = this.clientToNorm(e.clientX, e.clientY);
      const rect = { x: Math.max(0, x - 0.25), y: Math.max(0, y - 0.25), w: 0.5, h: 0.5 };
      appState.setCropRect(this.normalizeRect(rect));
      this.dragging = true;
      this.startRect = appState.getState('cropRect');
      this.startX = e.clientX;
      this.startY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', () => this.onUp());
  }

  onMove(e) {
    const rect = this.startRect;
    if (!rect) return;
    const cr = this.getCanvasRect();
    const dx = (e.clientX - this.startX) / cr.width;
    const dy = (e.clientY - this.startY) / cr.height;

    if (this.dragging) {
      this.applyRect({ x: rect.x + dx, y: rect.y + dy, w: rect.w, h: rect.h });
    } else if (this.resizing) {
      let { x, y, w, h } = rect;
      const hnd = this.handle;
      if (hnd.includes('w')) { x = x + dx; w = w - dx; }
      if (hnd.includes('e')) { w = w + dx; }
      if (hnd.includes('n')) { y = y + dy; h = h - dy; }
      if (hnd.includes('s')) { h = h + dy; }
      this.applyRect({ x, y, w, h });
    }
  }

  onUp() {
    if (this.dragging || this.resizing) {
      this.dragging = false;
      this.resizing = false;
      this.handle = null;
      // Snap to even source pixels by updating label only (actual rounding done at export)
      this.renderFromState();
    }
  }

  applyRect(r) {
    // Normalize and clamp 0..1
    const rect = this.normalizeRect(r);
    appState.setCropRect(rect);
  }

  normalizeRect({ x, y, w, h }) {
    let nx = Math.max(0, x), ny = Math.max(0, y);
    let nw = Math.max(0.02, w), nh = Math.max(0.02, h);
    if (nx + nw > 1) nx = 1 - nw;
    if (ny + nh > 1) ny = 1 - nh;
    return { x: nx, y: ny, w: nw, h: nh };
  }

  clientToNorm(clientX, clientY) {
    const cr = this.getCanvasRect();
    return { x: (clientX - cr.left) / cr.width, y: (clientY - cr.top) / cr.height };
  }

  renderFromState() {
    const rect = appState.getState('cropRect');
    const meta = appState.getState('videoMetadata');
    const show = !!(rect && meta);
    this.root.style.display = show ? 'block' : 'none';
    if (!show) return;

    const cr = this.getCanvasRect();
    const px = rect.x * cr.width;
    const py = rect.y * cr.height;
    const pw = rect.w * cr.width;
    const ph = rect.h * cr.height;
    this.root.style.position = 'absolute';
    this.root.style.left = this.canvas.style.left || '0px';
    this.root.style.top = this.canvas.style.top || '0px';
    this.root.style.width = `${cr.width}px`;
    this.root.style.height = `${cr.height}px`;
    this.root.style.pointerEvents = 'none';

    this.box.style.left = `${px}px`;
    this.box.style.top = `${py}px`;
    this.box.style.width = `${pw}px`;
    this.box.style.height = `${ph}px`;
    this.box.style.pointerEvents = 'auto';

    // Label with even-rounded source pixel size
    const vw = meta.width, vh = meta.height;
    const sw = roundEven(rect.w * vw);
    const sh = roundEven(rect.h * vh);
    this.sizeLabel.textContent = `${sw} x ${sh}`;
  }

  destroy() {
    this.root?.remove();
  }
}

