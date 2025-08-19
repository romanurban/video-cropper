import { appState } from './state.js';
import { VideoPlayer } from './video-player.js';
import { FrameRenderer } from './frame-renderer.js';
import { isVideoFile, formatTime } from './utils.js';

class App {
    constructor() {
        this.videoPlayer = null;
        this.frameRenderer = null;
        this.elements = {};
        
        this.init();
    }

    init() {
        this.getElements();
        this.setupVideoPlayer();
        this.setupFrameRenderer();
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
            playPauseButton: document.getElementById('play-pause-button'),
            progressSlider: document.getElementById('progress-slider'),
            currentTimeDisplay: document.getElementById('current-time'),
            totalTimeDisplay: document.getElementById('total-time'),
            filenameDisplay: document.getElementById('filename'),
            durationDisplay: document.getElementById('duration'),
            resolutionDisplay: document.getElementById('resolution')
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

    setupEventListeners() {
        this.elements.dropZone.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        this.elements.openButton.addEventListener('click', () => {
            this.elements.fileInput.click();
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleFileSelect(file);
            }
        });

        this.setupDragAndDrop();
        this.setupVideoControls();
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

        this.elements.progressSlider.addEventListener('input', (e) => {
            const percent = parseFloat(e.target.value);
            this.videoPlayer.seekToPercent(percent);
        });

        this.elements.progressSlider.addEventListener('mousedown', () => {
            this.isDragging = true;
        });

        this.elements.progressSlider.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
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
                this.elements.totalTimeDisplay.textContent = formatTime(metadata.duration);
            }
        });

        appState.subscribe('isPlaying', (isPlaying) => {
            this.elements.playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
        });

        appState.subscribe('currentTime', (currentTime) => {
            this.elements.currentTimeDisplay.textContent = formatTime(currentTime);
            
            if (!this.isDragging) {
                const duration = appState.getState('duration');
                const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
                this.elements.progressSlider.value = progress;
            }
        });

        appState.subscribe('error', (error) => {
            if (error) {
                this.showError(error);
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
        this.elements.controlsPanel.style.display = 'none';
        this.elements.metadataPanel.style.display = 'none';
    }

    showVideoInterface() {
        this.elements.dropZone.style.display = 'none';
        this.elements.videoContainer.style.display = 'flex';
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