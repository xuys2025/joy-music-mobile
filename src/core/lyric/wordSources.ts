// SPDX-License-Identifier: AGPL-3.0-only
import type { Track } from '../../types/music'
import type { LyricData } from './fetcher'
import musicSearch from '../search'
import { readTTML } from './codecs'
import { hasWordTiming, sameRecordingMetadata, verifiedTimeline, sanitizeTiming } from './accuracy'
import { lyricRequest, within } from './network'

type NativeFetcher = (track: Track) => Promise<LyricData>
const SOURCES = ['wy', 'tx', 'kw', 'kg'] as const
const SEARCH_TIMEOUT = 12000
const NATIVE_TIMEOUT = 30000
const COMMUNITY_TIMEOUT = 6000
const ENRICHMENT_TIMEOUT = 49000
const CANDIDATES_PER_SOURCE = 3

/** A rejected or empty provider cannot win the race or block another provider. */
function firstVerified(jobs: Promise<LyricData | null>[]): Promise<LyricData | null> {
  if (!jobs.length) return Promise.resolve(null)
  return new Promise(resolve => {
    let remaining = jobs.length
    for (const job of jobs) job.catch(() => null).then(result => {
      if (result) resolve(result)
      if (--remaining === 0) resolve(null)
    })
  })
}

/** Exact platform identifiers only. Do not use a title as a file path or guess IDs. */
async function community(track: Track, baseline: LyricData, active: () => boolean): Promise<LyricData | null> {
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
    if (!active()) return null
    try {
      const response = await lyricRequest(url, {}, 3000)
      if (response.status === 404) return null
      if (!response.ok) continue
      const parsed = readTTML(await response.text())
      if (!active()) return null
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
  let running = true
  const active = () => running
  const work = async (): Promise<LyricData | null> => {
    const direct = await within(community(track, baseline, active), null, COMMUNITY_TIMEOUT)
    if (direct || !active()) return direct
    if (!track.album || !track.artist || !track.title || !(track.duration > 0)) return null

    const query = `${track.title} ${track.artist}`
    const jobs = SOURCES.filter(source => source !== (track.source || 'kw')).map(async source => {
      const page = await within(musicSearch.searchTracksBySource({ query, source, limit: 10,
        page: 1, includeArtwork: false }), null, SEARCH_TIMEOUT)
      if (!active()) return null
      const seen = new Set<string>()
      const matches = (page?.list || []).filter(candidate => {
        if (candidate.source !== source || !sameRecordingMetadata(track, candidate)) return false
        const key = JSON.stringify([candidate.songmid || candidate.id, candidate.songId || '',
          candidate.hash || '', candidate.copyrightId || ''])
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, CANDIDATES_PER_SOURCE)
      return firstVerified(matches.map(candidate => firstVerified([
        within(nativeFetch(candidate), null, NATIVE_TIMEOUT).then(native => {
          if (!active() || !native) return null
          const lines = sanitizeTiming(native.lines, track.duration)
          return hasWordTiming(lines) && verifiedTimeline(lines, baseline.lines, track.duration)
            ? { ...baseline, lines, timingSource: 'matched' as const } : null
        }),
        within(community(candidate, baseline, active), null, COMMUNITY_TIMEOUT)
          .then(ttml => active() && ttml ? { ...ttml, timingSource: 'matched' as const } : null),
      ])))
    })
    // Every successful candidate passes the same exact metadata and whole-song
    // checks. A slow platform cannot hold back an already verified result.
    return firstVerified(jobs)
  }
  try { return await within(work(), null, ENRICHMENT_TIMEOUT) || baseline }
  finally { running = false }
}
