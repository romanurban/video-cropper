// ESM shim to expose createFFmpegCore from the local UMD core inside a module worker
export default async function createFFmpegCore(options = {}) {
  // Lazily load and cache the UMD core into this worker global
  if (!self.__FFMPEG_CREATE_CORE__) {
    const url = new URL('../ffmpeg-core.js', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ffmpeg-core.js: ${res.status}`);
    }
    const code = await res.text();
    // Evaluate UMD bundle in the worker global scope and return factory
    // Evaluate the UMD bundle and return the local factory symbol
    const factory = new Function('self', `${code}\nreturn createFFmpegCore;`);
    self.__FFMPEG_CREATE_CORE__ = factory(self);
  }
  // Patch mainScriptUrlOrBlob to point to the UMD core (not this ESM shim)
  const umdURL = new URL('../ffmpeg-core.js', import.meta.url).toString();
  let hash = '';
  if (typeof options.mainScriptUrlOrBlob === 'string') {
    const s = options.mainScriptUrlOrBlob;
    const i = s.indexOf('#');
    if (i !== -1) hash = s.substring(i);
  }
  const patched = { ...options, mainScriptUrlOrBlob: umdURL + hash };
  // Call the real factory with patched options
  return self.__FFMPEG_CREATE_CORE__(patched);
}
