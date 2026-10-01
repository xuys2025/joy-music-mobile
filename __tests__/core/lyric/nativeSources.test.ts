import { fetchNativeLyric, fetchLyric } from '../../../src/core/lyric/fetcher'
import { enrichWordLyrics } from '../../../src/core/lyric/wordSources'
import { wyRequest } from '../../../src/core/discover/wyCrypto'
import { encryptQrcHex } from '@applemusic-like-lyrics/lyric'
import { deflate } from 'pako'
import type { Track } from '../../../src/types/music'

jest.mock('../../../src/core/discover/wyCrypto', () => ({ wyRequest: jest.fn() }))
jest.mock('../../../src/core/lyric/wordSources', () => ({ enrichWordLyrics: jest.fn(async (_, baseline) => baseline) }))
const request = wyRequest as jest.Mock
const originalFetch = globalThis.fetch
const track: Track = { id: 'tx_mid', songmid: 'mid', songId: '123', source: 'tx', title: 'Fixture', artist: 'Singer', album: 'Album', duration: 10000, url: '' }
const lrc = '[00:01]你好\n[00:04]世界\n[00:08]最后'
const official = () => ({ ok: true, text: async () => JSON.stringify({ code: 0, lyric: lrc }) })
const json = (data: unknown) => ({ ok: true, json: async () => data })
const qrc = '<QrcInfos><Lyric_1 LyricContent="[1000,1000]你(1000,500)好(1500,500)"/></QrcInfos>'
beforeEach(() => {
  globalThis.fetch = jest.fn()
  request.mockReset()
  ;(enrichWordLyrics as jest.Mock).mockReset().mockImplementation(async (_, baseline) => baseline)
})
afterAll(() => { globalThis.fetch = originalFetch })

test('QQ requests numeric songID + qrc=1 and preserves all fallback rows', async () => {
  ;(fetch as jest.Mock).mockImplementation(async (url, init) => String(url).includes('c.y.qq.com') ? official()
    : json({ code: 0, req: { code: 0, data: { lyric: encryptQrcHex(qrc) } } }))
  const result = await fetchNativeLyric(track)
  expect(result.lines).toHaveLength(3)
  expect(result.lines[0].words?.map(word => word.startTime)).toEqual([1000, 1500])
  expect(result.lines[1].words).toBeUndefined()
  const body = JSON.parse((fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('musicu'))[1].body)
  expect(body.req.param).toMatchObject({ songID: 123, qrc: 1, crypt: 1 })
})
test('QQ corrupt ciphertext preserves the working official LRC path', async () => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('c.y.qq.com') ? official()
    : json({ code: 0, req: { code: 0, data: { lyric: 'f'.repeat(64) } } }))
  const result = await fetchNativeLyric(track)
  expect(result.lines).toHaveLength(3)
  expect(result.lines.every(line => !line.words)).toBe(true)
})
test('MID lookup must return the requested MID; wrong detail never selects another song ID', async () => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('c.y.qq.com') ? official()
    : json({ code: 0, req: { code: 0, data: { track_info: { mid: 'other-mid', id: 456 } } } }))
  const result = await fetchNativeLyric({ ...track, songId: undefined })
  expect(result.lines.every(line => !line.words)).toBe(true)
  expect((fetch as jest.Mock).mock.calls).toHaveLength(2)
})
test('a partial malformed YRC document falls back without deleting lyrics', async () => {
  request.mockResolvedValue({ data: { code: 200, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好\n[4000,1000](4000,-10,0)坏' }, lrc: { lyric: lrc } } })
  const result = await fetchNativeLyric({ ...track, source: 'wy', songmid: '123' })
  expect(result.lines).toHaveLength(3)
  expect(result.lines.every(line => !line.words)).toBe(true)
})
const krcPayload = (raw: string) => {
  const key = [0x40,0x47,0x61,0x77,0x5e,0x32,0x74,0x47,0x51,0x36,0x31,0x2d,0xce,0xd2,0x6e,0x69]
  const bytes = deflate(raw).map((byte: number, i: number) => byte ^ key[i % 16])
  return btoa('krc1' + Array.from(bytes).map(byte => String.fromCharCode(byte as number)).join(''))
}
test.each([false, true])('Kugou requests KRC and falls back to LRC after invalid timing: %s', async invalid => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('/search?')
    ? json({ candidates: [{ id: '1', accesskey: 'test-key', krctype: 1, contenttype: 0, song: 'Fixture', singer: 'Singer', duration: 10000 }] })
    : String(url).includes('fmt=krc')
      ? json({ status: 200, content: krcPayload(`[1000,1000]<0,${invalid ? -500 : 500},0>你<500,500,0>好`) })
      : json({ status: 200, content: btoa(unescape(encodeURIComponent(lrc))) }))
  const result = await fetchNativeLyric({ ...track, source: 'kg', hash: 'ABC' })
  expect((fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes('fmt=krc'))).toBe(true)
  if (invalid) { expect(result.lines).toHaveLength(3); expect(result.lines[0].words).toBeUndefined() }
  else expect(result.lines[0].words).toHaveLength(2)
})
test('Kugou candidates naming another recording cannot supply word timing', async () => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('/search?')
    ? json({ candidates: [{ id: '1', accesskey: 'test-key', krctype: 1, contenttype: 0, song: 'Fixture (Live)', singer: 'Singer', duration: 10000 }] })
    : json({ status: 200, content: btoa(unescape(encodeURIComponent(lrc))) }))
  const result = await fetchNativeLyric({ ...track, source: 'kg', hash: 'ABC' })
  expect(result.lines.every(line => !line.words)).toBe(true)
  expect((fetch as jest.Mock).mock.calls.some(([url]) => String(url).includes('fmt=krc'))).toBe(false)
})
test('native lyrics are published before optional enrichment completes', async () => {
  request.mockResolvedValue({ data: { code: 200, lrc: { lyric: lrc } } })
  let finish!: (value: unknown) => void
  ;(enrichWordLyrics as jest.Mock).mockImplementation((_, baseline) => new Promise(resolve => { finish = () => resolve(baseline) }))
  const update = jest.fn()
  const pending = fetchLyric({ ...track, source: 'wy', songmid: '123' }, update)
  for (let i = 0; i < 8; i++) await Promise.resolve()
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.any(Array) }))
  finish(null)
  expect((await pending).lines).toHaveLength(3)
})
