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
        this.progressLine = null;
        this.progressTrack = null;
        this.thumbnailsContainer = null;
        this.selectionOverlay = null;
        this.duration = 0;
        this.currentTime = 0;
        this.thumbnails = [];
        this.isDragging = false;
        this.isSelecting = false;
        this.isResizing = false;
        this.resizeHandle = null; // 'start' or 'end'
        this.selectionAnchor = null;
        this.selectionStartSec = null;
        this.selectionEndSec = null;
        this.stripWidth = 0;
        this.resizeHandleWidth = 4; // Width of resize handle in pixels
        this.animationFrameId = null;
        this.isPlayingVideo = false;
        this.lastClickTime = 0;
        this.clickDebounceMs = 50; // Prevent rapid clicks from interfering
        
        this.handleResize = debounce(this.updateLayout.bind(this), 200);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.smoothUpdateLoop = this.smoothUpdateLoop.bind(this);
        
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
        this.frameStrip.setAttribute('aria-label', 'Video timeline - click to seek, drag to select');
        this.frameStrip.setAttribute('tabindex', '0');
        
        this.thumbnailsContainer = document.createElement('div');
        this.thumbnailsContainer.className = 'thumbnails-container';
        
        this.playhead = document.createElement('div');
        this.playhead.className = 'timeline-playhead-frames';
        
        this.selectionOverlay = document.createElement('div');
        this.selectionOverlay.className = 'timeline-selection-overlay';
        this.selectionOverlay.setAttribute('aria-label', 'Selected range');
        this.selectionOverlay.setAttribute('aria-live', 'polite');
        this.selectionOverlay.style.display = 'none';
        
        this.progressTrack = document.createElement('div');
        this.progressTrack.className = 'timeline-progress-track';
        
        this.progressLine = document.createElement('div');
        this.progressLine.className = 'timeline-progress-line';
        this.progressLine.style.width = '0%';
        
        this.frameStrip.appendChild(this.thumbnailsContainer);
        this.frameStrip.appendChild(this.selectionOverlay);
        this.frameStrip.appendChild(this.playhead);
        
        this.progressTrack.appendChild(this.progressLine);
        
        this.container.appendChild(this.frameStrip);
        
        // Add progress track to the parent timeline section instead of timeline-frames container
        const timelineSection = this.container.parentElement;
        if (timelineSection) {
            timelineSection.appendChild(this.progressTrack);
        } else {
            this.container.appendChild(this.progressTrack);
        }
    }

    setupEventListeners() {
        this.frameStrip.addEventListener('pointerdown', this.handlePointerDown.bind(this));
        this.frameStrip.addEventListener('mousemove', this.handleMouseMove);
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
            if (!this.isDragging && !this.isResizing) {
                this.updatePlayhead();
            }
        });

        appState.subscribe('isPlaying', (isPlaying) => {
            this.isPlayingVideo = isPlaying;
            if (isPlaying) {
                this.thumbnailService.pauseGeneration();
                this.startSmoothUpdates();
            } else {
                this.thumbnailService.resumeGeneration(this.onThumbnailGenerated.bind(this));
                this.stopSmoothUpdates();
            }
        });

        appState.subscribe('selection', (selection) => {
            if (selection) {
                this.selectionStartSec = selection.startSec;
                this.selectionEndSec = selection.endSec;
            } else {
                this.selectionStartSec = null;
                this.selectionEndSec = null;
            }
            this.updateSelectionDisplay();
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
        const thumbnailWidth = 100; // Reduced width to fit more thumbnails
        const thumbnailSpacing = 1; // Reduced spacing
        const maxThumbnails = 300; // Increased maximum
        
        // Calculate how many thumbnails can fit in the container width
        const availableWidth = containerWidth - 32; // Account for padding
        const thumbnailsPerWidth = Math.floor(availableWidth / (thumbnailWidth + thumbnailSpacing));
        
        // Calculate count based on duration or fit to width
        const targetInterval = 2; // seconds per thumbnail (increased granularity)
        let countByDuration = Math.floor(this.duration / targetInterval);
        
        // Prioritize fitting more thumbnails, use container width as primary constraint
        let count = Math.min(thumbnailsPerWidth, maxThumbnails);
        
        // If we have fewer thumbnails than duration would suggest, use duration-based count
        if (countByDuration < count && countByDuration > 10) {
            count = countByDuration;
        }
        
        count = Math.max(count, 10); // Minimum 10 thumbnails for better granularity
        
        this.clearThumbnails();
        this.createPlaceholders(count, availableWidth);
        
        this.thumbnailService.generateThumbnails(
            this.duration,
            count,
            this.onThumbnailGenerated.bind(this)
        );
    }

    createPlaceholders(count, availableWidth) {
        const videoMetadata = appState.getState('videoMetadata');
        const aspectRatio = videoMetadata ? videoMetadata.width / videoMetadata.height : 16/9;
        
        // Calculate thumbnail width to fill available space
        const thumbnailSpacing = 2;
        const totalSpacing = (count - 1) * thumbnailSpacing;
        const thumbnailWidth = Math.floor((availableWidth - totalSpacing) / count);
        const maxThumbnailHeight = 86; // Leave space for time labels - 10px margin from 96px container
        let thumbnailHeight = Math.round(thumbnailWidth / aspectRatio);
        
        // For vertical videos, limit height and adjust width accordingly
        if (thumbnailHeight > maxThumbnailHeight) {
            thumbnailHeight = maxThumbnailHeight;
            // Recalculate width based on max height to maintain aspect ratio
            const adjustedWidth = Math.round(thumbnailHeight * aspectRatio);
            // If adjusted width is too small, keep original but crop height
            if (adjustedWidth < thumbnailWidth * 0.6) {
                thumbnailHeight = maxThumbnailHeight;
            }
        }
        
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
        
        // Make sure container takes full width
        this.thumbnailsContainer.style.width = '100%';
        this.thumbnailsContainer.style.justifyContent = 'space-between';
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

    getResizeHandle(x) {
        if (this.selectionStartSec === null || this.selectionEndSec === null || !this.duration) {
            return null;
        }
        
        // Force layout recalculation for accurate positioning
        this.frameStrip.offsetWidth; // Trigger reflow
        
        const rect = this.frameStrip.getBoundingClientRect();
        const rectWidth = Math.round(rect.width);
        
        // Ensure we have valid dimensions
        if (rectWidth <= 0) return null;
        
        const startPercentage = this.selectionStartSec / this.duration;
        const endPercentage = this.selectionEndSec / this.duration;
        
        const startX = Math.round(startPercentage * rectWidth);
        const endX = Math.round(endPercentage * rectWidth);
        
        // Check if near start handle
        if (Math.abs(x - startX) <= this.resizeHandleWidth / 2) {
            return 'start';
        }
        
        // Check if near end handle
        if (Math.abs(x - endX) <= this.resizeHandleWidth / 2) {
            return 'end';
        }
        
        return null;
    }

    handleMouseMove(event) {
        if (this.isDragging || this.isSelecting || this.isResizing) return;
        
        const rect = this.frameStrip.getBoundingClientRect();
        const x = Math.round(event.clientX - rect.left);
        const resizeHandle = this.getResizeHandle(x);
        
        if (resizeHandle) {
            this.frameStrip.setAttribute('data-cursor', 'col-resize');
        } else if (this.selectionStartSec !== null && this.selectionEndSec !== null) {
            const percentage = clamp(x / rect.width, 0, 1);
            const time = percentage * this.duration;
            
            // Check if inside selection for move cursor
            if (time >= this.selectionStartSec && time <= this.selectionEndSec) {
                this.frameStrip.setAttribute('data-cursor', 'grab');
            } else {
                this.frameStrip.removeAttribute('data-cursor');
            }
        } else {
            this.frameStrip.removeAttribute('data-cursor');
        }
    }

    handlePointerDown(event) {
        if (event.button !== 0) return; // Only handle left click
        if (!this.duration || this.duration <= 0) return; // Disable if no metadata
        
        // Debounce rapid clicks
        const now = Date.now();
        if (now - this.lastClickTime < this.clickDebounceMs) return;
        this.lastClickTime = now;
        
        event.preventDefault();
        
        // Force layout recalculation to ensure accurate positioning
        this.frameStrip.offsetWidth; // Trigger reflow
        
        const rect = this.frameStrip.getBoundingClientRect();
        const x = Math.round(event.clientX - rect.left);
        const rectWidth = Math.round(rect.width);
        
        // Ensure we have valid dimensions
        if (rectWidth <= 0) {
            console.warn('Timeline width is 0, cannot process click');
            return;
        }
        
        // Ensure click is within bounds
        if (x < 0 || x > rectWidth) {
            console.warn('Click outside timeline bounds');
            return;
        }
        
        const percentage = clamp(x / rectWidth, 0, 1);
        const clickTime = Math.round((percentage * this.duration) * 1000) / 1000; // Round to millisecond precision
        
        // Debug logging for troubleshooting (uncomment if needed)
        // console.debug('Timeline click:', { x, rectWidth, percentage, clickTime, duration: this.duration });
        
        // Provide immediate visual feedback for any click, regardless of what happens next
        this.currentTime = clickTime;
        this.updatePlayheadVisual();
        
        // Check if clicking on a resize handle
        const resizeHandle = this.getResizeHandle(x);
        if (resizeHandle) {
            this.isResizing = true;
            this.resizeHandle = resizeHandle;
            this.frameStrip.setAttribute('data-cursor', 'col-resize');
            
            this.frameStrip.setPointerCapture(event.pointerId);
            this.frameStrip.addEventListener('pointermove', this.handlePointerMove);
            this.frameStrip.addEventListener('pointerup', this.handlePointerUp);
            return;
        }
        
        // Check if clicking inside existing selection (for future move functionality)
        if (this.selectionStartSec !== null && this.selectionEndSec !== null &&
            clickTime >= this.selectionStartSec && clickTime <= this.selectionEndSec) {
            // For now, just seek within selection
            this.handleSeek(clickTime);
            return;
        }
        
        // Check if clicking outside existing selection to clear it
        if (this.selectionStartSec !== null && this.selectionEndSec !== null &&
            (clickTime < this.selectionStartSec || clickTime > this.selectionEndSec)) {
            // Clear selection if clicking outside
            appState.clearSelection();
        }
        
        // Start new selection or seek
        this.isDragging = true;
        this.selectionAnchor = clickTime;
        
        this.frameStrip.setPointerCapture(event.pointerId);
        this.frameStrip.addEventListener('pointermove', this.handlePointerMove);
        this.frameStrip.addEventListener('pointerup', this.handlePointerUp);
        
        // For now, just seek to the position
        this.handleSeek(clickTime);
    }

    handlePointerMove(event) {
        if (!this.isDragging && !this.isResizing) return;
        
        event.preventDefault();
        
        // Force layout recalculation for accurate positioning
        this.frameStrip.offsetWidth; // Trigger reflow
        
        const rect = this.frameStrip.getBoundingClientRect();
        const x = Math.round(event.clientX - rect.left);
        const rectWidth = Math.round(rect.width);
        
        // Ensure we have valid dimensions
        if (rectWidth <= 0) return;
        
        const percentage = clamp(x / rectWidth, 0, 1);
        const currentTime = Math.round((percentage * this.duration) * 1000) / 1000; // Round to millisecond precision
        
        if (this.isResizing) {
            // Handle selection resize
            let newStartSec = this.selectionStartSec;
            let newEndSec = this.selectionEndSec;
            
            if (this.resizeHandle === 'start') {
                newStartSec = clamp(currentTime, 0, this.selectionEndSec - 0.1);
            } else if (this.resizeHandle === 'end') {
                newEndSec = clamp(currentTime, this.selectionStartSec + 0.1, this.duration);
            }
            
            this.updateSelectionPreview(newStartSec, newEndSec);
        } else {
            // Handle new selection creation
            const anchorPercentage = this.selectionAnchor / this.duration;
            const anchorX = anchorPercentage * rect.width;
            const dragDistance = Math.abs(x - anchorX);
            
            if (dragDistance > 2) {
                this.isSelecting = true;
                
                // Update selection preview
                const startSec = Math.min(this.selectionAnchor, currentTime);
                const endSec = Math.max(this.selectionAnchor, currentTime);
                
                this.updateSelectionPreview(startSec, endSec);
                
                // Update playhead position to follow the drag for immediate visual feedback
                this.currentTime = currentTime;
                this.updatePlayheadVisual();
            } else {
                // For small movements (not yet selecting), still update playhead position for responsiveness
                this.currentTime = currentTime;
                this.updatePlayheadVisual();
            }
        }
    }

    handlePointerUp(event) {
        if (!this.isDragging && !this.isResizing) return;
        
        event.preventDefault();
        
        this.isDragging = false;
        this.frameStrip.releasePointerCapture(event.pointerId);
        this.frameStrip.removeEventListener('pointermove', this.handlePointerMove);
        this.frameStrip.removeEventListener('pointerup', this.handlePointerUp);
        
        if (this.isResizing && this.resizeHandle) {
            // Finalize resize
            // Force layout recalculation for accurate positioning
            this.frameStrip.offsetWidth; // Trigger reflow
            
            const rect = this.frameStrip.getBoundingClientRect();
            const x = Math.round(event.clientX - rect.left);
            const rectWidth = Math.round(rect.width);
            
            // Ensure we have valid dimensions
            if (rectWidth <= 0) return;
            
            const percentage = clamp(x / rectWidth, 0, 1);
            const currentTime = Math.round((percentage * this.duration) * 1000) / 1000; // Round to millisecond precision
            
            let newStartSec = this.selectionStartSec;
            let newEndSec = this.selectionEndSec;
            
            if (this.resizeHandle === 'start') {
                newStartSec = clamp(currentTime, 0, this.selectionEndSec - 0.1);
            } else if (this.resizeHandle === 'end') {
                newEndSec = clamp(currentTime, this.selectionStartSec + 0.1, this.duration);
            }
            
            appState.setSelection(newStartSec, newEndSec);
            
            // Seek to the beginning of the resized selection
            this.handleSeek(newStartSec);
            
            this.isResizing = false;
            this.resizeHandle = null;
            this.frameStrip.removeAttribute('data-cursor');
        } else if (this.isSelecting && this.selectionAnchor !== null) {
            // Finalize new selection
            // Force layout recalculation for accurate positioning
            this.frameStrip.offsetWidth; // Trigger reflow
            
            const rect = this.frameStrip.getBoundingClientRect();
            const x = Math.round(event.clientX - rect.left);
            const rectWidth = Math.round(rect.width);
            
            // Ensure we have valid dimensions
            if (rectWidth <= 0) return;
            
            const percentage = clamp(x / rectWidth, 0, 1);
            const endTime = Math.round((percentage * this.duration) * 1000) / 1000; // Round to millisecond precision
            
            const startSec = Math.min(this.selectionAnchor, endTime);
            const endSec = Math.max(this.selectionAnchor, endTime);
            
            // Only create selection if there's meaningful duration (minimum 0.1 seconds)
            const minSelectionDuration = 0.1;
            if (Math.abs(endSec - startSec) >= minSelectionDuration) {
                // Clamp selection to video bounds
                const clampedStartSec = clamp(startSec, 0, this.duration);
                const clampedEndSec = clamp(endSec, 0, this.duration);
                appState.setSelection(clampedStartSec, clampedEndSec);
                
                // Seek to the beginning of the selection
                this.handleSeek(clampedStartSec);
            }
        }
        
        this.isSelecting = false;
        this.selectionAnchor = null;
        
        // Resume thumbnail generation if paused
        this.thumbnailService.resumeGeneration(this.onThumbnailGenerated.bind(this));
    }

    handleSeek(seekTime) {
        // Clamp seek time to valid range
        const clampedSeekTime = clamp(seekTime, 0, this.duration);
        
        // console.debug('Seeking to:', { original: seekTime, clamped: clampedSeekTime });
        
        this.currentTime = clampedSeekTime;
        
        // Force immediate visual update, bypassing drag/resize checks
        this.updatePlayheadVisual();
        
        if (this.videoPlayer) {
            // Use requestAnimationFrame to ensure DOM is ready for seek
            requestAnimationFrame(() => {
                this.videoPlayer.seekTo(clampedSeekTime);
                
                // Force another visual update after seek to ensure sync
                requestAnimationFrame(() => {
                    this.updatePlayheadVisual();
                });
            });
        }
        
        // Pause thumbnail generation during dragging
        if (this.isDragging) {
            this.thumbnailService.pauseGeneration();
        }
    }

    startSmoothUpdates() {
        if (this.animationFrameId) return; // Already running
        this.smoothUpdateLoop();
    }

    stopSmoothUpdates() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    smoothUpdateLoop() {
        if (this.isPlayingVideo && this.videoPlayer) {
            // Get real-time position from video element
            const realCurrentTime = this.videoPlayer.getCurrentTime();
            if (Math.abs(realCurrentTime - this.currentTime) > 0.01) {
                this.currentTime = realCurrentTime;
                this.updatePlayheadVisual();
            }
            
            // Ultra-precise selection boundary checking at 60fps
            this.checkSelectionBoundaryUltraPrecise(realCurrentTime);
        }
        
        if (this.isPlayingVideo) {
            this.animationFrameId = requestAnimationFrame(this.smoothUpdateLoop);
        }
    }

    checkSelectionBoundaryUltraPrecise(currentTime) {
        if (!this.videoPlayer.isPlaying()) return;
        
        const selectionEndSec = appState.getState('selectionEndSec');
        const selectionStartSec = appState.getState('selectionStartSec');
        const isLooping = appState.getState('isLooping');
        
        // Stop at selection boundary if there's an active selection
        if (selectionEndSec !== null && currentTime >= selectionEndSec - 0.005) {
            if (isLooping) {
                // Loop back to selection start or beginning
                const loopStartTime = selectionStartSec !== null ? selectionStartSec : 0;
                this.videoPlayer.seekTo(loopStartTime);
            } else {
                // Seek back 0.3 seconds from selection end
                const seekBackTime = Math.max(selectionStartSec !== null ? selectionStartSec : 0, selectionEndSec - 0.3);
                this.videoPlayer.pause();
                this.videoPlayer.seekTo(seekBackTime);
                this.stopSmoothUpdates(); // Stop the loop immediately
            }
        }
    }

    updatePlayhead() {
        if (!this.isDragging && !this.isResizing) {
            this.updatePlayheadVisual();
        }
    }

    updatePlayheadVisual() {
        if (!this.duration || this.duration <= 0) return;
        
        const percentage = (this.currentTime / this.duration) * 100;
        const clampedPercentage = clamp(percentage, 0, 100);
        
        this.playhead.style.left = `${clampedPercentage}%`;
        
        if (this.progressLine) {
            // If there's a selection, limit progress line to selection end
            let progressPercentage = clampedPercentage;
            if (this.selectionStartSec !== null && this.selectionEndSec !== null) {
                const selectionEndPercentage = (this.selectionEndSec / this.duration) * 100;
                progressPercentage = Math.min(clampedPercentage, selectionEndPercentage);
            }
            this.progressLine.style.width = `${progressPercentage}%`;
        }
    }

    updateSelectionPreview(startSec, endSec) {
        if (!this.duration || this.duration <= 0) return;
        
        const startPercentage = (startSec / this.duration) * 100;
        const endPercentage = (endSec / this.duration) * 100;
        const width = endPercentage - startPercentage;
        
        this.selectionOverlay.style.display = 'block';
        this.selectionOverlay.style.left = `${startPercentage}%`;
        this.selectionOverlay.style.width = `${width}%`;
    }

    updateSelectionDisplay() {
        if (!this.duration || this.duration <= 0) {
            this.selectionOverlay.style.display = 'none';
            return;
        }
        
        if (this.selectionStartSec === null || this.selectionEndSec === null) {
            this.selectionOverlay.style.display = 'none';
            return;
        }
        
        const startPercentage = (this.selectionStartSec / this.duration) * 100;
        const endPercentage = (this.selectionEndSec / this.duration) * 100;
        const width = endPercentage - startPercentage;
        
        this.selectionOverlay.style.display = 'block';
        this.selectionOverlay.style.left = `${startPercentage}%`;
        this.selectionOverlay.style.width = `${width}%`;
        
        // Update aria-label for accessibility
        const duration = this.selectionEndSec - this.selectionStartSec;
        this.selectionOverlay.setAttribute('aria-label', 
            `Selected range from ${formatTime(this.selectionStartSec)} to ${formatTime(this.selectionEndSec)}, duration ${formatTime(duration)}`);
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
        this.stopSmoothUpdates();
        this.duration = 0;
        this.currentTime = 0;
        this.thumbnails = [];
        this.selectionStartSec = null;
        this.selectionEndSec = null;
        this.isSelecting = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this.selectionAnchor = null;
        this.isPlayingVideo = false;
        this.lastClickTime = 0;
        if (this.selectionOverlay) {
            this.selectionOverlay.style.display = 'none';
        }
        if (this.frameStrip) {
            this.frameStrip.removeAttribute('data-cursor');
        }
    }

    destroy() {
        this.reset();
        window.removeEventListener('resize', this.handleResize);
        this.thumbnailService.destroy();
        
        if (this.container && this.frameStrip) {
            this.container.removeChild(this.frameStrip);
        }
        
        // Clean up progress track
        if (this.progressTrack && this.progressTrack.parentElement) {
            this.progressTrack.parentElement.removeChild(this.progressTrack);
        }
    }
}