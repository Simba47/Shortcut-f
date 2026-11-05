/**
 * A part's edge dragged on the timeline (EditorShell trimByEdge): what the drag does, from where the
 * edge was and where it is now, and the clip as the drag found it (`at`). Every step of one drag
 * decides from the same `at` — the clip's length when it began, not the last step's — so a drag at
 * the clip's end keeps growing it instead of flipping to "nothing was cut here" (user, 2026-11-04).
 *  - 'cut': inwards — the stretch passed over is cut out
 *  - 'pieces': outwards in a clip of pieces — video it skipped there comes back
 *  - 'clipStart' / 'clipEnd': outwards at the clip's own start / end — more of the video
 *  - 'join': outwards between two parts — video cut at that join comes back
 */
export type EdgeDragPath = 'cut' | 'pieces' | 'clipStart' | 'clipEnd' | 'join'

export function edgeDragPath(edge: 'start' | 'end', from: number, to: number, at: { len: number; pieces: boolean }): EdgeDragPath {
  if (edge === 'start' ? to > from : to < from) return 'cut'
  if (at.pieces) return 'pieces'
  if (edge === 'start' && from <= 1) return 'clipStart'
  if (edge === 'end' && from >= at.len - 1) return 'clipEnd'
  return 'join'
}
