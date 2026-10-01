// SPDX-License-Identifier: AGPL-3.0-only
import type { Track } from '../../types/music'
import type { LyricLine } from './parser'

/** Keep version labels (live/remix/cover) when comparing catalogue metadata. */
export const normalizeIdentity = (text: string) => String(text || '').normalize('NFKC')
  .toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
const credit = /^(作词|作曲|词曲|编曲|制作人|制作|词|曲|译者|翻译|混音师?|母带师?|录音师?|演唱|歌手|专辑|发行|出品|OP|SP|lyrics?\s*by|written\s*by|composer|arranger|producer|artist|album)\s*[:：]/i
export const normalizeArtists = (s: string) => s.split(/\s*[\/、,&，；;]\s*/)
  .map(normalizeIdentity).filter(Boolean).sort().join('|')
const vocalLines = (lines: LyricLine[]) => lines.filter(line => !line.isBG && !credit.test(line.text)
  && normalizeIdentity(line.text).length >= 2)

export function validWordLine(line: LyricLine, duration = 0): boolean {
  const words = line.words
  if (!words?.length || !Number.isFinite(line.time) || line.time < 0
    || !Number.isFinite(line.endTime) || line.endTime! <= line.time) return false
  if (duration > 0 && line.endTime! > duration + 750) return false
  if (line.text.includes('\uFFFD') || words.map(word => word.text).join('') !== line.text) return false
  return words.every((word, i) => typeof word.text === 'string' && word.text.length > 0
    && Number.isFinite(word.startTime) && Number.isFinite(word.endTime)
    && word.startTime >= line.time && word.endTime > word.startTime
    // Integer quantization can overlap adjacent syllables by 1 ms (observed in
    // genuine Kuwo data). Keep the original values; larger overlaps fall back.
    && word.endTime <= line.endTime! && (!i || word.startTime + 1 >= words[i - 1].endTime))
}

/** A bad row keeps its text and falls back as a whole row, never partial words. */
export function sanitizeTiming(lines: LyricLine[], duration = 0): LyricLine[] {
  return lines.map(line => {
    if (!line.words || validWordLine(line, duration)) return line
    const { words, endTime, ...plain } = line
    return plain
  })
}

/** Native endpoint + exact platform ID: preserve untimed and malformed rows. */
export function mergeNativeTiming(timed: LyricLine[], baseline: LyricLine[], duration = 0): LyricLine[] {
  const safe = sanitizeTiming(timed, duration)
  if (!baseline.length) return safe
  const used = new Set<number>()
  return baseline.map(line => {
    const key = normalizeIdentity(line.text)
    const candidates = safe.map((row, i) => ({ row, i })).filter(({ row, i }) => !used.has(i)
      && validWordLine(row, duration) && normalizeIdentity(row.text) === key
      && Math.abs(row.time - line.time) <= 1500)
      .sort((a, b) => Math.abs(a.row.time - line.time) - Math.abs(b.row.time - line.time))
    if (!key || !candidates.length) return line
    const { row, i } = candidates[0]
    used.add(i)
    return { ...row, translation: row.translation || line.translation }
  }).sort((a, b) => a.time - b.time)
}

/** Lyrics alone cannot identify a recording. Require exact metadata AND duration. */
export function sameRecordingMetadata(track: Track, other: Track): boolean {
  return !!normalizeIdentity(track.title) && !!normalizeArtists(track.artist) && !!normalizeIdentity(track.album || '')
    && normalizeIdentity(track.title) === normalizeIdentity(other.title)
    && normalizeArtists(track.artist) === normalizeArtists(other.artist)
    && normalizeIdentity(track.album || '') === normalizeIdentity(other.album || '')
    && track.duration > 0 && other.duration > 0 && Math.abs(track.duration - other.duration) <= 1000
}

/** Community/cross-source lyrics need evidence spread across the whole song.
 * No inferred offset, speed correction, fuzzy text match or fabricated word times.
 */
export function verifiedTimeline(candidate: LyricLine[], baseline: LyricLine[], duration = 0): boolean {
  if (!candidate.length || candidate.some(line => line.words && !validWordLine(line, duration))) return false
  const a = vocalLines(baseline), b = vocalLines(candidate)
  if (a.length < 3 || b.length < 3) return false
  const matches: Array<{ a: number; b: number }> = []
  let next = 0
  for (let i = 0; i < a.length; i++) {
    const key = normalizeIdentity(a[i].text)
    const j = b.findIndex((line, j) => j >= next && normalizeIdentity(line.text) === key
      && Math.abs(line.time - a[i].time) <= 250)
    if (j >= 0) { matches.push({ a: i, b: j }); next = j + 1 }
  }
  if (matches.length < 3) return false
  const size = (lines: LyricLine[]) => lines.reduce((n, line) => n + normalizeIdentity(line.text).length, 0)
  const matchedSize = matches.reduce((n, { a: i }) => n + normalizeIdentity(a[i].text).length, 0)
  if (matchedSize / size(a) < 0.95 || matchedSize / size(b) < 0.95) return false
  const first = matches[0], last = matches[matches.length - 1]
  if ((last.a - first.a) / (a.length - 1) < 0.8 || (last.b - first.b) / (b.length - 1) < 0.8) return false
  return matches.some(({ b: i }) => validWordLine(b[i], duration) && b[i].words!.length > 1)
}

export const hasWordTiming = (lines: LyricLine[]) => lines.some(line => validWordLine(line) && line.words!.length > 1)
