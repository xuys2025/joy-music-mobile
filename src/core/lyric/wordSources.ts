// SPDX-License-Identifier: AGPL-3.0-only
import type { Track } from '../../types/music'
import type { LyricData } from './fetcher'
import musicSearch from '../search'
import { readTTML } from './codecs'
import { hasWordTiming, sameRecordingMetadata, verifiedTimeline } from './accuracy'
import { lyricRequest, within } from './network'

type NativeFetcher = (track: Track) => Promise<LyricData>
const SOURCES = ['wy', 'tx', 'kg'] as const

/** Exact platform identifiers only. Do not use a title as a file path or guess IDs. */
async function community(track: Track, baseline: LyricData): Promise<LyricData | null> {
  const source = track.source
  const id = source === 'tx' ? track.songId || baseline.platformSongId || track.songmid
    : track.songmid || track.id.replace(/^wy_/, '')
  if (!['wy', 'tx'].includes(source || '') || !/^\d+$/.test(id || '')) return null
  const folder = source === 'wy' ? 'ncm-lyrics' : 'qq-lyrics'
  const urls = [
    `https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/${folder}/${id}.ttml`,
    `https://amlldb.bikonoo.com/${folder}/${id}.ttml`,
  ]
  for (const url of urls) {
    try {
      const response = await lyricRequest(url, {}, 1800)
      if (response.status === 404) return null
      if (!response.ok) continue
      const parsed = readTTML(await response.text())
      const field = source === 'wy' ? 'ncmMusicId' : 'qqMusicId'
      if (!parsed.metadata.some(([key, values]) => key === field && values.includes(id!))) return null
      if (!verifiedTimeline(parsed.lines, baseline.lines, track.duration)) return null
      return { ...baseline, lines: parsed.lines, timingSource: 'community' }
    } catch { /* A failed mirror cannot replace native lyrics. */ }
  }
  return null
}

export async function enrichWordLyrics(track: Track, baseline: LyricData, nativeFetch: NativeFetcher): Promise<LyricData> {
  // There is no independent recording evidence without enough native lyric anchors.
  if (baseline.lines.length < 3) return baseline
  const direct = await within(community(track, baseline), null, 2800)
  if (direct) return direct
  if (!track.album || !track.artist || !track.title || !(track.duration > 0)) return baseline

  const query = `${track.title} ${track.artist}`
  const pages = await Promise.all(SOURCES.filter(source => source !== track.source).map(source =>
    within(musicSearch.searchTracksBySource({ query, source, limit: 5, page: 1 }), null, 2500)))
  const matches = pages.flatMap(page => page?.list || []).filter(candidate => sameRecordingMetadata(track, candidate))
  // Search order is deterministic. Ambiguous duplicates are never selected by fuzzy score.
  for (const candidate of matches.slice(0, 2)) {
    const native = await within(nativeFetch(candidate), null, 2500)
    if (!native?.lines.length) continue
    if (hasWordTiming(native.lines) && verifiedTimeline(native.lines, baseline.lines, track.duration))
      return { ...baseline, lines: native.lines, timingSource: 'matched' }
    const ttml = await within(community(candidate, baseline), null, 2200)
    if (ttml) return { ...ttml, timingSource: 'matched' }
  }
  return baseline
}
