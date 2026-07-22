import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import type { FastifyReply, FastifyRequest } from "fastify";

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export type ContainedStaticSite = Readonly<{
  root: string;
  serve(request: FastifyRequest, reply: FastifyReply): boolean;
}>;

function pathContained(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function applyHeaders(reply: FastifyReply): void {
  void reply
    .header("Cache-Control", "no-store")
    .header("Content-Security-Policy", CSP)
    .header("Referrer-Policy", "no-referrer")
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY");
}

function resolveRegularFile(root: string, requestedPath: string): string | null {
  const candidate = resolve(root, requestedPath);
  if (!pathContained(root, candidate)) {
    return null;
  }
  try {
    const status = lstatSync(candidate);
    if (!status.isFile() || status.isSymbolicLink()) {
      return null;
    }
    const canonical = realpathSync(candidate);
    return pathContained(root, canonical) ? canonical : null;
  } catch {
    return null;
  }
}

export function createContainedStaticSite(webRoot: string | undefined): ContainedStaticSite | null {
  if (webRoot === undefined || webRoot.trim().length === 0) {
    return null;
  }
  try {
    const requested = resolve(webRoot);
    const status = lstatSync(requested);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      return null;
    }
    const root = realpathSync(requested);
    const index = resolveRegularFile(root, "index.html");
    if (index === null) {
      return null;
    }
    return Object.freeze({
      root,
      serve(request: FastifyRequest, reply: FastifyReply): boolean {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return false;
        }
        const rawPath = request.raw.url?.split("?", 1)[0] ?? "/";
        if (/%(?:2e|2f|5c|00)/iu.test(rawPath)) {
          return false;
        }
        let decoded: string;
        try {
          decoded = decodeURIComponent(rawPath);
        } catch {
          return false;
        }
        if (decoded.includes("\\") || decoded.includes("\0")) {
          return false;
        }
        const segments = decoded.split("/").filter(Boolean);
        if (segments.some((segment) => segment === "." || segment === "..")) {
          return false;
        }
        const requested = segments.join("/");
        const hasExtension = extname(requested).length > 0;
        const file =
          requested.length === 0
            ? index
            : (resolveRegularFile(root, requested) ?? (hasExtension ? null : index));
        if (file === null) {
          return false;
        }
        applyHeaders(reply);
        void reply.type(CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
        if (request.method === "HEAD") {
          void reply.send();
        } else {
          void reply.send(readFileSync(file));
        }
        return true;
      },
    });
  } catch {
    return null;
  }
}
