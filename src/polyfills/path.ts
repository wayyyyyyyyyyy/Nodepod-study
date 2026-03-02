// POSIX path operations polyfill


// Path separator and delimiter constants
export const sep = '/';
export const delimiter = ':';

export function normalize(inputPath: string): string {
  if (!inputPath) return '.';

  const rooted = inputPath.charAt(0) === '/';
  const tokens = inputPath.split('/').filter(t => t.length > 0);
  const stack: string[] = [];

  for (const token of tokens) {
    if (token === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!rooted) {
        stack.push('..');
      }
    } else if (token !== '.') {
      stack.push(token);
    }
  }

  let output = stack.join('/');
  if (rooted) {
    output = '/' + output;
  }
  return output || '.';
}

export function join(...fragments: string[]): string {
  if (fragments.length === 0) return '.';
  const combined = fragments.filter(f => f !== '').join('/');
  return normalize(combined);
}

// resolves right-to-left until an absolute path is formed
export function resolve(...segments: string[]): string {
  let accumulated = '';

  for (let idx = segments.length - 1; idx >= 0; idx--) {
    const segment = segments[idx];
    if (!segment) continue;
    accumulated = segment + (accumulated ? '/' + accumulated : '');
    if (accumulated.charAt(0) === '/') break;
  }

  if (accumulated.charAt(0) !== '/') {
    const workingDir =
      typeof globalThis !== 'undefined' &&
      globalThis.process &&
      typeof globalThis.process.cwd === 'function'
        ? globalThis.process.cwd()
        : '/';
    accumulated = workingDir + (accumulated ? '/' + accumulated : '');
  }

  return normalize(accumulated);
}

export function isAbsolute(targetPath: string): boolean {
  return targetPath.charAt(0) === '/';
}

export function dirname(targetPath: string): string {
  if (!targetPath) return '.';
  const clean = normalize(targetPath);
  const slashPos = clean.lastIndexOf('/');
  if (slashPos < 0) return '.';
  if (slashPos === 0) return '/';
  return clean.substring(0, slashPos);
}

export function basename(targetPath: string, suffix?: string): string {
  if (!targetPath) return '';
  const clean = normalize(targetPath);
  let name = clean.substring(clean.lastIndexOf('/') + 1);
  if (suffix && name.endsWith(suffix)) {
    name = name.substring(0, name.length - suffix.length);
  }
  return name;
}

export function extname(targetPath: string): string {
  const name = basename(targetPath);
  const dotPos = name.lastIndexOf('.');
  if (dotPos <= 0) return '';
  return name.substring(dotPos);
}

export function relative(fromPath: string, toPath: string): string {
  const absFrom = resolve(fromPath);
  const absTo = resolve(toPath);

  if (absFrom === absTo) return '';

  const partsFrom = absFrom.split('/').filter(Boolean);
  const partsTo = absTo.split('/').filter(Boolean);

  let shared = 0;
  const limit = Math.min(partsFrom.length, partsTo.length);
  while (shared < limit && partsFrom[shared] === partsTo[shared]) {
    shared++;
  }

  const ascend = partsFrom.length - shared;
  const descend = partsTo.slice(shared);

  const pieces: string[] = [];
  for (let i = 0; i < ascend; i++) {
    pieces.push('..');
  }
  pieces.push(...descend);

  return pieces.join('/') || '.';
}

export function parse(targetPath: string): {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
} {
  const clean = normalize(targetPath);
  const rooted = isAbsolute(clean);
  const directory = dirname(clean);
  const base = basename(clean);
  const extension = extname(clean);
  const stem = base.substring(0, base.length - extension.length);

  return {
    root: rooted ? '/' : '',
    dir: directory,
    base,
    ext: extension,
    name: stem,
  };
}

export function format(components: {
  root?: string;
  dir?: string;
  base?: string;
  ext?: string;
  name?: string;
}): string {
  const directory = components.dir || components.root || '';
  const filename = components.base || (components.name || '') + (components.ext || '');

  if (!directory) return filename;
  if (directory === components.root) return directory + filename;
  return directory + '/' + filename;
}

// The posix namespace mirrors all path functions (this IS a POSIX implementation)
export const posix = {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
};

// Win32 namespace provided as a stub; all operations delegate to POSIX logic
export const win32 = {
  sep: '\\',
  delimiter: ';',
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
};

export default {
  sep,
  delimiter,
  normalize,
  join,
  resolve,
  isAbsolute,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  posix,
  win32,
};
