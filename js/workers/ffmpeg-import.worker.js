// FFmpeg.wasm import/transcode worker - ES Module worker
import { FFmpeg } from '../../libs/ffmpeg/esm/classes.js';
let ffmpegInstance = null;
let currentExportId = null;
let currentTargetDurationSec = 0;

async function getFFmpeg() {
  if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    if (currentExportId && /error|fail|frame|fps|time|speed/i.test(message)) {
      self.postMessage({ type: 'status', id: currentExportId, message });
    }
    const m = /time=\s*([0-9:.]+)/.exec(message);
    if (m && currentTargetDurationSec > 0) {
      const t = m[1].split(':').map(Number);
      let secs = 0;
      if (t.length === 3) secs = t[0]*3600 + t[1]*60 + t[2];
      else if (t.length === 2) secs = t[0]*60 + t[1];
      else secs = t[0];
      if (isFinite(secs)) {
        const pct = Math.max(0, Math.min(99, Math.floor((secs / currentTargetDurationSec) * 100)));
        self.postMessage({ type: 'progress', id: currentExportId, progress: pct, message: 'Transcoding...' });
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

self.onmessage = async (e) => {
  const { type, ...data } = e.data;
  try {
    switch (type) {
      case 'transcodeImport':
        await transcodeImport(data);
        break;
      case 'cleanup':
        currentExportId = null;
        break;
      default:
        self.postMessage({ type: 'error', message: `Unknown command: ${type}` });
    }
  } catch (error) {
    const msg = (error && (error.message || error.toString())) || 'Worker error';
    self.postMessage({ type: 'error', id: data.id, message: msg });
  }
};

async function transcodeImport({ id, file, preset }) {
  currentExportId = id;
  const ffmpeg = await getFFmpeg();
  const inputName = 'input_import';
  const outputName = 'output_import.mp4';
  self.postMessage({ type: 'status', id, message: 'Preparing import...' });
  const inputData = new Uint8Array(await file.arrayBuffer());
  await ffmpeg.writeFile(inputName, inputData);

  // If duration is available from file metadata, set expected duration
  // Not always possible here; progress will still show via ffmpeg ratio
  currentTargetDurationSec = 0;

  // Attempt remux (no re-encode) first
  try {
    const argsCopy = ['-hide_banner','-loglevel','warning','-nostdin','-y','-i', inputName,
      '-c','copy','-map','0:v:0','-map','0:a?','-movflags','+faststart', outputName];
    self.postMessage({ type: 'status', id, message: 'Attempting fast remux...' });
    await ffmpeg.exec(argsCopy);
    const buf = await ffmpeg.readFile(outputName);
    if (buf && buf.length > 0) {
      const blob = new Blob([buf], { type: 'video/mp4' });
      self.postMessage({ type: 'complete', id, blob, size: blob.size });
      self.postMessage({ type: 'progress', id, progress: 100, message: 'Done' });
      return;
    }
  } catch (_) { /* fall back */ }

  // Re-encode fallback
  const videoPreset = (preset?.video?.preset) || 'veryfast';
  const videoCrf = String(preset?.video?.crf ?? 23);
  const audioBR = String(preset?.audio?.bitrate ?? '160k');
  const makeArgs = (videoOnly=false)=>[
    '-hide_banner','-loglevel','info','-nostdin','-y','-i', inputName,
    '-c:v','libx264','-preset',videoPreset,'-crf',videoCrf,
    '-vsync','2','-movflags','+faststart',
    ...(videoOnly? ['-an'] : ['-c:a','aac','-b:a',audioBR,'-ac','2']),
    outputName
  ];
  try {
    self.postMessage({ type: 'status', id, message: 'Transcoding (A/V)...' });
    await ffmpeg.exec(makeArgs(false));
  } catch (e) {
    self.postMessage({ type: 'status', id, message: 'Audio issue; transcoding video only...' });
    await ffmpeg.exec(makeArgs(true));
  }
  const out = await ffmpeg.readFile(outputName);
  const blob = new Blob([out], { type: 'video/mp4' });
  self.postMessage({ type: 'complete', id, blob, size: blob.size });
  self.postMessage({ type: 'progress', id, progress: 100, message: 'Done' });
}

