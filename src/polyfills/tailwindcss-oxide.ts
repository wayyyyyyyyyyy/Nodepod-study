// Pure JS replacement for @tailwindcss/oxide (native Rust binaries can't load in browser).
// Regex-based scanner that extracts Tailwind CSS utility class candidates from VFS files.

// Intentionally broad to avoid false negatives -- Tailwind's compiler filters out non-matches
const CANDIDATE_RE =
  /[!\-]?(?:[a-z@][a-z0-9]*(?:-[a-z0-9/._]+)*(?:\[[^\]]+\])?(?:\/[a-z0-9._%-]+)?(?:\:[a-z@!][a-z0-9]*(?:-[a-z0-9/._]+)*(?:\[[^\]]+\])?(?:\/[a-z0-9._%-]+)?)*)/gi;

const SPLIT_RE = /[\s'"`;{}()\[\]]+/;

function extractCandidates(content: string): string[] {
  const seen = new Set<string>();
  const matches = content.match(CANDIDATE_RE);
  if (matches) {
    for (const m of matches) {
      if (m.length >= 2 && m.length <= 200) seen.add(m);
    }
  }
  // fallback: split on whitespace/quotes and keep plausible tokens
  const tokens = content.split(SPLIT_RE);
  for (const tok of tokens) {
    const t = tok.trim();
    if (t.length >= 2 && t.length <= 200 && /^[!@\-]?[a-z]/.test(t) && !t.includes("//") && !t.includes("/*")) {
      seen.add(t);
    }
  }
  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// Glob matching (minimal)
// ---------------------------------------------------------------------------

function matchGlob(pattern: string, path: string): boolean {
  // Convert glob pattern to regex
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (ch === "*") {
      re += "[^/]*";
      i++;
    } else if (ch === "?") {
      re += "[^/]";
      i++;
    } else if (ch === "{") {
      re += "(";
      i++;
    } else if (ch === "}") {
      re += ")";
      i++;
    } else if (ch === ",") {
      re += "|";
      i++;
    } else if (".+^$|()[]\\".includes(ch)) {
      re += "\\" + ch;
      i++;
    } else {
      re += ch;
      i++;
    }
  }
  re += "$";
  try {
    return new RegExp(re).test(path);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// VFS access — try to use globalThis.__nodepod_volume or require('fs')
// ---------------------------------------------------------------------------

function getFs(): any {
  // Access the VFS through globalThis.__nodepodVolume (set by script-engine.ts)
  const g = globalThis as any;
  if (g.__nodepodVolume) return g.__nodepodVolume;
  return null;
}

function readDir(fs: any, dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function walkDir(fs: any, dir: string, results: string[]): void {
  const entries = readDir(fs, dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next" || entry === "dist") continue;
    const full = dir.endsWith("/") ? dir + entry : dir + "/" + entry;
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walkDir(fs, full, results);
      } else {
        results.push(full);
      }
    } catch {
      // Skip unreadable entries
    }
  }
}

// ---------------------------------------------------------------------------
// Source entry type
// ---------------------------------------------------------------------------

interface SourceEntry {
  base: string;
  pattern: string;
  negated?: boolean;
}

interface ChangedContent {
  file?: string;
  content?: string;
  extension: string;
}

// File extensions that likely contain Tailwind class names
const SCANNABLE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".html", ".vue", ".svelte", ".astro", ".mdx", ".md",
  ".php", ".blade.php", ".erb", ".haml", ".slim",
  ".twig", ".pug", ".jade", ".hbs", ".ejs",
]);

// ---------------------------------------------------------------------------
// Scanner class
// ---------------------------------------------------------------------------

export interface Scanner {
  _sources: SourceEntry[];
  _fileList: string[] | null;
  _scannedCandidates: string[] | null;
  _collectFiles(): string[];
  scan(): string[];
  scanFiles(changedContent: ChangedContent[]): string[];
  getCandidatesWithPositions(changedContent: ChangedContent[]): Array<{ candidate: string; position: number }>;
  readonly files: string[];
  readonly globs: Array<{ base: string; pattern: string }>;
  readonly normalizedSources: SourceEntry[];
}

interface ScannerConstructor {
  new (opts?: { sources?: SourceEntry[] }): Scanner;
  (this: any, opts?: { sources?: SourceEntry[] }): void;
  prototype: any;
}

export const Scanner = function Scanner(this: any, opts?: { sources?: SourceEntry[] }) {
  if (!this) return;
  this._sources = opts?.sources || [];
  this._fileList = null;
  this._scannedCandidates = null;
} as unknown as ScannerConstructor;

Scanner.prototype._collectFiles = function _collectFiles(this: any): string[] {
  if (this._fileList) return this._fileList;

  const fs = getFs();
  if (!fs) {
    this._fileList = [];
    return this._fileList;
  }

  const files: string[] = [];
  const negatedPatterns: string[] = [];

  for (const source of this._sources) {
    if (source.negated) {
      negatedPatterns.push(source.pattern);
      continue;
    }

    const base = source.base || ".";
    const allFiles: string[] = [];
    walkDir(fs, base, allFiles);

    for (const file of allFiles) {
      const relPath = file.startsWith(base) ? file.slice(base.length).replace(/^\//, "") : file;
      const ext = file.substring(file.lastIndexOf("."));
      if (!SCANNABLE_EXTENSIONS.has(ext)) continue;
      if (source.pattern && !matchGlob(source.pattern, relPath)) continue;

      // Check against negated patterns
      let negated = false;
      for (const neg of negatedPatterns) {
        if (matchGlob(neg, relPath)) {
          negated = true;
          break;
        }
      }
      if (!negated) files.push(file);
    }
  }

  this._fileList = files;
  return files;
};

Scanner.prototype.scan = function scan(this: any): string[] {
  if (this._scannedCandidates) return this._scannedCandidates;

  const fs = getFs();
  if (!fs) {
    this._scannedCandidates = [];
    return this._scannedCandidates;
  }

  const files = this._collectFiles();
  const allCandidates = new Set<string>();

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf8");
      const candidates = extractCandidates(content);
      for (const c of candidates) allCandidates.add(c);
    } catch {
      // Skip unreadable files
    }
  }

  this._scannedCandidates = Array.from(allCandidates);
  return this._scannedCandidates;
};

Scanner.prototype.scanFiles = function scanFiles(this: any, changedContent: ChangedContent[]): string[] {
  const allCandidates = new Set<string>();
  const fs = getFs();

  for (const entry of changedContent) {
    let content = entry.content;
    if (!content && entry.file && fs) {
      try {
        content = fs.readFileSync(entry.file, "utf8");
      } catch {
        continue;
      }
    }
    if (content) {
      const candidates = extractCandidates(content);
      for (const c of candidates) allCandidates.add(c);
    }
  }

  // Invalidate cached scan results since files changed
  this._scannedCandidates = null;

  return Array.from(allCandidates);
};

Scanner.prototype.getCandidatesWithPositions = function getCandidatesWithPositions(this: any, changedContent: ChangedContent[]): Array<{ candidate: string; position: number }> {
  const results: Array<{ candidate: string; position: number }> = [];
  const fs = getFs();

  for (const entry of changedContent) {
    let content = entry.content;
    if (!content && entry.file && fs) {
      try {
        content = fs.readFileSync(entry.file, "utf8");
      } catch {
        continue;
      }
    }
    if (!content) continue;

    let match: RegExpExecArray | null;
    CANDIDATE_RE.lastIndex = 0;
    while ((match = CANDIDATE_RE.exec(content)) !== null) {
      results.push({ candidate: match[0], position: match.index });
    }
  }

  return results;
};

Object.defineProperty(Scanner.prototype, "files", {
  get: function(this: any): string[] {
    return this._collectFiles();
  },
  configurable: true,
});

Object.defineProperty(Scanner.prototype, "globs", {
  get: function(this: any): Array<{ base: string; pattern: string }> {
    return this._sources
      .filter((s: SourceEntry) => !s.negated)
      .map((s: SourceEntry) => ({ base: s.base, pattern: s.pattern }));
  },
  configurable: true,
});

Object.defineProperty(Scanner.prototype, "normalizedSources", {
  get: function(this: any): SourceEntry[] {
    return this._sources;
  },
  configurable: true,
});

export default { Scanner };
