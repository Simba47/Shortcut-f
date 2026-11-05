import { insidePicture, WHOLE_FRAME, type PictureBox } from './pictureBox'

// The open clip's video: its picture inside any black bars (lib pictureBox.ts; the worker finds it once
// and keeps it on the video). Set when the editor opens a clip; every view the editor makes by itself —
// a format's starting views, Follow, Auto format — keeps inside it. A view moved by hand goes where the
// user puts it.

let current: PictureBox = WHOLE_FRAME

export function setFramePicture(p: PictureBox) { current = p }
export const framePicture = () => current
/** A view kept inside the open clip's picture (the same view when the video has no bars) */
export const inFramePicture = <B extends PictureBox>(b: B): B => insidePicture(b, current)
