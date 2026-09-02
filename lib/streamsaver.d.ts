declare module 'streamsaver' {
  type StreamOptions = {
    size?: number;
    pathname?: string;
    writableStrategy?: QueuingStrategy<Uint8Array>;
    readableStrategy?: QueuingStrategy<Uint8Array>;
  };

  type StreamSaver = {
    mitm: string;
    supported: boolean;
    createWriteStream(
      filename: string,
      options?: StreamOptions,
    ): WritableStream<Uint8Array>;
  };

  const streamSaver: StreamSaver;
  export default streamSaver;
}
