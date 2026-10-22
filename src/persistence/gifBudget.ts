// The GIF size budget, shared by the recorder (estimate, refuse up front) and
// the GIF worker (abort on real bytes). Kept tiny so the worker does not pull in record.ts.

/** Estimated GIF bytes per output pixel per frame: about 2x the 0.04-0.06 measured on real 1080p GIFs. */
export const GIF_BYTES_PER_PIXEL = 0.1
/** Largest estimated GIF the recorder will make. */
export const GIF_MAX_BYTES = 64 * 1024 * 1024
/** Absolute frame cap for a GIF (20 s at 30 fps), whatever the size. */
export const GIF_MAX_FRAMES = 600
/** The worker aborts once the real stream passes this (the estimate was far off). */
export const GIF_ABORT_BYTES = Math.round(1.5 * GIF_MAX_BYTES)
