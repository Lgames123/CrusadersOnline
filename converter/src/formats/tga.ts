/**
 * Truevision TGA decoder. Supports true-colour (types 2/10) at 16/24/32 bpp and
 * greyscale (types 3/11) at 8 bpp, uncompressed or RLE. Output is RGBA8, top row first.
 * Pure: no Node or DOM APIs, so it runs in the CLI and in a browser worker.
 */
export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA8, rows top to bottom. */
  data: Uint8Array;
  hasAlpha: boolean;
}

export class TgaError extends Error {}

export function decodeTga(bytes: Uint8Array): DecodedImage {
  if (bytes.length < 18) throw new TgaError('file shorter than TGA header');
  const idLength = bytes[0]!;
  const colorMapType = bytes[1]!;
  const imageType = bytes[2]!;
  const cmapLength = bytes[5]! | (bytes[6]! << 8);
  const cmapEntryBits = bytes[7]!;
  const width = bytes[12]! | (bytes[13]! << 8);
  const height = bytes[14]! | (bytes[15]! << 8);
  const bpp = bytes[16]!;
  const descriptor = bytes[17]!;
  const alphaBits = descriptor & 0x0f;
  const topToBottom = (descriptor & 0x20) !== 0;
  const rightToLeft = (descriptor & 0x10) !== 0;

  const rle = imageType === 10 || imageType === 11;
  const grey = imageType === 3 || imageType === 11;
  if (!(imageType === 2 || imageType === 10 || grey)) throw new TgaError(`unsupported TGA image type ${imageType}`);
  if (grey ? bpp !== 8 : bpp !== 16 && bpp !== 24 && bpp !== 32) throw new TgaError(`unsupported bit depth ${bpp}`);
  if (width === 0 || height === 0) throw new TgaError('zero-sized image');

  const pixelBytes = bpp >> 3;
  let src = 18 + idLength + (colorMapType === 1 ? cmapLength * Math.ceil(cmapEntryBits / 8) : 0);
  const pixels = width * height;
  const out = new Uint8Array(pixels * 4);
  const hasAlpha = bpp === 32 ? alphaBits > 0 : bpp === 16 ? alphaBits > 0 : false;

  const writePixel = (i: number, p: number) => {
    // i = pixel index in file order; map to output (top-down, left-right) position
    const fileRow = Math.floor(i / width);
    const fileCol = i - fileRow * width;
    const row = topToBottom ? fileRow : height - 1 - fileRow;
    const col = rightToLeft ? width - 1 - fileCol : fileCol;
    const o = (row * width + col) * 4;
    if (grey) {
      const v = bytes[p]!;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    } else if (pixelBytes === 2) {
      const v = bytes[p]! | (bytes[p + 1]! << 8);
      out[o] = ((v >> 10) & 0x1f) * 255 / 31 | 0;
      out[o + 1] = ((v >> 5) & 0x1f) * 255 / 31 | 0;
      out[o + 2] = (v & 0x1f) * 255 / 31 | 0;
      out[o + 3] = hasAlpha ? (v & 0x8000 ? 255 : 0) : 255;
    } else {
      out[o] = bytes[p + 2]!;
      out[o + 1] = bytes[p + 1]!;
      out[o + 2] = bytes[p]!;
      out[o + 3] = pixelBytes === 4 && hasAlpha ? bytes[p + 3]! : 255;
    }
  };

  if (!rle) {
    if (src + pixels * pixelBytes > bytes.length) throw new TgaError('truncated pixel data');
    for (let i = 0; i < pixels; i++, src += pixelBytes) writePixel(i, src);
  } else {
    let i = 0;
    while (i < pixels) {
      if (src >= bytes.length) throw new TgaError('truncated RLE data');
      const packet = bytes[src++]!;
      const count = (packet & 0x7f) + 1;
      if (i + count > pixels) throw new TgaError('RLE packet overruns image');
      if (packet & 0x80) {
        if (src + pixelBytes > bytes.length) throw new TgaError('truncated RLE data');
        for (let k = 0; k < count; k++) writePixel(i++, src);
        src += pixelBytes;
      } else {
        if (src + count * pixelBytes > bytes.length) throw new TgaError('truncated RLE data');
        for (let k = 0; k < count; k++, src += pixelBytes) writePixel(i++, src);
      }
    }
  }

  return { width, height, data: out, hasAlpha };
}
