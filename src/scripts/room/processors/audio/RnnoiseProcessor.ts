import type { TrackProcessor, AudioProcessorOptions } from 'livekit-client';
import { Rnnoise, DenoiseState } from '@shiguredo/rnnoise-wasm';

export class RnnoiseLivekitProcessor implements TrackProcessor<any> {
  readonly name = 'rnnoise';
  private rnnoiseInstance?: Rnnoise;
  private denoiseState?: DenoiseState;
  private audioContext?: AudioContext;
  private mediaStreamSource?: MediaStreamAudioSourceNode;
  private mediaStreamDestination?: MediaStreamAudioDestinationNode;
  private scriptNode?: ScriptProcessorNode;
  
  processedTrack?: MediaStreamTrack;

  async init(opts: AudioProcessorOptions): Promise<void> {
    this.audioContext = opts.audioContext;
    
    // Load RNNoise WASM
    if (!this.rnnoiseInstance) {
      this.rnnoiseInstance = await Rnnoise.load();
    }
    this.denoiseState = this.rnnoiseInstance.createDenoiseState();

    // Create Audio source from the input track
    const inputStream = new MediaStream([opts.track]);
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(inputStream);
    
    // Create Destination
    this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
    this.processedTrack = this.mediaStreamDestination.stream.getAudioTracks()[0];

    // Create ScriptProcessorNode with bufferSize 512
    this.scriptNode = this.audioContext.createScriptProcessor(512, 1, 1);

    const frameSize = 480;
    let inputBufferQueue: number[] = [];

    this.scriptNode.onaudioprocess = (e) => {
      const inputChannel = e.inputBuffer.getChannelData(0);
      const outputChannel = e.outputBuffer.getChannelData(0);

      // Enqueue inputs, scaling to 16-bit PCM values for RNNoise
      for (let i = 0; i < inputChannel.length; i++) {
        inputBufferQueue.push(inputChannel[i] * 32768);
      }

      // Keep input queue under 2048 samples (~42ms) to prevent latency build-up
      if (inputBufferQueue.length > 2048) {
        inputBufferQueue = inputBufferQueue.slice(inputBufferQueue.length - 2048);
      }

      // Process in 480-sample blocks
      const processedQueue: number[] = [];
      const tempFrame = new Float32Array(frameSize);

      while (inputBufferQueue.length >= frameSize) {
        for (let i = 0; i < frameSize; i++) {
          tempFrame[i] = inputBufferQueue[i];
        }
        inputBufferQueue = inputBufferQueue.slice(frameSize);

        // Process frame using the RNNoise model
        if (this.denoiseState) {
          this.denoiseState.processFrame(tempFrame);
        }

        // Convert back to Float32 range (-1 to 1) and enqueue
        for (let i = 0; i < frameSize; i++) {
          processedQueue.push(tempFrame[i] / 32768);
        }
      }

      // Fill output buffer
      for (let i = 0; i < outputChannel.length; i++) {
        if (i < processedQueue.length) {
          outputChannel[i] = processedQueue[i];
        } else {
          outputChannel[i] = 0;
        }
      }
    };

    // Connect the nodes
    this.mediaStreamSource.connect(this.scriptNode);
    this.scriptNode.connect(this.mediaStreamDestination);
  }

  async restart(opts: AudioProcessorOptions): Promise<void> {
    await this.destroy();
    await this.init(opts);
  }

  async destroy(): Promise<void> {
    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode.onaudioprocess = null;
      this.scriptNode = undefined;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = undefined;
    }
    if (this.denoiseState) {
      this.denoiseState.destroy();
      this.denoiseState = undefined;
    }
    this.processedTrack = undefined;
  }
}
