/**
 * 歌词服务入口。
 * 提供带缓存的歌词获取，以及类型和工具函数的统一导出。
 */

import { Track } from '../../types/music'
import { lyricCache } from '../music/cache'
import { fetchLyric, isLikelyGarbledLyric, LyricData } from './fetcher'
import { hasWordTiming, normalizeIdentity, sanitizeTiming } from './accuracy'

export type { LyricData } from './fetcher'
export type { LyricLine } from './parser'
export { findCurrentLineIndex } from './parser'

const EMPTY_LYRIC: LyricData = { lines: [], rawLrc: '', rawTlrc: '' }

/**
 * 内存缓存：同一首歌的 getLyric 调用直接返回已解析结果，
 * 避免 MiniPlayer 与 NowPlaying 同时请求同一首歌的歌词。
 * 同时合并并发请求（in-flight dedup）。
 */
const memoryCache = new Map<string, LyricData>()
type Listener = (data: LyricData) => void
interface Pending { promise: Promise<LyricData>; listeners: Set<Listener>; latest?: LyricData }
const inFlightRequests = new Map<string, Pending>()
const MEMORY_CACHE_MAX = 30

function buildLyricTextForGarbledCheck(cached: LyricData): string {
  const rawLrc = String(cached?.rawLrc || '')
  const rawTlrc = String(cached?.rawTlrc || '')
  const lineTexts = Array.isArray(cached?.lines)
    ? cached.lines
      .slice(0, 80)
      .map((line) => `${line?.text || ''} ${line?.translation || ''}`.trim())
      .join('\n')
    : ''
  return [rawLrc, rawTlrc, lineTexts].filter(Boolean).join('\n')
}

/**
 * 获取歌词（优先内存缓存 → 磁盘缓存 → API 请求）。
 * 同一 cacheKey 的并发请求会自动合并，避免重复网络调用。
 * @param track - 当前播放歌曲
 */
export function lyricCacheKey(track: Track): string {
  return JSON.stringify(['word_v5', track.source || 'kw', track.songmid || track.id, track.songId || '',
    track.hash || '', track.duration, normalizeIdentity(track.title), normalizeIdentity(track.artist), normalizeIdentity(track.album || '')])
}

function isFresh(data: LyricData): boolean {
  const ttl = hasWordTiming(data.lines) ? 7 * 86400000 : 10 * 60000
  return !!data.fetchedAt && Date.now() - data.fetchedAt < ttl
}

export async function getLyric(track: Track, onUpdate?: Listener): Promise<LyricData> {
  const cacheKey = lyricCacheKey(track)

  // 1. 内存命中
  const memoryCached = memoryCache.get(cacheKey)
  if (memoryCached && isFresh(memoryCached)) { onUpdate?.(memoryCached); return memoryCached }

  // 2. 合并并发请求
  let task = inFlightRequests.get(cacheKey)
  if (!task) {
    task = { promise: undefined!, listeners: new Set() }
    const pending = task
    inFlightRequests.set(cacheKey, task)
    const publish = (data: LyricData) => {
      if (!data.lines.length) return
      pending.latest = data
      for (const listener of pending.listeners) listener(data)
    }

  task.promise = (async (): Promise<LyricData> => {
    let usableCache: LyricData | undefined
    try {
      const cached = await lyricCache.getLyric(cacheKey)
      if (cached?.lines?.length) {
        const mergedText = buildLyricTextForGarbledCheck(cached as LyricData)
        if (!isLikelyGarbledLyric(mergedText)) {
          usableCache = { ...(cached as LyricData), lines: sanitizeTiming(cached.lines, track.duration) }
          publish(usableCache)
          if (isFresh(usableCache)) { storeInMemoryCache(cacheKey, usableCache); return usableCache }
        }
        if (!usableCache) await lyricCache.clearLyric(cacheKey)
      }
    } catch {
      // cache miss, continue to fetch
    }

    const fetched = await fetchLyric(track, publish)
    const lyricData = fetched.lines.length ? fetched : usableCache || EMPTY_LYRIC

    if (lyricData.lines.length) {
      storeInMemoryCache(cacheKey, lyricData)
      try {
        await lyricCache.saveLyric(cacheKey, lyricData)
      } catch {
        // cache write failure is non-critical
      }
    }

    return lyricData
  })()
  }
  if (onUpdate) {
    task.listeners.add(onUpdate)
    if (task.latest) onUpdate(task.latest)
  }
  try {
    return await task.promise
  } finally {
    if (onUpdate) task.listeners.delete(onUpdate)
    if (inFlightRequests.get(cacheKey) === task) inFlightRequests.delete(cacheKey)
  }
}

function storeInMemoryCache(key: string, data: LyricData): void {
  if (memoryCache.size >= MEMORY_CACHE_MAX) {
    // 淘汰最早的条目
    const firstKey = memoryCache.keys().next().value
    if (firstKey !== undefined) memoryCache.delete(firstKey)
  }
  memoryCache.set(key, data)
}
