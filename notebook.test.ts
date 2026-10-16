import assert from "node:assert/strict";
import { test } from "node:test";
import { format, indexContent, matchNotes, rankNotes, shorten, newNote, noteLink, parseHits, paths, relatedNotes, withUpdate, wrapUpMessage } from "./notebook.ts";

const output = `
============================================================
  Results for: "pippi disk"
============================================================

  [1] conclave / general
      Source: pippi-sandbox-disk-usage.md
      Match:  bm25=4.7175

      Disk fills up on sandbox-1.

  --------------------------------------------------------
  [2] conclave / general
      Source: pippi-sandbox-disk-usage.md
      Match:  bm25=3.1000

      Same note, other chunk.

  --------------------------------------------------------
  [3] conclave / general
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
    `Notes in the user's conclave notebook (${paths.notes}) that may relate to this thread. Read the ones that fit before you start, and ignore the rest:\n- ${noteLink("n0")}: about n0\n- ${noteLink("n1")}: about n1\n- ${noteLink("n2")}: about n2`,
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

test("indexContent lists notes alphabetically with summaries", () => {
  const index = indexContent([
    { slug: "trainz", summary: "The train game" },
    { slug: "aws-ses", summary: "" },
  ]);
  assert.ok(index.startsWith("# Index\n\n"));
  assert.ok(index.endsWith("- [[aws-ses]]\n- [[trainz]]: The train game\n"));
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
