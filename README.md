# bb-plugin-wiki

A BB plugin that gives your agents a personal wiki. The wiki is a folder of Markdown notes. Agents search it, cite it in chat and write to it, and the plugin keeps it committed and indexed.

## What it does

For agents:

- **`wiki_search` tool.** Keyword search over the notes. It returns each note's slug, its one-line summary and a matching snippet.
- **`wiki_save` tool.** `mode=create` writes a new note. `mode=update` adds a dated `## Update` section above `## Related notes`. Both add the date line and a link back to the thread. An optional `sourceUrl` records the link the note is based on.
- **Related notes on the first message.** The plugin searches with a thread's first message and gives the agent up to three notes that may fit.
- **The `wiki` skill.** It ships with the plugin and tells agents when to search, when to save and how to cite notes.

In the app:

- **Clickable citations.** Agents cite notes as Markdown links to the note file, so a click opens the note in the side panel. Hover a citation to see the note's summary and first section.
- **`@` mentions.** Type `@` and pick a note under "Wiki". The agent gets the whole note as context.
- **"Wiki" thread panel.** It lists the notes that link to the thread, notes that may be related, and lint counts for the whole wiki.
- **Save to wiki and archive.** A button in the thread header. It asks the agent to save what's worth keeping, then archives the thread when the agent is done.

In the background:

- **Sync.** At startup, after a settings change, when a thread goes idle, and before each search or save, the plugin writes the index note, commits changed notes (`wiki: ...`) and rebuilds the search index if it's out of date.
- **Index note.** `wiki.md` lists every note with its summary, grouped by the first part of the slug.

From the command line:

- `bb wiki lint` lists orphan notes, broken `[[links]]` and notes without `## Related notes`.
- `bb wiki unsaved [days]` lists threads from the last days (default 7) that no note links to.

## Before you install

- **BB 0.44 or later.** The notes must be on the same machine as the BB server.
- **A folder of Markdown notes.** Only `.md` files directly in the folder count. Subfolders, such as Obsidian's `daily/`, are skipped.
- **git (optional).** If the folder is a git repo, or inside one, the plugin commits changes. Without git it still works, but doesn't commit.
- **[mempalace](https://github.com/bunkerlab-net/mempalace) (optional).** Used for search if installed. Without it the plugin uses its own word search.

## Install

```sh
bb plugin install git:https://github.com/himynameisjonas/bb-plugin-wiki.git
```

Then set `notes` to your notes folder (see below).

## Settings

Change them under Settings → Installed plugins → Wiki, or with `bb plugin config wiki set <key> <value>`.

| Key | Default | What |
|---|---|---|
| `notes` | `~/Documents/Notes/wiki` | Folder with the Markdown notes. |
| `mempalace` | `~/.local/bin/mempalace` | Path to the mempalace binary. If it's missing, the plugin uses its own word search. |
| `palace` | `~/.local/share/mempalace/wiki.db` | Search index file for mempalace. The plugin rebuilds it from the notes. |
| `index` | `wiki` | Name of the index note, without `.md`. The plugin deletes the old file when you change the name. Leave it empty to turn the index off. |
| `dateStyle` | `obsidian-daily` | Date line on new notes and updates: `obsidian-daily` (`[[daily/YYYY-MM-DD\|YYYY-MM-DD]]`), `plain`, or `none`. |

## How search works

Both search engines use BM25, so a query matches whole words that appear in a note.

With mempalace, the plugin keeps its own index file (`palace`) and rebuilds it from scratch when a note is newer than the index. A rebuild takes about three seconds. It doesn't use the shared `palace.db`, because `mempalace mine` never drops the old chunks of an edited note, so that file fills up with duplicates.

Without mempalace, the plugin reads every note on each search and ranks them itself.

The related-notes hints are kept in memory. After a BB server restart, threads that were already running get no hint, and the panel searches with the thread title instead.

## Development

```sh
npm install
npm test
npm run typecheck
bb plugin install ~/code/bb-plugin-wiki   # install from your checkout
bb plugin dev                              # rebuild and reload on every change
```

The server side is `server.ts` (BB wiring) and `notebook.ts` (notes, search, git). The UI is `app.tsx`. The skill is in `skills/wiki/SKILL.md`.
