import { useState, type RefObject } from "react";
import { Popover } from "./Popover";

export const NOTES_MAX = 20_000;

/** Dropdown editor for a task's notes. Explicit Save (⌘/Ctrl+Enter also saves); Esc or a click outside discards. */
export function NotesDropdown({
  anchor,
  initial,
  onSave,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  initial: string | null;
  onSave(notes: string | null): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(initial ?? "");
  const dirty = draft !== (initial ?? "");
  const save = () => {
    const trimmed = draft.trim();
    onSave(trimmed === "" ? null : trimmed);
    onClose();
  };
  const btn = "rounded-md px-2.5 py-1 text-xs font-medium transition";

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="w-72 space-y-2">
        <textarea
          autoFocus
          value={draft}
          maxLength={NOTES_MAX}
          rows={6}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
          placeholder="Add notes: details, links, what “done” looks like…"
          aria-label="Notes"
          className="w-full resize-y rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-4 focus:ring-accent/20"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">⌘↵ to save</span>
          <div className="flex gap-1">
            <button onClick={onClose} className={`${btn} text-muted hover:bg-surface-2`}>Cancel</button>
            <button onClick={save} disabled={!dirty} className={`${btn} bg-accent text-accent-fg disabled:opacity-50`}>Save</button>
          </div>
        </div>
      </div>
    </Popover>
  );
}
