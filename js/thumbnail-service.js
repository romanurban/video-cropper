import { safeRevokeObjectURL } from './utils.js';

export class ThumbnailService {
    constructor() {
        this.offscreenVideo = null;
        this.offscreenCanvas = null;
        this.offscreenContext = null;
        this.thumbnailCache = new Map();
        this.seekQueue = [];
        this.isProcessing = false;
        this.currentFile = null;
        this.currentFileUrl = null;
        this.abortController = null;
    }

    async initialize(file) {
        this.cleanup();
        
        this.currentFile = file;
        this.currentFileUrl = URL.createObjectURL(file);
        this.abortController = new AbortController();
        
        this.offscreenVideo = document.createElement('video');
        this.offscreenVideo.preload = 'metadata';
        this.offscreenVideo.muted = true;
        this.offscreenVideo.style.position = 'absolute';
        this.offscreenVideo.style.left = '-9999px';
        this.offscreenVideo.style.visibility = 'hidden';
        document.body.appendChild(this.offscreenVideo);
        
        this.offscreenCanvas = document.createElement('canvas');
        this.offscreenContext = this.offscreenCanvas.getContext('2d');
        
        return new Promise((resolve, reject) => {
            const handleLoad = () => {
                this.offscreenVideo.removeEventListener('loadedmetadata', handleLoad);
                this.offscreenVideo.removeEventListener('error', handleError);
                resolve();
            };
            
            const handleError = () => {
                this.offscreenVideo.removeEventListener('loadedmetadata', handleLoad);
                this.offscreenVideo.removeEventListener('error', handleError);
                reject(new Error('Failed to load video for thumbnails'));
            };
            
            this.offscreenVideo.addEventListener('loadedmetadata', handleLoad);
            this.offscreenVideo.addEventListener('error', handleError);
            this.offscreenVideo.src = this.currentFileUrl;
        });
    }

    generateThumbnails(duration, count, onProgress) {
        if (!this.offscreenVideo || !duration || count <= 0) return;
        
        this.thumbnailCache.clear();
        this.seekQueue = [];
        
        const interval = duration / count;
        const thumbnailWidth = 120;
        const videoAspectRatio = this.offscreenVideo.videoWidth / this.offscreenVideo.videoHeight;
        const thumbnailHeight = Math.round(thumbnailWidth / videoAspectRatio);
        
        this.offscreenCanvas.width = thumbnailWidth;
        this.offscreenCanvas.height = thumbnailHeight;
        
        for (let i = 0; i < count; i++) {
            const time = Math.min(i * interval, duration - 0.1);
            this.seekQueue.push({
                time,
                index: i,
                width: thumbnailWidth,
                height: thumbnailHeight
            });
        }
        
        this.processQueue(onProgress);
    }

    generateThumbnailsAtTimes(times, onProgress) {
        if (!this.offscreenVideo || !Array.isArray(times) || times.length === 0) return;
        this.thumbnailCache.clear();
        this.seekQueue = [];

        const thumbnailWidth = 120;
        const videoAspectRatio = this.offscreenVideo.videoWidth / this.offscreenVideo.videoHeight;
        const thumbnailHeight = Math.round(thumbnailWidth / videoAspectRatio);

        this.offscreenCanvas.width = thumbnailWidth;
        this.offscreenCanvas.height = thumbnailHeight;

        times.forEach((time, index) => {
            const t = Math.max(0, Math.min(time, (this.offscreenVideo.duration || time) - 0.1));
            this.seekQueue.push({ time: t, index, width: thumbnailWidth, height: thumbnailHeight });
        });

        this.processQueue(onProgress);
    }

    async processQueue(onProgress) {
        if (this.isProcessing || this.seekQueue.length === 0) return;
        
        this.isProcessing = true;
        
        while (this.seekQueue.length > 0 && !this.abortController?.signal.aborted) {
            const item = this.seekQueue.shift();
            
            try {
                const thumbnail = await this.captureThumbnail(item.time, item.width, item.height);
                if (thumbnail && !this.abortController?.signal.aborted) {
                    this.thumbnailCache.set(item.time, {
                        url: thumbnail,
                        time: item.time,
                        index: item.index
                    });
                    
                    if (onProgress) {
                        onProgress(item.index, thumbnail, item.time);
                    }
                }
                
                await this.waitForNextFrame();
                
            } catch (error) {
                console.warn(`Failed to generate thumbnail at ${item.time}s:`, error);
            }
        }
        
        this.isProcessing = false;
    }

    async captureThumbnail(time, width, height) {
        return new Promise((resolve) => {
            const handleSeeked = () => {
                this.offscreenVideo.removeEventListener('seeked', handleSeeked);
                
                try {
                    this.offscreenContext.clearRect(0, 0, width, height);
                    this.offscreenContext.drawImage(this.offscreenVideo, 0, 0, width, height);
                    
                    this.offscreenCanvas.toBlob((blob) => {
                        if (blob) {
                            const url = URL.createObjectURL(blob);
                            resolve(url);
                        } else {
                            resolve(null);
                        }
                    }, 'image/jpeg', 0.7);
                    
                } catch (error) {
                    console.warn('Error capturing thumbnail:', error);
                    resolve(null);
                }
            };
            
            this.offscreenVideo.addEventListener('seeked', handleSeeked);
            this.offscreenVideo.currentTime = Math.max(0, time);
        });
    }

    waitForNextFrame() {
        return new Promise((resolve) => {
            if (window.requestIdleCallback) {
                window.requestIdleCallback(resolve, { timeout: 100 });
            } else {
                setTimeout(resolve, 16);
            }
        });
    }

    getThumbnails() {
        return Array.from(this.thumbnailCache.values()).sort((a, b) => a.index - b.index);
    }

    getThumbnailAtTime(time) {
        return this.thumbnailCache.get(time);
    }

    pauseGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = new AbortController();
        }
        this.isProcessing = false;
    }

    resumeGeneration(onProgress) {
        if (this.seekQueue.length > 0) {
            this.processQueue(onProgress);
        }
    }

    cleanup() {
        this.pauseGeneration();
        
        if (this.offscreenVideo) {
            this.offscreenVideo.pause();
            this.offscreenVideo.src = '';
            if (this.offscreenVideo.parentNode) {
                this.offscreenVideo.parentNode.removeChild(this.offscreenVideo);
            }
            this.offscreenVideo = null;
        }
        
        this.thumbnailCache.forEach(thumbnail => {
            safeRevokeObjectURL(thumbnail.url);
        });
        this.thumbnailCache.clear();
        
        if (this.currentFileUrl) {
            safeRevokeObjectURL(this.currentFileUrl);
            this.currentFileUrl = null;
        }
        
        this.seekQueue = [];
        this.currentFile = null;
        this.offscreenCanvas = null;
        this.offscreenContext = null;
    }

    destroy() {
        this.cleanup();
    }
}
