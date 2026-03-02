// stub - minimal diagnostics_channel for compatibility


export interface DiagChannel {
  name: string;
  readonly hasSubscribers: boolean;
  subscribe(handler: (message: unknown, name: string) => void): void;
  unsubscribe(handler: (message: unknown, name: string) => void): boolean;
  publish(message: unknown): void;
}

export const DiagChannel = function DiagChannel(this: any, name: string) {
  if (!this) return;
  this.name = name;
  this._listeners = [];
} as unknown as { new(name: string): DiagChannel; prototype: any };

Object.defineProperty(DiagChannel.prototype, 'hasSubscribers', {
  get(this: any) { return this._listeners.length > 0; },
  configurable: true,
});

DiagChannel.prototype.subscribe = function subscribe(handler: (message: unknown, name: string) => void): void {
  this._listeners.push(handler);
};

DiagChannel.prototype.unsubscribe = function unsubscribe(handler: (message: unknown, name: string) => void): boolean {
  const idx = this._listeners.indexOf(handler);
  if (idx === -1) return false;
  this._listeners.splice(idx, 1);
  return true;
};

DiagChannel.prototype.publish = function publish(this: any, message: unknown): void {
  for (const handler of this._listeners) {
    try {
      handler(message, this.name);
    } catch {
      /* swallow */
    }
  }
};

const channels = new Map<string, DiagChannel>();

export function channel(name: string): DiagChannel {
  if (!channels.has(name)) channels.set(name, new DiagChannel(name));
  return channels.get(name)!;
}

export function hasSubscribers(name: string): boolean {
  return channels.get(name)?.hasSubscribers ?? false;
}

export function subscribe(
  name: string,
  handler: (message: unknown, name: string) => void,
): void {
  channel(name).subscribe(handler);
}

export function unsubscribe(
  name: string,
  handler: (message: unknown, name: string) => void,
): boolean {
  return channels.get(name)?.unsubscribe(handler) ?? false;
}

export { DiagChannel as Channel };
export default {
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  Channel: DiagChannel,
};
