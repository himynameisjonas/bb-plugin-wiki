---
name: conclave-notebook
description: Search and write the user's conclave notebook (a folder of Markdown notes) with the conclave_search and conclave_save tools. Use when the user asks what they know or wrote about something, says "save to conclave", when starting work that earlier notes might cover, or when a thread has learned something a future agent needs.
---

# Conclave notebook

The conclave notebook is a folder of Markdown notes, one topic per note. The folder is set in the Conclave plugin settings. Tool results and the related-notes hint show its path.

## Read

1. Search with `conclave_search`. It is keyword search (BM25), so use words that are likely to appear in a note. Don't paraphrase.
2. Read the top two to four notes in full, not only the snippets.
3. Answer from the notes. Cite each claim with a Markdown file link to the note, for example `[trainz](/path/to/notes/trainz.md)`. BB makes these clickable. A bare `[[slug]]` in chat is plain text.

`index.md` in the notes folder lists every note with its one-line summary. Read it when you need an overview.

## Write

Save without being asked when the thread learned something durable. Tell the user which note you wrote.

1. Search first. If a note covers the topic, use `conclave_save` with `mode=update`, or edit the stale part of the file. Create a new note only for a new topic.
2. For a new note, use `mode=create` with a kebab-case slug of three to six words and no date in it. Give a one-line summary. Start the body with a `# Heading` and end it with a `## Related notes` list.
3. When the note summarizes a link the user pasted (a Slack thread, gist or article), pass it as `sourceUrl`. The note then keeps the source.
4. `conclave_save` adds the date line and a link to this thread, then commits and reindexes. If you edit a file directly, the plugin commits and reindexes when the thread goes idle.

Don't edit `index.md`. The plugin writes it.

## Links inside notes

- Link other notes with `[[slug]]`, the file name without `.md`. Use `[[slug|text]]` when the link sits inside a sentence.
- End each note with `## Related notes`: one `[[slug]]` per line, with a short hint at how they relate.

## What to write

- Reasoning that took a while to work out and would be expensive to redo.
- Rare recipes: debugging, deploys, recovery.
- Decisions and why: "we picked X over Y because Z".
- Patterns seen across several incidents.

Don't write what the codebase already says, or short-lived chat context and to-do lists.
