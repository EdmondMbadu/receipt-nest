declare module 'heic-decode' {
  interface HeicDecodeOptions {
    buffer: Buffer;
  }

  interface HeicDecodeResult {
    width: number;
    height: number;
    data: Uint8Array;
  }

  function decode(options: HeicDecodeOptions): Promise<HeicDecodeResult>;

  export default decode;
}
