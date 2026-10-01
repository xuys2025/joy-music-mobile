import { getLyric, lyricCacheKey } from '../../../src/core/lyric'
import { lyricCache } from '../../../src/core/music/cache'
import { fetchLyric } from '../../../src/core/lyric/fetcher'
import type { Track } from '../../../src/types/music'

jest.mock('../../../src/core/music/cache', () => ({ lyricCache: { getLyric: jest.fn(), saveLyric: jest.fn(), clearLyric: jest.fn() } }))
jest.mock('../../../src/core/lyric/fetcher', () => ({ fetchLyric: jest.fn(), isLikelyGarbledLyric: () => false }))
const fetcher = fetchLyric as jest.Mock
const cache = lyricCache.getLyric as jest.Mock
const track: Track = { id: 'cache-1', songmid: 'cache-1', source: 'wy', title: 'Fixture', artist: 'Singer', album: 'Album', duration: 10000, url: '' }
const basic = { lines: [{ time: 1000, text: '你好' }], rawLrc: '[00:01]你好', rawTlrc: '', fetchedAt: Date.now() }
beforeEach(() => { fetcher.mockReset(); cache.mockReset().mockResolvedValue(null); (lyricCache.saveLyric as jest.Mock).mockReset() })

test('same catalogue ID with another hash/duration/version never shares a validated word cache', () => {
  for (const patch of [{ hash: 'another' }, { duration: 11000 }, { title: 'Fixture (Live)' }, { album: 'Other' }, { songId: '456' }])
    expect(lyricCacheKey({ ...track, ...patch })).not.toBe(lyricCacheKey(track))
})
test('the parser fix cannot reuse a fresh word_v2 fallback from an older install', () => {
  expect(JSON.parse(lyricCacheKey(track))[0]).toBe('word_v3')
})
test('concurrent views share one request and both receive the immediate LRC update', async () => {
  let finish!: (data: typeof basic) => void
  fetcher.mockImplementation((_, update) => { update(basic); return new Promise(resolve => { finish = resolve }) })
  const a = jest.fn(), b = jest.fn()
  const first = getLyric(track, a), second = getLyric(track, b)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(a).toHaveBeenCalledWith(basic)
  expect(b).toHaveBeenCalledWith(basic)
  finish(basic)
  expect(await first).toEqual(await second)
})
test('a fresh fallback cache avoids repeatedly requesting missing word lyrics', async () => {
  cache.mockResolvedValue(basic)
  expect(await getLyric({ ...track, id: 'cache-2', songmid: 'cache-2' })).toEqual(basic)
  expect(fetcher).not.toHaveBeenCalled()
})
test('expired fallback cache retries and remains available during an outage', async () => {
  const expired = { ...basic, fetchedAt: Date.now() - 86400000 }
  cache.mockResolvedValue(expired)
  fetcher.mockResolvedValue({ lines: [], rawLrc: '', rawTlrc: '' })
  const update = jest.fn()
  expect(await getLyric({ ...track, id: 'cache-3', songmid: 'cache-3' }, update)).toEqual(expired)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(update).toHaveBeenCalledWith(expired)
})
test('a fallback retries after 10 minutes instead of masking a recovered endpoint for 6 hours', async () => {
  const expired = { ...basic, fetchedAt: Date.now() - 11 * 60000 }
  cache.mockResolvedValue(expired)
  fetcher.mockResolvedValue(basic)
  expect(await getLyric({ ...track, id: 'cache-4', songmid: 'cache-4' })).toEqual(basic)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
