import { appState } from './state.js';
import { VideoPlayer } from './video-player.js';
import { FrameRenderer } from './frame-renderer.js';
import { TimelineFrames } from './timeline-frames.js';
import { isVideoFile, formatTime } from './utils.js';

class App {
    constructor() {
        this.videoPlayer = null;
        this.frameRenderer = null;
        this.timelineFrames = null;
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
            fileInput: document.getElementById('file-input'),
            videoContainer: document.getElementById('video-container'),
            videoElement: document.getElementById('video-element'),
            canvasElement: document.getElementById('canvas-element'),
            controlsPanel: document.getElementById('controls-panel'),
            metadataPanel: document.getElementById('metadata-panel'),
            timelineSection: document.getElementById('timeline-section'),
            timelineFrames: document.getElementById('timeline-frames'),
            playPauseButton: document.getElementById('play-pause-button'),
            loopButton: document.getElementById('loop-button'),
            volumeSlider: document.getElementById('volume-slider'),
            volumePercent: document.getElementById('volume-percentage'),
            filenameDisplay: document.getElementById('filename'),
            durationDisplay: document.getElementById('duration'),
            resolutionDisplay: document.getElementById('resolution'),
            selectionInfo: document.getElementById('selection-info'),
            selectionStart: document.getElementById('selection-start'),
            selectionEnd: document.getElementById('selection-end'),
            selectionDuration: document.getElementById('selection-duration')
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
        this.elements.playPauseButton.addEventListener('click', () => {
            const isPlaying = appState.getState('isPlaying');
            if (isPlaying) {
                this.videoPlayer.pause();
            } else {
                this.videoPlayer.play();
            }
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
    }

    setupKeyboardControls() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                appState.clearSelection();
            } else if (e.key === ' ' && e.shiftKey) {
                e.preventDefault();
                this.playFromSelectionStart();
            }
        });
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
                this.elements.durationDisplay.textContent = formatTime(metadata.duration);
                this.elements.resolutionDisplay.textContent = `${metadata.width}×${metadata.height}`;
            }
        });

        appState.subscribe('isPlaying', (isPlaying) => {
            this.elements.playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
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
                this.elements.selectionStart.textContent = formatTime(selection.startSec);
                this.elements.selectionEnd.textContent = formatTime(selection.endSec);
                this.elements.selectionDuration.textContent = formatTime(selection.endSec - selection.startSec);
                this.elements.selectionInfo.style.display = 'flex';
            } else {
                this.elements.selectionInfo.style.display = 'none';
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
}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
