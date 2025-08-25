import { appState } from './state.js';

export class ImportManager {
  constructor() {
    this.importWorker = null;
    this.currentJobId = null;
    this.progressCallback = null;
    this.statusCallback = null;
    this.completeCallback = null;
    this.errorCallback = null;
  }

  ensureCrossOriginIsolated() {
    if (!self.crossOriginIsolated) {
      throw new Error('SharedArrayBuffer is unavailable. Please refresh to enable import (service worker will set COOP/COEP).');
    }
  }

  setupWorkerListeners(worker) {
    worker.onmessage = (e) => {
      const { type, id, ...data } = e.data;
      if (id && id !== this.currentJobId) return;
      switch (type) {
        case 'progress':
          this.progressCallback && this.progressCallback({ progress: data.progress || 0, message: data.message || 'Processing...' });
          break;
        case 'status':
          this.statusCallback && this.statusCallback(data.message);
          break;
        case 'complete':
          this.currentJobId = null;
          this.completeCallback && this.completeCallback(data.blob, data.size);
          break;
        case 'error':
          this.currentJobId = null;
          this.errorCallback && this.errorCallback(new Error(`import worker failed: ${data.message}`));
          break;
        default:
          console.warn('Unknown import worker message:', type);
      }
    };

    worker.onerror = (error) => {
      this.currentJobId = null;
      this.errorCallback && this.errorCallback(new Error(`import worker error: ${error.message}`));
    };
  }

  async initWorker() {
    this.ensureCrossOriginIsolated();
    if (!this.importWorker) {
      this.importWorker = new Worker('./js/workers/ffmpeg-import.worker.js', { type: 'module' });
      this.setupWorkerListeners(this.importWorker);
    }
  }

  async transcodeToMP4(file, options = {}) {
    if (!file) throw new Error('No input file');
    await this.initWorker();

    this.currentJobId = crypto.randomUUID();
    this.progressCallback = options.onProgress;
    this.statusCallback = options.onStatus;
    this.completeCallback = options.onComplete;
    this.errorCallback = options.onError;

    const preset = options.preset || { video: { crf: 21, preset: 'medium' }, audio: { bitrate: '192k' } };
    this.importWorker.postMessage({ type: 'transcodeImport', id: this.currentJobId, file, preset });
  }

  cancel() {
    if (this.importWorker) this.importWorker.postMessage({ type: 'cleanup' });
    this.currentJobId = null;
    this.progressCallback = null;
    this.statusCallback = null;
    this.completeCallback = null;
    this.errorCallback = null;
  }

  destroy() {
    this.cancel();
    if (this.importWorker) {
      this.importWorker.terminate();
      this.importWorker = null;
    }
  }
}

export const importManager = new ImportManager();

