import { appState } from './state.js';
import { getVideoMetadata, safeRevokeObjectURL, formatTime } from './utils.js';

export class VideoPlayer {
    constructor(videoElement) {
        this.videoElement = videoElement;
        this.currentObjectURL = null;
        
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
    }

    handleEnded() {
        const isLooping = appState.getState('isLooping');
        
        if (isLooping) {
            // Loop back to beginning of video
            this.seekTo(0);
            this.play();
        } else {
            // Seek back 0.3 seconds from the end
            const currentTime = this.videoElement.currentTime;
            const seekBackTime = Math.max(0, currentTime - 0.3);
            this.seekTo(seekBackTime);
            appState.setPlaybackState(false);
        }
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
    }

    stop() {
        this.pause();
        
        const selectionStartSec = appState.getState('selectionStartSec');
        const hasSelection = selectionStartSec !== null;
        
        if (hasSelection) {
            this.seekTo(selectionStartSec);
        } else {
            this.seekTo(0);
        }
    }

    seekToBeginning() {
        const selectionStartSec = appState.getState('selectionStartSec');
        const hasSelection = selectionStartSec !== null;
        
        if (hasSelection) {
            this.seekTo(selectionStartSec);
        } else {
            this.seekTo(0);
        }
    }

    seekToEnd() {
        const selectionEndSec = appState.getState('selectionEndSec');
        const hasSelection = selectionEndSec !== null;
        
        if (hasSelection) {
            this.seekTo(selectionEndSec);
        } else {
            this.seekTo(this.getDuration());
        }
    }

    getSmartSkipDuration() {
        const selectionStartSec = appState.getState('selectionStartSec');
        const selectionEndSec = appState.getState('selectionEndSec');
        const hasSelection = selectionStartSec !== null && selectionEndSec !== null;
        
        let duration;
        if (hasSelection) {
            duration = selectionEndSec - selectionStartSec;
        } else {
            duration = this.getDuration();
        }
        
        // Smart skip duration based on total duration
        if (duration <= 1) {
            return Math.max(0.1, duration * 0.1); // 10% of duration, min 0.1 second (100ms)
        } else if (duration <= 5) {
            return Math.max(0.2, duration * 0.08); // 8% of duration, min 0.2 second (200ms)
        } else if (duration <= 10) {
            return Math.max(0.5, duration * 0.05); // 5% of duration, min 0.5 second
        } else if (duration <= 30) {
            return Math.max(1, duration * 0.03); // 3% of duration, min 1 second
        } else if (duration <= 300) { // 5 minutes
            return Math.max(2, duration * 0.02); // 2% of duration, min 2 seconds
        } else if (duration <= 1800) { // 30 minutes
            return Math.max(5, duration * 0.015); // 1.5% of duration, min 5 seconds
        } else {
            return Math.max(10, duration * 0.01); // 1% of duration, min 10 seconds
        }
    }

    rewind() {
        const skipDuration = this.getSmartSkipDuration();
        const currentTime = this.getCurrentTime();
        const selectionStartSec = appState.getState('selectionStartSec');
        const hasSelection = selectionStartSec !== null;
        
        const minTime = hasSelection ? selectionStartSec : 0;
        const newTime = Math.max(minTime, currentTime - skipDuration);
        
        this.seekTo(newTime);
    }

    forward() {
        const skipDuration = this.getSmartSkipDuration();
        const currentTime = this.getCurrentTime();
        const selectionEndSec = appState.getState('selectionEndSec');
        const hasSelection = selectionEndSec !== null;
        
        const maxTime = hasSelection ? selectionEndSec : this.getDuration();
        const newTime = Math.min(maxTime, currentTime + skipDuration);
        
        this.seekTo(newTime);
    }

    playFromSelection(startTime) {
        this.seekTo(startTime);
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
