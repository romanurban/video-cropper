import { appState } from './state.js';

export class ExportManager {
    constructor() {
        this.ffmpegWorker = null;
        this.webcodecsWorker = null;
        this.currentExportId = null;
        this.isExporting = false;
        
        this.progressCallback = null;
        this.statusCallback = null;
        this.completeCallback = null;
        this.errorCallback = null;
        
        this.maxFFmpegFileSize = 2 * 1024 * 1024 * 1024; // 2GB limit for FFmpeg.wasm
    }
    
    async initializeWorkers() {
        if (!this.ffmpegWorker) {
            this.ffmpegWorker = new Worker('./js/workers/ffmpeg-export.worker.js', { type: 'module' });
            this.setupWorkerListeners(this.ffmpegWorker, 'ffmpeg');
        }
        
        if (!this.webcodecsWorker) {
            this.webcodecsWorker = new Worker('./js/workers/webcodecs-export.worker.js');
            this.setupWorkerListeners(this.webcodecsWorker, 'webcodecs');
        }
    }
    
    setupWorkerListeners(worker, workerType) {
        worker.onmessage = (e) => {
            const { type, id, ...data } = e.data;
            
            if (id && id !== this.currentExportId) {
                return; // Ignore messages from old exports
            }
            
            switch (type) {
                case 'progress':
                    if (this.progressCallback) {
                        // Handle both v0.11 and v0.12 progress formats
                        this.progressCallback({
                            progress: data.progress || 0,
                            message: data.message || 'Processing...'
                        });
                    }
                    break;
                    
                case 'status':
                    if (this.statusCallback) {
                        this.statusCallback(data.message);
                    }
                    break;
                    
                case 'complete':
                    this.isExporting = false;
                    if (this.completeCallback) {
                        this.completeCallback(data.blob, data.size);
                    }
                    break;
                    
                case 'error':
                    this.isExporting = false;
                    const errorMsg = `${workerType} export failed: ${data.message}`;
                    
                    if (workerType === 'ffmpeg' && this.shouldFallbackToWebCodecs(data.message)) {
                        this.handleFallbackToWebCodecs();
                    } else if (this.errorCallback) {
                        this.errorCallback(new Error(errorMsg));
                    }
                    break;
                    
                case 'support-check':
                    // Handle WebCodecs support check result
                    break;
                    
                default:
                    console.warn(`Unknown worker message type: ${type}`);
            }
        };
        
        worker.onerror = (error) => {
            this.isExporting = false;
            if (this.errorCallback) {
                this.errorCallback(new Error(`${workerType} worker error: ${error.message}`));
            }
        };
    }
    
    shouldFallbackToWebCodecs(errorMessage) {
        // Disable WebCodecs fallback for now since it's not fully implemented
        // TODO: Re-enable when WebCodecs export is completed
        return false;
        
        // Future fallback conditions:
        // 1. Memory errors from FFmpeg.wasm
        // 2. WASM compilation errors  
        // 3. File too large errors
        const fallbackTriggers = [
            'out of memory',
            'memory',
            'wasm',
            'compilation',
            'abort',
            'RuntimeError'
        ];
        
        return fallbackTriggers.some(trigger => 
            errorMessage.toLowerCase().includes(trigger.toLowerCase())
        );
    }
    
    async handleFallbackToWebCodecs() {
        if (this.statusCallback) {
            this.statusCallback('FFmpeg failed, trying WebCodecs fallback...');
        }
        
        // Get current export parameters from state
        const file = appState.getState('file');
        const operations = this.getCurrentOperations();
        const preset = this.getDefaultPreset();
        
        await this.exportWithWebCodecs(file, operations, preset);
    }
    
    getCurrentOperations() {
        const state = appState.getState();
        const operations = {};
        
        // Add cut operation if selection exists
        if (state.selectionStartSec !== null && state.selectionEndSec !== null) {
            operations.cut = {
                startSec: state.selectionStartSec,
                endSec: state.selectionEndSec
            };
        }

        // Add crop operation if cropRect exists
        if (state.cropRect && state.videoMetadata) {
            // Defer mapping to worker/ffmpeg; pass normalized rect and source dims
            operations.crop = {
                normalized: state.cropRect,
                source: {
                    width: state.videoMetadata.width,
                    height: state.videoMetadata.height
                }
            };
        }
        
        return operations;
    }
    
    getDefaultPreset() {
        return {
            video: {
                crf: 21,
                preset: 'medium',
                bitrate: 2000000
            },
            audio: {
                bitrate: '192k'
            }
        };
    }
    
    async exportVideo(options = {}) {
        if (this.isExporting) {
            throw new Error('Export already in progress');
        }
        
        const file = appState.getState('file');
        if (!file) {
            throw new Error('No video file loaded');
        }
        
        this.isExporting = true;
        this.currentExportId = crypto.randomUUID();
        
        // Set up callbacks
        this.progressCallback = options.onProgress;
        this.statusCallback = options.onStatus;
        this.completeCallback = options.onComplete;
        this.errorCallback = options.onError;
        
        const operations = this.getCurrentOperations();
        const preset = { ...this.getDefaultPreset(), ...options.preset };
        
        try {
            await this.initializeWorkers();
            
            // Determine which export method to use
            const useWebCodecs = file.size > this.maxFFmpegFileSize || options.forceWebCodecs;
            
            if (useWebCodecs) {
                if (this.statusCallback) {
                    this.statusCallback('Large file detected, using WebCodecs...');
                }
                await this.exportWithWebCodecs(file, operations, preset);
            } else {
                await this.exportWithFFmpeg(file, operations, preset);
            }
            
        } catch (error) {
            this.isExporting = false;
            if (this.errorCallback) {
                this.errorCallback(error);
            }
        }
    }
    
    async exportWithFFmpeg(file, operations, preset) {
        if (!this.ffmpegWorker) {
            throw new Error('FFmpeg worker not initialized');
        }
        
        this.ffmpegWorker.postMessage({
            type: 'export',
            id: this.currentExportId,
            file,
            operations,
            preset
        });
    }
    
    async exportWithWebCodecs(file, operations, preset) {
        if (!this.webcodecsWorker) {
            throw new Error('WebCodecs worker not initialized');
        }
        
        this.webcodecsWorker.postMessage({
            type: 'export',
            id: this.currentExportId,
            file,
            operations,
            preset
        });
    }
    
    cancelExport() {
        if (!this.isExporting) {
            return;
        }
        
        this.isExporting = false;
        this.currentExportId = null;
        
        // Clean up workers
        if (this.ffmpegWorker) {
            this.ffmpegWorker.postMessage({ type: 'cleanup' });
        }
        if (this.webcodecsWorker) {
            this.webcodecsWorker.postMessage({ type: 'cleanup' });
        }
        
        // Reset callbacks
        this.progressCallback = null;
        this.statusCallback = null;
        this.completeCallback = null;
        this.errorCallback = null;
    }
    
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'exported-video.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    getFileSizeString(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    estimateExportSize(operations) {
        const file = appState.getState('file');
        const metadata = appState.getState('videoMetadata');
        
        if (!file || !metadata) {
            return null;
        }
        
        let durationRatio = 1;
        
        // Estimate size reduction from trimming
        if (operations.cut) {
            const { startSec, endSec } = operations.cut;
            const cutDuration = endSec - startSec;
            durationRatio = cutDuration / metadata.duration;
        }
        
        // Rough estimation: trimming reduces file size proportionally
        // Crop and quality changes are harder to estimate without encoding
        const estimatedSize = Math.round(file.size * durationRatio * 0.8); // 80% of original for compression
        
        return {
            estimatedSize,
            originalSize: file.size,
            compressionRatio: durationRatio * 0.8,
            sizeString: this.getFileSizeString(estimatedSize)
        };
    }
    
    destroy() {
        this.cancelExport();
        
        if (this.ffmpegWorker) {
            this.ffmpegWorker.terminate();
            this.ffmpegWorker = null;
        }
        
        if (this.webcodecsWorker) {
            this.webcodecsWorker.terminate();
            this.webcodecsWorker = null;
        }
    }
}

// Create singleton instance
export const exportManager = new ExportManager();
