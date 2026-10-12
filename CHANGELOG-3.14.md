# Sonance 3.14

Install **one** package: `Sonance3.wgt` (square icon) or `Sonance3-Oblong.wgt` (wide home-row tile). Settings → About reads **V3.14**.

3.14 fixes two things you reported from the TV.

## Fixed

- **Long lyric lines are no longer cut off.** With lyrics open on Now Playing, a line longer than the panel now wraps onto further rows at whole words (no hyphens), at every interface size, and shows in full: nothing is cut at the right edge, and at 175 % and 200 % the lyrics no longer run under the controls on the left. When the song reaches a wrapped line, all of its rows light up together. The amount of wrapping follows the interface size you choose in Settings. A single word too long for a row is the one thing that breaks mid-word, rather than being cut. A line so long that it is taller than the lyrics panel (only at the largest sizes) shows its first rows highlighted, with the rest below.
- **Holding OK opens the menu on the Samsung silver remote.** On the simple remote without coloured buttons, holding OK on a song started playing it instead of opening the options menu. Holding OK now opens the menu after about half a second on that remote too, as it does on the remote with coloured buttons. A short press still plays the song.
- At 175 % and 200 %, the credits panel (ⓘ on Now Playing) also no longer runs under the controls.

## For developers

- **A key trace in the Performance overlay.** With Settings → Advanced → Performance overlay on, a panel under the readout lists the last 12 key events, newest last: down or up, the key code, the key name, the repeat flag and the milliseconds since the previous event. It shows what a remote sends while OK is held, so a photo of the TV can settle a remote that still misbehaves. With the overlay off nothing is attached, as before.
- **Hold OK, in `js/focus.js`:** a keyup on a long-press zone is provisional: an OK keydown within 100 ms (`RELEASE_GRACE_MS`) continues the hold, so a short press there now activates 100 ms after its keyup. Once an OK keyup has been seen since launch, a key still down at 500 ms opens the sheet with or without auto-repeats. After a hold opens the sheet, OK is swallowed until the key is really released.
- **Lyrics:** synced lines are laid out at `calc(100% / 1.15)` with `overflow-wrap: break-word`, the lyrics and credits panels clear the left column above about 164 %, and the scroller reads the active line's real height and keeps it out of the top fade.
- **Fixtures and specs:** `?mockLyricsLong=1` (long synced lines, or unsynced with `mockLyricsUnsynced=1`, on both mock backends); `e2e/lyrics-wrap.spec.ts`, `e2e/hold-ok-sequences.spec.ts` and `e2e/perf-hud-keys.spec.ts`. The suite has 386 tests.
