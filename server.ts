import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOTES, commit, isStale, newNote, rebuild, search, summary, today, withUpdate } from "./notebook.ts";

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

  const threadLink = async (threadId: string, projectId: string) => {
    const thread = await bb.sdk.threads.get({ threadId });
    const base = bb.server.experimental_appUrl ?? bb.server.loopbackBaseUrl;
    const label = (thread.title ?? thread.titleFallback ?? threadId).replace(/[[\]]/g, "");
    return `[${label}](${base}/projects/${projectId}/threads/${threadId})`;
  };

  sync().catch(() => {});
  bb.events.on("thread.idle", () => sync().catch(() => {}));

  bb.agents.registerTool({
    name: "conclave_search",
    description:
      "Search the user's conclave notebook (personal notes in ~/Documents/Notes/conclave) by keywords. BM25, so use words likely to appear in a note. Returns note slugs, one-line summaries and matching snippets.",
    instructions:
      "Use conclave_search before starting work that earlier notes might cover, and when the user asks what they know or wrote about something. Cite notes as [[slug]].",
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
        .map((hit) => `[[${hit.slug}]] (${hit.score.toFixed(2)}): ${summary(hit.slug)}\n${hit.text.slice(0, 600)}`)
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
    async execute({ slug, mode, summary: line, body }, { threadId, projectId }) {
      const path = join(NOTES, `${slug}.md`);
      const source = await threadLink(threadId, projectId);
      if (mode === "create") {
        if (existsSync(path)) return { content: [{ type: "text", text: `[[${slug}]] exists. Use mode=update.` }], isError: true };
        if (!line) return { content: [{ type: "text", text: "summary is required for create." }], isError: true };
        writeFileSync(path, newNote(today(), line, source, body));
      } else {
        if (!existsSync(path)) return { content: [{ type: "text", text: `No note [[${slug}]]. Use mode=create.` }], isError: true };
        writeFileSync(path, withUpdate(readFileSync(path, "utf8"), today(), source, body));
      }
      await sync(`conclave: ${mode === "create" ? line : `update ${slug}`}`);
      return `Saved [[${slug}]] (${path}). Committed and reindexed.`;
    },
  });
}
