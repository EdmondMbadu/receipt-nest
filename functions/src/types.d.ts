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

declare module 'jpeg-js' {
  interface RawImageData {
    data: Buffer;
    width: number;
    height: number;
  }

  interface EncodedImage {
    data: Buffer;
    width: number;
    height: number;
  }

  export function encode(rawImageData: RawImageData, quality?: number): EncodedImage;
  export function decode(jpegData: Buffer): RawImageData;
}
