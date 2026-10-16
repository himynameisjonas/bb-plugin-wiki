import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const home = homedir();

export const REPO = join(home, "Documents/Notes");
export const NOTES = join(REPO, "conclave");
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
  // ponytail: a reader mid-swap gets one odd search, fine for a CLI lookup
  for (const suffix of ["-wal", "-shm"]) rmSync(PALACE + suffix, { force: true });
  renameSync(next, PALACE);
  if (existsSync(`${next}-wal`)) renameSync(`${next}-wal`, `${PALACE}-wal`);
  rmSync(`${next}-shm`, { force: true });
}

export const today = () => new Date().toLocaleDateString("sv-SE");
const daily = (date: string) => `[[daily/${date}|${date}]]`;

export function newNote(date: string, summary: string, source: string, body: string): string {
  return `_${daily(date)}_. ${summary.trim()}\n\nSource: ${source}\n\n${body.trim()}\n`;
}

export function withUpdate(note: string, date: string, source: string, body: string): string {
  const update = `## Update ${daily(date)}\n\nSource: ${source}\n\n${body.trim()}\n\n`;
  const related = note.search(/^## Related notes/m);
  if (related === -1) return `${note.trimEnd()}\n\n${update.trimEnd()}\n`;
  return note.slice(0, related) + update + note.slice(related);
}

export async function commit(message?: string): Promise<boolean> {
  const git = (...args: string[]) => run("git", ["-C", REPO, "-c", "core.hooksPath=/dev/null", ...args]);
  const { stdout } = await git("status", "--porcelain", "--", "conclave");
  if (!stdout.trim()) return false;
  const slugs = [...stdout.matchAll(/conclave\/(.+?)\.md/g)].map((match) => match[1]);
  await git("add", "-A", "--", "conclave");
  await git("commit", "-q", "-m", message ?? `conclave: update ${slugs.join(", ") || "notes"}`, "--", "conclave");
  return true;
}

// ponytail: BM25 scores don't separate well, so this is a loose hint, not a verdict
export function relatedNotes(hits: Hit[], describe: (slug: string) => string): string | null {
  const top = hits[0]?.score ?? 0;
  const picked = hits.filter((hit) => hit.score >= 2 && hit.score >= top * 0.6).slice(0, 3);
  if (picked.length === 0) return null;
  const lines = picked.map((hit) => `- [[${hit.slug}]]: ${describe(hit.slug)}`);
  return [
    "Notes in the user's conclave notebook (~/Documents/Notes/conclave) that may relate to this thread. Read the ones that fit before you start, and ignore the rest:",
    ...lines,
  ].join("\n");
}

export function listNotes(): { slug: string; summary: string }[] {
  return readdirSync(NOTES)
    .filter((file) => file.endsWith(".md"))
    .map((file) => ({ file, mtime: statSync(join(NOTES, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => {
      const slug = file.slice(0, -3);
      return { slug, summary: summary(slug) };
    });
}

export function matchNotes<T extends { slug: string; summary: string }>(notes: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter((note) => words.every((word) => `${note.slug} ${note.summary}`.toLowerCase().includes(word)));
}
