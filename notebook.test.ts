import assert from "node:assert/strict";
import { test } from "node:test";
import { newNote, parseHits, relatedNotes, withUpdate } from "./notebook.ts";

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
    "Notes in the user's conclave notebook (~/Documents/Notes/conclave) that may relate to this thread. Read the ones that fit before you start, and ignore the rest:\n- [[n0]]: about n0\n- [[n1]]: about n1\n- [[n2]]: about n2",
  );
  assert.equal(relatedNotes([{ slug: "weak", score: 1.5, text: "" }], () => ""), null);
});
