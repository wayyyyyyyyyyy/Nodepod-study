// Chunked to avoid blowing the call stack on large buffers
const SEGMENT_SIZE = 8192;

export function bytesToBase64(data: Uint8Array): string {
  const segments: string[] = [];
  for (let offset = 0; offset < data.length; offset += SEGMENT_SIZE) {
    segments.push(
      String.fromCharCode.apply(null, Array.from(data.subarray(offset, offset + SEGMENT_SIZE)))
    );
  }
  return btoa(segments.join(''));
}

export function base64ToBytes(encoded: string): Uint8Array {
  const raw = atob(encoded);
  const result = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    result[i] = raw.charCodeAt(i);
  }
  return result;
}

export function bytesToHex(data: Uint8Array): string {
  const chars = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    chars[i] = data[i].toString(16).padStart(2, '0');
  }
  return chars.join('');
}

export function bytesToLatin1(data: Uint8Array): string {
  const segments: string[] = [];
  for (let offset = 0; offset < data.length; offset += SEGMENT_SIZE) {
    segments.push(
      String.fromCharCode.apply(null, Array.from(data.subarray(offset, offset + SEGMENT_SIZE)))
    );
  }
  return segments.join('');
}
