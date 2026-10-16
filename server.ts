import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTES,
  noteLink,
  type Hit,
  commit,
  isStale,
  listNotes,
  matchNotes,
  newNote,
  notesLinking,
  pickRelated,
  rebuild,
  relatedNotes,
  search,
  summary,
  today,
  withUpdate,
} from "./notebook.ts";

const noteSchema = z.object({ slug: z.string(), summary: z.string() });
const threadNotesSchema = z.object({
  hostId: z.string().nullable(),
  notesDir: z.string(),
  linked: z.array(noteSchema),
  related: z.array(noteSchema),
});
export type ThreadNotes = z.infer<typeof threadNotesSchema>;

export const rpcContract = defineRpcContract({
  thread_notes: { input: z.object({ threadId: z.string() }), output: threadNotesSchema },
});

export default async function plugin(bb: BbPluginApi) {
  let queue = Promise.resolve();
  const sync = (message?: string) => {
    const job = queue.then(async () => {
      await commit(message);
      if (isStale()) await rebuild();
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
  bb.events.on("thread.idle", () => sync().catch(() => {}));

  // ponytail: in memory, so a server restart loses hints for threads already running
  const related = new Map<string, Hit[]>();
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
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
  bb.agents.contributeInstructions(({ threadId }) => relatedNotes(related.get(threadId) ?? [], summary));

  bb.rpc.register(rpcContract, {
    async thread_notes({ threadId }) {
      const linked = notesLinking(threadId);
      let hits = related.get(threadId);
      if (!hits?.length) {
        const thread = await bb.sdk.threads.get({ threadId });
        const title = thread.title ?? thread.titleFallback;
        hits = title ? await search(title, 8) : [];
      }
      const note = (slug: string) => ({ slug, summary: summary(slug) });
      return {
        hostId: (await bb.sdk.system.config()).primaryHostId,
        notesDir: NOTES,
        linked: linked.map(note),
        related: pickRelated(hits).filter((hit) => !linked.includes(hit.slug)).map((hit) => note(hit.slug)),
      };
    },
  });
  bb.events.on("thread.archived", ({ thread }) => void related.delete(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => void related.delete(thread.id));

  bb.ui.registerMentionProvider({
    id: "note",
    label: "Conclave",
    search({ query }) {
      return matchNotes(listNotes(), query)
        .slice(0, 8)
        .map((note) => ({ id: note.slug, title: note.slug, subtitle: note.summary }));
    },
    resolve(slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Bad note id ${slug}`);
      const path = join(NOTES, `${slug}.md`);
      return { context: `Conclave note [[${slug}]] (${path}):\n\n${readFileSync(path, "utf8").slice(0, 30_000)}` };
    },
  });

  bb.agents.registerTool({
    name: "conclave_search",
    description:
      "Search the user's conclave notebook (personal notes in ~/Documents/Notes/conclave) by keywords. BM25, so use words likely to appear in a note. Returns note slugs, one-line summaries and matching snippets.",
    instructions:
      "Use conclave_search before starting work that earlier notes might cover, and when the user asks what they know or wrote about something. In chat, cite notes as Markdown file links like [slug](/path/to/slug.md) so they are clickable. Inside notes, keep [[slug]].",
    presentation: { label: { pending: "Searching conclave", completed: "Searched conclave" } },
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
    name: "conclave_save",
    description:
      "Write to the user's conclave notebook. mode=create makes a new note; mode=update adds a dated update section to an existing note. Adds the date line and a link to this thread, commits the notes repo and reindexes search.",
    instructions:
      "When this thread learns something a future agent needs (hard-won reasoning, a rare recipe, a decision and why), save it with conclave_save without being asked. Search first and update the matching note instead of creating a parallel one. Tell the user the slug.",
    presentation: { label: { pending: "Saving to conclave", completed: "Saved to conclave" } },
    parameters: z.object({
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case, no .md"),
      mode: z.enum(["create", "update"]),
      summary: z.string().max(300).optional().describe("One-line summary. Required for create."),
      body: z.string().min(1).describe("Markdown. For create, start with a # heading and end with ## Related notes."),
    }),
    async execute({ slug, mode, summary: line, body }, { threadId }) {
      const path = join(NOTES, `${slug}.md`);
      const source = await threadLink(threadId);
      if (mode === "create") {
        if (existsSync(path)) return { content: [{ type: "text", text: `[[${slug}]] exists. Use mode=update.` }], isError: true };
        if (!line) return { content: [{ type: "text", text: "summary is required for create." }], isError: true };
        writeFileSync(path, newNote(today(), line, source, body));
      } else {
        if (!existsSync(path)) return { content: [{ type: "text", text: `No note [[${slug}]]. Use mode=create.` }], isError: true };
        writeFileSync(path, withUpdate(readFileSync(path, "utf8"), today(), source, body));
      }
      await sync(`conclave: ${mode === "create" ? line : `update ${slug}`}`);
      return `Saved ${noteLink(slug)}. Committed and reindexed.`;
    },
  });
}
