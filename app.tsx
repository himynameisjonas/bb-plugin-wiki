import {
  definePluginApp,
  experimental_FileLink as FileLink,
  experimental_Icon as Icon,
  UrlLink,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import type { NotePreview, ThreadNotes, rpcContract } from "./server.ts";

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

function WikiPanel({ threadId }: { threadId: string }) {
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
      <p className="text-xs text-muted-foreground">
        Notebook: {data.lint.orphans} orphan notes, {data.lint.broken} broken links, {data.lint.noRelated} notes without Related
        notes. Run <code>bb wiki lint</code> for the lists.
      </p>
    </div>
  );
}

function SaveAndArchiveButton({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  const label =
    state === "sent"
      ? "Saving to the wiki. The thread archives when the agent is done."
      : state === "failed"
        ? "Could not start the wrap-up. Try again."
        : "Save to wiki and archive";

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
      <Icon name="wiki/icon" fallback="Archive" aria-hidden className="size-4" />
    </button>
  );
}

// Chat renders note citations as file:// links. Hovering one shows the note's summary and first section.
function NotePreviewOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const [card, setCard] = useState<{ preview: NonNullable<NotePreview>; rect: DOMRect } | null>(null);

  useEffect(() => {
    let current: HTMLAnchorElement | null = null;
    const onOver = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>('[data-markdown-preview] a[href^="file:"][href$=".md"]') ?? null;
      if (link === current) return;
      current = link;
      setCard(null);
      if (!link) return;
      rpc.call("note_preview", { path: decodeURIComponent(new URL(link.href).pathname) }).then(
        (preview) => current === link && preview && setCard({ preview, rect: link.getBoundingClientRect() }),
        () => {},
      );
    };
    document.addEventListener("pointerover", onOver);
    return () => document.removeEventListener("pointerover", onOver);
  }, [rpc]);

  if (!card) return null;
  const { preview, rect } = card;
  const below = rect.bottom + 280 < window.innerHeight;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-96 space-y-1 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
      style={{
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 392)),
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      }}
    >
      <div className="text-sm font-medium">{preview.slug}</div>
      {preview.summary && <p className="text-sm text-muted-foreground">{preview.summary}</p>}
      {preview.body && <p className="line-clamp-6 whitespace-pre-line text-xs text-muted-foreground">{preview.body}</p>}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "note-preview", component: NotePreviewOverlay });
  app.slots.threadPanelAction({ id: "notes", title: "Wiki", component: WikiPanel });
  app.slots.experimental_threadHeaderAction({
    id: "save-and-archive",
    title: "Save to wiki and archive",
    component: SaveAndArchiveButton,
  });
});
