/**
 * Minimal client for the HeadTTS /v1/synthesize REST endpoint.
 * Returns parsed JSON: { audio (base64 WAV), words, wtimes, wdurations, ... }
 */

const SERVER = 'http://localhost:8882';

export async function synth(input, { voice = 'af_bella', language = 'en-us', speed = 1, audioEncoding = 'wav' } = {}) {
  const res = await fetch(`${SERVER}/v1/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, voice, language, speed, audioEncoding }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function ping() {
  const res = await fetch(`${SERVER}/v1/hello`, { method: 'POST' });
  if (!res.ok) throw new Error(`Ping failed: HTTP ${res.status}`);
  return res.text();
}

/** Decode a base64 WAV to Int16 PCM samples. */
export function wavToInt16(base64wav) {
  const buf = Buffer.from(base64wav, 'base64');
  // WAV PCM16: data starts at byte 44 (standard 44-byte header)
  const headerSize = 44;
  const samples = new Int16Array(buf.buffer, buf.byteOffset + headerSize, (buf.length - headerSize) / 2);
  return samples;
}

/** Parse sample rate from WAV header (bytes 24-27, little-endian uint32). */
export function wavSampleRate(base64wav) {
  const buf = Buffer.from(base64wav, 'base64');
  return buf.readUInt32LE(24);
}

/** Duration in ms from a base64 WAV. */
export function wavDurationMs(base64wav) {
  const buf = Buffer.from(base64wav, 'base64');
  const sampleRate = buf.readUInt32LE(24);
  const headerSize = 44;
  const numSamples = (buf.length - headerSize) / 2;
  return (numSamples / sampleRate) * 1000;
}

// Smoke-test when run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  console.log('Pinging server...');
  const version = await ping();
  console.log('Server version:', version);

  console.log('\nSynthesizing "This is an example."...');
  const result = await synth('This is an example.');
  console.log('words:', result.words);
  console.log('wtimes:', result.wtimes);
  console.log('wdurations:', result.wdurations);
  console.log('audio length (base64 chars):', result.audio?.length);
  console.log('audio duration ms:', wavDurationMs(result.audio).toFixed(1));
  console.log('\nSmoke test PASSED.');
}
