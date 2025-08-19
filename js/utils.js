export function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '00:00';
    
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function safeRevokeObjectURL(url) {
    if (url && url.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch (error) {
            console.warn('Failed to revoke object URL:', error);
        }
    }
}

export function getVideoMetadata(videoElement) {
    return {
        duration: videoElement.duration,
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
        aspectRatio: videoElement.videoWidth / videoElement.videoHeight
    };
}

export function isVideoFile(file) {
    return file && file.type.startsWith('video/');
}

export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function getCanvasSize(videoWidth, videoHeight, containerWidth, containerHeight) {
    if (!videoWidth || !videoHeight) {
        return { width: containerWidth, height: containerHeight };
    }
    
    const videoAspectRatio = videoWidth / videoHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let canvasWidth, canvasHeight;
    
    if (videoAspectRatio > containerAspectRatio) {
        canvasWidth = containerWidth;
        canvasHeight = containerWidth / videoAspectRatio;
    } else {
        canvasHeight = containerHeight;
        canvasWidth = containerHeight * videoAspectRatio;
    }
    
    return {
        width: Math.floor(canvasWidth),
        height: Math.floor(canvasHeight)
    };
}

export function getDevicePixelRatio() {
    return window.devicePixelRatio || 1;
}

export function formatTimecode(seconds, options = {}) {
    const { withMillis = false } = options;
    
    if (isNaN(seconds) || !isFinite(seconds)) return '00:00:00';
    
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    let timecode = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    if (withMillis) {
        const millis = Math.floor((seconds % 1) * 1000);
        timecode += `.${millis.toString().padStart(3, '0')}`;
    }
    
    return timecode;
}

export function getVideoBaseName(filename) {
    if (!filename) return 'video';
    const name = filename.split('.').slice(0, -1).join('.');
    return name || 'video';
}

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 100);
}

export function setupCanvasForDPR(canvas, width, height) {
    const dpr = getDevicePixelRatio();
    const ctx = canvas.getContext('2d');
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    
    ctx.scale(dpr, dpr);
    
    return ctx;
}