/**
 * M14 frontend security guards — static invariants that must never regress.
 *
 * The terminal handles session tokens and renders server data; these checks
 * pin the XSS/exfiltration posture: no raw HTML injection sinks, no
 * persistent token storage, no dynamic code execution, and no logging of
 * credentials.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// Vitest runs from the frontend root; src is the application tree.
const SRC = join(process.cwd(), "src");
const files = listSourceFiles(SRC).filter(
  // The guard itself contains the literal patterns it asserts on.
  (f) => !f.includes("security-guards.test"),
);

describe("frontend security statics", () => {
  it("scans a non-empty source tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("has no raw-HTML injection sinks", () => {
    const offenders = files.filter((f) =>
      readFileSync(f, "utf-8").includes("dangerouslySetInnerHTML"),
    );
    expect(offenders).toEqual([]);
  });

  it("never persists tokens or credentials to web storage", () => {
    // The invariant concerns SHIPPED code. Test files legitimately seed and
    // inspect browser storage to exercise the persistence layer (the app's own
    // write path goes through a guarded `Storage` reference, never a literal),
    // so they are excluded from this check only.
    const shippedFiles = files.filter((f) => !/\.test\.(ts|tsx)$/.test(f));
    const offenders = shippedFiles.filter((f) => {
      const text = readFileSync(f, "utf-8");
      return /localStorage\.setItem|sessionStorage\.setItem/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("never logs credentials or tokens", () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf-8");
      return /console\.\w+\([^)]*(password|refresh_token|access_token)/i.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("has no dynamic code execution", () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf-8");
      return /(^|\W)(eval\(|new Function\(|document\.write\()/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it("no secrets hardcoded in the frontend bundle source", () => {
    const offenders = files.filter((f) => {
      const text = readFileSync(f, "utf-8");
      return /(JWT_SECRET|api[_-]?secret|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}/i.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
