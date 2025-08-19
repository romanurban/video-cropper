import { appState } from './state.js';
import { ThumbnailService } from './thumbnail-service.js';
import { formatTime, clamp, debounce } from './utils.js';

export class TimelineFrames {
    constructor(container, videoPlayer) {
        this.container = container;
        this.videoPlayer = videoPlayer;
        this.thumbnailService = new ThumbnailService();
        this.frameStrip = null;
        this.playhead = null;
        this.progressOverlay = null;
        this.thumbnailsContainer = null;
        this.duration = 0;
        this.currentTime = 0;
        this.thumbnails = [];
        this.isDragging = false;
        this.stripWidth = 0;
        
        this.handleResize = debounce(this.updateLayout.bind(this), 200);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        
        this.init();
    }

    init() {
        this.createElements();
        this.setupEventListeners();
        this.setupStateSubscriptions();
    }

    createElements() {
        this.frameStrip = document.createElement('div');
        this.frameStrip.className = 'frame-strip';
        this.frameStrip.setAttribute('role', 'application');
        this.frameStrip.setAttribute('aria-label', 'Video timeline - click to seek');
        
        this.thumbnailsContainer = document.createElement('div');
        this.thumbnailsContainer.className = 'thumbnails-container';
        
        this.progressOverlay = document.createElement('div');
        this.progressOverlay.className = 'progress-overlay';
        
        this.playhead = document.createElement('div');
        this.playhead.className = 'timeline-playhead-frames';
        
        this.frameStrip.appendChild(this.thumbnailsContainer);
        this.frameStrip.appendChild(this.progressOverlay);
        this.frameStrip.appendChild(this.playhead);
        this.container.appendChild(this.frameStrip);
    }

    setupEventListeners() {
        this.frameStrip.addEventListener('pointerdown', this.handlePointerDown.bind(this));
        window.addEventListener('resize', this.handleResize);
        
        const resizeObserver = new ResizeObserver(() => {
            this.handleResize();
        });
        
        if (this.container) {
            resizeObserver.observe(this.container);
        }
    }

    setupStateSubscriptions() {
        appState.subscribe('file', async (file) => {
            if (file) {
                await this.loadVideo(file);
            } else {
                this.reset();
            }
        });

        appState.subscribe('videoMetadata', (metadata) => {
            if (metadata) {
                this.duration = metadata.duration;
                this.generateThumbnails();
            }
        });

        appState.subscribe('currentTime', (currentTime) => {
            this.currentTime = currentTime;
            if (!this.isDragging) {
                this.updatePlayhead();
            }
        });

        appState.subscribe('isPlaying', (isPlaying) => {
            if (isPlaying) {
                this.thumbnailService.pauseGeneration();
            } else {
                this.thumbnailService.resumeGeneration(this.onThumbnailGenerated.bind(this));
            }
        });
    }

    async loadVideo(file) {
        try {
            await this.thumbnailService.initialize(file);
        } catch (error) {
            console.error('Failed to initialize thumbnail service:', error);
        }
    }

    generateThumbnails() {
        if (!this.duration || this.duration <= 0) return;
        
        this.updateLayout();
        
        const containerWidth = this.container.getBoundingClientRect().width;
        const thumbnailWidth = 120;
        const maxThumbnails = 200;
        const targetInterval = 4; // seconds per thumbnail
        
        let count = Math.floor(this.duration / targetInterval);
        count = Math.min(count, maxThumbnails);
        count = Math.max(count, Math.floor(containerWidth / thumbnailWidth) || 10);
        
        this.clearThumbnails();
        this.createPlaceholders(count);
        
        this.thumbnailService.generateThumbnails(
            this.duration,
            count,
            this.onThumbnailGenerated.bind(this)
        );
    }

    createPlaceholders(count) {
        const thumbnailWidth = 120;
        const videoMetadata = appState.getState('videoMetadata');
        const aspectRatio = videoMetadata ? videoMetadata.width / videoMetadata.height : 16/9;
        const thumbnailHeight = Math.round(thumbnailWidth / aspectRatio);
        
        for (let i = 0; i < count; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'thumbnail-placeholder';
            placeholder.style.width = `${thumbnailWidth}px`;
            placeholder.style.height = `${thumbnailHeight}px`;
            placeholder.dataset.index = i;
            
            const time = (i / count) * this.duration;
            placeholder.dataset.time = time;
            
            const timeLabel = document.createElement('div');
            timeLabel.className = 'thumbnail-time';
            timeLabel.textContent = formatTime(time);
            placeholder.appendChild(timeLabel);
            
            this.thumbnailsContainer.appendChild(placeholder);
        }
        
        this.stripWidth = count * thumbnailWidth;
        this.thumbnailsContainer.style.width = `${this.stripWidth}px`;
    }

    onThumbnailGenerated(index, thumbnailUrl, time) {
        const placeholder = this.thumbnailsContainer.querySelector(`[data-index="${index}"]`);
        if (!placeholder) return;
        
        const img = document.createElement('img');
        img.src = thumbnailUrl;
        img.className = 'thumbnail-image';
        img.setAttribute('draggable', false);
        img.alt = `Frame at ${formatTime(time)}`;
        
        img.onload = () => {
            placeholder.innerHTML = '';
            placeholder.appendChild(img);
            
            const timeLabel = document.createElement('div');
            timeLabel.className = 'thumbnail-time';
            timeLabel.textContent = formatTime(time);
            placeholder.appendChild(timeLabel);
        };
        
        img.onerror = () => {
            console.warn(`Failed to load thumbnail for time ${time}`);
        };
    }

    handlePointerDown(event) {
        if (event.button !== 0) return; // Only handle left click
        
        event.preventDefault();
        this.isDragging = true;
        
        this.frameStrip.setPointerCapture(event.pointerId);
        this.frameStrip.addEventListener('pointermove', this.handlePointerMove);
        this.frameStrip.addEventListener('pointerup', this.handlePointerUp);
        
        this.handleSeek(event);
    }

    handlePointerMove(event) {
        if (!this.isDragging) return;
        
        event.preventDefault();
        this.handleSeek(event);
    }

    handlePointerUp(event) {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        this.frameStrip.releasePointerCapture(event.pointerId);
        this.frameStrip.removeEventListener('pointermove', this.handlePointerMove);
        this.frameStrip.removeEventListener('pointerup', this.handlePointerUp);
        
        // Resume thumbnail generation if paused
        this.thumbnailService.resumeGeneration(this.onThumbnailGenerated.bind(this));
    }

    handleSeek(event) {
        const rect = this.frameStrip.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = clamp(x / rect.width, 0, 1);
        const seekTime = percentage * this.duration;
        
        this.currentTime = seekTime;
        this.updatePlayhead();
        
        if (this.videoPlayer) {
            this.videoPlayer.seekTo(seekTime);
        }
        
        // Pause thumbnail generation during dragging
        if (this.isDragging) {
            this.thumbnailService.pauseGeneration();
        }
    }

    updatePlayhead() {
        if (!this.duration || this.duration <= 0) return;
        
        const percentage = (this.currentTime / this.duration) * 100;
        const clampedPercentage = clamp(percentage, 0, 100);
        
        this.playhead.style.left = `${clampedPercentage}%`;
        this.progressOverlay.style.width = `${clampedPercentage}%`;
    }

    updateLayout() {
        const containerRect = this.container.getBoundingClientRect();
        if (containerRect.width !== this.containerWidth) {
            this.containerWidth = containerRect.width;
            // Could trigger thumbnail regeneration here if needed
        }
    }

    clearThumbnails() {
        this.thumbnailsContainer.innerHTML = '';
        this.stripWidth = 0;
    }

    reset() {
        this.clearThumbnails();
        this.thumbnailService.cleanup();
        this.duration = 0;
        this.currentTime = 0;
        this.thumbnails = [];
    }

    destroy() {
        this.reset();
        window.removeEventListener('resize', this.handleResize);
        this.thumbnailService.destroy();
        
        if (this.container && this.frameStrip) {
            this.container.removeChild(this.frameStrip);
        }
    }
}