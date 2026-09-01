const CONTAINER_BOXES = new Set([
  'moov',
  'trak',
  'mdia',
  'minf',
  'stbl',
  'edts',
  'udta',
  'meta',
  'ilst',
  'dinf',
  'tref',
  'ipro',
  'sinf',
  'schi',
  'wave',
]);

const ALLOWED_TOP_LEVEL = new Set([
  'ftyp',
  'moov',
  'mdat',
  'free',
  'skip',
  'wide',
]);

const DUMMY_SAMPLE = new Uint8Array([0, 0, 0, 4, 0, 0, 0, 0]);
const COPY_BLOCK_SAMPLES = 65_536;
const MAX_INPUT_SIZE = 1024 * 1024 * 1024;
const MAX_TRAILER_SIZE = 512 * 1024 * 1024;
const MAX_SAFE_BOX_SIZE = 0xffffffff;

export type HazeProgress = {
  percent: number;
  message: string;
};

export type HazeReport = {
  inputSize: number;
  outputSize: number;
  inputLayout: string[];
  outputLayout: string[];
  audioSampleEntry: string;
  originalTrackCount: number;
  outputTrackCount: number;
  originalAudioSamples: number;
  dummySamples: number;
  dummySampleSize: number;
  trailerOffset: number;
  trailerSize: number;
  mdatSha256: string | null;
  videoAndAudioPayloadPreserved: boolean;
  strictIsoBmff: false;
  classification: 'OBSERVED';
};

export type HazeResult = {
  output: Blob;
  outputName: string;
  report: HazeReport;
};

type Mp4Box = {
  type: string;
  offset: number;
  size: number;
  headerSize: number;
  payloadOffset: number;
  end: number;
  children: Mp4Box[];
};

type RebuildContext = {
  bytes: Uint8Array;
  view: DataView;
  moov: Mp4Box;
  mdat: Mp4Box;
  audioTrack: Mp4Box;
  newTrackId: number;
  originalAudioSampleCount: number;
  extraSampleCount: number;
  originalAudioChunkCount: number;
  newMdatOffset: number | null;
  trailerOffset: number | null;
};

export class HazeCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HazeCompatibilityError';
  }
}

function readType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function encodeType(type: string) {
  if (type.length !== 4) throw new Error(`Invalid box type ${type}.`);
  return Uint8Array.from(type, (character) => character.charCodeAt(0) & 0xff);
}

function parseBoxes(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  depth = 0,
): Mp4Box[] {
  if (depth > 64)
    throw new HazeCompatibilityError('A hierarquia MP4 é profunda demais.');
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset < end) {
    if (end - offset < 8) {
      throw new HazeCompatibilityError(
        `Dados incompletos no offset 0x${offset.toString(16).toUpperCase()}.`,
      );
    }
    const size32 = view.getUint32(offset);
    const type = readType(bytes, offset + 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) {
        throw new HazeCompatibilityError(
          `Header estendido incompleto em ${type}.`,
        );
      }
      const extended = view.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new HazeCompatibilityError(
          `Box ${type} excede o limite seguro do navegador.`,
        );
      }
      size = Number(extended);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize) {
      throw new HazeCompatibilityError(
        `Box ${JSON.stringify(type)} possui tamanho ${size}, menor que o header ${headerSize}.`,
      );
    }
    const boxEnd = offset + size;
    if (!Number.isSafeInteger(boxEnd) || boxEnd > end) {
      throw new HazeCompatibilityError(
        `Box ${type} ultrapassa os limites do arquivo.`,
      );
    }
    const payloadOffset = offset + headerSize;
    let children: Mp4Box[] = [];
    if (CONTAINER_BOXES.has(type)) {
      const childStart = payloadOffset + (type === 'meta' ? 4 : 0);
      if (childStart <= boxEnd) {
        children = parseBoxes(bytes, view, childStart, boxEnd, depth + 1);
      }
    }
    boxes.push({
      type,
      offset,
      size,
      headerSize,
      payloadOffset,
      end: boxEnd,
      children,
    });
    offset = boxEnd;
  }
  return boxes;
}

function walk(box: Mp4Box): Mp4Box[] {
  return [box, ...box.children.flatMap(walk)];
}

function findAll(boxes: Mp4Box[], type: string) {
  return boxes.flatMap((box) =>
    walk(box).filter((candidate) => candidate.type === type),
  );
}

function one(root: Mp4Box, type: string) {
  const matches = walk(root).filter((box) => box.type === type);
  if (matches.length !== 1) {
    throw new HazeCompatibilityError(
      `A compatibilidade Haze exige exatamente um box ${type} em ${root.type}; encontrados ${matches.length}.`,
    );
  }
  return matches[0];
}

function concatenate(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total > MAX_SAFE_BOX_SIZE) {
    throw new HazeCompatibilityError(
      'Um box reconstruído ultrapassaria 4 GiB.',
    );
  }
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
}

function u32(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new HazeCompatibilityError(`Valor ${value} não cabe em uint32.`);
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function makeBox(type: string, payload: Uint8Array) {
  return concatenate([u32(8 + payload.byteLength), encodeType(type), payload]);
}

function hazeToolTag() {
  const text = new TextEncoder().encode('Haze Engine 4.0');
  const dataPayload = concatenate([u32(1), u32(0), text]);
  return makeBox('©too', makeBox('data', dataPayload));
}

function raw(ctx: RebuildContext, box: Mp4Box) {
  return ctx.bytes.slice(box.offset, box.end);
}

function resizeBox(
  source: Uint8Array,
  payload: Uint8Array,
  headerSize: number,
) {
  const size = headerSize + payload.byteLength;
  if (size > MAX_SAFE_BOX_SIZE) {
    throw new HazeCompatibilityError(
      'Um box reconstruído excede o tamanho de 32 bits.',
    );
  }
  const header = source.slice(0, headerSize);
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  const size32 = view.getUint32(0);
  if (size32 === 1) view.setBigUint64(8, BigInt(size));
  else if (size32 === 0) {
    throw new HazeCompatibilityError(
      'Boxes internos com size=0 não são reescritos.',
    );
  } else view.setUint32(0, size);
  return concatenate([header, payload]);
}

function remapStco(ctx: RebuildContext, box: Mp4Box, clone: boolean) {
  const source = raw(ctx, box);
  const output = source.slice();
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  const payload = box.headerSize;
  const count = view.getUint32(payload + 4);
  const expected = box.headerSize + 8 + count * 4;
  if (output.byteLength !== expected) {
    throw new HazeCompatibilityError(
      'Tabela stco truncada ou preenchida não é suportada.',
    );
  }

  if (ctx.newMdatOffset !== null) {
    const delta = ctx.newMdatOffset - ctx.mdat.offset;
    for (let index = 0; index < count; index += 1) {
      const position = payload + 8 + index * 4;
      const previous = view.getUint32(position);
      if (previous < ctx.mdat.offset || previous >= ctx.mdat.end) {
        throw new HazeCompatibilityError(
          `O offset stco 0x${previous.toString(16).toUpperCase()} não aponta para o mdat.`,
        );
      }
      const next = previous + delta;
      if (next < 0 || next > 0xffffffff) {
        throw new HazeCompatibilityError(
          'O novo offset stco ultrapassa 32 bits.',
        );
      }
      view.setUint32(position, next);
    }
  }

  if (!clone) return output;
  view.setUint32(payload + 4, count + 1);
  return resizeBox(
    output,
    concatenate([
      output.slice(payload),
      u32(ctx.trailerOffset === null ? 0 : ctx.trailerOffset),
    ]),
    box.headerSize,
  );
}

function cloneLeaf(ctx: RebuildContext, box: Mp4Box) {
  const source = raw(ctx, box);
  const output = source.slice();
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  const payload = box.headerSize;

  if (box.type === 'tkhd') {
    const version = output[payload];
    const position = payload + (version === 1 ? 20 : version === 0 ? 12 : -1);
    if (position < payload)
      throw new HazeCompatibilityError(`Versão tkhd ${version} não suportada.`);
    view.setUint32(position, ctx.newTrackId);
    return output;
  }

  if (box.type === 'mdhd') {
    const version = output[payload];
    const position = payload + (version === 1 ? 24 : version === 0 ? 16 : -1);
    if (position < payload)
      throw new HazeCompatibilityError(`Versão mdhd ${version} não suportada.`);
    if (version === 1) {
      const duration =
        view.getBigUint64(position) + BigInt(ctx.extraSampleCount);
      view.setBigUint64(position, duration);
    } else {
      const duration = view.getUint32(position) + ctx.extraSampleCount;
      if (duration > 0xffffffff)
        throw new HazeCompatibilityError('A duração mdhd excederia 32 bits.');
      view.setUint32(position, duration);
    }
    return output;
  }

  if (box.type === 'stts') {
    const count = view.getUint32(payload + 4);
    if (output.byteLength !== box.headerSize + 8 + count * 8) {
      throw new HazeCompatibilityError(
        'Tabela stts truncada ou preenchida não é suportada.',
      );
    }
    view.setUint32(payload + 4, count + 1);
    return resizeBox(
      output,
      concatenate([output.slice(payload), u32(ctx.extraSampleCount), u32(1)]),
      box.headerSize,
    );
  }

  if (box.type === 'stsc') {
    const count = view.getUint32(payload + 4);
    if (output.byteLength !== box.headerSize + 8 + count * 12) {
      throw new HazeCompatibilityError(
        'Tabela stsc truncada ou preenchida não é suportada.',
      );
    }
    view.setUint32(payload + 4, count + 1);
    return resizeBox(
      output,
      concatenate([
        output.slice(payload),
        u32(ctx.originalAudioChunkCount + 1),
        u32(ctx.extraSampleCount),
        u32(1),
      ]),
      box.headerSize,
    );
  }

  if (box.type === 'stsz') {
    const sampleSize = view.getUint32(payload + 4);
    const count = view.getUint32(payload + 8);
    if (sampleSize !== 0 || count !== ctx.originalAudioSampleCount) {
      throw new HazeCompatibilityError(
        'A réplica exige uma tabela stsz AAC de tamanho variável.',
      );
    }
    if (output.byteLength !== box.headerSize + 12 + count * 4) {
      throw new HazeCompatibilityError(
        'Tabela stsz truncada ou preenchida não é suportada.',
      );
    }
    view.setUint32(payload + 8, count + ctx.extraSampleCount);
    const appended = new Uint8Array(ctx.extraSampleCount * 4);
    const appendedView = new DataView(appended.buffer);
    for (let index = 0; index < ctx.extraSampleCount; index += 1) {
      appendedView.setUint32(index * 4, DUMMY_SAMPLE.byteLength);
    }
    return resizeBox(
      output,
      concatenate([output.slice(payload), appended]),
      box.headerSize,
    );
  }

  if (box.type === 'stco') return remapStco(ctx, box, true);
  if (box.type === 'co64') {
    throw new HazeCompatibilityError(
      'Entradas co64 ainda não são suportadas pelo modo Haze web.',
    );
  }
  return output;
}

function normalLeaf(ctx: RebuildContext, box: Mp4Box) {
  const output = raw(ctx, box).slice();
  if (box.type === 'mvhd') {
    new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(
      output.byteLength - 4,
      ctx.newTrackId + 1,
    );
    return output;
  }
  if (box.type === 'stco') return remapStco(ctx, box, false);
  if (box.type === 'co64') {
    throw new HazeCompatibilityError(
      'Entradas co64 ainda não são suportadas pelo modo Haze web.',
    );
  }
  return output;
}

function rebuildBox(
  ctx: RebuildContext,
  box: Mp4Box,
  clone = false,
): Uint8Array {
  const source = raw(ctx, box);
  if (!box.children.length) {
    if (box.type === 'ilst') {
      return resizeBox(
        source,
        concatenate([source.slice(box.headerSize), hazeToolTag()]),
        box.headerSize,
      );
    }
    return clone ? cloneLeaf(ctx, box) : normalLeaf(ctx, box);
  }

  let cursor = box.payloadOffset;
  const parts: Uint8Array[] = [];
  let cloneInserted = false;
  let sawTrack = false;
  let sawToolTag = false;

  for (const child of box.children) {
    if (child.offset < cursor || child.end > box.end) {
      throw new HazeCompatibilityError(
        `Filhos inválidos dentro de ${box.type}.`,
      );
    }
    parts.push(ctx.bytes.slice(cursor, child.offset));

    if (box.type === 'trak' && child.type === 'edts') {
      cursor = child.end;
      continue;
    }

    if (box.type === 'ilst' && child.type === '©too') {
      parts.push(hazeToolTag());
      sawToolTag = true;
    } else {
      if (
        box.type === 'moov' &&
        child.type !== 'trak' &&
        sawTrack &&
        !cloneInserted
      ) {
        parts.push(rebuildBox(ctx, ctx.audioTrack, true));
        cloneInserted = true;
      }
      parts.push(rebuildBox(ctx, child, clone));
      if (box.type === 'moov' && child.type === 'trak') sawTrack = true;
    }
    cursor = child.end;
  }

  if (box.type === 'moov' && !cloneInserted) {
    parts.push(rebuildBox(ctx, ctx.audioTrack, true));
  }
  if (box.type === 'ilst' && !sawToolTag) parts.push(hazeToolTag());
  parts.push(ctx.bytes.slice(cursor, box.end));
  return resizeBox(source, concatenate(parts), box.headerSize);
}

function handlerType(bytes: Uint8Array, track: Mp4Box) {
  const handler = walk(track).find((box) => box.type === 'hdlr');
  return handler ? readType(bytes, handler.payloadOffset + 8) : null;
}

function trackId(view: DataView, box: Mp4Box) {
  const version = view.getUint8(box.payloadOffset);
  const position =
    box.payloadOffset + (version === 1 ? 20 : version === 0 ? 12 : -1);
  if (position < box.payloadOffset)
    throw new HazeCompatibilityError(`Versão tkhd ${version} não suportada.`);
  return view.getUint32(position);
}

function sha256Hex(buffer: ArrayBuffer) {
  return crypto.subtle
    .digest('SHA-256', buffer)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, '0'),
      ).join(''),
    );
}

function outputName(name: string) {
  const stem = name.replace(/\.(mp4|m4v)$/i, '') || 'video';
  return `${stem}_observed_haze_4.mp4`;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function transformObservedHaze(
  file: File,
  onProgress?: (progress: HazeProgress) => void,
): Promise<HazeResult> {
  if (!/\.(mp4|m4v)$/i.test(file.name)) {
    throw new HazeCompatibilityError('Selecione um arquivo .mp4 ou .m4v.');
  }
  if (file.size < 8)
    throw new HazeCompatibilityError(
      'O arquivo é pequeno demais para ser um MP4.',
    );
  if (file.size > MAX_INPUT_SIZE) {
    throw new HazeCompatibilityError(
      'O modo web aceita arquivos de até 1 GiB por segurança de memória.',
    );
  }

  onProgress?.({ percent: 12, message: 'Lendo o arquivo localmente…' });
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  onProgress?.({ percent: 28, message: 'Validando a estrutura MP4…' });
  const top = parseBoxes(bytes, view, 0, bytes.byteLength);
  const oneTop = (type: string) => {
    const matches = top.filter((box) => box.type === type);
    if (matches.length !== 1) {
      throw new HazeCompatibilityError(
        `A réplica exige exatamente um ${type}; encontrados ${matches.length}.`,
      );
    }
    return matches[0];
  };
  const ftyp = oneTop('ftyp');
  const moov = oneTop('moov');
  const mdat = oneTop('mdat');
  const unsupported = top.filter((box) => !ALLOWED_TOP_LEVEL.has(box.type));
  if (unsupported.length) {
    throw new HazeCompatibilityError(
      `Boxes de nível superior não suportados: ${unsupported.map((box) => box.type).join(', ')}.`,
    );
  }
  if (findAll([moov], 'co64').length) {
    throw new HazeCompatibilityError(
      'Este arquivo usa co64; o modo Haze web não fará um patch inseguro.',
    );
  }

  const tracks = moov.children.filter((box) => box.type === 'trak');
  const audioTracks = tracks.filter(
    (track) => handlerType(bytes, track) === 'soun',
  );
  const videoTracks = tracks.filter(
    (track) => handlerType(bytes, track) === 'vide',
  );
  if (
    tracks.length !== 2 ||
    audioTracks.length !== 1 ||
    videoTracks.length !== 1
  ) {
    throw new HazeCompatibilityError(
      `A réplica exige exatamente uma track de vídeo e uma de áudio; encontradas ${videoTracks.length} de vídeo e ${audioTracks.length} de áudio.`,
    );
  }
  const audioTrack = audioTracks[0];
  const stsd = one(audioTrack, 'stsd');
  const sampleEntry = readType(bytes, stsd.payloadOffset + 12);
  if (sampleEntry !== 'mp4a') {
    throw new HazeCompatibilityError(
      `O áudio usa ${JSON.stringify(sampleEntry)}, mas a réplica exata exige AAC/mp4a. Converta o áudio para AAC antes de usar o site.`,
    );
  }
  const stsz = one(audioTrack, 'stsz');
  const stco = one(audioTrack, 'stco');
  const sampleCount = view.getUint32(stsz.payloadOffset + 8);
  const chunkCount = view.getUint32(stco.payloadOffset + 4);
  if (!sampleCount || !chunkCount) {
    throw new HazeCompatibilityError(
      'As tabelas de amostras ou chunks de áudio estão vazias.',
    );
  }
  const extraSampleCount = sampleCount * 9;
  if (
    !Number.isSafeInteger(extraSampleCount) ||
    sampleCount + extraSampleCount > 0xffffffff
  ) {
    throw new HazeCompatibilityError(
      'A contagem de amostras ultrapassaria o limite de 32 bits.',
    );
  }
  const trailerSize = extraSampleCount * DUMMY_SAMPLE.byteLength;
  if (trailerSize > MAX_TRAILER_SIZE) {
    throw new HazeCompatibilityError(
      'O trailer experimental ultrapassaria 512 MiB.',
    );
  }
  if (!findAll([moov], 'ilst').length) {
    throw new HazeCompatibilityError(
      'O arquivo não possui ilst para receber a assinatura Haze observada.',
    );
  }

  const ids = findAll([moov], 'tkhd').map((box) => trackId(view, box));
  const ctx: RebuildContext = {
    bytes,
    view,
    moov,
    mdat,
    audioTrack,
    newTrackId: Math.max(0, ...ids) + 1,
    originalAudioSampleCount: sampleCount,
    extraSampleCount,
    originalAudioChunkCount: chunkCount,
    newMdatOffset: null,
    trailerOffset: null,
  };

  onProgress?.({ percent: 48, message: 'Reconstruindo o moov e a timeline…' });
  const sizingMoov = rebuildBox(ctx, moov);
  ctx.newMdatOffset = ftyp.size + sizingMoov.byteLength;
  ctx.trailerOffset = ctx.newMdatOffset + mdat.size;
  const finalMoov = rebuildBox(ctx, moov);
  if (finalMoov.byteLength !== sizingMoov.byteLength) {
    throw new HazeCompatibilityError(
      'O tamanho do moov mudou durante a correção dos offsets.',
    );
  }

  onProgress?.({ percent: 70, message: 'Montando o trailer observado…' });
  const fullBlock = new Uint8Array(
    DUMMY_SAMPLE.byteLength * COPY_BLOCK_SAMPLES,
  );
  for (let index = 0; index < COPY_BLOCK_SAMPLES; index += 1) {
    fullBlock.set(DUMMY_SAMPLE, index * DUMMY_SAMPLE.byteLength);
  }
  const trailerParts: Uint8Array[] = [];
  let remaining = extraSampleCount;
  while (remaining > 0) {
    const count = Math.min(COPY_BLOCK_SAMPLES, remaining);
    trailerParts.push(
      count === COPY_BLOCK_SAMPLES ? fullBlock : fullBlock.slice(0, count * 8),
    );
    remaining -= count;
  }

  onProgress?.({
    percent: 84,
    message: 'Verificando a região de mídia preservada…',
  });
  const mdatHash =
    mdat.size <= 256 * 1024 * 1024
      ? await sha256Hex(buffer.slice(mdat.offset, mdat.end))
      : null;
  const ftypBytes = bytes.slice(ftyp.offset, ftyp.end);
  const output = new Blob(
    [
      asArrayBuffer(ftypBytes),
      asArrayBuffer(finalMoov),
      file.slice(mdat.offset, mdat.end),
      ...trailerParts.map(asArrayBuffer),
    ],
    { type: 'video/mp4' },
  );

  onProgress?.({ percent: 94, message: 'Validando a assinatura de saída…' });
  const rebuiltView = new DataView(
    finalMoov.buffer,
    finalMoov.byteOffset,
    finalMoov.byteLength,
  );
  const rebuiltTree = parseBoxes(
    finalMoov,
    rebuiltView,
    0,
    finalMoov.byteLength,
  );
  const rebuiltMoov = rebuiltTree[0];
  const outputTracks = findAll([rebuiltMoov], 'trak');
  if (
    rebuiltMoov.type !== 'moov' ||
    outputTracks.length !== tracks.length + 1 ||
    findAll([rebuiltMoov], 'edts').length !== 0
  ) {
    throw new HazeCompatibilityError(
      'A validação interna da estrutura reconstruída falhou.',
    );
  }

  onProgress?.({ percent: 100, message: 'Variante pronta para download.' });
  return {
    output,
    outputName: outputName(file.name),
    report: {
      inputSize: file.size,
      outputSize: output.size,
      inputLayout: top.map((box) => box.type),
      outputLayout: ['ftyp', 'moov', 'mdat', '<trailing-data>'],
      audioSampleEntry: sampleEntry,
      originalTrackCount: tracks.length,
      outputTrackCount: outputTracks.length,
      originalAudioSamples: sampleCount,
      dummySamples: extraSampleCount,
      dummySampleSize: DUMMY_SAMPLE.byteLength,
      trailerOffset: ctx.trailerOffset,
      trailerSize,
      mdatSha256: mdatHash,
      videoAndAudioPayloadPreserved: true,
      strictIsoBmff: false,
      classification: 'OBSERVED',
    },
  };
}
