import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { build as esbuild } from "esbuild";

function inlineProcessWorkerPlugin() {
  const VIRTUAL_ID = "virtual:process-worker-bundle";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  let workerBundle = "";

  return {
    name: "inline-process-worker-demo",
    async buildStart() {
      const result = await esbuild({
        entryPoints: ["src/threading/process-worker-entry.ts"],
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "esnext",
        write: false,
        minify: false,
        sourcemap: false,
      });
      workerBundle = result.outputFiles[0].text;
    },
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id: string) {
      if (id === RESOLVED_ID) {
        return `export const PROCESS_WORKER_BUNDLE = ${JSON.stringify(workerBundle)};`;
      }
      return null;
    },
  };
}

function corsRelayPlugin() {
  const PREFIX = "/__cors_proxy__/";

  const setCorsHeaders = (res: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
  };

  const handler = async (req: any, res: any, next: () => void) => {
    const rawUrl = req.url as string | undefined;
    if (!rawUrl || !rawUrl.startsWith(PREFIX)) {
      next();
      return;
    }

    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const encodedTarget = rawUrl.slice(PREFIX.length);
    if (!encodedTarget) {
      res.statusCode = 400;
      res.end("Missing encoded target URL");
      return;
    }

    let targetUrl = "";
    try {
      targetUrl = decodeURIComponent(encodedTarget);
    } catch {
      res.statusCode = 400;
      res.end("Invalid encoded target URL");
      return;
    }

    if (!/^https?:\/\//i.test(targetUrl)) {
      res.statusCode = 400;
      res.end("Only http(s) URLs are allowed");
      return;
    }

    try {
      const method = String(req.method || "GET").toUpperCase();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers ?? {})) {
        if (!v) continue;
        const key = k.toLowerCase();
        if (
          key === "host" ||
          key === "origin" ||
          key === "referer" ||
          key === "connection" ||
          key === "content-length"
        ) {
          continue;
        }
        headers[key] = Array.isArray(v) ? v.join(", ") : String(v);
      }

      let body: Buffer | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        }
        if (chunks.length > 0) body = Buffer.concat(chunks);
      }

      const upstream = await fetch(targetUrl, {
        method,
        headers,
        body,
        redirect: "follow",
      });

      res.statusCode = upstream.status;
      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() === "content-encoding") return;
        res.setHeader(key, value);
      });
      setCorsHeaders(res);

      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.end(bytes);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`Proxy request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    name: "demo-cors-relay",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        void handler(req, res, next);
      });
    },
    configurePreviewServer(server: any) {
      server.middlewares.use((req: any, res: any, next: () => void) => {
        void handler(req, res, next);
      });
    },
  };
}

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), inlineProcessWorkerPlugin(), corsRelayPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
