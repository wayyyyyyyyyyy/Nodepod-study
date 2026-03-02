// StringDecoder for decoding Buffer/Uint8Array to strings


export interface StringDecoder {
  encoding: string;
  write(buf: Uint8Array | Buffer): string;
  end(buf?: Uint8Array | Buffer): string;
}

export const StringDecoder = function StringDecoder(this: any, encoding?: string) {
  if (!this) return;
  this.encoding = encoding || "utf8";
} as unknown as { new(encoding?: string): StringDecoder; prototype: any };

StringDecoder.prototype.write = function write(buf: Uint8Array | Buffer): string {
  if (!buf || buf.length === 0) return "";
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new TextDecoder(this.encoding).decode(bytes);
};

StringDecoder.prototype.end = function end(buf?: Uint8Array | Buffer): string {
  return buf ? this.write(buf) : "";
};

export default { StringDecoder };
