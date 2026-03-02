// optional CORS proxy for APIs that don't allow browser origins

let activeProxy: string | null = null;

export function setProxy(url: string | null): void {
  activeProxy = url;
}

export function getProxy(): string | null {
  return activeProxy;
}

export function isProxyActive(): boolean {
  return activeProxy !== null;
}

export async function proxiedFetch(url: string, init?: RequestInit): Promise<Response> {
  if (activeProxy) {
    return fetch(activeProxy + encodeURIComponent(url), init);
  }
  return fetch(url, init);
}

export function resolveProxyUrl(url: string): string {
  return activeProxy ? activeProxy + encodeURIComponent(url) : url;
}
