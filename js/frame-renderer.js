import { appState } from './state.js';
import { getCanvasSize, setupCanvasForDPR, debounce } from './utils.js';

export class FrameRenderer {
    constructor(videoElement, canvasElement) {
        this.videoElement = videoElement;
        this.canvasElement = canvasElement;
        this.ctx = null;
        this.animationFrame = null;
        this.isRendering = false;
        this.containerWidth = 0;
        this.containerHeight = 0;
        
        this.handleResize = debounce(this.updateCanvasSize.bind(this), 100);
        this.setupEventListeners();
        this.setupStateSubscriptions();
    }

    setupEventListeners() {
        window.addEventListener('resize', this.handleResize);
        
        const resizeObserver = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (entry.target === this.canvasElement.parentElement) {
                    this.handleResize();
                }
            }
        });
        
        if (this.canvasElement.parentElement) {
            resizeObserver.observe(this.canvasElement.parentElement);
        }
    }

    setupStateSubscriptions() {
        appState.subscribe('videoMetadata', (metadata) => {
            if (metadata) {
                this.updateCanvasSize();
                this.startRendering();
            } else {
                this.stopRendering();
            }
        });

        appState.subscribe('isPlaying', (isPlaying) => {
            if (isPlaying) {
                this.startRendering();
            }
        });

        appState.subscribe('currentTime', () => {
            if (!appState.getState('isPlaying')) {
                this.renderFrame();
            }
        });

        appState.subscribe('file', (file) => {
            if (!file) {
                this.clearCanvas();
                this.stopRendering();
            }
        });
    }

    updateCanvasSize() {
        const container = this.canvasElement.parentElement;
        if (!container) return;

        const containerRect = container.getBoundingClientRect();
        this.containerWidth = containerRect.width;
        this.containerHeight = containerRect.height;

        const metadata = appState.getState('videoMetadata');
        if (!metadata) return;

        const { width, height } = getCanvasSize(
            metadata.width,
            metadata.height,
            this.containerWidth,
            this.containerHeight
        );

        this.ctx = setupCanvasForDPR(this.canvasElement, width, height);
        
        this.renderFrame();
    }

    startRendering() {
        if (this.isRendering) return;
        
        this.isRendering = true;
        this.renderLoop();
    }

    stopRendering() {
        this.isRendering = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    renderLoop() {
        if (!this.isRendering) return;

        this.renderFrame();

        if (appState.getState('isPlaying')) {
            this.animationFrame = requestAnimationFrame(() => this.renderLoop());
        } else {
            this.isRendering = false;
        }
    }

    renderFrame() {
        if (!this.ctx || !this.videoElement) return;

        const metadata = appState.getState('videoMetadata');
        if (!metadata || this.videoElement.readyState < 2) return;

        try {
            const canvasWidth = this.canvasElement.width;
            const canvasHeight = this.canvasElement.height;
            
            this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            
            this.ctx.drawImage(
                this.videoElement,
                0,
                0,
                this.canvasElement.style.width.replace('px', ''),
                this.canvasElement.style.height.replace('px', '')
            );
            
        } catch (error) {
            console.warn('Error rendering frame:', error);
        }
    }

    clearCanvas() {
        if (!this.ctx) return;
        
        const canvasWidth = this.canvasElement.width;
        const canvasHeight = this.canvasElement.height;
        this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    }

    getCanvasDataURL(format = 'image/png', quality = 0.92) {
        return this.canvasElement.toDataURL(format, quality);
    }

    getCanvasImageData() {
        if (!this.ctx) return null;
        
        const canvasWidth = this.canvasElement.width;
        const canvasHeight = this.canvasElement.height;
        return this.ctx.getImageData(0, 0, canvasWidth, canvasHeight);
    }

    destroy() {
        this.stopRendering();
        window.removeEventListener('resize', this.handleResize);
    }
}