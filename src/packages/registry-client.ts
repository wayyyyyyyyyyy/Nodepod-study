// Registry Client — fetches package metadata, versions, and tarballs from npm.

export interface VersionDetail {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  optionalDependencies?: Record<string, string>;
  dist: {
    tarball: string;
    shasum: string;
    integrity?: string;
  };
  main?: string;
  module?: string;
  exports?: Record<string, unknown>;
  bin?: Record<string, string> | string;
}

export interface PackageMetadata {
  name: string;
  'dist-tags': {
    latest: string;
    [label: string]: string;
  };
  versions: Record<string, VersionDetail>;
  time?: Record<string, string>;
}

export interface RegistryConfig {
  endpoint?: string;
  metadataCache?: Map<string, PackageMetadata>;
}

import { NPM_REGISTRY_URL } from "../constants/config";

const NPM_REGISTRY_BASE = NPM_REGISTRY_URL;

// @scope/pkg -> @scope%2fpkg
function encodeForUrl(pkgName: string): string {
  return pkgName.replace(/\//g, '%2f');
}

export class RegistryClient {
  private baseUrl: string;
  private metadataStore: Map<string, PackageMetadata>;

  constructor(config: RegistryConfig = {}) {
    this.baseUrl = (config.endpoint || NPM_REGISTRY_BASE).replace(/\/+$/, '');
    this.metadataStore = config.metadataCache || new Map();
  }

  // Cached per client instance
  async fetchManifest(name: string): Promise<PackageMetadata> {
    const cached = this.metadataStore.get(name);
    if (cached) {
      return cached;
    }

    const requestUrl = `${this.baseUrl}/${encodeForUrl(name)}`;

    const resp = await fetch(requestUrl, {
      headers: {
        Accept:
          'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8',
      },
    });

    if (resp.status === 404) {
      throw new Error(`Package "${name}" does not exist in the registry`);
    }
    if (!resp.ok) {
      throw new Error(
        `Registry request for "${name}" failed with HTTP ${resp.status}`
      );
    }

    const metadata = (await resp.json()) as PackageMetadata;
    this.metadataStore.set(name, metadata);

    return metadata;
  }

  // Resolves dist-tags (e.g. "latest", "next") to concrete versions
  async fetchVersion(name: string, version: string): Promise<VersionDetail> {
    const metadata = await this.fetchManifest(name);

    const taggedVersion = metadata['dist-tags'][version];
    const resolvedVersion = taggedVersion || version;

    const detail = metadata.versions[resolvedVersion];
    if (!detail) {
      throw new Error(
        `Version "${version}" does not exist for package "${name}"`
      );
    }

    return detail;
  }

  async getLatestVersion(name: string): Promise<string> {
    const metadata = await this.fetchManifest(name);
    return metadata['dist-tags'].latest;
  }

  async listVersions(name: string): Promise<string[]> {
    const metadata = await this.fetchManifest(name);
    return Object.keys(metadata.versions);
  }

  async getTarballUrl(name: string, version: string): Promise<string> {
    const detail = await this.fetchVersion(name, version);
    return detail.dist.tarball;
  }

  async downloadArchive(tarballUrl: string): Promise<ArrayBuffer> {
    const resp = await fetch(tarballUrl);
    if (!resp.ok) {
      throw new Error(`Tarball download failed (HTTP ${resp.status}): ${tarballUrl}`);
    }
    return resp.arrayBuffer();
  }

  flushCache(): void {
    this.metadataStore.clear();
  }
}

export default RegistryClient;
