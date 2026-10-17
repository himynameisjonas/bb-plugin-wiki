import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const DEFAULTS = {
  notes: "~/Documents/Notes/wiki",
  mempalace: "~/.local/bin/mempalace",
  // Own palace file: `mempalace mine` never drops old chunks of an edited note,
  // so a shared palace.db fills with duplicates. A full rebuild takes ~3s.
  palace: "~/.local/share/mempalace/wiki.db",
  index: "wiki",
};
type Paths = typeof DEFAULTS;
const expand = (path: string) => path.trim().replace(/^~(?=$|\/)/, homedir());
export const paths: Paths = { notes: "", mempalace: "", palace: "", index: "" };
export function configure(next: Paths) {
  for (const key of Object.keys(DEFAULTS) as (keyof Paths)[]) paths[key] = expand(next[key] || DEFAULTS[key]);
  // An empty name turns the index off.
  paths.index = (next.index ?? DEFAULTS.index).trim().replace(/\.md$/, "");
}
configure(DEFAULTS);

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

export const hasMempalace = () => existsSync(paths.mempalace);

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// Plain BM25 (k1 1.2, b 0.75), so scores land in the same range as mempalace's and the related-notes cutoff still fits.
export function rankNotes(docs: { slug: string; text: string }[], query: string, limit = 5): Hit[] {
  const terms = [...new Set(words(query))];
  const tokenized = docs.map((doc) => ({ ...doc, tokens: words(`${doc.slug.replace(/-/g, " ")} ${doc.text}`) }));
  const avgLength = tokenized.reduce((sum, doc) => sum + doc.tokens.length, 0) / (tokenized.length || 1);
  const idf = new Map(
    terms.map((term) => {
      const df = tokenized.filter((doc) => doc.tokens.includes(term)).length;
      return [term, Math.log((tokenized.length - df + 0.5) / (df + 0.5) + 1)];
    }),
  );
  return tokenized
    .map((doc) => {
      let score = 0;
      for (const term of terms) {
        const tf = doc.tokens.filter((token) => token === term).length;
        if (tf) score += idf.get(term)! * ((tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * doc.tokens.length) / avgLength)));
      }
      const line = doc.text.split("\n").find((text) => terms.some((term) => words(text).includes(term))) ?? "";
      return { slug: doc.slug, score, text: line.trim().slice(0, 600) };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function readNotes(): { slug: string; text: string }[] {
  return readdirSync(paths.notes)
    .filter((file) => file.endsWith(".md") && file !== `${paths.index}.md`)
    .map((file) => ({ slug: file.slice(0, -3), text: readFileSync(join(paths.notes, file), "utf8") }));
}

function wordSearch(query: string, limit: number): Hit[] {
  return rankNotes(readNotes(), query.slice(0, 500), limit);
}

export type Lint = { orphans: string[]; broken: { slug: string; target: string }[]; noRelated: string[] };

export function lint(docs: { slug: string; text: string }[]): Lint {
  const slugs = new Set(docs.map((doc) => doc.slug));
  const linked = new Set<string>();
  const broken: Lint["broken"] = [];
  for (const doc of docs) {
    const text = doc.text.replace(/```[\s\S]*?```|`[^`\n]*`/g, "");
    for (const [, raw] of text.matchAll(/\[\[([^\]|#]+)/g)) {
      const target = raw.trim();
      if (target.startsWith("daily/")) continue;
      if (!slugs.has(target)) broken.push({ slug: doc.slug, target });
      else if (target !== doc.slug) linked.add(target);
    }
  }
  const sorted = (list: string[]) => list.sort((a, b) => a.localeCompare(b));
  return {
    orphans: sorted([...slugs].filter((slug) => !linked.has(slug))),
    broken,
    noRelated: sorted(docs.filter((doc) => !/^## Related notes/m.test(doc.text)).map((doc) => doc.slug)),
  };
}

export function lintReport({ orphans, broken, noRelated }: Lint): string {
  const section = (title: string, lines: string[]) => `${title}: ${lines.length}\n${lines.map((line) => `- ${line}\n`).join("")}`;
  return [
    section("Orphans (no other note links to them)", orphans.map((slug) => `[[${slug}]]`)),
    section("Broken links", broken.map(({ slug, target }) => `[[${slug}]] links to [[${target}]]`)),
    section("Notes without ## Related notes", noRelated.map((slug) => `[[${slug}]]`)),
  ].join("\n");
}

export async function search(query: string, limit = 5): Promise<Hit[]> {
  if (!hasMempalace()) return wordSearch(query, limit);
  const { stdout } = await run(
    paths.mempalace,
    ["--palace", paths.palace, "search", "--wing", "wiki", "--results", String(limit * 3), "--", query.slice(0, 500)],
    { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
  );
  return parseHits(stdout).filter((hit) => hit.slug !== paths.index).slice(0, limit);
}

export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).replace(/[\s,.;:]+$/, "")}…`;
}

export function summary(slug: string): string {
  try {
    const first = readFileSync(join(paths.notes, `${slug}.md`), "utf8").split("\n").find((line) => line.trim()) ?? "";
    return shorten(first.replace(/^_(\[\[daily\/[^\]]*\]\]|\d{4}-\d{2}-\d{2})_\.?\s*/, "").replace(/^#\s*/, ""), 200);
  } catch {
    return "";
  }
}

// The text under the title, up to the first ## heading, for hover previews in chat.
export function firstSection(text: string, max = 500): string {
  const lines = text.split("\n");
  const title = lines.findIndex((line) => line.startsWith("# "));
  const body = lines.slice(title >= 0 ? title + 1 : 1).join("\n").split(/^## /m)[0];
  return shorten(body.replace(/^Source: .*$/m, "").trim(), max);
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
  await run(paths.mempalace, ["--palace", next, "mine", "--wing", "wiki", paths.notes], { timeout: 60_000 });
  // ponytail: a reader mid-swap gets one odd search, fine for a CLI lookup
  for (const suffix of ["-wal", "-shm"]) rmSync(paths.palace + suffix, { force: true });
  renameSync(next, paths.palace);
  if (existsSync(`${next}-wal`)) renameSync(`${next}-wal`, `${paths.palace}-wal`);
  rmSync(`${next}-shm`, { force: true });
}

export const today = () => new Date().toLocaleDateString("sv-SE");
export const DATE_STYLES = ["obsidian-daily", "plain", "none"] as const;
export type DateStyle = (typeof DATE_STYLES)[number];
export const format = { dateStyle: "obsidian-daily" as DateStyle };
const mark = (date: string) => (format.dateStyle === "obsidian-daily" ? `[[daily/${date}|${date}]]` : date);

export function newNote(date: string, summary: string, source: string, body: string): string {
  const first = format.dateStyle === "none" ? summary.trim() : `_${mark(date)}_. ${summary.trim()}`;
  return `${first}\n\nSource: ${source}\n\n${body.trim()}\n`;
}

export function withUpdate(note: string, date: string, source: string, body: string): string {
  const heading = format.dateStyle === "none" ? "## Update" : `## Update ${mark(date)}`;
  const update = `${heading}\n\nSource: ${source}\n\n${body.trim()}\n\n`;
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
  const slugs = [...status.matchAll(/([^/\s"]+)\.md"?$/gm)].map((match) => match[1]).filter((slug) => slug !== paths.index);
  await git("add", "-A", "--", ".");
  await git("commit", "-q", "-m", message ?? `wiki: update ${slugs.join(", ") || "index"}`, "--", ".");
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
    `Notes in the user's wiki (${paths.notes}) that may relate to this thread. Read the ones that fit before you start, and ignore the rest:`,
    ...lines,
  ].join("\n");
}

export function listNotes(): { slug: string; summary: string }[] {
  return readdirSync(paths.notes)
    .filter((file) => file.endsWith(".md") && file !== `${paths.index}.md`)
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

// Groups notes by the first part of the slug. A prefix with one note goes to "Other".
export function indexContent(notes: { slug: string; summary: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const note of [...notes].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const prefix = note.slug.split("-")[0];
    groups.set(prefix, [...(groups.get(prefix) ?? []), `- [[${note.slug}]]${note.summary ? `: ${note.summary}` : ""}`]);
  }
  const other = [...groups.values()].filter((lines) => lines.length < 2).flat();
  const sections = [...groups].filter(([, lines]) => lines.length > 1).map(([prefix, lines]) => `## ${prefix}\n\n${lines.join("\n")}`);
  if (other.length) sections.push(`## Other\n\n${other.join("\n")}`);
  return `# Index\n\nEvery note in this folder, one line each, grouped by the first part of the slug. The BB wiki plugin writes this file, so don't edit it.\n\n${sections.join("\n\n")}\n`;
}

// Only writes on change, so an unchanged notebook doesn't trigger a commit or an index rebuild.
// Also deletes index files written under an earlier name, so a rename or turning the index off doesn't leave one behind.
export function writeIndex(): boolean {
  let removed = false;
  for (const file of readdirSync(paths.notes).filter((file) => file.endsWith(".md") && file !== `${paths.index}.md`)) {
    const text = readFileSync(join(paths.notes, file), "utf8");
    if (text.startsWith("# Index\n\n") && text.includes("The BB wiki plugin writes this file")) {
      rmSync(join(paths.notes, file));
      removed = true;
    }
  }
  if (!paths.index) return removed;
  const path = join(paths.notes, `${paths.index}.md`);
  const next = indexContent(listNotes());
  if (existsSync(path) && readFileSync(path, "utf8") === next) return false;
  writeFileSync(path, next);
  return true;
}

export type ThreadRow = { id: string; title: string | null; titleFallback?: string | null; createdAt: number; originPluginId: string | null };

// Threads that no note links to. Agent-mode automation threads are skipped here; script-spawned ones carry no origin, so the compile prompt skips those by title.
export function unsavedThreads(threads: ThreadRow[], docs: { text: string }[], since: number): ThreadRow[] {
  const saved = new Set(docs.flatMap((doc) => doc.text.match(/thr_[a-z0-9]+/g) ?? []));
  return threads
    .filter((thread) => thread.createdAt >= since && thread.originPluginId !== "automations" && !saved.has(thread.id))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export const unsavedReport = (threads: ThreadRow[]) =>
  threads
    .map((thread) => `- ${thread.id} (${new Date(thread.createdAt).toLocaleDateString("sv-SE")}): ${thread.title ?? thread.titleFallback ?? ""}\n`)
    .join("");
