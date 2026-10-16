import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { isStale, rebuild, search, summary } from "./notebook.ts";

export default async function plugin(bb: BbPluginApi) {
  let queue = Promise.resolve();
  const refresh = () => {
    queue = queue
      .then(async () => {
        if (isStale()) await rebuild();
      })
      .catch((error) => bb.log.error(`refresh failed: ${error}`));
    return queue;
  };

  void refresh();

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
      await refresh();
      const hits = await search(query, limit);
      if (hits.length === 0) return "No matching notes.";
      return hits
        .map((hit) => `[[${hit.slug}]] (${hit.score.toFixed(2)}): ${summary(hit.slug)}\n${hit.text.slice(0, 600)}`)
        .join("\n\n");
    },
  });
}
