import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const DEFAULTS = {
  notes: "~/Documents/Notes/conclave",
  mempalace: "~/.local/bin/mempalace",
  // Own palace file: `mempalace mine` never drops old chunks of an edited note,
  // so a shared palace.db fills with duplicates. A full rebuild takes ~3s.
  palace: "~/.local/share/mempalace/conclave.db",
};
type Paths = typeof DEFAULTS;
const expand = (path: string) => path.trim().replace(/^~(?=$|\/)/, homedir());
export const paths: Paths = { notes: "", mempalace: "", palace: "" };
export function configure(next: Paths) {
  for (const key of Object.keys(DEFAULTS) as (keyof Paths)[]) paths[key] = expand(next[key] || DEFAULTS[key]);
}
configure(DEFAULTS);

export const INDEX = "index";

export type Hit = { slug: string; score: number; text: string };

// A Markdown file link is clickable in BB chat and opens the note in the side panel; [[slug]] is not.
export const noteLink = (slug: string) => `[${slug}](${join(paths.notes, `${slug}.md`)})`;

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
    paths.mempalace,
    ["--palace", paths.palace, "search", "--wing", "conclave", "--results", String(limit * 3), "--", query.slice(0, 500)],
    { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  );
  return parseHits(stdout).filter((hit) => hit.slug !== INDEX).slice(0, limit);
}

export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).replace(/[\s,.;:]+$/, "")}…`;
}

export function summary(slug: string): string {
  try {
    const first = readFileSync(join(paths.notes, `${slug}.md`), "utf8").split("\n").find((line) => line.trim()) ?? "";
    return shorten(first.replace(/^_\[\[daily\/[^\]]*\]\]_\.?\s*/, "").replace(/^#\s*/, ""), 200);
  } catch {
    return "";
  }
}

export function isStale(): boolean {
  let built: number;
  try {
    built = statSync(paths.palace).mtimeMs;
  } catch {
    return true;
  }
  if (statSync(paths.notes).mtimeMs > built) return true;
  return readdirSync(paths.notes).some((file) => file.endsWith(".md") && statSync(join(paths.notes, file)).mtimeMs > built);
}

export async function rebuild(): Promise<void> {
  const next = `${paths.palace}.next`;
  mkdirSync(dirname(paths.palace), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) rmSync(next + suffix, { force: true });
  await run(paths.mempalace, ["--palace", next, "mine", "--wing", "conclave", paths.notes], { timeout: 60_000 });
  // ponytail: a reader mid-swap gets one odd search, fine for a CLI lookup
  for (const suffix of ["-wal", "-shm"]) rmSync(paths.palace + suffix, { force: true });
  renameSync(next, paths.palace);
  if (existsSync(`${next}-wal`)) renameSync(`${next}-wal`, `${paths.palace}-wal`);
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

// Works when the notes folder is the repo root or a folder inside it. No repo means no commits.
export async function commit(message?: string): Promise<boolean> {
  const git = (...args: string[]) => run("git", ["-C", paths.notes, "-c", "core.hooksPath=/dev/null", ...args]);
  let status: string;
  try {
    status = (await git("status", "--porcelain", "--", ".")).stdout;
  } catch {
    return false;
  }
  if (!status.trim()) return false;
  const slugs = [...status.matchAll(/([^/\s"]+)\.md"?$/gm)].map((match) => match[1]).filter((slug) => slug !== INDEX);
  await git("add", "-A", "--", ".");
  await git("commit", "-q", "-m", message ?? `conclave: update ${slugs.join(", ") || "index"}`, "--", ".");
  return true;
}

// ponytail: BM25 scores don't separate well, so this is a loose hint, not a verdict
export function pickRelated(hits: Hit[]): Hit[] {
  const top = hits[0]?.score ?? 0;
  return hits.filter((hit) => hit.score >= 2 && hit.score >= top * 0.6).slice(0, 3);
}

export function relatedNotes(hits: Hit[], describe: (slug: string) => string): string | null {
  const picked = pickRelated(hits);
  if (picked.length === 0) return null;
  const lines = picked.map((hit) => `- ${noteLink(hit.slug)}: ${describe(hit.slug)}`);
  return [
    `Notes in the user's conclave notebook (${paths.notes}) that may relate to this thread. Read the ones that fit before you start, and ignore the rest:`,
    ...lines,
  ].join("\n");
}

export function listNotes(): { slug: string; summary: string }[] {
  return readdirSync(paths.notes)
    .filter((file) => file.endsWith(".md") && file !== `${INDEX}.md`)
    .map((file) => ({ file, mtime: statSync(join(paths.notes, file)).mtimeMs }))
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

export function notesLinking(threadId: string): string[] {
  return readdirSync(paths.notes)
    .filter((file) => file.endsWith(".md") && readFileSync(join(paths.notes, file), "utf8").includes(threadId))
    .map((file) => file.slice(0, -3));
}

export function wrapUpMessage(lead: string, linked: string[], related: string[]): string {
  const list = (slugs: string[]) => slugs.map((slug) => `- ${noteLink(slug)}`).join("\n");
  const parts = [lead];
  if (linked.length) parts.push(`Notes this thread already wrote. Update these with mode=update, or edit the stale parts:\n${list(linked)}`);
  if (related.length) parts.push(`Notes that may cover the same topic. Read them and update one if it fits:\n${list(related)}`);
  return parts.join("\n\n");
}

export function indexContent(notes: { slug: string; summary: string }[]): string {
  const lines = [...notes]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((note) => `- [[${note.slug}]]${note.summary ? `: ${note.summary}` : ""}`);
  return `# Index\n\nEvery note in this folder, one line each. The BB conclave plugin writes this file, so don't edit it.\n\n${lines.join("\n")}\n`;
}

// Only writes on change, so an unchanged notebook doesn't trigger a commit or an index rebuild.
export function writeIndex(): boolean {
  const path = join(paths.notes, `${INDEX}.md`);
  const next = indexContent(listNotes());
  if (existsSync(path) && readFileSync(path, "utf8") === next) return false;
  writeFileSync(path, next);
  return true;
}
