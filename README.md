# bb-plugin-conclave

Connects BB threads to the conclave notebook in `~/Documents/Notes/conclave`.

- `conclave_search` and `conclave_save` agent tools. Save adds the date line and a link back to the thread.
- On a thread's first message, the agent gets up to three notes that may relate to it.
- When a thread goes idle, changed notes are committed (`conclave: ...`) and the search index is rebuilt.

The index lives in its own file, `~/.local/share/mempalace/conclave.db`, rebuilt from scratch on change. `mempalace mine` never drops the old chunks of an edited note, so mining into the shared `palace.db` piles up duplicates.

```sh
bb plugin install ~/code/bb-plugin-conclave
npm test
```
