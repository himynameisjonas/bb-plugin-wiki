import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstSection, format, indexContent, writeIndex, lint, lintReport, unsavedThreads, matchNotes, rankNotes, shorten, newNote, noteLink, parseHits, paths, relatedNotes, withUpdate, wrapUpMessage } from "./notebook.ts";

const output = `
============================================================
  Results for: "pippi disk"
============================================================

  [1] wiki / general
      Source: pippi-sandbox-disk-usage.md
      Match:  bm25=4.7175

      Disk fills up on sandbox-1.

  --------------------------------------------------------
  [2] wiki / general
      Source: pippi-sandbox-disk-usage.md
      Match:  bm25=3.1000

      Same note, other chunk.

  --------------------------------------------------------
  [3] wiki / general
      Source: pippi-health-log.md
      Match:  bm25=2.1988

      One line per box per day.

  --------------------------------------------------------
`;

test("parseHits keeps the best chunk per note", () => {
  assert.deepEqual(parseHits(output), [
    { slug: "pippi-sandbox-disk-usage", score: 4.7175, text: "Disk fills up on sandbox-1." },
    { slug: "pippi-health-log", score: 2.1988, text: "One line per box per day." },
  ]);
});

test("newNote puts the date line and source first", () => {
  assert.equal(
    newNote("2026-10-16", "Why X.", "[t](u)", "# X\n\nBody\n"),
    "_[[daily/2026-10-16|2026-10-16]]_. Why X.\n\nSource: [t](u)\n\n# X\n\nBody\n",
  );
});

test("withUpdate goes before Related notes", () => {
  const note = "Intro\n\n## Related notes\n\n- [[a]]\n";
  assert.equal(
    withUpdate(note, "2026-10-16", "[t](u)", "New fact."),
    "Intro\n\n## Update [[daily/2026-10-16|2026-10-16]]\n\nSource: [t](u)\n\nNew fact.\n\n## Related notes\n\n- [[a]]\n",
  );
});

test("withUpdate appends when there is no Related notes", () => {
  assert.equal(
    withUpdate("Intro\n", "2026-10-16", "[t](u)", "New fact."),
    "Intro\n\n## Update [[daily/2026-10-16|2026-10-16]]\n\nSource: [t](u)\n\nNew fact.\n",
  );
});

test("relatedNotes keeps up to three notes close to the top score", () => {
  const hits = [6, 5, 4, 3.9, 1].map((score, index) => ({ slug: `n${index}`, score, text: "" }));
  assert.equal(
    relatedNotes(hits, (slug) => `about ${slug}`),
    `Notes in the user's wiki (${paths.notes}) that may relate to this thread. Read the ones that fit before you start, and ignore the rest:\n- ${noteLink("n0")}: about n0\n- ${noteLink("n1")}: about n1\n- ${noteLink("n2")}: about n2`,
  );
  assert.equal(relatedNotes([{ slug: "weak", score: 1.5, text: "" }], () => ""), null);
});

test("matchNotes needs every word in the slug or summary", () => {
  const notes = [
    { slug: "trainz", summary: "The living note for Trainz" },
    { slug: "pippi-health-log", summary: "Pippi sandbox health log" },
  ];
  assert.deepEqual(matchNotes(notes, "pip log").map((note) => note.slug), ["pippi-health-log"]);
  assert.deepEqual(matchNotes(notes, "").length, 2);
});

test("wrapUpMessage lists existing notes before related ones", () => {
  const message = wrapUpMessage("Lead.", ["mine"], ["near"]);
  assert.ok(message.startsWith("Lead.\n\nNotes this thread already wrote."));
  assert.ok(message.indexOf(noteLink("mine")) < message.indexOf(noteLink("near")));
  assert.equal(wrapUpMessage("Lead.", [], []), "Lead.");
});

test("indexContent groups notes by slug prefix, singletons under Other", () => {
  const index = indexContent([
    { slug: "trainz", summary: "The train game" },
    { slug: "pippi-b", summary: "" },
    { slug: "aws-ses", summary: "" },
    { slug: "pippi-a", summary: "First" },
  ]);
  assert.ok(index.startsWith("# Index\n\n"));
  assert.ok(index.endsWith("## pippi\n\n- [[pippi-a]]: First\n- [[pippi-b]]\n\n## Other\n\n- [[aws-ses]]\n- [[trainz]]: The train game\n"));
});

test("shorten cuts at a word and adds an ellipsis", () => {
  assert.equal(shorten("short", 10), "short");
  assert.equal(shorten("part of the Turbo foundation work", 20), "part of the Turbo…");
});

test("the date line follows the date style", () => {
  try {
    format.dateStyle = "plain";
    assert.ok(newNote("2026-10-16", "Why X.", "s", "b").startsWith("_2026-10-16_. Why X.\n"));
    assert.ok(withUpdate("Intro\n", "2026-10-16", "s", "b").includes("## Update 2026-10-16\n"));
    format.dateStyle = "none";
    assert.ok(newNote("2026-10-16", "Why X.", "s", "b").startsWith("Why X.\n"));
    assert.ok(withUpdate("Intro\n", "2026-10-16", "s", "b").includes("## Update\n"));
  } finally {
    format.dateStyle = "obsidian-daily";
  }
});

test("rankNotes ranks the note that matches the query best first", () => {
  const docs = [
    { slug: "kafka-rebalancing", text: "Consumer group rebalancing.\nStatic membership avoids rebalances on deploys." },
    { slug: "trainz", text: "A train game with tracks and stations." },
    { slug: "deploy-notes", text: "How we deploy the monolith." },
  ];
  const hits = rankNotes(docs, "kafka static membership", 5);
  assert.equal(hits[0].slug, "kafka-rebalancing");
  assert.equal(hits[0].text, "Static membership avoids rebalances on deploys.");
  assert.ok(!hits.some((hit) => hit.slug === "trainz"));
  assert.deepEqual(rankNotes(docs, "nothing here matches", 5), []);
});

test("lint finds orphans, broken links and notes without Related notes", () => {
  const docs = [
    { slug: "a", text: "See [[b|the b note]] and [[daily/2026-10-16|2026-10-16]].\n\n## Related notes\n\n- [[a]]\n" },
    { slug: "b", text: "Links to [[gone]]. Code: `[[not-a-link]]`\n\n```\n[[also-not]]\n```\n" },
  ];
  assert.deepEqual(lint(docs), { orphans: ["a"], broken: [{ slug: "b", target: "gone" }], noRelated: ["b"] });
  assert.ok(lintReport(lint(docs)).startsWith("Orphans (no other note links to them): 1\n- [[a]]\n"));
});

test("unsavedThreads keeps recent threads no note links to", () => {
  const row = (id: string, createdAt: number, originPluginId: string | null = null) => ({ id, title: id, createdAt, originPluginId });
  const threads = [row("thr_old", 1), row("thr_saved", 10), row("thr_auto", 10, "automations"), row("thr_a", 10), row("thr_b", 20)];
  const docs = [{ text: "Source: [x](http://host/threads/thr_saved)" }];
  assert.deepEqual(unsavedThreads(threads, docs, 5).map((thread) => thread.id), ["thr_b", "thr_a"]);
});

test("firstSection takes the text between the title and the first ## heading", () => {
  const note = "_2026-10-17_. Summary\n\nSource: [x](y)\n\n# Title\n\nFirst part.\n\nSecond part.\n\n## Details\n\nNot this.\n";
  assert.equal(firstSection(note), "First part.\n\nSecond part.");
  assert.equal(firstSection("Summary only\n\nBody text\n"), "Body text");
});

test("writeIndex writes under the configured name and deletes the old index", () => {
  const saved = { ...paths };
  paths.notes = mkdtempSync(join(tmpdir(), "wiki-"));
  paths.index = "wiki";
  writeFileSync(join(paths.notes, "index.md"), "# Index\n\nEvery note. The BB wiki plugin writes this file, so don't edit it.\n");
  writeFileSync(join(paths.notes, "keep.md"), "# Index\n\nMy own index, keep it.\n");
  try {
    assert.equal(writeIndex(), true);
    assert.equal(existsSync(join(paths.notes, "index.md")), false);
    const index = readFileSync(join(paths.notes, "wiki.md"), "utf8");
    assert.ok(index.includes("[[keep]]") && !index.includes("[[index]]") && !index.includes("[[wiki]]"));
  } finally {
    Object.assign(paths, saved);
  }
});
