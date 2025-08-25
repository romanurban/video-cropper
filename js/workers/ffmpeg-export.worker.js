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
  const deleted = Array.isArray(operations.deletedRanges) ? operations.deletedRanges : [];
  // Set target duration for progress reporting
  if (hasCut) {
    currentTargetDurationSec = Math.max(0, Number(operations.cut.endSec) - Number(operations.cut.startSec));
  } else if (typeof durationSec === 'number' && isFinite(durationSec)) {
    currentTargetDurationSec = durationSec;
  } else if (!hasCut && !hasCrop) {
    // No edits: export as-is via stream copy
    args.push('-i', inputName);
    args.push('-c', 'copy', '-map', '0:v:0', '-map', '0:a?');
    args.push('-movflags', '+faststart');
    args.push(outputName);
  } else {
    currentTargetDurationSec = 0;
  }

  const videoPreset = (preset?.video?.preset) || 'medium';
  const videoCrf = String(preset?.video?.crf ?? 21);
  const audioBR = String(preset?.audio?.bitrate ?? '192k');

  if (deleted.length > 0) {
    // Build skip filter (select/aselect) that removes deleted time ranges; re-encode
    args.push('-i', inputName);
    const kept = computeKeptFromDeleted(deleted, durationSec);
    currentTargetDurationSec = kept.reduce((acc, seg) => acc + Math.max(0, (seg.e - seg.s)), 0);
    if (!kept.length) throw new Error('No content to export after deletions');
    const fc = buildSkipFilter(deleted);
    args.push('-filter_complex', fc);
    args.push('-map', '[vout]');
    args.push('-map', '[aout]?');
    args.push(
      '-c:v', 'libx264',
      '-preset', videoPreset,
      '-crf', videoCrf,
      '-threads', '0',
      '-vsync', '2',
      '-movflags', '+faststart'
    );
    args.push('-c:a', 'aac', '-b:a', audioBR, '-ac', '2');
    args.push(outputName);
  } else if (hasCut && !hasCrop && videoPreset === 'copy') {
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
  try {
    await ffmpeg.exec(args);
  } catch (err) {
    // If failure occurs in deleted-ranges path due to missing audio, retry video-only filter
    try {
      if (deleted.length > 0) {
        const args2 = ['-hide_banner', '-loglevel', 'info', '-nostdin', '-y'];
        args2.push('-i', inputName);
        const kept = computeKeptFromDeleted(deleted, durationSec);
        currentTargetDurationSec = kept.reduce((acc, seg) => acc + Math.max(0, (seg.e - seg.s)), 0);
        const fc2 = buildSkipFilterVideoOnly(deleted);
        args2.push('-filter_complex', fc2);
        args2.push('-map', '[vout]');
        args2.push(
          '-c:v', 'libx264',
          '-preset', videoPreset,
          '-crf', videoCrf,
          '-threads', '0',
          '-vsync', '2',
          '-movflags', '+faststart',
          '-an'
        );
        args2.push(outputName);
        self.postMessage({ type: 'status', id, message: 'Retrying without audio track...' });
        await ffmpeg.exec(args2);
      } else {
        throw err;
      }
    } catch (err2) {
      throw err2 || err;
    }
  }

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: 'video/mp4' });
  self.postMessage({ type: 'complete', id, blob, size: blob.size });
  // Ensure final progress reaches 100%
  self.postMessage({ type: 'progress', id, progress: 100, message: 'Done' });
}

function computeKeptFromDeleted(deletedRanges, fullDuration) {
  const d = (typeof fullDuration === 'number' && isFinite(fullDuration)) ? fullDuration : 0;
  const sorted = deletedRanges
    .map(r => ({ s: Math.max(0, Number(r.startSec)), e: Math.max(0, Number(r.endSec)) }))
    .filter(r => isFinite(r.s) && isFinite(r.e) && r.e > r.s)
    .sort((a, b) => a.s - b.s);
  const merged = [];
  for (const r of sorted) {
    if (!merged.length) { merged.push({ ...r }); continue; }
    const last = merged[merged.length - 1];
    if (r.s <= last.e + 1e-6) last.e = Math.max(last.e, r.e); else merged.push({ ...r });
  }
  const kept = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.s > cursor) kept.push({ s: cursor, e: r.s });
    cursor = Math.max(cursor, r.e);
  }
  if (d && d > cursor) kept.push({ s: cursor, e: d });
  return kept;
}

function buildConcatFilter(segments) {
  // segments: [{s, e}] times in seconds
  const vlabels = [];
  const alabels = [];
  let parts = [];
  for (let i = 0; i < segments.length; i++) {
    const { s, e } = segments[i];
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    parts.push(`[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`);
    vlabels.push(`[v${i}]`);
    alabels.push(`[a${i}]`);
  }
  const concat = `${vlabels.join('')}${alabels.join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`;
  parts.push(concat);
  return parts.join(';');
}

function buildSkipFilter(deletedRanges) {
  // Build select/aselect expressions that exclude deleted windows
  const ds = deletedRanges
    .map(r => ({ s: Math.max(0, Number(r.startSec)), e: Math.max(0, Number(r.endSec)) }))
    .filter(r => isFinite(r.s) && isFinite(r.e) && r.e > r.s);
  const conds = ds.map(r => `between(t,${r.s},${r.e})`);
  const expr = conds.length ? `not(${conds.join('+')})` : '1';
  const v = `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB[vout]`;
  const a = `[0:a]aselect='${expr}',asetpts=N/SR/TB[aout]`;
  return `${v};${a}`;
}

function buildConcatFilterVideoOnly(segments) {
  const vlabels = [];
  let parts = [];
  for (let i = 0; i < segments.length; i++) {
    const { s, e } = segments[i];
    parts.push(`[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`);
    vlabels.push(`[v${i}]`);
  }
  const concat = `${vlabels.join('')}concat=n=${segments.length}:v=1:a=0[vout]`;
  parts.push(concat);
  return parts.join(';');
}

function buildSkipFilterVideoOnly(deletedRanges) {
  const ds = deletedRanges
    .map(r => ({ s: Math.max(0, Number(r.startSec)), e: Math.max(0, Number(r.endSec)) }))
    .filter(r => isFinite(r.s) && isFinite(r.e) && r.e > r.s);
  const conds = ds.map(r => `between(t,${r.s},${r.e})`);
  const expr = conds.length ? `not(${conds.join('+')})` : '1';
  const v = `[0:v]select='${expr}',setpts=N/FRAME_RATE/TB[vout]`;
  return v;
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
