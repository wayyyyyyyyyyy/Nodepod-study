// stub - real DNS not available in browser, returns 127.0.0.1 for localhost, 0.0.0.0 otherwise

type SingleResult = (err: Error | null, addr?: string, fam?: number) => void;
type MultiResult = (
  err: Error | null,
  entries?: Array<{ address: string; family: number }>
) => void;

export function lookup(
  host: string,
  cb: SingleResult
): void;
export function lookup(
  host: string,
  opts: { family?: number; all?: true },
  cb: MultiResult
): void;
export function lookup(
  host: string,
  opts: { family?: number; all?: boolean },
  cb: SingleResult | MultiResult
): void;
export function lookup(
  host: string,
  optsOrCb: { family?: number; all?: boolean } | SingleResult,
  cb?: SingleResult | MultiResult
): void {
  const handler = typeof optsOrCb === 'function' ? optsOrCb : cb;
  const flags = typeof optsOrCb === 'object' ? optsOrCb : {};

  const isLocal = host === 'localhost' || host === '127.0.0.1';
  const ip = isLocal ? '127.0.0.1' : '0.0.0.0';

  setTimeout(() => {
    if (flags.all) {
      (handler as MultiResult)(null, [{ address: ip, family: 4 }]);
    } else {
      (handler as SingleResult)(null, ip, 4);
    }
  }, 0);
}

export function resolve(
  _host: string,
  cb: (err: Error | null, addrs?: string[]) => void
): void {
  setTimeout(() => cb(null, ['0.0.0.0']), 0);
}

export function resolve4(
  host: string,
  cb: (err: Error | null, addrs?: string[]) => void
): void {
  resolve(host, cb);
}

export function resolve6(
  _host: string,
  cb: (err: Error | null, addrs?: string[]) => void
): void {
  setTimeout(() => cb(null, ['::1']), 0);
}

export function reverse(
  _ip: string,
  cb: (err: Error | null, names?: string[]) => void
): void {
  setTimeout(() => cb(null, ['localhost']), 0);
}

export function setServers(_list: string[]): void {}
export function getServers(): string[] { return []; }
export function setDefaultResultOrder(_order: string): void {}
export function getDefaultResultOrder(): string { return 'verbatim'; }

export const promises = {
  lookup(
    host: string,
    opts?: { family?: number; all?: boolean }
  ): Promise<{ address: string; family: number } | Array<{ address: string; family: number }>> {
    return new Promise((ok, fail) => {
      if (opts?.all) {
        lookup(host, opts, ((e: Error | null, a?: Array<{ address: string; family: number }>) => {
          if (e) fail(e); else ok(a ?? []);
        }) as MultiResult);
      } else {
        lookup(host, opts ?? {}, (e, addr, fam) => {
          if (e) fail(e); else ok({ address: addr!, family: fam! });
        });
      }
    });
  },

  resolve(host: string): Promise<string[]> {
    return new Promise((ok, fail) => {
      resolve(host, (e, a) => (e ? fail(e) : ok(a ?? [])));
    });
  },

  resolve4(host: string): Promise<string[]> {
    return promises.resolve(host);
  },

  resolve6(_host: string): Promise<string[]> {
    return Promise.resolve(['::1']);
  },

  reverse(_ip: string): Promise<string[]> {
    return Promise.resolve(['localhost']);
  },

  setServers(_s: string[]): void {},
  getServers(): string[] { return []; },
};

export const ADDRCONFIG = 0;
export const V4MAPPED = 0;
export const ALL = 0;

export default {
  lookup,
  resolve,
  resolve4,
  resolve6,
  reverse,
  setServers,
  getServers,
  setDefaultResultOrder,
  getDefaultResultOrder,
  promises,
  ADDRCONFIG,
  V4MAPPED,
  ALL,
};
