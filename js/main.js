import { appState } from './state.js';
import { VideoPlayer } from './video-player.js';
import { FrameRenderer } from './frame-renderer.js';
import { TimelineFrames } from './timeline-frames.js';
import { exportUI } from './export-ui.js';
import { isVideoFile, formatTime, formatTimecode, parseTimecode } from './utils.js';
import { CropOverlay } from './crop-overlay.js';

class App {
    constructor() {
        this.videoPlayer = null;
        this.frameRenderer = null;
        this.timelineFrames = null;
        this.cropOverlay = null;
        this.elements = {};
        
        this.init();
    }

    init() {
        this.getElements();
        this.setupVideoPlayer();
        this.setupFrameRenderer();
        this.setupTimelineFrames();
        this.setupEventListeners();
        this.setupStateSubscriptions();
    }

    getElements() {
        this.elements = {
            dropZone: document.getElementById('drop-zone'),
            openButton: document.getElementById('open-button'),
            loadSampleLink: document.getElementById('load-sample-link'),
            fileInput: document.getElementById('file-input'),
            videoContainer: document.getElementById('video-container'),
            videoElement: document.getElementById('video-element'),
            canvasElement: document.getElementById('canvas-element'),
            controlsPanel: document.getElementById('controls-panel'),
            metadataPanel: document.getElementById('metadata-panel'),
            timelineSection: document.getElementById('timeline-section'),
            timelineFrames: document.getElementById('timeline-frames'),
            seekBeginningButton: document.getElementById('seek-beginning-button'),
            rewindButton: document.getElementById('rewind-button'),
            playPauseButton: document.getElementById('play-pause-button'),
            stopButton: document.getElementById('stop-button'),
            forwardButton: document.getElementById('forward-button'),
            seekEndButton: document.getElementById('seek-end-button'),
            loopButton: document.getElementById('loop-button'),
            exportGlobalButton: document.getElementById('export-global-button'),
            volumeSlider: document.getElementById('volume-slider'),
            volumePercent: document.getElementById('volume-percentage'),
            filenameDisplay: document.getElementById('filename'),
            durationDisplay: document.getElementById('duration'),
            resolutionDisplay: document.getElementById('resolution'),
            selectionInfo: document.getElementById('selection-info'),
            selectionStartInput: document.getElementById('selection-start-input'),
            selectionEndInput: document.getElementById('selection-end-input'),
            selectionDuration: document.getElementById('selection-duration'),
            restoreSelectionButton: document.getElementById('restore-selection-button'),
            deleteSelectionButton: document.getElementById('delete-selection-button'),
            exportButton: document.getElementById('export-button')
        };
    }

    setupVideoPlayer() {
        this.videoPlayer = new VideoPlayer(this.elements.videoElement);
    }

    setupFrameRenderer() {
        this.frameRenderer = new FrameRenderer(
            this.elements.videoElement,
            this.elements.canvasElement
        );
        // Initialize crop overlay above the canvas
        this.cropOverlay = new CropOverlay(this.elements.canvasElement);
    }


    setupTimelineFrames() {
        this.timelineFrames = new TimelineFrames(this.elements.timelineFrames, this.videoPlayer);
    }

    setupEventListeners() {
        this.elements.dropZone.addEventListener('click', (e) => {
            // Only prevent if it's not the file input itself
            if (e.target !== this.elements.fileInput) {
                this.elements.fileInput.click();
            }
        });

        this.elements.openButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.elements.fileInput.click();
        });

        if (this.elements.loadSampleLink) {
            this.elements.loadSampleLink.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this.loadSampleFile();
            });
        }

        this.elements.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleFileSelect(file);
                // Clear the input value to allow selecting the same file again
                e.target.value = '';
            }
        });

        this.setupDragAndDrop();
        this.setupVideoControls();
        this.setupKeyboardControls();
    }

    setupDragAndDrop() {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            this.elements.dropZone.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            this.elements.dropZone.addEventListener(eventName, this.highlight.bind(this), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            this.elements.dropZone.addEventListener(eventName, this.unhighlight.bind(this), false);
        });

        this.elements.dropZone.addEventListener('drop', this.handleDrop.bind(this), false);
    }

    setupVideoControls() {
        this.elements.seekBeginningButton.addEventListener('click', () => {
            this.videoPlayer.seekToBeginning();
        });

        this.elements.rewindButton.addEventListener('click', () => {
            this.videoPlayer.rewind();
        });

        this.elements.playPauseButton.addEventListener('click', () => {
            const isPlaying = appState.getState('isPlaying');
            if (isPlaying) {
                this.videoPlayer.pause();
            } else {
                // If starting inside a deleted fragment, allow play-through instead of skipping
                if (this.timelineFrames && typeof this.timelineFrames.isTimeInDeletedRange === 'function') {
                    const now = this.videoPlayer.getCurrentTime();
                    if (this.timelineFrames.isTimeInDeletedRange(now)) {
                        this.timelineFrames.playThroughDeleted = true;
                    }
                }
                this.videoPlayer.play();
            }
        });

        this.elements.stopButton.addEventListener('click', () => {
            this.videoPlayer.stop();
        });

        this.elements.forwardButton.addEventListener('click', () => {
            this.videoPlayer.forward();
        });

        this.elements.seekEndButton.addEventListener('click', () => {
            this.videoPlayer.seekToEnd();
        });

        this.elements.loopButton.addEventListener('click', () => {
            const isLooping = appState.getState('isLooping');
            appState.setLooping(!isLooping);
        });

        if (this.elements.volumeSlider) {
            const updateLabel = (percent) => {
                if (this.elements.volumePercent) {
                    this.elements.volumePercent.textContent = `${Math.round(percent)}%`;
                }
            };
            const initialVol = appState.getState('volume');
            const initialPercent = Math.round(((typeof initialVol === 'number') ? initialVol : 1) * 100);
            this.elements.volumeSlider.value = String(initialPercent);
            updateLabel(initialPercent);

            this.elements.volumeSlider.addEventListener('input', (e) => {
                const percent = Number(e.target.value);
                updateLabel(percent);
                this.videoPlayer.setVolume(percent / 100);
            });
        }

        // Precise selection time editing
        const applyStart = () => {
            const el = this.elements.selectionStartInput; if (!el) return;
            const parsed = parseTimecode(el.value);
            const curEnd = appState.getState('selectionEndSec');
            if (parsed == null || curEnd == null) return this.refreshSelectionInputs();
            const minDur = 0.01;
            const newStart = Math.max(0, Math.min(parsed, curEnd - minDur));
            appState.setSelection(newStart, curEnd);
        };
        const applyEnd = () => {
            const el = this.elements.selectionEndInput; if (!el) return;
            const parsed = parseTimecode(el.value);
            const curStart = appState.getState('selectionStartSec');
            if (parsed == null || curStart == null) return this.refreshSelectionInputs();
            const minDur = 0.01;
            const dur = this.videoPlayer.getDuration() || Infinity;
            const newEnd = Math.min(dur, Math.max(parsed, curStart + minDur));
            appState.setSelection(curStart, newEnd);
        };
        const bindTimeInput = (el, apply) => {
            if (!el) return;
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); apply(); el.blur(); }
                if (e.key === 'Escape') { e.preventDefault(); this.refreshSelectionInputs(); el.blur(); }
            });
            el.addEventListener('blur', () => apply());
        };
        bindTimeInput(this.elements.selectionStartInput, applyStart);
        bindTimeInput(this.elements.selectionEndInput, applyEnd);

        if (document.getElementById('clear-selection-button')) {
            document.getElementById('clear-selection-button').addEventListener('click', () => {
                appState.clearSelection();
            });
        }

        if (this.elements.exportGlobalButton) {
            this.elements.exportGlobalButton.addEventListener('click', () => {
                // Open the unified export modal; export-manager will honor deleted ranges
                if (this.videoPlayer) {
                    exportUI.showExportModal();
                }
            });
        }

        if (this.elements.deleteSelectionButton) {
            this.elements.deleteSelectionButton.addEventListener('click', () => {
                if (this.hasActiveSelection()) {
                    appState.deleteSelection();
                }
            });
        }

        if (this.elements.restoreSelectionButton) {
            this.elements.restoreSelectionButton.addEventListener('click', () => {
                const selectionStartSec = appState.getState('selectionStartSec');
                const selectionEndSec = appState.getState('selectionEndSec');
                if (selectionStartSec !== null && selectionEndSec !== null && this.timelineFrames) {
                    const changed = this.timelineFrames.restoreDeletedInRange(selectionStartSec, selectionEndSec);
                    if (changed) {
                        this.showInfo('Restored deleted fragments in selection');
                    }
                    this.updateRestoreButtonState();
                }
            });
        }
    }

    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            const t = e.target;
            const tag = (t && t.tagName) ? t.tagName.toLowerCase() : '';
            const isEditable = !!(t && (tag === 'input' || tag === 'textarea' || t.isContentEditable || (t.closest && t.closest('[contenteditable="true"]'))));

            if (e.key === 'Escape') {
                appState.clearSelection();
                return;
            }

            // Do not trigger global shortcuts while typing in inputs/editable fields
            if (isEditable) return;

            if (e.key === ' ' && e.shiftKey) {
                e.preventDefault();
                this.playFromSelectionStart();
                return;
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && this.hasActiveSelection()) {
                e.preventDefault();
                appState.deleteSelection();
            }
        });
    }

    hasActiveSelection() {
        const selectionStartSec = appState.getState('selectionStartSec');
        const selectionEndSec = appState.getState('selectionEndSec');
        return selectionStartSec !== null && selectionEndSec !== null;
    }

    playFromSelectionStart() {
        const selectionStartSec = appState.getState('selectionStartSec');
        const selectionEndSec = appState.getState('selectionEndSec');
        
        if (selectionStartSec !== null && selectionEndSec !== null) {
            // Use the new playFromSelection method for proper selection playback
            this.videoPlayer.playFromSelection(selectionStartSec);
        }
    }

    setupStateSubscriptions() {
        appState.subscribe('file', (file) => {
            if (file) {
                this.showVideoInterface();
            } else {
                this.showDropZone();
            }
        });

        appState.subscribe('filename', (filename) => {
            this.elements.filenameDisplay.textContent = filename;
        });

        appState.subscribe('videoMetadata', (metadata) => {
            if (metadata) {
                import('./utils.js').then(({ formatTimecode }) => {
                    this.elements.durationDisplay.textContent = formatTimecode(metadata.duration, { withMillis: true });
                });
                this.elements.resolutionDisplay.textContent = `${metadata.width}×${metadata.height}`;
            }
        });

        appState.subscribe('isPlaying', (isPlaying) => {
            if (isPlaying) {
                this.elements.playPauseButton.classList.add('playing');
                this.elements.playPauseButton.title = 'Pause';
                this.elements.playPauseButton.setAttribute('aria-label', 'Pause');
            } else {
                this.elements.playPauseButton.classList.remove('playing');
                this.elements.playPauseButton.title = 'Play';
                this.elements.playPauseButton.setAttribute('aria-label', 'Play');
            }
        });

        appState.subscribe('volume', (volume) => {
            if (this.elements.volumeSlider) {
                const percent = Math.round(((typeof volume === 'number') ? volume : 1) * 100);
                if (Number(this.elements.volumeSlider.value) !== percent) {
                    this.elements.volumeSlider.value = String(percent);
                }
                if (this.elements.volumePercent) {
                    this.elements.volumePercent.textContent = `${percent}%`;
                }
            }
        });

        appState.subscribe('error', (error) => {
            if (error) {
                this.showError(error);
            }
        });

        appState.subscribe('selection', (selection) => {
            if (selection) {
                // Only update inputs if not focused to avoid disrupting typing
                this.refreshSelectionInputs(selection);
                this.elements.selectionDuration.textContent = formatTimecode(selection.endSec - selection.startSec, { withMillis: true });
                this.elements.selectionInfo.style.display = 'flex';
                this.updateRestoreButtonState();
            } else {
                this.elements.selectionInfo.style.display = 'none';
                this.updateRestoreButtonState();
            }
        });

        // Live preview of selection while dragging/resizing
        appState.subscribe('selectionPreview', (preview) => {
            const startInput = this.elements.selectionStartInput;
            const endInput = this.elements.selectionEndInput;
            const startFocused = (document.activeElement === startInput);
            const endFocused = (document.activeElement === endInput);
            if (preview && typeof preview.startSec === 'number' && typeof preview.endSec === 'number') {
                if (startInput && !startFocused) startInput.value = formatTimecode(preview.startSec, { withMillis: true });
                if (endInput && !endFocused) endInput.value = formatTimecode(preview.endSec, { withMillis: true });
                this.elements.selectionDuration.textContent = formatTimecode(preview.endSec - preview.startSec, { withMillis: true });
            } else {
                // Restore to current selection values
                const selStart = appState.getState('selectionStartSec');
                const selEnd = appState.getState('selectionEndSec');
                if (selStart != null && selEnd != null) {
                    if (startInput && !startFocused) startInput.value = formatTimecode(selStart, { withMillis: true });
                    if (endInput && !endFocused) endInput.value = formatTimecode(selEnd, { withMillis: true });
                    this.elements.selectionDuration.textContent = formatTimecode(selEnd - selStart, { withMillis: true });
                }
            }
        });

        appState.subscribe('isLooping', (isLooping) => {
            if (isLooping) {
                this.elements.loopButton.classList.add('active');
                this.elements.loopButton.title = 'Loop enabled - click to disable';
            } else {
                this.elements.loopButton.classList.remove('active');
                this.elements.loopButton.title = 'Loop disabled - click to enable';
            }
        });

        appState.subscribe('file', (file) => {
            if (this.elements.exportButton) {
                this.elements.exportButton.disabled = !file;
                this.elements.exportButton.title = file ? 'Export video' : 'Load a video to export';
            }
            if (this.elements.exportGlobalButton) {
                this.elements.exportGlobalButton.disabled = !file;
                this.elements.exportGlobalButton.title = file ? 'Export video' : 'Load a video to export';
            }
        });

        appState.subscribe('selectionDeleted', (data) => {
            if (data && data.message) {
                this.showInfo(data.message);
                // Add visual feedback for deletion
                if (data.action === 'deleted') {
                    this.showDeletionFeedback(data.deletedSelection);
                    // Move playhead to the beginning of the not-deleted part
                    const end = Math.max(0, Number(data.deletedSelection.endSec) || 0);
                    const target = (this.timelineFrames && typeof this.timelineFrames.getNextNonDeletedTime === 'function')
                        ? this.timelineFrames.getNextNonDeletedTime(end)
                        : end;
                    this.videoPlayer.pause();
                    this.videoPlayer.seekTo(target);
                }
                this.updateRestoreButtonState();
            }
        });
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    highlight() {
        this.elements.dropZone.classList.add('drag-over');
    }

    unhighlight() {
        this.elements.dropZone.classList.remove('drag-over');
    }

    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            this.handleFileSelect(files[0]);
        }
    }

    async handleFileSelect(file) {
        if (!isVideoFile(file)) {
            this.showError('Please select a valid video file.');
            return;
        }

        try {
            await this.videoPlayer.loadFile(file);
        } catch (error) {
            console.error('Error handling file:', error);
            this.showError(`Failed to load video: ${error.message}`);
        }
    }

    async loadSampleFile() {
        const samplePath = 'samples/BigBuckBunny_sample.mp4';
        try {
            const response = await fetch(samplePath);
            if (!response.ok) {
                throw new Error(`Failed to fetch sample (${response.status})`);
            }
            const blob = await response.blob();
            const type = blob.type || 'video/mp4';
            // Create a File so downstream filename/metadata flows work as with user files
            const file = new File([blob], 'BigBuckBunny_sample.mp4', { type });
            await this.handleFileSelect(file);
        } catch (err) {
            console.error('Error loading sample file:', err);
            this.showError('Unable to load sample video. Please try again.');
        }
    }

    showDropZone() {
        this.elements.dropZone.style.display = 'flex';
        this.elements.videoContainer.style.display = 'none';
        this.elements.timelineSection.style.display = 'none';
        this.elements.controlsPanel.style.display = 'none';
        this.elements.metadataPanel.style.display = 'none';
    }

    showVideoInterface() {
        this.elements.dropZone.style.display = 'none';
        this.elements.videoContainer.style.display = 'flex';
        this.elements.timelineSection.style.display = 'block';
        this.elements.controlsPanel.style.display = 'flex';
        this.elements.metadataPanel.style.display = 'flex';
    }


    showError(message) {
        alert(`Error: ${message}`);
    }

    showInfo(message) {
        console.info(message);
        // Create a simple toast notification
        this.showToast(message);
    }

    showDeletionFeedback(deletedSelection) {
        // Visual feedback when selection is deleted
        if (this.elements.selectionInfo && this.elements.selectionInfo.style.display !== 'none') {
            // Flash effect to show something was deleted
            this.elements.selectionInfo.style.transition = 'opacity 0.3s ease';
            this.elements.selectionInfo.style.opacity = '0.3';
            setTimeout(() => {
                this.elements.selectionInfo.style.opacity = '1';
            }, 300);
        }
        
        // Log the deletion details
        console.info(`Selection deleted: ${deletedSelection.duration.toFixed(2)}s from ${deletedSelection.startSec.toFixed(2)}s to ${deletedSelection.endSec.toFixed(2)}s`);
    }

    showToast(message) {
        // Simple toast notification implementation
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 12px 16px;
                border-radius: 4px;
                font-size: 14px;
                z-index: 1000;
                opacity: 0;
                transform: translateY(-20px);
                transition: all 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
            `;
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    refreshSelectionInputs(selection) {
        const startSec = selection?.startSec ?? appState.getState('selectionStartSec');
        const endSec = selection?.endSec ?? appState.getState('selectionEndSec');
        if (startSec == null || endSec == null) return;
        if (this.elements.selectionStartInput) this.elements.selectionStartInput.value = formatTimecode(startSec, { withMillis: true });
        if (this.elements.selectionEndInput) this.elements.selectionEndInput.value = formatTimecode(endSec, { withMillis: true });
    }
    updateRestoreButtonState() {
        const btn = this.elements.restoreSelectionButton;
        if (!btn) return;
        const start = appState.getState('selectionStartSec');
        const end = appState.getState('selectionEndSec');
        if (start === null || end === null || !this.timelineFrames) {
            btn.disabled = true;
            btn.title = 'Restore unavailable (no selection)';
            return;
        }
        const hasDeleted = this.timelineFrames.hasDeletedInRange(start, end);
        btn.disabled = !hasDeleted;
        btn.title = hasDeleted ? 'Restore deleted fragments in selection' : 'No deleted fragments in selection';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
