/**
 * Every kind of transition the database takes (transitions.type): 'cut' (none) and every kind the
 * export draws. Copied as-is from the worker (chai-cut-backend src/lib/transitionKinds.ts, which
 * its start-up puts in the database's check, tested there against render.py). Keep the two the same:
 * a kind the editor offers that isn't here was saved as a plain dissolve (user, 2026-11-04).
 */
export const TRANSITION_KINDS = [
  'cut', 'fade', 'wipe', 'fadeblack', 'fadewhite', 'slideleft', 'slideup', 'zoomin', 'circleopen',
  'slideright', 'slidedown', 'smoothleft', 'hblur', 'radial', 'pixelize',
  'swipeup', 'velocity', 'zoomout', 'shake', 'glitch', 'flare', 'spin', 'warp',
] as const
