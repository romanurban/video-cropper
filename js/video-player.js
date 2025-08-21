import { appState } from './state.js';
import { getVideoMetadata, safeRevokeObjectURL, formatTime } from './utils.js';

export class VideoPlayer {
    constructor(videoElement) {
        this.videoElement = videoElement;
        this.currentObjectURL = null;
        this.isPlayingSelection = false;
        
        this.setupEventListeners();
        // Initialize audio properties from state
        try {
            const initialVolume = appState.getState('volume');
            const initialMuted = appState.getState('muted');
            if (typeof initialVolume === 'number') {
                this.videoElement.volume = Math.max(0, Math.min(1, initialVolume));
            }
            if (typeof initialMuted === 'boolean') {
                this.videoElement.muted = initialMuted;
            }
        } catch (e) {
            // Non-fatal; fall back to element defaults
            console.warn('Volume init failed:', e);
        }
    }

    setupEventListeners() {
        this.videoElement.addEventListener('loadstart', this.handleLoadStart.bind(this));
        this.videoElement.addEventListener('loadedmetadata', this.handleLoadedMetadata.bind(this));
        this.videoElement.addEventListener('loadeddata', this.handleLoadedData.bind(this));
        this.videoElement.addEventListener('canplay', this.handleCanPlay.bind(this));
        this.videoElement.addEventListener('play', this.handlePlay.bind(this));
        this.videoElement.addEventListener('pause', this.handlePause.bind(this));
        this.videoElement.addEventListener('timeupdate', this.handleTimeUpdate.bind(this));
        this.videoElement.addEventListener('ended', this.handleEnded.bind(this));
        this.videoElement.addEventListener('error', this.handleError.bind(this));
        this.videoElement.addEventListener('seeking', this.handleSeeking.bind(this));
        this.videoElement.addEventListener('seeked', this.handleSeeked.bind(this));
        this.videoElement.addEventListener('volumechange', this.handleVolumeChange.bind(this));
    }

    async loadFile(file) {
        try {
            appState.setLoading(true);
            appState.setError(null);

            this.cleanup();

            this.currentObjectURL = URL.createObjectURL(file);
            this.videoElement.src = this.currentObjectURL;
            
            appState.setFile(file);
            
        } catch (error) {
            console.error('Error loading video file:', error);
            appState.setError(`Failed to load video: ${error.message}`);
            appState.setLoading(false);
        }
    }

    handleLoadStart() {
        appState.setLoading(true);
    }

    handleLoadedMetadata() {
        const metadata = getVideoMetadata(this.videoElement);
        appState.setVideoMetadata(metadata);
    }

    handleLoadedData() {
        appState.setLoading(false);
    }

    handleCanPlay() {
        appState.setLoading(false);
    }

    handlePlay() {
        appState.setPlaybackState(true);
    }

    handlePause() {
        appState.setPlaybackState(false);
    }

    handleTimeUpdate() {
        const currentTime = this.videoElement.currentTime;
        appState.setCurrentTime(currentTime);
        
        // Stop at selection end if selection is present
        if (this.isPlaying()) {
            const selectionEndSec = appState.getState('selectionEndSec');
            if (selectionEndSec !== null && currentTime >= selectionEndSec - 0.05) {
                this.pause();
                // Seek back to exact selection end
                this.seekTo(selectionEndSec);
            }
        }
    }

    handleEnded() {
        appState.setPlaybackState(false);
        this.isPlayingSelection = false;
    }

    handleError() {
        const error = this.videoElement.error;
        let errorMessage = 'Unknown video error';

        if (error) {
            switch (error.code) {
                case error.MEDIA_ERR_ABORTED:
                    errorMessage = 'Video loading was aborted';
                    break;
                case error.MEDIA_ERR_NETWORK:
                    errorMessage = 'Network error occurred while loading video';
                    break;
                case error.MEDIA_ERR_DECODE:
                    errorMessage = 'Video format not supported or corrupted';
                    break;
                case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
                    errorMessage = 'Video format not supported';
                    break;
            }
        }

        console.error('Video error:', error);
        appState.setError(errorMessage);
        appState.setLoading(false);
    }

    handleSeeking() {
        appState.setLoading(true);
    }

    handleSeeked() {
        appState.setLoading(false);
    }

    handleVolumeChange() {
        // Reflect element values back to state
        appState.setVolume(this.videoElement.volume);
        appState.setMuted(this.videoElement.muted);
    }

    play() {
        if (this.videoElement.readyState >= 2) {
            return this.videoElement.play().catch(error => {
                console.error('Play failed:', error);
                appState.setError(`Playback failed: ${error.message}`);
            });
        }
    }

    pause() {
        this.videoElement.pause();
        this.isPlayingSelection = false;
    }

    playFromSelection(startTime) {
        this.seekTo(startTime);
        this.isPlayingSelection = true;
        return this.play();
    }

    setVolume(volume) {
        const v = Math.max(0, Math.min(1, Number(volume)));
        this.videoElement.volume = v;
    }

    setMuted(muted) {
        this.videoElement.muted = Boolean(muted);
    }

    seekTo(time) {
        if (this.videoElement.readyState >= 1) {
            this.videoElement.currentTime = Math.max(0, Math.min(time, this.videoElement.duration));
        }
    }

    seekToPercent(percent) {
        const duration = this.videoElement.duration;
        if (duration > 0) {
            const time = (percent / 100) * duration;
            this.seekTo(time);
        }
    }

    getCurrentTime() {
        return this.videoElement.currentTime;
    }

    getDuration() {
        return this.videoElement.duration;
    }

    getProgress() {
        const duration = this.getDuration();
        if (duration > 0) {
            return (this.getCurrentTime() / duration) * 100;
        }
        return 0;
    }

    isPlaying() {
        return !this.videoElement.paused && !this.videoElement.ended;
    }

    cleanup() {
        this.pause();
        this.isPlayingSelection = false;
        if (this.currentObjectURL) {
            safeRevokeObjectURL(this.currentObjectURL);
            this.currentObjectURL = null;
        }
        this.videoElement.src = '';
        this.videoElement.load();
    }

    destroy() {
        this.cleanup();
    }
}
