/**
 * (Shown by the account menu's Keyboard shortcuts and the Guide page.)
 * Keys the editor understands, exactly as EditorShell's keydown handler does them (user, 2026-11-12: the list
 * said ←/→ moved a second and S trimmed; ←/→ move one frame and S splits). Grouped as they're used.
 * "Ctrl" shows as ⌘ on a Mac.
 */
export const SHORTCUT_GROUPS: { title: string; items: { keys: string[]; what: string }[] }[] = [
  { title: 'Play', items: [
    { keys: ['Space'], what: 'Play or pause' },
    { keys: ['←', '→'], what: 'One frame back or forward' },
    { keys: ['Shift', '← / →'], what: '5 seconds back or forward' },
    { keys: ['Hold ← / →'], what: 'Skip fast (faster the longer you hold)' },
  ] },
  { title: 'Edit', items: [
    { keys: ['S'], what: 'Split at the playhead' },
    { keys: ['['], what: 'Trim the selected part’s start to the playhead' },
    { keys: [']'], what: 'Trim the selected part’s end to the playhead' },
    { keys: ['Delete'], what: 'Delete what’s selected' },
    { keys: ['Ctrl', 'D'], what: 'Duplicate what’s selected' },
    { keys: ['Ctrl', 'C'], what: 'Copy what’s selected' },
    { keys: ['Ctrl', 'X'], what: 'Cut what’s selected' },
    { keys: ['Ctrl', 'V'], what: 'Paste at the playhead (into any clip)' },
    { keys: ['Ctrl', 'Alt', 'C'], what: 'Copy the selected text’s style' },
    { keys: ['Ctrl', 'Alt', 'V'], what: 'Paste that style on the selected texts' },
    { keys: ['Ctrl', 'G'], what: 'Group what’s selected' },
    { keys: ['Ctrl', 'Shift', 'G'], what: 'Ungroup' },
  ] },
  { title: 'Undo', items: [
    { keys: ['Ctrl', 'Z'], what: 'Undo' },
    { keys: ['Ctrl', 'Shift', 'Z'], what: 'Redo (or Ctrl + Y)' },
    { keys: ['?'], what: 'Show these shortcuts' },
    { keys: ['Esc'], what: 'Close a menu or dialog' },
  ] },
]
