import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHits } from "./notebook.ts";

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
