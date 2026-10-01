// SPDX-License-Identifier: AGPL-3.0-only
import type { LyricLine } from '../../core/lyric/parser'
import type { LyricLine as RenderLine } from '@applemusic-like-lyrics/core'
import { validWordLine } from '../../core/lyric/accuracy'

export interface PlaybackState {
  position: number
  duration: number
  playing: boolean
  active: boolean
  seek?: boolean
}

/** Only real word timings are sent to AMLL. A zero-duration fallback atom
 * selects line highlighting in our build adapter; no estimated word span. */
export function toRenderLines(lines: LyricLine[], duration = 0): RenderLine[] {
  return lines.filter(line => Number.isFinite(line.time) && line.time >= 0 && line.text.trim())
    .map((line, index, valid) => {
      const next = valid[index + 1]?.time
      const timed = validWordLine(line, duration)
      const end = Math.max(line.time, (timed ? line.endTime : undefined) ?? next ?? (duration > line.time ? duration : line.time + 5000))
      const words = timed ? line.words : undefined
      return {
        startTime: line.time, endTime: end,
        words: words?.length === line.words?.length && words?.length
          ? words.map(word => ({ word: word.text, startTime: word.startTime, endTime: word.endTime }))
          : [{ word: line.text, startTime: line.time, endTime: line.time }],
        translatedLyric: line.translation || '', romanLyric: line.romanLyric || '', isBG: !!line.isBG, isDuet: !!line.isDuet,
      }
    })
}

/** Double JSON encoding keeps lyric text out of executable JavaScript. */
export function bridgeScript(message: unknown): string {
  const encoded = JSON.stringify(JSON.stringify(message)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `window.receiveLyrics(JSON.parse(${encoded}));true;`
}

/** Interpolate the native 250 ms updates, without advancing through a stall. */
export class PlaybackClock {
  private state: PlaybackState = { position: 0, duration: 0, playing: false, active: false }
  private anchor = 0
  private pendingSeek?: { position: number; until: number }

  sync(state: PlaybackState, now: number): boolean {
    const previous = this.time(now)
    if (state.seek) this.pendingSeek = { position: state.position, until: now + 1200 }
    else if (this.pendingSeek) {
      if (Math.abs(state.position - this.pendingSeek.position) < 750 || now >= this.pendingSeek.until) this.pendingSeek = undefined
      else state = { ...state, position: this.time(now) }
    }
    this.state = { ...state, position: Math.max(0, state.position) }
    this.anchor = now
    return !!state.seek || Math.abs(previous - state.position) > 750
  }

  time(now: number): number {
    const elapsed = this.state.playing && this.state.active ? Math.min(1000, Math.max(0, now - this.anchor)) : 0
    const position = this.state.position + elapsed
    return this.state.duration > 0 ? Math.min(this.state.duration, position) : position
  }
}
