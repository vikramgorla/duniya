// On-server speech engines (043): listening (Whisper "tiny", int8) and speaking (a Piper voice), both run by the
// open-source sherpa-onnx runtime. Nothing is part of the app: the owner switches an engine on in Settings and it is
// downloaded into DATA_DIR on demand (like the Copilot helper) — the npm package `sherpa-onnx-node` with prebuilt
// binaries for Linux x64 and arm64 (no build tools needed), plus the model files from the sherpa-onnx releases.
// whisper.cpp and the Piper binaries were considered: whisper.cpp publishes no Linux binaries (it would need a native
// build toolchain, which the constitution rules out) and the Piper binaries are archived; sherpa-onnx runs the same
// Whisper and Piper models from one maintained package.
//
// Every job runs in a child process (speech-worker.cjs) at low priority, after the small-server checks
// (resources.js), through the media job queue, with a timeout; temp files are always removed.
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, readdirSync, createWriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DATA_DIR } from './config.js';
import { netEnv } from './mcp-local.js';
import { localEngineCheck, lowPriority, hasCommand, runJob } from './resources.js';

export const SHERPA_SPEC = 'sherpa-onnx-node@1.13.8'; // 2.x dropped the built-in phonemizer Piper voices need
const DIR = join(DATA_DIR, 'speech');
const TMP = join(DATA_DIR, 'media-tmp');
const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
export const ENGINES = {
  stt: { label: 'Listening (Whisper tiny)', model: 'sherpa-onnx-whisper-tiny', url: `${RELEASES}/asr-models/sherpa-onnx-whisper-tiny.tar.bz2`,
    keep: /(encoder|decoder)\.int8\.onnx$|tokens\.txt$/, downloadMb: 115, diskMb: 140, ramMb: 400 },
  tts: { label: 'Speaking (Piper voice “Amy”, English)', model: 'vits-piper-en_US-amy-low', url: `${RELEASES}/tts-models/vits-piper-en_US-amy-low.tar.bz2`,
    keep: null, downloadMb: 65, diskMb: 110, ramMb: 300 },
};

const err = (message, code, status = 400) => Object.assign(new Error(message), { code, status });
const sherpaDir = () => join(DIR, 'node_modules', 'sherpa-onnx-node');
const libDir = () => join(DIR, 'node_modules', `sherpa-onnx-${process.platform}-${process.arch}`);
const modelDir = (kind) => join(DIR, 'models', ENGINES[kind].model);
const runtimeInstalled = () => existsSync(join(sherpaDir(), 'package.json')) && existsSync(libDir());
const modelInstalled = (kind) => existsSync(join(modelDir(kind), '.ok'));

// ---------- tests: a fake engine (no downloads, no native code) ----------
let fake = null;
/** Tests: { transcribe(buffer) → text, speak(text) → Buffer (ogg), installed: { stt, tts } }. null restores. */
export function setLocalEngine(f) { fake = f; }

// ---------- status & install (state lives on the server, so the panel survives reloads) ----------
const jobs = { stt: null, tts: null }; // { step, startedAt, error }
export function localStatus() {
  const out = { platform: `${process.platform}-${process.arch}`, supported: process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch), ffmpeg: hasFfmpeg(), engines: {} };
  if (fake) out.supported = true;
  for (const kind of Object.keys(ENGINES)) {
    const e = ENGINES[kind];
    out.engines[kind] = { label: e.label, installed: fake ? !!fake.installed?.[kind] : runtimeInstalled() && modelInstalled(kind), downloadMb: e.downloadMb, diskMb: e.diskMb, ramMb: e.ramMb,
      installing: jobs[kind] && !jobs[kind].error ? { step: jobs[kind].step, startedAt: jobs[kind].startedAt } : null, error: jobs[kind]?.error || null };
  }
  return out;
}
export const engineReady = (kind) => (fake ? !!fake.installed?.[kind] : runtimeInstalled() && modelInstalled(kind));

function sh(cmd, args, opts = {}) {
  return new Promise((res, rej) => execFile(cmd, args, { timeout: 15 * 60000, maxBuffer: 8 * 1024 * 1024, ...opts }, (e, stdout, stderr) => (e ? rej(Object.assign(e, { stdout: String(stdout || ''), stderr: String(stderr || '') })) : res(String(stdout || '')))));
}

/** Download the runtime and one engine's model in the background. Returns the status at once. */
export function installEngine(kind) {
  if (!ENGINES[kind]) throw err('Unknown engine', 'bad_engine');
  const check = localEngineCheck({ forEnable: true });
  if (!check.ok) throw err(check.reason, check.code);
  const st = localStatus();
  if (!st.supported) throw err(`On-server speech runs on Linux x64 or arm64; this server is ${st.platform}.`, 'unsupported');
  if (!hasCommand('tar') || !hasCommand('bzip2')) throw err('This server is missing “tar” or “bzip2”, needed to unpack the model. Update the app with the installer, or install them (sudo apt install bzip2).', 'missing_tool');
  if (jobs[kind] && !jobs[kind].error) return localStatus();
  if (engineReady(kind)) return localStatus();
  const job = { step: 'Downloading the speech runtime', startedAt: Date.now(), error: null };
  jobs[kind] = job;
  (async () => {
    mkdirSync(DIR, { recursive: true });
    if (!runtimeInstalled()) {
      if (!existsSync(join(DIR, 'package.json'))) writeFileSync(join(DIR, 'package.json'), '{"name":"duniya-speech","private":true}');
      await sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', '--omit=dev', '--no-package-lock', '--ignore-scripts', SHERPA_SPEC], {
        cwd: DIR, env: { ...netEnv(), PATH: process.env.PATH, HOME: DIR, npm_config_cache: join(DIR, '.npm-cache'), npm_config_update_notifier: 'false' } });
    }
    const e = ENGINES[kind];
    job.step = `Downloading the model (about ${e.downloadMb} MB)`;
    const dest = join(DIR, 'models'); mkdirSync(dest, { recursive: true });
    const archive = join(dest, `${e.model}.tar.bz2`);
    const res = await fetch(e.url, { signal: AbortSignal.timeout(20 * 60000) });
    if (!res.ok || !res.body) throw new Error(`model download answered ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(archive)); // streamed to disk, never held in memory
    job.step = 'Unpacking the model';
    rmSync(modelDir(kind), { recursive: true, force: true });
    await sh('tar', ['xjf', archive, '-C', dest]);
    rmSync(archive, { force: true });
    if (e.keep) for (const f of readdirSync(modelDir(kind))) if (!e.keep.test(f)) rmSync(join(modelDir(kind), f), { recursive: true, force: true });
    writeFileSync(join(modelDir(kind), '.ok'), new Date().toISOString());
    jobs[kind] = null;
  })().catch((x) => { job.error = `Could not install: ${String(x.stderr || x.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`; });
  return localStatus();
}
export function removeEngine(kind) {
  if (!ENGINES[kind]) throw err('Unknown engine', 'bad_engine');
  rmSync(modelDir(kind), { recursive: true, force: true });
  jobs[kind] = null;
  if (!Object.keys(ENGINES).some((k) => modelInstalled(k))) rmSync(DIR, { recursive: true, force: true }); // nothing left: free the disk
  return localStatus();
}

// ---------- ffmpeg ----------
let ffmpegOk = null;
export function hasFfmpeg() { if (ffmpegOk === null) ffmpegOk = hasCommand('ffmpeg'); return ffmpegOk; }
export const setFfmpeg = (v) => { ffmpegOk = v; }; // tests
let fakeConvert = null;
/** Tests: (buffer, target) → Buffer. */
export const setConverter = (fn) => { fakeConvert = fn; };

const tmpFile = (ext) => { mkdirSync(TMP, { recursive: true, mode: 0o700 }); return join(TMP, `${randomUUID()}.${ext}`); };
/**
 * Convert audio with ffmpeg (low priority, memory-capped, temp files). target: 'ogg' (Opus voice note for WhatsApp)
 * or 'wav16' (16 kHz mono for Whisper).
 */
export async function convertAudio(buffer, target) {
  if (fakeConvert) return fakeConvert(buffer, target);
  if (!hasFfmpeg()) throw err('ffmpeg is not installed on this server', 'no_ffmpeg');
  const input = tmpFile('in'); const output = tmpFile(target === 'ogg' ? 'ogg' : 'wav');
  try {
    writeFileSync(input, buffer);
    const args = target === 'ogg'
      ? ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', output]
      : ['-y', '-loglevel', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', output];
    const [cmd, a] = lowPriority('ffmpeg', args, { memMb: 512 });
    await sh(cmd, a, { timeout: 120000 });
    return readFileSync(output);
  } finally { rmSync(input, { force: true }); rmSync(output, { force: true }); }
}

// ---------- jobs ----------
function worker(args, timeoutMs) {
  const [cmd, a] = lowPriority(process.execPath, [join(import.meta.dirname, 'speech-worker.cjs'), sherpaDir(), ...args]);
  return sh(cmd, a, { timeout: timeoutMs, env: { PATH: process.env.PATH, HOME: DIR, LD_LIBRARY_PATH: libDir(), DYLD_LIBRARY_PATH: libDir() } })
    .catch((e) => { const line = String(e.stdout || '').trim().split('\n').pop(); throw new Error(line ? JSON.parse(line).error : e.message); })
    .then((stdout) => { const r = JSON.parse(stdout.trim().split('\n').pop() || '{}'); if (r.error) throw new Error(r.error); return r; });
}
function ready(kind) {
  if (!engineReady(kind)) throw err('The on-server engine is not installed', 'not_installed');
  const check = localEngineCheck({ needMb: ENGINES[kind].ramMb });
  if (!check.ok) throw err(check.reason, check.code);
}

/** Transcribe a voice note on this server. Returns the text. */
export async function transcribeLocal(buffer) {
  ready('stt');
  if (fake) return runJob('On-server transcription', () => fake.transcribe(buffer));
  return runJob('On-server transcription', async () => {
    const wav = tmpFile('wav');
    try {
      writeFileSync(wav, await convertAudio(buffer, 'wav16'));
      return (await worker(['stt', modelDir('stt'), wav], 120000)).text || '';
    } finally { rmSync(wav, { force: true }); }
  }, { timeoutMs: 150000 });
}

/** Speak text on this server. Returns an Ogg/Opus voice note. */
export async function speakLocal(text) {
  ready('tts');
  if (fake) return runJob('On-server speech', () => fake.speak(text));
  return runJob('On-server speech', async () => {
    const txt = tmpFile('txt'); const wav = tmpFile('wav');
    try {
      writeFileSync(txt, String(text));
      await worker(['tts', modelDir('tts'), txt, wav], 120000);
      const audio = readFileSync(wav);
      if (!audio.length) throw new Error('no audio produced');
      return await convertAudio(audio, 'ogg');
    } finally { rmSync(txt, { force: true }); rmSync(wav, { force: true }); }
  }, { timeoutMs: 150000 });
}
