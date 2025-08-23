// FFmpeg.wasm export worker (same-origin, no CDN) - ES Module worker
import { FFmpeg } from '../../libs/ffmpeg/esm/classes.js';
let isProcessing = false;

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

async function processWithFFmpeg({ id, file, operations, preset }) {
  isProcessing = true;
  self.postMessage({ type: 'status', id, message: 'Loading FFmpeg core...' });
  const ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    // Forward high-signal logs as status updates
    if (/error|fail|pass|frame|fps|time|speed/i.test(message)) {
      self.postMessage({ type: 'status', id, message });
    }
  });
  ffmpeg.on('progress', ({ ratio }) => {
    self.postMessage({ type: 'progress', id, progress: Math.round((ratio || 0) * 100) });
  });

  // Load with local core URLs
  const base = import.meta.url; // URL of this worker module
  await ffmpeg.load({
    // Point to our ESM shim which wraps the local UMD core in a module-friendly default export
    coreURL: new URL('../../libs/ffmpeg/esm/ffmpeg-core.js', base).toString(),
    // The shim + worker glue passes these through to Emscripten via mainScriptUrlOrBlob
    wasmURL: new URL('../../libs/ffmpeg/ffmpeg-core.wasm', base).toString(),
    workerURL: new URL('../../libs/ffmpeg/ffmpeg-core.worker.js', base).toString()
  });

  self.postMessage({ type: 'status', id, message: 'Preparing input...' });
  const inputName = 'input.mp4';
  const outputName = 'output.mp4';
  await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

  const args = ['-hide_banner', '-loglevel', 'info', '-nostdin', '-y', '-i', inputName];

  if (operations.cut && typeof operations.cut.startSec === 'number' && typeof operations.cut.endSec === 'number') {
    args.push('-ss', String(operations.cut.startSec));
    args.push('-to', String(operations.cut.endSec));
  }

  const vf = buildFilterGraph({ crop: operations.crop && operations.crop.mapped });
  if (vf) {
    args.push('-vf', vf);
  }

  const videoPreset = (preset?.video?.preset) || 'medium';
  const videoCrf = String(preset?.video?.crf ?? 21);
  const audioBR = String(preset?.audio?.bitrate ?? '192k');

  args.push(
    '-c:v', 'libx264',
    '-preset', videoPreset,
    '-crf', videoCrf,
    '-vsync', '2',
    '-movflags', '+faststart',
    '-map', '0:v:0',
    '-map', '0:a?',
    '-c:a', 'aac',
    '-b:a', audioBR,
    '-af', 'aresample=async=1:first_pts=0',
    outputName
  );

  self.postMessage({ type: 'status', id, message: 'Encoding with FFmpeg...' });
  await ffmpeg.exec(args);

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: 'video/mp4' });
  self.postMessage({ type: 'complete', id, blob, size: blob.size });
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
