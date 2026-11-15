// On-server speech worker (043). Runs in its own process (started by speech-local.js with LD_LIBRARY_PATH set for the
// sherpa-onnx native libraries), does one job and exits, so its memory is returned to the system right away.
//   node speech-worker.cjs <sherpa-onnx-node dir> stt <model dir> <16 kHz mono wav>
//   node speech-worker.cjs <sherpa-onnx-node dir> tts <model dir> <text file> <output wav>
// Prints one JSON line: { text } | { sampleRate, samples } | { error }.
/* global process */
const fs = require('node:fs');
const path = require('node:path');

const [, , sherpaDir, mode, modelDir, input, output] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify({ ...o, maxRssMb: Math.round(process.resourceUsage().maxRSS / 1024) })}\n`);
try {
  const sherpa = require(sherpaDir);
  const find = (re) => { const f = fs.readdirSync(modelDir).find((x) => re.test(x)); if (!f) throw new Error(`model file ${re} missing in ${modelDir}`); return path.join(modelDir, f); };
  if (mode === 'stt') {
    const rec = new sherpa.OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { whisper: { encoder: find(/encoder\.int8\.onnx$/), decoder: find(/decoder\.int8\.onnx$/), language: '', task: 'transcribe' },
        tokens: find(/tokens\.txt$/), numThreads: 1, provider: 'cpu', debug: 0 },
    });
    const wave = sherpa.readWave(input);
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
    rec.decode(stream);
    out({ text: String(rec.getResult(stream).text || '').trim() });
  } else if (mode === 'tts') {
    const tts = new sherpa.OfflineTts({
      model: { vits: { model: find(/\.onnx$/), tokens: path.join(modelDir, 'tokens.txt'), dataDir: path.join(modelDir, 'espeak-ng-data') }, numThreads: 1, provider: 'cpu', debug: 0 },
      maxNumSentences: 1,
    });
    const audio = tts.generate({ text: fs.readFileSync(input, 'utf8'), sid: 0, speed: 1.0 });
    sherpa.writeWave(output, { samples: audio.samples, sampleRate: audio.sampleRate });
    out({ sampleRate: audio.sampleRate, samples: audio.samples.length });
  } else throw new Error(`unknown mode ${mode}`);
} catch (e) {
  out({ error: String(e && e.message || e).slice(0, 500) });
  process.exitCode = 1;
}
