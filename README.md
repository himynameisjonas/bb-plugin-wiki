# bb-plugin-wiki

Connects BB threads to the wiki in `~/Documents/Notes/wiki`.

- `wiki_search` and `wiki_save` agent tools. Save adds the date line and a link back to the thread.
- On a thread's first message, the agent gets up to three notes that may relate to it.
- When a thread goes idle, changed notes are committed (`wiki: ...`) and the search index is rebuilt.
- `bb wiki lint` lists orphan notes, broken `[[links]]` and notes without `## Related notes`. The notes panel shows the counts.
- `bb wiki unsaved [days]` lists threads from the last days (default 7) that no note links to.

The index lives in its own file, `~/.local/share/mempalace/wiki.db`, rebuilt from scratch on change. `mempalace mine` never drops the old chunks of an edited note, so mining into the shared `palace.db` piles up duplicates.

```sh
bb plugin install git:https://github.com/himynameisjonas/bb-plugin-wiki.git
npm test
```

## Settings

Change them under Settings → Installed plugins → Wiki, or with `bb plugin config wiki set <key> <value>`. Run `bb plugin reload wiki` afterwards.

| Key | Default | What |
|---|---|---|
| `notes` | `~/Documents/Notes/wiki` | Folder with the Markdown notes. It can be a git repo root or a folder inside one. Without git, the plugin still indexes but doesn't commit. |
| `mempalace` | `~/.local/bin/mempalace` | The [mempalace](https://github.com/bunkerlab-net/mempalace) binary, used for search. Optional: without it the plugin uses a built-in word search (BM25 over whole notes). |
| `palace` | `~/.local/share/mempalace/wiki.db` | Search index file. The plugin rebuilds it from scratch when notes change. |
| `dateStyle` | `obsidian-daily` | Date line on new notes and updates: `obsidian-daily` (`[[daily/YYYY-MM-DD\|YYYY-MM-DD]]`), `plain`, or `none`. |

The notes must be on the same machine as the BB server.
