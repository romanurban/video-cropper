// FFmpeg.wasm export worker (same-origin, no CDN) - ES Module worker
import { FFmpeg } from '../../libs/ffmpeg/esm/classes.js';
let isProcessing = false;
let ffmpegInstance = null;
let currentExportId = null;
let currentTargetDurationSec = 0;

async function getFFmpeg() {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    if (currentExportId && /error|fail|pass|frame|fps|time|speed/i.test(message)) {
      self.postMessage({ type: 'status', id: currentExportId, message });
    }
    // Heuristic progress from log time= when core ratio is not emitted
    if (currentExportId && currentTargetDurationSec > 0) {
      const m = /time=\s*([0-9:.]+)/.exec(message);
      if (m) {
        const t = m[1];
        const parts = t.split(':').map(Number);
        let secs = 0;
        if (parts.length === 3) {
          secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          secs = parts[0] * 60 + parts[1];
        } else if (parts.length === 1) {
          secs = parts[0];
        }
        if (isFinite(secs) && secs >= 0) {
          const pct = Math.max(0, Math.min(99, Math.floor((secs / currentTargetDurationSec) * 100)));
          self.postMessage({ type: 'progress', id: currentExportId, progress: pct, message: 'Encoding...' });
        }
      }
    }
  });
  ffmpeg.on('progress', ({ ratio }) => {
    if (currentExportId) self.postMessage({ type: 'progress', id: currentExportId, progress: Math.round((ratio || 0) * 100) });
  });
  const base = import.meta.url;
  await ffmpeg.load({
    coreURL: new URL('../../libs/ffmpeg/esm/ffmpeg-core.js', base).toString(),
    wasmURL: new URL('../../libs/ffmpeg/ffmpeg-core.wasm', base).toString(),
    workerURL: new URL('../../libs/ffmpeg/ffmpeg-core.worker.js', base).toString()
  });
  ffmpegInstance = ffmpeg;
  return ffmpegInstance;
}

const roundEven = (n) => Math.max(0, Math.floor(n / 2) * 2);

function buildFilterGraph(ops) {
  const filters = [];
  // Rotation normalization could be inserted here if metadata provided
  if (ops.crop) {
    const { x, y, w, h } = ops.crop;
    const W = roundEven(w);
    const H = roundEven(h);
    const X = roundEven(x);
    const Y = roundEven(y);
    filters.push(`crop=${W}:${H}:${X}:${Y}`);
  }
  // Ensure sane SAR and pixel format
  filters.push('setsar=1');
  filters.push('format=yuv420p');
  return filters.join(',');
}

async function processWithFFmpeg({ id, file, operations, preset, durationSec }) {
  isProcessing = true;
  currentExportId = id;
  self.postMessage({ type: 'status', id, message: 'Loading FFmpeg core...' });
  const ffmpeg = await getFFmpeg();

  self.postMessage({ type: 'status', id, message: 'Preparing input...' });
  const inputName = 'input.mp4';
  const outputName = 'output.mp4';
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  const args = ['-hide_banner', '-loglevel', 'info', '-nostdin', '-y'];
  const hasCut = operations.cut && typeof operations.cut.startSec === 'number' && typeof operations.cut.endSec === 'number';
  const hasCrop = !!(operations.crop && operations.crop.mapped);
  // Set target duration for progress reporting
  if (hasCut) {
    currentTargetDurationSec = Math.max(0, Number(operations.cut.endSec) - Number(operations.cut.startSec));
  } else if (typeof durationSec === 'number' && isFinite(durationSec)) {
    currentTargetDurationSec = durationSec;
  } else {
    currentTargetDurationSec = 0;
  }

  const videoPreset = (preset?.video?.preset) || 'medium';
  const videoCrf = String(preset?.video?.crf ?? 21);
  const audioBR = String(preset?.audio?.bitrate ?? '192k');

  if (hasCut && !hasCrop && videoPreset === 'copy') {
    // Fast path: stream copy without re-encoding if explicitly requested
    const start = Number(operations.cut.startSec);
    const dur = Math.max(0, Number(operations.cut.endSec) - start);
    args.push('-ss', String(start), '-i', inputName, '-t', String(dur));
    args.push('-c', 'copy', '-map', '0:v:0', '-map', '0:a?');
    args.push('-fflags', '+genpts', '-avoid_negative_ts', 'make_zero');
    args.push('-movflags', '+faststart');
    args.push(outputName);
  } else {
    // Re-encode: crop and/or full encode
    args.push('-i', inputName);
    if (hasCut) {
      const start = Number(operations.cut.startSec);
      const dur = Math.max(0, Number(operations.cut.endSec) - start);
      args.push('-ss', String(start), '-t', String(dur));
    }
    const vf = buildFilterGraph({ crop: operations.crop && operations.crop.mapped });
    if (vf) args.push('-vf', vf);

    args.push(
      '-c:v', 'libx264',
      '-preset', videoPreset,
      '-crf', videoCrf,
      '-threads', '0',
      '-vsync', '2',
      '-movflags', '+faststart',
      '-map', '0:v:0',
      '-map', '0:a?'
    );
    // Encode audio per preset for consistent quality
    args.push('-c:a', 'aac', '-b:a', audioBR, '-ac', '2');
    args.push(outputName);
  }

  self.postMessage({ type: 'status', id, message: 'Encoding with FFmpeg...' });
  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: 'video/mp4' });
  self.postMessage({ type: 'complete', id, blob, size: blob.size });
  // Ensure final progress reaches 100%
  self.postMessage({ type: 'progress', id, progress: 100, message: 'Done' });
}

function mapNormalizedCropToSource(operations) {
  if (!operations.crop || !operations.crop.normalized || !operations.crop.source) return operations;
  const { normalized, source } = operations.crop;
  const sx = Math.round(normalized.x * source.width);
  const sy = Math.round(normalized.y * source.height);
  const sw = Math.round(normalized.w * source.width);
  const sh = Math.round(normalized.h * source.height);
  const mapped = { x: roundEven(sx), y: roundEven(sy), w: roundEven(sw), h: roundEven(sh) };
  return { ...operations, crop: { ...operations.crop, mapped } };
}

self.onmessage = async (e) => {
  const { type, ...data } = e.data;
  try {
    switch (type) {
      case 'export': {
        const ops = mapNormalizedCropToSource(data.operations || {});
        await processWithFFmpeg({ ...data, operations: ops });
        break;
      }
      case 'cleanup':
        isProcessing = false;
        self.postMessage({ type: 'status', message: 'Cleanup completed' });
        break;
      default:
        self.postMessage({ type: 'error', message: `Unknown command: ${type}` });
    }
  } catch (error) {
    const msg = (error && (error.message || error.toString())) || 'Worker error';
    self.postMessage({ type: 'error', id: data.id, message: msg });
  }
};
