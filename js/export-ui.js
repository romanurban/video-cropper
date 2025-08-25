import { appState } from './state.js';
import { exportManager } from './export-manager.js';
import { formatTime, formatTimecode } from './utils.js';

export class ExportUI {
    constructor() {
        this.modal = null;
        this.progressModal = null;
        this.isInitialized = false;
        
        this.setupExportButton();
    }
    
    setupExportButton() {
        const exportButton = document.getElementById('export-button');
        if (exportButton) {
            exportButton.addEventListener('click', () => {
                this.showExportModal();
            });
        }
    }
    
    createExportModal() {
        if (this.modal) {
            return this.modal;
        }
        
        const modal = document.createElement('div');
        modal.className = 'export-modal';
        modal.innerHTML = `
            <div class="export-modal-content">
                <div class="export-modal-header">
                    <h3>Export Video</h3>
                    <button class="export-modal-close" aria-label="Close">&times;</button>
                </div>
                
                <div class="export-modal-body">
                    <div class="export-section">
                        <h4>Export Range</h4>
                        <div class="export-range-info">
                            <span id="export-range-display">Full video</span>
                            <span id="export-duration-display"></span>
                        </div>
                    </div>
                    
                    <div class="export-section">
                        <h4>Quality Preset</h4>
                        <div class="preset-options">
                            <label class="preset-option">
                                <input type="radio" name="quality-preset" value="high">
                                <span class="preset-label">
                                    <strong>High Quality</strong>
                                    <small>CRF 18, Slow preset - Best quality, larger file</small>
                                </span>
                            </label>
                            <label class="preset-option">
                                <input type="radio" name="quality-preset" value="medium">
                                <span class="preset-label">
                                    <strong>Medium Quality</strong>
                                    <small>CRF 21, Medium preset - Balanced quality/size</small>
                                </span>
                            </label>
                            <label class="preset-option">
                                <input type="radio" name="quality-preset" value="fast" checked>
                                <span class="preset-label">
                                    <strong>Fast Export</strong>
                                    <small>CRF 23, Fast preset - Quick export, smaller file</small>
                                </span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="export-section">
                        <h4>Export Method</h4>
                        <div class="method-options">
                            <label class="method-option">
                                <input type="radio" name="export-method" value="auto" checked>
                                <span class="method-label">
                                    <strong>Auto</strong>
                                    <small>FFmpeg.wasm for small files, WebCodecs for large files</small>
                                </span>
                            </label>
                            <label class="method-option">
                                <input type="radio" name="export-method" value="ffmpeg">
                                <span class="method-label">
                                    <strong>FFmpeg.wasm</strong>
                                    <small>Better quality, slower for large files (&lt;2GB)</small>
                                </span>
                            </label>
                            <label class="method-option">
                                <input type="radio" name="export-method" value="webcodecs" disabled>
                                <span class="method-label">
                                    <strong>WebCodecs</strong>
                                    <small>Coming soon - faster for large files</small>
                                </span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="export-section">
                        <div class="export-estimate">
                            <span>Estimated size: </span>
                            <span id="export-size-estimate">Calculating...</span>
                        </div>
                    </div>
                </div>
                
                <div class="export-modal-footer">
                    <button class="export-cancel-button">Cancel</button>
                    <button class="export-start-button">Start Export</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.modal = modal;
        
        // Set up modal event listeners
        this.setupModalListeners();
        
        return modal;
    }
    
    createProgressModal() {
        if (this.progressModal) {
            return this.progressModal;
        }
        
        const modal = document.createElement('div');
        modal.className = 'export-progress-modal';
        modal.innerHTML = `
            <div class="export-progress-content">
                <div class="export-progress-header">
                    <h3>Exporting Video</h3>
                </div>
                
                <div class="export-progress-body">
                    <div class="progress-status">
                        <span id="export-status">Preparing export...</span>
                    </div>
                    
                    <div class="progress-bar-container">
                        <div class="progress-bar">
                            <div class="progress-fill" id="export-progress-fill"></div>
                        </div>
                        <span class="progress-text" id="export-progress-text">0%</span>
                    </div>
                    
                    <div class="progress-details">
                        <div class="progress-time">
                            <span>Elapsed: <span id="export-elapsed-time">00:00</span></span>
                            <span>Est. remaining: <span id="export-remaining-time">--:--</span></span>
                        </div>
                    </div>
                </div>
                
                <div class="export-progress-footer">
                    <button class="export-cancel-button" id="export-cancel-progress">Cancel Export</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        this.progressModal = modal;
        
        // Set up progress modal listeners
        this.setupProgressModalListeners();
        
        return modal;
    }
    
    setupModalListeners() {
        if (!this.modal) return;
        
        // Close modal
        const closeButton = this.modal.querySelector('.export-modal-close');
        const cancelButton = this.modal.querySelector('.export-cancel-button');
        
        const closeModal = () => {
            this.hideExportModal();
        };
        
        closeButton.addEventListener('click', closeModal);
        cancelButton.addEventListener('click', closeModal);
        
        // Close on background click
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) {
                closeModal();
            }
        });
        
        // Start export
        const startButton = this.modal.querySelector('.export-start-button');
        startButton.addEventListener('click', () => {
            this.startExport();
        });
        
        // Update estimate when preset changes
        const presetInputs = this.modal.querySelectorAll('input[name="quality-preset"]');
        presetInputs.forEach(input => {
            input.addEventListener('change', () => {
                this.updateSizeEstimate();
            });
        });
    }
    
    setupProgressModalListeners() {
        if (!this.progressModal) return;
        
        const cancelButton = this.progressModal.querySelector('#export-cancel-progress');
        cancelButton.addEventListener('click', () => {
            this.cancelExport();
        });
    }
    
    showExportModal() {
        const modal = this.createExportModal();
        this.updateExportInfo();
        this.updateSizeEstimate();
        modal.style.display = 'flex';
    }
    
    hideExportModal() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }
    
    showProgressModal() {
        const modal = this.createProgressModal();
        modal.style.display = 'flex';
        this.startTime = Date.now();
    }
    
    hideProgressModal() {
        if (this.progressModal) {
            this.progressModal.style.display = 'none';
        }
    }
    
    updateExportInfo() {
        const state = appState.getState();
        const rangeDisplay = document.getElementById('export-range-display');
        const durationDisplay = document.getElementById('export-duration-display');
        
        if (!rangeDisplay || !durationDisplay) return;
        
        if (state.selectionStartSec !== null && state.selectionEndSec !== null) {
            const startTime = formatTimecode(state.selectionStartSec, { withMillis: true });
            const endTime = formatTimecode(state.selectionEndSec, { withMillis: true });
            const duration = state.selectionEndSec - state.selectionStartSec;
            rangeDisplay.textContent = `Selection: ${startTime} - ${endTime}`;
            durationDisplay.textContent = `Duration: ${formatTimecode(duration, { withMillis: true })}`;
        } else {
            rangeDisplay.textContent = 'Full video';
            if (state.videoMetadata) {
                durationDisplay.textContent = `Duration: ${formatTimecode(state.videoMetadata.duration, { withMillis: true })}`;
            }
        }
    }
    
    updateSizeEstimate() {
        const estimateElement = document.getElementById('export-size-estimate');
        if (!estimateElement) return;
        
        const operations = exportManager.getCurrentOperations();
        const estimate = exportManager.estimateExportSize(operations);
        
        if (estimate) {
            estimateElement.textContent = estimate.sizeString;
        } else {
            estimateElement.textContent = 'Unable to estimate';
        }
    }
    
    getSelectedPreset() {
        const selectedPreset = this.modal?.querySelector('input[name="quality-preset"]:checked')?.value;
        
        switch (selectedPreset) {
            case 'high':
                return {
                    video: { crf: 18, preset: 'slow' },
                    audio: { bitrate: '256k' }
                };
            case 'fast':
                return {
                    video: { crf: 23, preset: 'fast' },
                    audio: { bitrate: '128k' }
                };
            default: // medium
                return {
                    video: { crf: 21, preset: 'medium' },
                    audio: { bitrate: '192k' }
                };
        }
    }
    
    getExportMethod() {
        const selectedMethod = this.modal?.querySelector('input[name="export-method"]:checked')?.value;
        return selectedMethod || 'auto';
    }
    
    startExport() {
        this.hideExportModal();
        this.showProgressModal();
        
        const preset = this.getSelectedPreset();
        const method = this.getExportMethod();
        const forceWebCodecs = method === 'webcodecs';
        
        exportManager.exportVideo({
            preset,
            forceWebCodecs,
            onProgress: (data) => this.updateProgress(data),
            onStatus: (message) => this.updateStatus(message),
            onComplete: (blob, size) => this.handleExportComplete(blob, size),
            onError: (error) => this.handleExportError(error)
        });
    }
    
    updateProgress(data) {
        const progressFill = document.getElementById('export-progress-fill');
        const progressText = document.getElementById('export-progress-text');
        const remainingTime = document.getElementById('export-remaining-time');
        
        if (data.progress !== undefined) {
            const progress = Math.min(100, Math.max(0, data.progress));
            if (progressFill) progressFill.style.width = `${progress}%`;
            if (progressText) progressText.textContent = `${Math.round(progress)}%`;
            
            // Update remaining time estimate
            if (remainingTime && progress > 5) {
                const elapsed = (Date.now() - this.startTime) / 1000;
                const remaining = (elapsed * (100 - progress)) / progress;
                remainingTime.textContent = this.formatDuration(remaining);
            }
        }
        
        // Update elapsed time
        const elapsedTime = document.getElementById('export-elapsed-time');
        if (elapsedTime) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            elapsedTime.textContent = this.formatDuration(elapsed);
        }
    }
    
    updateStatus(message) {
        const statusElement = document.getElementById('export-status');
        if (statusElement) {
            statusElement.textContent = message;
        }
    }
    
    handleExportComplete(blob, size) {
        this.hideProgressModal();
        
        // Generate filename
        const state = appState.getState();
        const originalName = state.filename || 'video';
        const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `${nameWithoutExt}_exported_${timestamp}.mp4`;
        
        // Download the file (silent; no popup)
        exportManager.downloadBlob(blob, filename);
        
        // Optionally, we could surface a subtle inline status instead of alert.
        // Intentionally no popup alert on success.
    }
    
    handleExportError(error) {
        this.hideProgressModal();
        this.showErrorMessage(error.message);
    }
    
    cancelExport() {
        exportManager.cancelExport();
        this.hideProgressModal();
    }
    
    showSuccessMessage(fileSize, isDemo = false) {
        // Simple alert for now - could be replaced with a nicer modal
        const demoNote = isDemo ? '\\n\\nNote: This is a demo version. The exported file is the original video without processing. Full FFmpeg.wasm integration coming soon!' : '';
        alert(`Export completed successfully!\\nFile size: ${fileSize}\\nDownload should start automatically.${demoNote}`);
    }
    
    showErrorMessage(message) {
        // Simple alert for now - could be replaced with a nicer error modal
        alert(`Export failed: ${message}`);
    }
    
    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    destroy() {
        if (this.modal) {
            document.body.removeChild(this.modal);
            this.modal = null;
        }
        
        if (this.progressModal) {
            document.body.removeChild(this.progressModal);
            this.progressModal = null;
        }
    }
}

// Export singleton instance
export const exportUI = new ExportUI();
