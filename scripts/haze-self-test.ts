import assert from 'node:assert/strict';

import { transformObservedHaze } from '../lib/haze-core.ts';

function concat(...parts: Uint8Array[]) {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
}

function u32(...values: number[]) {
  const output = new Uint8Array(values.length * 4);
  const view = new DataView(output.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value));
  return output;
}

function type(value: string) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function box(kind: string, payload = new Uint8Array()) {
  return concat(u32(8 + payload.length), type(kind), payload);
}

function fullBox(kind: string, payload = new Uint8Array()) {
  return box(kind, concat(new Uint8Array(4), payload));
}

function hdlr(kind: string) {
  return fullBox('hdlr', concat(u32(0), type(kind), new Uint8Array(12)));
}

function tkhd(trackId: number) {
  return fullBox(
    'tkhd',
    concat(u32(0, 0, trackId, 0, 2_000), new Uint8Array(68)),
  );
}

function mdhd(timescale: number, duration: number) {
  return fullBox(
    'mdhd',
    concat(u32(0, 0, timescale, duration), new Uint8Array(4)),
  );
}

function tables(kind: string, samples: number, chunkOffset: number) {
  const sampleEntry = box(kind, new Uint8Array(28));
  const stsd = fullBox('stsd', concat(u32(1), sampleEntry));
  const stts = fullBox('stts', u32(1, samples, kind === 'mp4a' ? 1_024 : 40));
  const stsc = fullBox('stsc', u32(1, 1, samples, 1));
  const sizes = concat(
    ...Array.from({ length: samples }, () => u32(kind === 'mp4a' ? 8 : 4)),
  );
  const stsz = fullBox('stsz', concat(u32(0, samples), sizes));
  const stco = fullBox('stco', u32(1, chunkOffset));
  return box('stbl', concat(stsd, stts, stsc, stsz, stco));
}

function track(kind: 'vide' | 'soun', id: number, chunkOffset: number) {
  const sampleEntry = kind === 'soun' ? 'mp4a' : 'avc1';
  const edits = box('edts', fullBox('elst', u32(1, 2_000, 0, 0x00010000)));
  const media = box(
    'mdia',
    concat(
      mdhd(kind === 'soun' ? 48_000 : 1_000, kind === 'soun' ? 3_072 : 2_000),
      hdlr(kind),
      box('minf', tables(sampleEntry, kind === 'soun' ? 3 : 2, chunkOffset)),
    ),
  );
  return box('trak', concat(tkhd(id), edits, media));
}

function fixture() {
  const ftyp = box(
    'ftyp',
    concat(type('isom'), u32(0x200), type('isom'), type('mp41')),
  );
  const free = box('free');
  const mdat = box('mdat', new Uint8Array(128).fill(0x4d));
  const chunkOffset = ftyp.length + free.length + 8;
  const mvhdPayload = new Uint8Array(100);
  new DataView(mvhdPayload.buffer).setUint32(96, 3);
  const metadata = box('udta', fullBox('meta', box('ilst')));
  const moov = box(
    'moov',
    concat(
      fullBox('mvhd', mvhdPayload),
      track('vide', 1, chunkOffset),
      track('soun', 2, chunkOffset),
      metadata,
    ),
  );
  return concat(ftyp, free, mdat, moov);
}

const input = fixture();
class EphemeralSourceFile extends File {
  override slice(): Blob {
    throw new Error('A saída não pode depender de File.slice().');
  }
}

const file = new EphemeralSourceFile([input], 'fixture.mp4', {
  type: 'video/mp4',
});
const result = await transformObservedHaze(file);
const output = new Uint8Array(await result.output.arrayBuffer());
const expectedSample = [0, 0, 0, 4, 0, 0, 0, 0];

assert.equal(result.report.originalTrackCount, 2);
assert.equal(result.report.outputTrackCount, 3);
assert.equal(result.report.originalAudioSamples, 3);
assert.equal(result.report.dummySamples, 27);
assert.equal(result.report.trailerSize, 216);
assert.deepEqual(Array.from(output.slice(-8)), expectedSample);
assert.deepEqual(result.report.outputLayout, [
  'ftyp',
  'moov',
  'mdat',
  '<trailing-data>',
]);
assert.equal(result.report.videoAndAudioPayloadPreserved, true);
assert.equal(result.report.strictIsoBmff, false);
assert.match(result.report.mdatSha256 ?? '', /^[0-9a-f]{64}$/);

console.log('Observed Haze browser transform: PASS');
