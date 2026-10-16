# bb-plugin-conclave

Connects BB threads to the conclave notebook in `~/Documents/Notes/conclave`.

- `conclave_search` and `conclave_save` agent tools. Save adds the date line and a link back to the thread.
- On a thread's first message, the agent gets up to three notes that may relate to it.
- When a thread goes idle, changed notes are committed (`conclave: ...`) and the search index is rebuilt.

The index lives in its own file, `~/.local/share/mempalace/conclave.db`, rebuilt from scratch on change. `mempalace mine` never drops the old chunks of an edited note, so mining into the shared `palace.db` piles up duplicates.

```sh
bb plugin install git:https://github.com/himynameisjonas/bb-plugin-conclave.git
npm test
```

## Settings

Change them under Settings → Installed plugins → Conclave, or with `bb plugin config conclave set <key> <value>`. Run `bb plugin reload conclave` afterwards.

| Key | Default | What |
|---|---|---|
| `notes` | `~/Documents/Notes/conclave` | Folder with the Markdown notes. It can be a git repo root or a folder inside one. Without git, the plugin still indexes but doesn't commit. |
| `mempalace` | `~/.local/bin/mempalace` | The [mempalace](https://github.com/bunkerlab-net/mempalace) binary, used for search. |
| `palace` | `~/.local/share/mempalace/conclave.db` | Search index file. The plugin rebuilds it from scratch when notes change. |

The notes must be on the same machine as the BB server.
