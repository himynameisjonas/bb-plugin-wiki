import {
  definePluginApp,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  UrlLink,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { ThreadNotes, rpcContract } from "./server.ts";

type Note = ThreadNotes["linked"][number];

function NoteList({ title, empty, notes, data }: { title: string; empty: string; notes: Note[]; data: ThreadNotes }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const path = `${data.notesDir}/${note.slug}.md`;
            return (
              <li key={note.slug} className="space-y-0.5">
                <div className="text-sm font-medium">
                  {data.hostId ? <FileLink target={{ kind: "host", hostId: data.hostId, path }}>{note.slug}</FileLink> : note.slug}
                </div>
                {note.summary && <p className="text-sm text-muted-foreground">{note.summary}</p>}
                <UrlLink href={`obsidian://open?path=${encodeURIComponent(path)}`} className="text-xs underline">
                  Open in Obsidian
                </UrlLink>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConclavePanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<ThreadNotes | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("thread_notes", { threadId }).then(setData, (cause: unknown) => setError(String(cause)));
  }, [rpc, threadId]);

  if (error) return <p className="text-sm text-destructive">Could not load notes: {error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading notes…</p>;
  return (
    <div className="space-y-6">
      <NoteList title="Written in this thread" empty="No note links to this thread yet." notes={data.linked} data={data} />
      <NoteList title="May be related" empty="No related notes found." notes={data.related} data={data} />
    </div>
  );
}

function SaveAndArchiveButton({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  const label =
    state === "sent"
      ? "Saving to conclave. The thread archives when the agent is done."
      : state === "failed"
        ? "Could not start the wrap-up. Try again."
        : "Save to conclave and archive";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={state === "sent"}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
      onClick={() => {
        setState("sent");
        rpc.call("save_and_archive", { threadId }).catch(() => setState("failed"));
      }}
    >
      <Icon name="conclave/icon" fallback="Archive" aria-hidden className="size-4" />
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({ id: "notes", title: "Conclave notes", component: ConclavePanel });
  app.slots.experimental_threadHeaderAction({
    id: "save-and-archive",
    title: "Save to conclave and archive",
    component: SaveAndArchiveButton,
  });
});
