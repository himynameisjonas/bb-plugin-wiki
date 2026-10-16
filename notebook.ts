import { execFile } from "node:child_process";
import { readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const home = homedir();

export const NOTES = join(home, "Documents/Notes/conclave");
export const MEMPALACE = join(home, ".local/bin/mempalace");
// Own palace file: `mempalace mine` never drops old chunks of an edited note,
// so the shared palace.db fills with duplicates. A full rebuild takes ~3s.
export const PALACE = join(home, ".local/share/mempalace/conclave.db");

export type Hit = { slug: string; score: number; text: string };

export function parseHits(output: string): Hit[] {
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const block of output.split(/\n\s*\[\d+\] /).slice(1)) {
    const slug = block.match(/Source:\s+(.+?)\.md/)?.[1];
    const score = Number(block.match(/bm25=([\d.]+)/)?.[1] ?? 0);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const text = block.split(/bm25=[\d.]+[^\n]*\n/)[1]?.split(/\n\s*-{10,}/)[0]?.trim() ?? "";
    hits.push({ slug, score, text });
  }
  return hits;
}

export async function search(query: string, limit = 5): Promise<Hit[]> {
  const { stdout } = await run(
    MEMPALACE,
    ["--palace", PALACE, "search", "--wing", "conclave", "--results", String(limit * 3), "--", query.slice(0, 500)],
    { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  );
  return parseHits(stdout).slice(0, limit);
}

export function summary(slug: string): string {
  try {
    const first = readFileSync(join(NOTES, `${slug}.md`), "utf8").split("\n").find((line) => line.trim()) ?? "";
    return first.replace(/^_\[\[daily\/[^\]]*\]\]_\.?\s*/, "").replace(/^#\s*/, "").slice(0, 200);
  } catch {
    return "";
  }
}

export function isStale(): boolean {
  let built: number;
  try {
    built = statSync(PALACE).mtimeMs;
  } catch {
    return true;
  }
  if (statSync(NOTES).mtimeMs > built) return true;
  return readdirSync(NOTES).some((file) => file.endsWith(".md") && statSync(join(NOTES, file)).mtimeMs > built);
}

export async function rebuild(): Promise<void> {
  const next = `${PALACE}.next`;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(next + suffix, { force: true });
  await run(MEMPALACE, ["--palace", next, "mine", "--wing", "conclave", NOTES], { timeout: 60_000 });
  // ponytail: a reader mid-swap gets one failed search, fine for a CLI lookup
  for (const suffix of ["-wal", "-shm"]) rmSync(PALACE + suffix, { force: true });
  renameSync(next, PALACE);
}
