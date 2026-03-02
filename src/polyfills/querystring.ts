// Querystring parse/stringify/escape/unescape


export type ParsedQuery = Record<string, string | string[]>;

// supports duplicate keys (values become arrays) and custom separators
export function parse(
  input: string,
  pairSep: string = '&',
  kvSep: string = '=',
  options?: { maxKeys?: number }
): ParsedQuery {
  const output: ParsedQuery = {};
  if (!input || typeof input !== 'string') return output;

  const ceiling = options?.maxKeys || 1000;
  const segments = input.split(pairSep);
  const limit = ceiling > 0 ? Math.min(segments.length, ceiling) : segments.length;

  for (let i = 0; i < limit; i++) {
    const segment = segments[i];
    const eqPos = segment.indexOf(kvSep);
    let k: string;
    let v: string;

    if (eqPos >= 0) {
      k = decodeURIComponent(segment.substring(0, eqPos).replace(/\+/g, ' '));
      v = decodeURIComponent(segment.substring(eqPos + 1).replace(/\+/g, ' '));
    } else {
      k = decodeURIComponent(segment.replace(/\+/g, ' '));
      v = '';
    }

    if (k in output) {
      const prev = output[k];
      if (Array.isArray(prev)) {
        prev.push(v);
      } else {
        output[k] = [prev, v];
      }
    } else {
      output[k] = v;
    }
  }

  return output;
}

export function stringify(
  obj: Record<string, string | string[] | number | boolean | undefined>,
  pairSep: string = '&',
  kvSep: string = '='
): string {
  if (!obj || typeof obj !== 'object') return '';

  const parts: string[] = [];

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    const encodedKey = encodeURIComponent(key);

    if (Array.isArray(val)) {
      for (const item of val) {
        parts.push(`${encodedKey}${kvSep}${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodedKey}${kvSep}${encodeURIComponent(String(val))}`);
    }
  }

  return parts.join(pairSep);
}

export function escape(text: string): string {
  return encodeURIComponent(text);
}

export function unescape(text: string): string {
  return decodeURIComponent(text.replace(/\+/g, ' '));
}

// Node.js compatibility aliases
export const encode = stringify;
export const decode = parse;

export default {
  parse,
  stringify,
  escape,
  unescape,
  encode,
  decode,
};
