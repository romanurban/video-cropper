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
        this.deletedMarkersLayer = null;
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
        this.deletedRanges = [];
        this.stripWidth = 0;
        this.resizeHandleWidth = 4; // Width of resize handle in pixels
        this.animationFrameId = null;
        this.isPlayingVideo = false;
        this.lastClickTime = 0;
        this.clickDebounceMs = 50; // Prevent rapid clicks from interfering
        this.playThroughDeleted = false; // allow seamless play inside deleted when user starts there
        
        this.handleResize = debounce(this.updateLayout.bind(this), 200);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.smoothUpdateLoop = this.smoothUpdateLoop.bind(this);
        
        this.init();
    }

    hasDeletedInRange(startSec, endSec) {
        if (!this.deletedRanges || !this.deletedRanges.length) return false;
        const s = Math.min(startSec, endSec);
        const e = Math.max(startSec, endSec);
        return this.deletedRanges.some(r => Math.max(r.start, s) < Math.min(r.end, e));
    }

    restoreDeletedInRange(startSec, endSec) {
        if (!this.deletedRanges || !this.deletedRanges.length) return false;
        const s = Math.min(startSec, endSec);
        const e = Math.max(startSec, endSec);
        const next = [];
        let changed = false;
        for (const r of this.deletedRanges) {
            const overlapStart = Math.max(r.start, s);
            const overlapEnd = Math.min(r.end, e);
            if (overlapEnd <= overlapStart) {
                // no overlap
                next.push(r);
                continue;
            }
            changed = true;
            // If selection fully covers this range, drop it
            if (s <= r.start && e >= r.end) {
                continue;
            }
            // Partial overlaps: trim or split
            if (r.start < s && r.end > e) {
                // selection in the middle -> split into two ranges
                next.push({ start: r.start, end: s });
                next.push({ start: e, end: r.end });
            } else if (r.start < s && r.end <= e) {
                // overlap on the right side -> trim end
                next.push({ start: r.start, end: s });
            } else if (r.start >= s && r.end > e) {
                // overlap on the left side -> trim start
                next.push({ start: e, end: r.end });
            }
        }
        if (changed) {
            this.deletedRanges = next;
            this.updateDeletedOverlays();
            this.renderDeletedMarkers();
            this.generateThumbnails();
            // Sync to global state for export
            if (appState && typeof appState.setDeletedRanges === 'function') {
                const ranges = (this.deletedRanges || []).map(r => ({ startSec: r.start, endSec: r.end }));
                appState.setDeletedRanges(ranges);
            }
        }
        return changed;
    }

    isTimeInDeletedRange(timeSec) {
        if (!this.deletedRanges || !this.deletedRanges.length) return false;
        return this.deletedRanges.some(r => timeSec >= r.start && timeSec < r.end);
    }

    getNextNonDeletedTime(timeSec) {
        if (!this.duration || this.duration <= 0) return 0;
        let t = Math.max(0, Math.min(this.duration, Number(timeSec) || 0));
        // If t lands in a deleted range, jump to the end of that range.
        // Repeat in case of back-to-back deleted ranges.
        let safety = 0;
        while (this.isTimeInDeletedRange(t) && safety < 100) {
            const covering = this.deletedRanges.find(r => t >= r.start && t < r.end);
            if (!covering) break;
            t = covering.end;
            safety++;
        }
        // Add a tiny epsilon to avoid being exactly on a boundary
        const epsilon = 0.001;
        return Math.min(this.duration, t + epsilon);
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
        
        // Deleted markers overlay (clickable) on top of the main ribbon
        this.deletedMarkersLayer = document.createElement('div');
        this.deletedMarkersLayer.className = 'timeline-deleted-markers';
        
        this.frameStrip.appendChild(this.thumbnailsContainer);
        this.frameStrip.appendChild(this.selectionOverlay);
        this.frameStrip.appendChild(this.playhead);
        this.frameStrip.appendChild(this.deletedMarkersLayer);
        
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
                this.renderDeletedMarkers();
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

        // When a selection is deleted, collapse it in the ribbon and add marker
        appState.subscribe('selectionDeleted', (data) => {
            if (data && data.deletedSelection && this.duration > 0) {
                const { startSec, endSec } = data.deletedSelection;
                // Clamp to duration and ignore zero-length
                const start = Math.max(0, Math.min(this.duration, startSec));
                const end = Math.max(0, Math.min(this.duration, endSec));
                if (end > start) {
                    this.addDeletedRange({ start, end, expanded: false });
                    this.updateDeletedOverlays();
                    this.renderDeletedMarkers();
                    // Regenerate thumbnails to reflect collapsed ribbon
                    this.generateThumbnails();
                }
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
        const thumbnailWidth = 100;
        const thumbnailSpacing = 1;
        const maxThumbnails = 300;

        const availableWidth = containerWidth - 32;
        const thumbnailsPerWidth = Math.floor(availableWidth / (thumbnailWidth + thumbnailSpacing));

        const collapsedDuration = this.getCollapsedDuration() || this.duration;
        const targetInterval = 2;
        let countByDuration = Math.floor(collapsedDuration / targetInterval);
        let count = Math.min(thumbnailsPerWidth, maxThumbnails);
        if (countByDuration < count && countByDuration > 10) count = countByDuration;
        count = Math.max(count, 10);

        this.clearThumbnails();
        this.createPlaceholders(count, availableWidth, collapsedDuration);

        const times = [];
        for (let i = 0; i < count; i++) {
            const collapsedTime = (i / Math.max(1, count - 1)) * collapsedDuration;
            const t = this.getTimeForCollapsedTime(collapsedTime);
            times.push(t);
        }

        if (typeof this.thumbnailService.generateThumbnailsAtTimes === 'function') {
            this.thumbnailService.generateThumbnailsAtTimes(times, this.onThumbnailGenerated.bind(this));
        } else {
            // Fallback: approximate by duration mapping
            this.thumbnailService.generateThumbnails(this.duration, count, this.onThumbnailGenerated.bind(this));
        }
    }

    createPlaceholders(count, availableWidth, collapsedDuration) {
        const videoMetadata = appState.getState('videoMetadata');
        const aspectRatio = videoMetadata ? videoMetadata.width / videoMetadata.height : 16/9;
        
        // Calculate thumbnail width to fill available space
        const thumbnailSpacing = 2;
        const totalSpacing = (count - 1) * thumbnailSpacing;
        const thumbnailWidth = Math.floor((availableWidth - totalSpacing) / count);
        const maxThumbnailHeight = 86; // Leave space for time labels
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
            
            const collapsedTime = (i / Math.max(1, count - 1)) * collapsedDuration;
            const realTime = this.getTimeForCollapsedTime(collapsedTime);
            placeholder.dataset.time = realTime;
            
            const timeLabel = document.createElement('div');
            timeLabel.className = 'thumbnail-time';
            timeLabel.textContent = formatTime(realTime);
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
        
        const startPercentage = this.getCollapsedPercentForTime(this.selectionStartSec) / 100;
        const endPercentage = this.getCollapsedPercentForTime(this.selectionEndSec) / 100;
        
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

    getDeletedResizeHandle(x) {
        if (!this.deletedRanges || !this.deletedRanges.length || !this.duration) return null;
        const expanded = this.deletedRanges.map((r, i) => ({ ...r, index: i })).filter(r => r.expanded);
        if (!expanded.length) return null;
        this.frameStrip.offsetWidth;
        const rect = this.frameStrip.getBoundingClientRect();
        const rectWidth = Math.round(rect.width);
        if (rectWidth <= 0) return null;
        for (const r of expanded) {
            const startPct = this.getCollapsedPercentForTime(r.start) / 100;
            const endPct = this.getCollapsedPercentForTime(r.end) / 100;
            const startX = Math.round(startPct * rectWidth);
            const endX = Math.round(endPct * rectWidth);
            if (Math.abs(x - startX) <= this.resizeHandleWidth / 2) return { index: r.index, edge: 'start' };
            if (Math.abs(x - endX) <= this.resizeHandleWidth / 2) return { index: r.index, edge: 'end' };
        }
        return null;
    }

    handleMouseMove(event) {
        if (this.isDragging || this.isSelecting || this.isResizing) return;
        
        const rect = this.frameStrip.getBoundingClientRect();
        const x = Math.round(event.clientX - rect.left);
        const resizeHandle = this.getResizeHandle(x);
        const deletedHandle = this.getDeletedResizeHandle(x);
        
        if (resizeHandle || deletedHandle) {
            this.frameStrip.setAttribute('data-cursor', 'col-resize');
        } else if (this.selectionStartSec !== null && this.selectionEndSec !== null) {
        const percentage = clamp(x / rect.width, 0, 1);
        const time = this.getTimeForCollapsedPercent(percentage * 100);
            
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
        // Ignore clicks on deleted markers (they handle their own expansion)
        if (event.target && (
            event.target.classList?.contains('timeline-deleted-marker') ||
            event.target.closest?.('.timeline-deleted-marker') ||
            event.target.classList?.contains('timeline-collapse-marker') ||
            event.target.closest?.('.timeline-collapse-marker')
        )) {
            return;
        }
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
        const clickTime = Math.round((this.getTimeForCollapsedPercent(percentage * 100)) * 1000) / 1000;
        
        // Debug logging for troubleshooting (uncomment if needed)
        // console.debug('Timeline click:', { x, rectWidth, percentage, clickTime, duration: this.duration });
        
        // Provide immediate visual feedback for any click, regardless of what happens next
        this.currentTime = clickTime;
        this.updatePlayheadVisual();
        
        // Check if clicking on a selection resize handle
        const resizeHandle = this.getResizeHandle(x);
        if (resizeHandle) {
            this.isResizing = true;
            this.resizingDeleted = false;
            this.resizeHandle = resizeHandle;
            this.frameStrip.setAttribute('data-cursor', 'col-resize');
            
            this.frameStrip.setPointerCapture(event.pointerId);
            this.frameStrip.addEventListener('pointermove', this.handlePointerMove);
            this.frameStrip.addEventListener('pointerup', this.handlePointerUp);
            return;
        }

        // Check if clicking on an expanded deleted resize handle
        const delHandle = this.getDeletedResizeHandle(x);
        if (delHandle) {
            this.isResizing = true;
            this.resizingDeleted = true;
            this.resizeDeletedIndex = delHandle.index;
            this.resizeHandle = delHandle.edge;
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
        
        // Do not clear selection when clicking outside it; allow seeking while keeping selection
        
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
        const currentTime = Math.round((this.getTimeForCollapsedPercent(percentage * 100)) * 1000) / 1000;
        
        if (this.isResizing) {
            if (!this.resizingDeleted) {
                // Handle selection resize
                let newStartSec = this.selectionStartSec;
                let newEndSec = this.selectionEndSec;
            if (this.resizeHandle === 'start') {
                newStartSec = clamp(currentTime, 0, this.selectionEndSec - 0.01);
            } else if (this.resizeHandle === 'end') {
                newEndSec = clamp(currentTime, this.selectionStartSec + 0.01, this.duration);
            }
                this.updateSelectionPreview(newStartSec, newEndSec);
            } else {
                // Live resize expanded deleted
                const idx = this.resizeDeletedIndex;
                if (idx >= 0 && idx < this.deletedRanges.length) {
                    const r = this.deletedRanges[idx];
                    const minDur = 0.05;
                    if (this.resizeHandle === 'start') {
                        r.start = clamp(currentTime, 0, r.end - minDur);
                    } else if (this.resizeHandle === 'end') {
                        r.end = clamp(currentTime, r.start + minDur, this.duration);
                    }
                    this.updateDeletedOverlays();
                    this.renderDeletedMarkers();
                }
            }
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
            const currentTime = Math.round((this.getTimeForCollapsedPercent(percentage * 100)) * 1000) / 1000;
            
            if (!this.resizingDeleted) {
                let newStartSec = this.selectionStartSec;
                let newEndSec = this.selectionEndSec;
                if (this.resizeHandle === 'start') {
                    newStartSec = clamp(currentTime, 0, this.selectionEndSec - 0.01);
                } else if (this.resizeHandle === 'end') {
                    newEndSec = clamp(currentTime, this.selectionStartSec + 0.01, this.duration);
                }
                appState.setSelection(newStartSec, newEndSec);
                // Seek to the beginning of the resized selection
                this.handleSeek(newStartSec);
            } else {
                // Finalize expanded deleted resize
                const idx = this.resizeDeletedIndex;
                if (idx >= 0 && idx < this.deletedRanges.length) {
                    const r = this.deletedRanges[idx];
                    const minDur = 0.05;
                    if (this.resizeHandle === 'start') {
                        r.start = clamp(currentTime, 0, r.end - minDur);
                    } else if (this.resizeHandle === 'end') {
                        r.end = clamp(currentTime, r.start + minDur, this.duration);
                    }
                    this.normalizeDeletedRanges();
                    this.updateDeletedOverlays();
                    this.renderDeletedMarkers();
                    this.generateThumbnails();
                }
            }
            
            this.isResizing = false;
            this.resizingDeleted = false;
            this.resizeDeletedIndex = -1;
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
            const minSelectionDuration = 0.01;
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
            // Skip deleted range seamlessly during playback
            if (this.deletedRanges && this.deletedRanges.length) {
                const threshold = 0.005; // 5ms window
                for (const r of this.deletedRanges) {
                    if (realCurrentTime >= (r.start - threshold) && realCurrentTime < r.end) {
                        if (this.playThroughDeleted) {
                            // Let it play through; clear flag once we exit this region
                        } else {
                            // Skip deleted range when not explicitly playing inside it
                            const target = (typeof this.getNextNonDeletedTime === 'function')
                                ? this.getNextNonDeletedTime(r.end)
                                : r.end;
                            this.videoPlayer.seekTo(target);
                            this.currentTime = target;
                            this.updatePlayheadVisual();
                        }
                        break;
                    } else if (this.playThroughDeleted && realCurrentTime >= r.end && realCurrentTime < r.end + 0.05) {
                        // Just exited a deleted range we were playing through; reset flag
                        this.playThroughDeleted = false;
                    }
                }
            }
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
        
        const clampedPercentage = clamp(this.getCollapsedPercentForTime(this.currentTime), 0, 100);
        this.playhead.style.left = `${clampedPercentage}%`;
        
        if (this.progressLine) {
            // If there's a selection, limit progress line to selection end
            let progressPercentage = clampedPercentage;
            if (this.selectionStartSec !== null && this.selectionEndSec !== null) {
                const selectionEndPercentage = this.getCollapsedPercentForTime(this.selectionEndSec);
                progressPercentage = Math.min(clampedPercentage, selectionEndPercentage);
            }
            this.progressLine.style.width = `${progressPercentage}%`;
        }
    }

    updateSelectionPreview(startSec, endSec) {
        if (!this.duration || this.duration <= 0) return;
        
        const startPercentage = this.getCollapsedPercentForTime(startSec);
        const endPercentage = this.getCollapsedPercentForTime(endSec);
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
        
        const startPercentage = this.getCollapsedPercentForTime(this.selectionStartSec);
        const endPercentage = this.getCollapsedPercentForTime(this.selectionEndSec);
        const width = endPercentage - startPercentage;
        
        this.selectionOverlay.style.display = 'block';
        this.selectionOverlay.style.left = `${startPercentage}%`;
        this.selectionOverlay.style.width = `${width}%`;
        
        // Update aria-label for accessibility
        const duration = this.selectionEndSec - this.selectionStartSec;
        this.selectionOverlay.setAttribute('aria-label', 
            `Selected range from ${formatTime(this.selectionStartSec)} to ${formatTime(this.selectionEndSec)}, duration ${formatTime(duration)}`);
    }

    updateDeletedOverlays() {
        // Remove existing overlays
        const old = this.frameStrip.querySelectorAll('.timeline-deleted-overlay');
        old.forEach(el => el.parentElement && el.parentElement.removeChild(el));
        if (!this.duration || this.duration <= 0) return;
        // Render overlays only for expanded deleted ranges using collapsed mapping
        for (const range of this.deletedRanges.filter(r => r.expanded)) {
            const startPct = this.getCollapsedPercentForTime(range.start);
            const endPct = this.getCollapsedPercentForTime(range.end);
            const widthPct = Math.max(0, endPct - startPct);
            if (widthPct <= 0) continue;
            const overlay = document.createElement('div');
            overlay.className = 'timeline-deleted-overlay';
            overlay.style.left = `${startPct}%`;
            overlay.style.width = `${widthPct}%`;
            this.frameStrip.appendChild(overlay);
        }
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
        this.deletedRanges = [];
        this.playThroughDeleted = false;
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
            // Clear any deleted overlays
            const old = this.frameStrip.querySelectorAll('.timeline-deleted-overlay');
            old.forEach(el => el.parentElement && el.parentElement.removeChild(el));
        }
        if (this.deletedMarkersLayer) {
            this.deletedMarkersLayer.innerHTML = '';
        }
    }

    // --- Deleted ranges management and collapsed mapping ---
    addDeletedRange(range) {
        this.deletedRanges.push({ start: range.start, end: range.end, expanded: Boolean(range.expanded) });
        this.normalizeDeletedRanges();
        if (appState && typeof appState.setDeletedRanges === 'function') {
            const ranges = (this.deletedRanges || []).map(r => ({ startSec: r.start, endSec: r.end }));
            appState.setDeletedRanges(ranges);
        }
    }

    normalizeDeletedRanges() {
        if (!this.deletedRanges.length) return;
        const ranges = [...this.deletedRanges]
            .filter(r => r.end > r.start)
            .sort((a, b) => a.start - b.start);
        const merged = [];
        for (const r of ranges) {
            if (!merged.length) { merged.push({ ...r }); continue; }
            const last = merged[merged.length - 1];
            if (r.start <= last.end + 1e-6) {
                // Merge contiguous/overlapping ranges; expansion state collapses by default
                last.end = Math.max(last.end, r.end);
                // Only keep expanded=true if ALL merged parts were expanded.
                // This ensures that adding a new (collapsed) deletion adjacent to an expanded one
                // results in a collapsed joined region, per UX expectation.
                last.expanded = Boolean(last.expanded && r.expanded);
            } else {
                merged.push({ ...r });
            }
        }
        this.deletedRanges = merged;
        if (appState && typeof appState.setDeletedRanges === 'function') {
            const ranges = (this.deletedRanges || []).map(r => ({ startSec: r.start, endSec: r.end }));
            appState.setDeletedRanges(ranges);
        }
    }

    getKeptRanges() {
        this.normalizeDeletedRanges();
        const kept = [];
        let cursor = 0;
        for (const r of this.deletedRanges) {
            if (r.start > cursor) kept.push({ start: cursor, end: r.start });
            cursor = Math.max(cursor, r.end);
        }
        if (this.duration > cursor) kept.push({ start: cursor, end: this.duration });
        return kept;
    }

    getVisibleRanges() {
        // Visible = kept ranges + deleted ranges that are expanded
        const kept = this.getKeptRanges();
        const expandedDeleted = this.deletedRanges.filter(r => r.expanded).map(r => ({ start: r.start, end: r.end, deleted: true }));
        const all = [...kept.map(k => ({ ...k, deleted: false })), ...expandedDeleted]
            .sort((a, b) => a.start - b.start);
        // Merge neighbors that are same type and adjacent
        const merged = [];
        for (const seg of all) {
            if (!merged.length) { merged.push({ ...seg }); continue; }
            const last = merged[merged.length - 1];
            if (seg.deleted === last.deleted && seg.start <= last.end + 1e-6) {
                last.end = Math.max(last.end, seg.end);
            } else {
                merged.push({ ...seg });
            }
        }
        return merged;
    }

    getCollapsedDuration() {
        const vis = this.getVisibleRanges();
        return vis.reduce((acc, seg) => acc + (seg.end - seg.start), 0);
    }

    getCollapsedPercentForTime(time) {
        const total = this.getCollapsedDuration();
        if (!total || total <= 0) return 0;
        const vis = this.getVisibleRanges();
        let collapsedTime = 0;
        for (const seg of vis) {
            if (time >= seg.end) {
                collapsedTime += (seg.end - seg.start);
            } else if (time > seg.start) {
                collapsedTime += (time - seg.start);
                break;
            } else {
                break;
            }
        }
        return clamp((collapsedTime / total) * 100, 0, 100);
    }

    getTimeForCollapsedPercent(percent) {
        const total = this.getCollapsedDuration();
        if (!total || total <= 0) return 0;
        const collapsedTime = clamp(percent, 0, 100) / 100 * total;
        return this.getTimeForCollapsedTime(collapsedTime);
    }

    getTimeForCollapsedTime(collapsedTime) {
        const total = this.getCollapsedDuration();
        const t = Math.max(0, Math.min(total, collapsedTime));
        const vis = this.getVisibleRanges();
        let acc = 0;
        for (const seg of vis) {
            const segDur = seg.end - seg.start;
            if (t <= acc + segDur) {
                const offset = t - acc;
                return seg.start + Math.max(0, offset);
            }
            acc += segDur;
        }
        return this.duration || 0;
    }

    expandDeletedRange(start, end) {
        this.deletedRanges = this.deletedRanges.map(r => {
            if (Math.abs(r.start - start) < 1e-6 && Math.abs(r.end - end) < 1e-6) {
                return { ...r, expanded: true };
            }
            return r;
        });
        this.normalizeDeletedRanges();
        this.renderDeletedMarkers();
        this.updateDeletedOverlays();
        this.generateThumbnails();
        if (appState && typeof appState.setDeletedRanges === 'function') {
            const ranges = (this.deletedRanges || []).map(r => ({ startSec: r.start, endSec: r.end }));
            appState.setDeletedRanges(ranges);
        }
    }

    collapseDeletedRange(start, end) {
        this.deletedRanges = this.deletedRanges.map(r => {
            if (Math.abs(r.start - start) < 1e-6 && Math.abs(r.end - end) < 1e-6) {
                return { ...r, expanded: false };
            }
            return r;
        });
        this.normalizeDeletedRanges();
        this.renderDeletedMarkers();
        this.updateDeletedOverlays();
        this.generateThumbnails();
        if (appState && typeof appState.setDeletedRanges === 'function') {
            const ranges = (this.deletedRanges || []).map(r => ({ startSec: r.start, endSec: r.end }));
            appState.setDeletedRanges(ranges);
        }
    }

    renderDeletedMarkers() {
        if (!this.deletedMarkersLayer) return;
        this.deletedMarkersLayer.innerHTML = '';
        if (!this.duration || this.duration <= 0) return;
        for (const r of this.deletedRanges.filter(r => !r.expanded)) {
            const pct = this.getCollapsedPercentForTime(r.start);
            const marker = document.createElement('div');
            marker.className = 'timeline-deleted-marker';
            marker.style.left = `${pct}%`;
            marker.title = `Expand deleted ${formatTime(r.end - r.start)}`;
            marker.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Expand (show) this deleted region in the ribbon (still deleted)
                this.expandDeletedRange(r.start, r.end);
            });
            this.deletedMarkersLayer.appendChild(marker);
        }

        // Collapse markers for expanded deleted ranges (left edge)
        for (const r of this.deletedRanges.filter(r => r.expanded)) {
            const pct = this.getCollapsedPercentForTime(r.start);
            const marker = document.createElement('div');
            marker.className = 'timeline-collapse-marker';
            marker.style.left = `${pct}%`;
            marker.title = `Collapse deleted ${formatTime(r.end - r.start)}`;
            marker.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.collapseDeletedRange(r.start, r.end);
            });
            this.deletedMarkersLayer.appendChild(marker);
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
