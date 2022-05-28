import Minipass from 'minipass';
import SoxrResampler, { SoxrDatatype } from 'wasm-audio-resampler';
import { l } from '../environment/log';
import { assert, now, rollover } from '../misc';
import {
  OPUS_ENCODER_CHUNK_DURATION, OPUS_ENCODER_CHUNKS_PER_SECONDS, OPUS_ENCODER_RATE, OPUS_ENCODER_CHUNK_SAMPLES_COUNT, MAX_LATENCY,
} from '../constants';
import { OpusApplication } from './opus';
import { OpusEncodeStream, OpusDecodeStream } from './opus_streams';

// if we try reading 5 times and there is still no data available, stop the stream and try again on the "readable" event
// This is necessary to prevent the input buffer of the sourceStream being depleted and having to wait for a "readable" event which leads to some chunks being missed
// This will happen a lot a slow CPU were a garbage collection will stop the world for more than a chunk worth of time and then a lot of chunks will be read at the same time
// without letting rnough time for the child process to emit new data
const MIN_LOOP_ITERATION_WITHOUT_DATA_TO_STOP_READING = 5;

const log = l.extend('audioSinkDebug');

export interface AudioChunkStreamOutput {
  i: number;
  chunk: Buffer;
}

// This is used to control the output throughput of a stream and emit chunks of "chunkSize" bytes every "chunkDuration" ms
// every chunk has a index corresponding to when this chunk is emitted (i = [time when chunk was read relative to the creating of the stream] / chunkDuration)
// as long as the source stream can be read, the index is incremented directly
// if the source stream is interrupted (nothing can be read anymore), the next time a chunk is available, the index will be recalculated from the time
export class AudioChunkStream extends Minipass {
  private readInterval: NodeJS.Timeout;
  lastEmittedChunkIndex: number;
  private loopIterationWithoutData = 0;

  constructor(
    public startTime: number,
    public sourceStream: NodeJS.ReadableStream,
    public chunkDuration: number,
    public chunkSize: number,
  ) {
    super({
      objectMode: true,
    });
    this.lastEmittedChunkIndex = -1;
    this.sourceStream.on('readable', this.startReadLoop);
  }

  private startReadLoop = () => {
    this.loopIterationWithoutData = 0;
    if (this.readInterval) {
      return;
    }
    this._pushNecessaryChunks();
    this.readInterval = setInterval(this._pushNecessaryChunks, this.chunkDuration);
  }

  private stopReadLoop = () => {
    this.loopIterationWithoutData = 0;
    this.lastEmittedChunkIndex = -1;
    if (this.readInterval) {
      clearInterval(this.readInterval);
      delete this.readInterval;
    }
  }

  private now = () => now() - this.startTime;

  _pushNecessaryChunks = () => {
    while (true) {
      const currentChunkIndex = this.lastEmittedChunkIndex === -1 ? Math.floor(this.now() / this.chunkDuration) : this.lastEmittedChunkIndex + 1;
      // if this.lastEmittedChunkIndex === -1 the stream was interrupted because source couldn't be read, restart a sequence
      const currentChunkLatency = this.now() - (currentChunkIndex * this.chunkDuration);
      if (currentChunkLatency < 0) { // this chunk is in the future, do nothing and wait for next tick
        break;
      }
      let chunk = this.sourceStream.read(this.chunkSize) as Buffer;
      if (chunk === null) {
        this.loopIterationWithoutData++;
        if (this.loopIterationWithoutData >= MIN_LOOP_ITERATION_WITHOUT_DATA_TO_STOP_READING) {
          // nothing to read from source, we need to compute the next chunk from time instead of the sequence
          log('Stream out of data, stopping reading loop until new data arrives');
          this.stopReadLoop();
        }
        break;
      } else {
        this.loopIterationWithoutData = 0;
      }
      if (this.lastEmittedChunkIndex === -1) {
        log('Stream started again');
      }
      if (chunk.length !== this.chunkSize) {
        log('INCOMPLETE CHUNK');
        // it could mean we are at the end of the stream and receiving an incomplete chunk
        // so we complete it with zeros
        const incompleteChunk = chunk;
        chunk = Buffer.alloc(this.chunkSize);
        chunk.set(incompleteChunk);
      }
      const chunkOutput: AudioChunkStreamOutput = {
        i: currentChunkIndex,
        chunk,
      };
      // console.log(`+ ${currentChunkIndex}`);
      this.write(chunkOutput);
      this.lastEmittedChunkIndex = currentChunkIndex;
    }
  }
}

export class AudioChunkStreamEncoder extends Minipass {
  constructor() {
    super({
      objectMode: true,
    });
  }

  write(d: any, encoding?: string | (() => void), cb?: () => void) {
    const encodedChunk = new Uint8Array(
      Uint32Array.BYTES_PER_ELEMENT
      + d.chunk.byteLength,
    );
    new DataView(encodedChunk.buffer, encodedChunk.byteOffset).setUint32(0, d.i);
    encodedChunk.set(d.chunk, Uint32Array.BYTES_PER_ELEMENT);
    const returnVal = super.write(encodedChunk);
    if (cb) {
      cb();
    }
    return returnVal;
  }
}

export class AudioChunkStreamDecoder extends Minipass {
  constructor() {
    super({
      objectMode: true,
    });
  }
  write(d: any, encoding?: string | (() => void), cb?: () => void) {
    const input = d instanceof Buffer ? new Uint8Array(d.buffer) : d as Uint8Array;
    const returnVal = super.write({
      i: new DataView(input.buffer, input.byteOffset).getUint32(0),
      // this is necessary to make a copy of the buffer instead of creating a view to the same data
      chunk: input.slice(4),
    });
    if (cb) {
      cb();
    }
    return returnVal;
  }
}

// Used to reorder incoming chunk. If a chunk is missing, buffer up to [maxUnorderedChunks] chunks
export class AudioChunkStreamOrderer extends Minipass {
  buffer: AudioChunkStreamOutput[] = [];
  private nextEmittableChunkIndex = -1;

  constructor(public maxUnorderedChunks = 10) {
    super({
      objectMode: true,
    });
  }

  private emitNextChunksInBuffer = () => {
    while (this.buffer.length && this.buffer[0].i === this.nextEmittableChunkIndex) {
      this.emitChunk(this.buffer[0]);
      this.buffer.splice(0, 1);
    }
  }

  private emitChunk = (chunk) => {
    super.write(chunk);
    this.nextEmittableChunkIndex = chunk.i + 1;
  }

  write(d: any, encoding?: string | (() => void), cb?: () => void) {
    if (this.nextEmittableChunkIndex === -1) {
      this.nextEmittableChunkIndex = d.i;
    }
    if (d.i < this.nextEmittableChunkIndex) {
      // late chunk, we already emitted more recent chunks, ignoring
      return true;
    }

    if (this.nextEmittableChunkIndex === d.i) {
      // ordered chunk, act as a passthrough
      this.emitChunk(d);
    } else {
      // unordered chunk, store chunk in buffer
      // console.log(`GAP, next emitable ${this.nextEmittableChunkIndex}, received: ${d.i}`);
      this.buffer.push(d);
    }

    this.buffer.sort((a, b) => a.i - b.i);
    this.emitNextChunksInBuffer();

    // gap is too big, giving up on waiting for the chunk to be received
    if (this.buffer.length && this.buffer.length >= this.maxUnorderedChunks) {
      // console.log(`== gap too big, starting emitting, next emitable ${this.nextEmittableChunkIndex}`);
      if (this.buffer[0].i - this.nextEmittableChunkIndex === 1) {
        log(`Conceilling missing chunk ${this.nextEmittableChunkIndex}`);
        // there is only one missing chunk, we can send empty packet to let OPUS try to coneal this
        this.emitChunk({
          i: this.nextEmittableChunkIndex,
          chunk: Buffer.alloc(0),
        });
      }
      if (this.nextEmittableChunkIndex !== this.buffer[0].i) {
        log(`Missed ${this.buffer[0].i - this.nextEmittableChunkIndex} chunks, continuing without`);
      }
      // force consumming the buffer starting from the oldest chunk
      this.nextEmittableChunkIndex = this.buffer[0].i;
      this.emitNextChunksInBuffer();
    }

    if (cb) {
      cb();
    }

    return true;
  }
}

export class AudioChunkStreamResampler extends Minipass {
  private resampler: SoxrResampler;

  private alignementBuffer: Uint8Array;
  private resampledBuffer: Uint8Array;
  private bufferOffset = 0;
  private bufferSize = 0;

  private chunkIndexToEmit: number[] = [];
  private outputChunkTargetLength: number;

  constructor(public channels: number, public inRate: number, public outRate: number) {
    super({
      objectMode: true,
    });

    this.resampler = new SoxrResampler(channels, inRate, outRate, SoxrDatatype.SOXR_INT16, SoxrDatatype.SOXR_FLOAT32);
    this.resampler.init();

    // chunks can be delayed and returned in one call so we need to realign them
    this.outputChunkTargetLength = OPUS_ENCODER_CHUNK_SAMPLES_COUNT * this.channels * Float32Array.BYTES_PER_ELEMENT;
    // we use a big alignement buffer because we want to return a slice of the buffer instead of a copy
    // and we need to not use the same buffer space directly after so we use a circular buffer
    this.alignementBuffer = new Uint8Array(MAX_LATENCY * (outRate / 1000));
    assert((MAX_LATENCY * (outRate / 1000)) % this.outputChunkTargetLength === 0, 'alignement buffer length should be a multiple of outputChunkTargetLength');
    this.resampledBuffer = new Uint8Array(this.outputChunkTargetLength * 3);
  }

  write(d: any, encoding?: string | (() => void), cb?: () => void) {
    const makeCallback = () => {
      const callback = typeof encoding === 'function' ? encoding : cb;
      if (callback) {
        callback();
      }
    };
    if (!this.resampler.soxrModule) {
      // the resampler is not yet initialized, bailing out on the audio chunk
      // (we optimize for latency so if the resampler is not yet ready, we drop the chunk instead of waiting as anyway the chunk will be too old to be useful)
      makeCallback();
      return true;
    }
    this.chunkIndexToEmit.push(d.i);

    // TODO: Use threaded version of soxr resampler
    const outputChunk = this.resampler.processChunk(d.chunk, this.resampledBuffer);
    if (outputChunk.length === 0) {
      makeCallback();
      return true;
    }
    if (this.bufferOffset + outputChunk.length > this.alignementBuffer.length) {
      // complex case: the resampled data don't fit in one go, need to write it in two passes
      const overflow = (this.bufferOffset + outputChunk.length) - this.alignementBuffer.length;
      this.alignementBuffer.set(outputChunk.subarray(0, outputChunk.length - overflow), this.bufferOffset);
      this.alignementBuffer.set(outputChunk.subarray(outputChunk.length - overflow), 0);
    } else {
      // simple case: the resampled data fit in the alignement buffer
      this.alignementBuffer.set(outputChunk, this.bufferOffset);
    }

    this.bufferSize += outputChunk.length;
    this.bufferOffset = (this.bufferOffset + outputChunk.length) % this.alignementBuffer.length;

    while (this.bufferSize >= this.outputChunkTargetLength && this.chunkIndexToEmit.length > 0) {
      const [chunkIndex] = this.chunkIndexToEmit.splice(0, 1);
      const offset = rollover(this.bufferOffset - this.bufferSize, 0, this.alignementBuffer.length);
      try {
        super.write({
          i: chunkIndex,
          chunk: this.alignementBuffer.subarray(offset, offset + this.outputChunkTargetLength),
        });
      } catch (e) {
        l('Error while writting in AudioChunkStreamResampler', e);
      }
      this.bufferSize -= this.outputChunkTargetLength;
    }
    makeCallback();
    return true;
  }
}

export const createAudioChunkStream = (startTime: number, sourceStream: NodeJS.ReadableStream, sourceRate: number, channels: number) => {
  const chunkStream = new AudioChunkStream(
    startTime,
    sourceStream,
    OPUS_ENCODER_CHUNK_DURATION,
    (sourceRate / OPUS_ENCODER_CHUNKS_PER_SECONDS) * channels * Uint16Array.BYTES_PER_ELEMENT,
  );
  // we resample even if the rate is the same as it simplified the code and prevent edge cases
  const audioChunkResampler = new AudioChunkStreamResampler(channels, sourceRate, OPUS_ENCODER_RATE);
  return chunkStream
    .pipe(audioChunkResampler);
};

export const createAudioEncodedStream = (channels: number) => {
  const opusEncoderStream = new OpusEncodeStream(OPUS_ENCODER_RATE, channels, OpusApplication.OPUS_APPLICATION_RESTRICTED_LOWDELAY);
  const chunkEncoder = new AudioChunkStreamEncoder();
  opusEncoderStream.pipe(chunkEncoder);
  return { input: opusEncoderStream, output: chunkEncoder };
};

export const createAudioDecodedStream = (channels: number) => {
  const chunkDecoderStream = new AudioChunkStreamDecoder();
  const orderer = new AudioChunkStreamOrderer(10); // opus codec expect an ordered chunk stream but the webrtc datachannel is in unordered mode so we need to try to reorder them to prevent audio glitches
  const opusDecoderStream = new OpusDecodeStream(OPUS_ENCODER_RATE, channels);
  chunkDecoderStream.pipe(orderer).pipe(opusDecoderStream);
  return { input: chunkDecoderStream, output: opusDecoderStream };
};
