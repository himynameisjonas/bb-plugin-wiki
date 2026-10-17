import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  DATE_STYLES,
  DEFAULTS,
  configure,
  firstSection,
  paths,
  format,
  hasMempalace,
  noteLink,
  type Hit,
  commit,
  isStale,
  lint,
  lintReport,
  listNotes,
  matchNotes,
  newNote,
  notesLinking,
  pickRelated,
  readNotes,
  wrapUpMessage,
  writeIndex,
  rebuild,
  relatedNotes,
  search,
  summary,
  today,
  unsavedReport,
  unsavedThreads,
  withUpdate,
} from "./notebook.ts";

const noteSchema = z.object({ slug: z.string(), summary: z.string() });
const threadNotesSchema = z.object({
  hostId: z.string().nullable(),
  notesDir: z.string(),
  linked: z.array(noteSchema),
  related: z.array(noteSchema),
  lint: z.object({ orphans: z.number(), broken: z.number(), noRelated: z.number() }),
});
export type ThreadNotes = z.infer<typeof threadNotesSchema>;
const previewSchema = z.object({ slug: z.string(), summary: z.string(), body: z.string() }).nullable();
export type NotePreview = z.infer<typeof previewSchema>;

export const rpcContract = defineRpcContract({
  thread_notes: { input: z.object({ threadId: z.string() }), output: threadNotesSchema },
  save_and_archive: { input: z.object({ threadId: z.string() }), output: z.object({ queued: z.boolean() }) },
  note_preview: { input: z.object({ path: z.string() }), output: previewSchema },
});

const WRAP_UP = [
  "Wrap-up before archiving: save what a future agent needs from this thread to the wiki with wiki_save.",
  "Prefer updating an existing note over creating a new one. Run wiki_search too if the notes below don't cover it.",
  "If nothing here is worth keeping, save nothing and say so.",
  "Reply with one line naming the note. BB archives this thread when you finish.",
].join(" ");

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    notes: { type: "string", label: "Notes folder", description: "Folder with the Markdown notes. ~ is your home folder.", default: DEFAULTS.notes },
    mempalace: { type: "string", label: "mempalace binary", description: "Path to the mempalace binary. Optional: without it the plugin uses a built-in word search.", default: DEFAULTS.mempalace },
    palace: { type: "string", label: "Search index file", description: "The plugin rebuilds this file from the notes.", default: DEFAULTS.palace },
    index: { type: "string", label: "Index note", description: "Name of the note that lists every note, without .md. Leave it empty to turn the index off. The plugin deletes the old index when you change this.", default: DEFAULTS.index },
    dateStyle: {
      type: "select",
      label: "Date line",
      description: "How new notes and updates show the date. obsidian-daily links to daily/YYYY-MM-DD.",
      options: [...DATE_STYLES],
      default: "obsidian-daily",
    },
  });
  const apply = (values: typeof DEFAULTS & { dateStyle: string }) => {
    configure(values);
    format.dateStyle = DATE_STYLES.find((style) => style === values.dateStyle) ?? "obsidian-daily";
    if (!existsSync(paths.notes)) {
      bb.status.needsConfiguration(`Can't find the notes folder ${paths.notes}. Fix it in the plugin settings, then run \`bb plugin reload wiki\`.`);
    }
    if (!hasMempalace()) bb.log.info(`No mempalace at ${paths.mempalace}, using the built-in word search`);
  };
  apply(await settings.get());
  let queue = Promise.resolve();
  const sync = (message?: string) => {
    const job = queue.then(async () => {
      if (!existsSync(paths.notes)) return;
      writeIndex();
      await commit(message);
      if (hasMempalace() && isStale()) await rebuild();
    });
    queue = job.catch((error) => bb.log.error(`sync failed: ${error}`));
    return job;
  };

  // /threads/<id> opens Personal-project threads too; /projects/proj_personal/... redirects home
  const threadLink = async (threadId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    const base = bb.server.experimental_appUrl ?? bb.server.loopbackBaseUrl;
    const label = (thread.title ?? thread.titleFallback ?? threadId).replace(/[[\]]/g, "");
    return `[${label}](${base}/threads/${threadId})`;
  };

  sync().catch(() => {});
  settings.onChange((next) => {
    apply(next);
    sync().catch(() => {});
  });
  const archiveKey = (threadId: string) => `archive-after:${threadId}`;
  bb.events.on("thread.idle", async ({ thread }) => {
    await sync().catch(() => {});
    // "queued" means a busy thread went idle before the wrap-up turn ran
    if ((await bb.storage.kv.get(archiveKey(thread.id))) !== "running") return;
    await bb.storage.kv.delete(archiveKey(thread.id));
    await bb.sdk.threads.archive({ threadId: thread.id });
  });
  bb.events.on("thread.failed", ({ thread }) => bb.storage.kv.delete(archiveKey(thread.id)));

  // ponytail: in memory, so a server restart loses hints for threads already running
  const related = new Map<string, Hit[]>();
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    if (ctx.input.text.includes(WRAP_UP) && (await bb.storage.kv.get(archiveKey(ctx.thread.id)))) {
      await bb.storage.kv.set(archiveKey(ctx.thread.id), "running");
    }
    if (!related.has(ctx.thread.id) && ctx.input.text.trim()) {
      related.set(ctx.thread.id, []);
      try {
        related.set(ctx.thread.id, await search(ctx.input.text, 8));
      } catch (error) {
        bb.log.warn(`related notes failed: ${error}`);
      }
    }
    return { action: "proceed" };
  });
  const notesFor = async (threadId: string) => {
    const linked = notesLinking(threadId);
    let hits = related.get(threadId);
    if (!hits?.length) {
      const thread = await bb.sdk.threads.get({ threadId });
      const title = thread.title ?? thread.titleFallback;
      hits = title ? await search(title, 8) : [];
    }
    return { linked, related: pickRelated(hits).map((hit) => hit.slug).filter((slug) => !linked.includes(slug)) };
  };

  bb.agents.contributeInstructions(({ threadId }) => relatedNotes(related.get(threadId) ?? [], summary));

  bb.rpc.register(rpcContract, {
    async save_and_archive({ threadId }) {
      const { linked, related } = await notesFor(threadId);
      await bb.storage.kv.set(archiveKey(threadId), "queued");
      const text = wrapUpMessage(WRAP_UP, linked, related);
      await bb.sdk.threads.send({ threadId, input: [{ type: "text", text, mentions: [] }], mode: "queue-if-active" });
      return { queued: true };
    },
    async note_preview({ path }) {
      const file = resolve(path);
      if (dirname(file) !== paths.notes || !file.endsWith(".md") || !existsSync(file)) return null;
      const slug = basename(file, ".md");
      return { slug, summary: summary(slug), body: firstSection(readFileSync(file, "utf8")) };
    },
    async thread_notes({ threadId }) {
      const { linked, related } = await notesFor(threadId);
      const note = (slug: string) => ({ slug, summary: summary(slug) });
      const { orphans, broken, noRelated } = lint(readNotes());
      return {
        hostId: (await bb.sdk.system.config()).primaryHostId,
        notesDir: paths.notes,
        linked: linked.map(note),
        related: related.map(note),
        lint: { orphans: orphans.length, broken: broken.length, noRelated: noRelated.length },
      };
    },
  });
  bb.events.on("thread.archived", ({ thread }) => void related.delete(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => void related.delete(thread.id));

  bb.cli.register({
    name: "wiki",
    summary: "Check the wiki",
    commands: [
      { name: "lint", summary: "List orphan notes, broken [[links]] and notes without ## Related notes", usage: "bb wiki lint" },
      { name: "unsaved", summary: "List threads from the last days (default 7) that no note links to", usage: "bb wiki unsaved [days]" },
    ],
    async run([command, days = "7"]) {
      if (command === "lint") return { exitCode: 0, stdout: lintReport(lint(readNotes())) };
      if (command === "unsaved" && Number(days) > 0) {
        const lists = await Promise.all([false, true].map((archived) => bb.sdk.threads.list({ archived, limit: 1000 })));
        const since = Date.now() - Number(days) * 86_400_000;
        return { exitCode: 0, stdout: unsavedReport(unsavedThreads(lists.flat(), readNotes(), since)) };
      }
      return { exitCode: 1, stderr: "Usage: bb wiki lint | bb wiki unsaved [days]\n" };
    },
  });

  bb.ui.registerMentionProvider({
    id: "note",
    label: "Wiki",
    search({ query }) {
      return matchNotes(listNotes(), query)
        .slice(0, 8)
        .map((note) => ({ id: note.slug, title: note.slug, subtitle: note.summary }));
    },
    resolve(slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Bad note id ${slug}`);
      const path = join(paths.notes, `${slug}.md`);
      return { context: `Wiki note [[${slug}]] (${path}):\n\n${readFileSync(path, "utf8").slice(0, 30_000)}` };
    },
  });

  bb.agents.registerTool({
    name: "wiki_search",
    description:
      "Search the user's wiki (personal Markdown notes) by keywords. BM25, so use words likely to appear in a note. Returns note slugs, one-line summaries and matching snippets.",
    instructions:
      "Use wiki_search before starting work that earlier notes might cover, and when the user asks what they know or wrote about something. In chat, cite notes as Markdown file links like [slug](/path/to/slug.md) so they are clickable. Inside notes, keep [[slug]].",
    presentation: { label: { pending: "Searching the wiki", completed: "Searched the wiki" } },
    parameters: z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    async execute({ query, limit }) {
      await sync().catch(() => {});
      const hits = await search(query, limit);
      if (hits.length === 0) return "No matching notes.";
      return hits
        .map((hit) => `${noteLink(hit.slug)} (${hit.score.toFixed(2)}): ${summary(hit.slug)}\n${hit.text.slice(0, 600)}`)
        .join("\n\n");
    },
  });

  bb.agents.registerTool({
    name: "wiki_save",
    description:
      "Write to the user's wiki. mode=create makes a new note; mode=update adds a dated update section to an existing note. Adds the date line and a link to this thread, commits the notes repo and reindexes search.",
    instructions:
      "When this thread learns something a future agent needs (hard-won reasoning, a rare recipe, a decision and why), save it with wiki_save without being asked. Search first and update the matching note instead of creating a parallel one. When the note summarizes a link the user pasted (Slack thread, gist, article), pass it as sourceUrl so the source stays traceable. Tell the user the slug.",
    presentation: { label: { pending: "Saving to the wiki", completed: "Saved to the wiki" } },
    parameters: z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case, no .md"),
      mode: z.enum(["create", "update"]),
      summary: z.string().max(300).optional().describe("One-line summary. Required for create."),
      body: z.string().min(1).describe("Markdown. For create, start with a # heading and end with ## Related notes."),
      sourceUrl: z.string().url().optional().describe("Link the note is based on, such as a Slack thread, gist or article."),
    }),
    async execute({ slug, mode, summary: line, body, sourceUrl }, { threadId }) {
      const path = join(paths.notes, `${slug}.md`);
      const source = (await threadLink(threadId)) + (sourceUrl ? `\nClipped from: <${sourceUrl}>` : "");
      if (mode === "create") {
        if (existsSync(path)) return { content: [{ type: "text", text: `[[${slug}]] exists. Use mode=update.` }], isError: true };
        if (!line) return { content: [{ type: "text", text: "summary is required for create." }], isError: true };
        writeFileSync(path, newNote(today(), line, source, body));
      } else {
        if (!existsSync(path)) return { content: [{ type: "text", text: `No note [[${slug}]]. Use mode=create.` }], isError: true };
        writeFileSync(path, withUpdate(readFileSync(path, "utf8"), today(), source, body));
      }
      await sync(`wiki: ${mode === "create" ? line : `update ${slug}`}`);
      return `Saved ${noteLink(slug)}.`;
    },
  });
}
