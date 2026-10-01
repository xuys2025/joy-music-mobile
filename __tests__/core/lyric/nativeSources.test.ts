import { fetchNativeLyric, fetchLyric } from '../../../src/core/lyric/fetcher'
import { enrichWordLyrics } from '../../../src/core/lyric/wordSources'
import { wyRequest } from '../../../src/core/discover/wyCrypto'
import { encryptQrcHex } from '@applemusic-like-lyrics/lyric'
import { deflate } from 'pako'
import type { Track } from '../../../src/types/music'
import fixtures from '../../fixtures/mrc.json'

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
test('one QRC layout space cannot make the whole native document lose its word timing', async () => {
  const raw = '<QrcInfos><Lyric_1 LyricContent="[1000,1000]你(1000,500) (1500,0)好(1500,500)\n[4000,1000]世(4000,500)界(4500,500)"/></QrcInfos>'
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('c.y.qq.com') ? official()
    : json({ code: 0, req: { code: 0, data: { lyric: encryptQrcHex(raw) } } }))
  const result = await fetchNativeLyric(track)
  expect(result.lines).toHaveLength(3)
  expect(result.lines[0].words).toHaveLength(3)
  expect(result.lines[0].words?.[1]).toEqual({ text: ' ', startTime: 1500, endTime: 1500 })
  expect(result.lines[1].words).toHaveLength(2)
})

const kwPayload = (text: string, header = 'TP=content') => {
  const bytes = new TextEncoder().encode(text).map((byte, i) => byte ^ 'yeelion'.charCodeAt(i % 7))
  const compressed = deflate(btoa(Array.from(bytes).map(byte => String.fromCharCode(byte)).join('')))
  const prefix = new TextEncoder().encode(header + '\r\n\r\n')
  const raw = new Uint8Array(prefix.length + compressed.length)
  raw.set(prefix); raw.set(compressed, prefix.length)
  return { ok: true, arrayBuffer: async () => raw.buffer }
}
test('current Kuwo mlyric uses UTF-8 and accepts an uppercase TP header with real zero-duration spaces', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(kwPayload('[ti:测试]\n[kuwo:13]\n[00:01.000]<500,-500>你<500,500> <2000,-1000>好'))
  const result = await fetchNativeLyric({ ...track, source: 'kw', songmid: 'kw_123' })
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain('https://mlyric.kuwo.cn/mobi.s?')
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain('lrcx=1')
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain('rid=123')
  expect((fetch as jest.Mock).mock.calls).toHaveLength(1)
  expect(result.lines[0].text).toBe('你 好')
  expect(result.lines[0].words?.map(word => [word.startTime, word.endTime])).toEqual([[1000, 1500], [1500, 1500], [1500, 3000]])
})
test('failed Kuwo word endpoints preserve the existing songinfo LRC fallback', async () => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('songinfoandlrc')
    ? json({ data: { lrclist: [{ time: '1', lineLyric: '你好' }, { time: '4', lineLyric: '世界' }] } })
    : { ok: false })
  const result = await fetchNativeLyric({ ...track, source: 'kw', songmid: '123' })
  expect(result.lines.map(line => line.text)).toEqual(['你好', '世界'])
  expect(result.lines.every(line => !line.words)).toBe(true)
  expect((fetch as jest.Mock).mock.calls).toHaveLength(3)
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
test('WY uses EAPI YRC even when the old Linux endpoint only returns plain lyrics', async () => {
  request.mockResolvedValue({ data: { code: 200, lrc: { lyric: lrc } } })
  ;(fetch as jest.Mock).mockResolvedValue(json({ code: 200, lrc: { lyric: lrc }, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好' } }))
  const result = await fetchNativeLyric({ ...track, source: 'wy', songmid: '123' })
  expect((fetch as jest.Mock).mock.calls[0][0]).toBe('https://interface3.music.163.com/eapi/song/lyric/v1')
  expect(result.lines).toHaveLength(3)
  expect(result.lines[0].words?.map(w => w.startTime)).toEqual([1000, 1500])
})
test('a partial EAPI YRC document preserves all plain rows without fabricated words', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(json({ code: 200, lrc: { lyric: lrc }, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好\n[4000,1000](4000,-10,0)坏' } }))
  request.mockResolvedValue({ data: { code: 200, lrc: { lyric: lrc } } })
  const result = await fetchNativeLyric({ ...track, source: 'wy', songmid: '123' })
  expect(result.lines).toHaveLength(3)
  expect(result.lines.every(line => !line.words)).toBe(true)
})
test('stalled EAPI is aborted and cannot overwrite the available legacy LRC later', async () => {
  jest.useFakeTimers()
  try {
    let finish!: (response: any) => void
    ;(fetch as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    request.mockResolvedValue({ data: { code: 200, lrc: { lyric: lrc } } })
    const pending = fetchNativeLyric({ ...track, source: 'wy', songmid: '123' })
    await jest.advanceTimersByTimeAsync(20000)
    const result = await pending
    expect(result.lines).toHaveLength(3)
    expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true)
    finish(json({ code: 200, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好' } }))
    await Promise.resolve()
    expect(result.lines.every(line => !line.words)).toBe(true)
  } finally { jest.useRealTimers() }
})
test('legacy YRC can supplement a plain EAPI result for the same platform ID', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(json({ code: 200, lrc: { lyric: lrc } }))
  request.mockResolvedValue({ data: { code: 200, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好' } } })
  const result = await fetchNativeLyric({ ...track, source: 'wy', songmid: '123' })
  expect(result.lines).toHaveLength(3)
  expect(result.lines[0].words).toHaveLength(2)
})

const mgResource = { songId: '123', copyrightId: 'copyright', songName: 'Fixture', artists: [{ name: 'Singer' }], album: 'Album', length: '00:00:10', lrcUrl: 'https://example.test/lrc', mrcUrl: 'https://example.test/mrc' }
test.each([false, true])('Migu validates resource identity and retains LRC when MRC is corrupt: %s', invalid => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('resourceinfo')
    ? json({ code: '000000', resource: [{ ...mgResource, songId: 'wrong', copyrightId: 'wrong' }, mgResource] })
    : { ok: true, text: async () => String(url).endsWith('/mrc') ? (invalid ? fixtures.invalid.cipher : fixtures.valid.cipher) : lrc })
  return fetchNativeLyric({ ...track, id: 'mg_123', source: 'mg', songmid: '123', songId: undefined }).then(result => {
    expect(result.lines).toHaveLength(3)
    if (invalid) expect(result.lines.every(line => !line.words)).toBe(true)
    else expect(result.lines[0].words?.map(w => w.startTime)).toEqual([1000, 1500])
  })
})
test.each([{ songName: 'Fixture (Live)' }, { artists: [{ name: 'Other' }] }, { length: '00:00:15' }, { album: 'Other' }])('Migu cannot apply MRC from a conflicting recording: %p', mismatch => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('resourceinfo')
    ? json({ code: '000000', resource: [{ ...mgResource, ...mismatch }] })
    : { ok: true, text: async () => lrc })
  return fetchNativeLyric({ ...track, id: 'mg_123', source: 'mg', songmid: '123' }).then(result => {
    expect(result.lines).toHaveLength(3)
    expect((fetch as jest.Mock).mock.calls.some(([url]) => String(url).endsWith('/mrc'))).toBe(false)
  })
})
test('Migu rejects an unrelated resource even when it is the first or only result', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(json({ code: '000000', resource: [{ ...mgResource, songId: 'wrong', copyrightId: 'wrong' }] }))
  const result = await fetchNativeLyric({ ...track, id: 'mg_123', source: 'mg', songmid: '123' })
  expect(result.lines).toHaveLength(0)
  expect((fetch as jest.Mock).mock.calls).toHaveLength(1)
})
test('Migu aborts a stalled MRC download while preserving the available plain LRC', async () => {
  jest.useFakeTimers()
  try {
    ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('resourceinfo')
      ? json({ code: '000000', resource: [mgResource] })
      : String(url).endsWith('/mrc') ? new Promise(() => {}) : { ok: true, text: async () => lrc })
    const pending = fetchLyric({ ...track, id: 'mg_123', source: 'mg', songmid: '123' })
    await jest.advanceTimersByTimeAsync(20000)
    const result = await pending
    expect(result.lines).toHaveLength(3)
    expect(result.lines.every(line => !line.words)).toBe(true)
    expect((fetch as jest.Mock).mock.calls.find(([url]) => String(url).endsWith('/mrc'))[1].signal.aborted).toBe(true)
  } finally { jest.useRealTimers() }
})
test('Migu accepts an exact resource with valid MRC even when its LRC download fails', async () => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('resourceinfo')
    ? json({ code: '000000', resource: [mgResource] })
    : String(url).endsWith('/mrc') ? { ok: true, text: async () => fixtures.valid.cipher } : { ok: false })
  const result = await fetchNativeLyric({ ...track, id: 'mg_123', source: 'mg', songmid: '123' })
  expect(result.lines).toHaveLength(2)
  expect(result.lines[0].words).toBeUndefined()
  expect(result.lines[1].words).toHaveLength(2)
  expect(result.rawLrc).not.toContain('(1000,500)')
})
test('Migu resolves song and copyright aliases in one bounded official request', async () => {
  ;(fetch as jest.Mock).mockImplementation(async url => String(url).includes('resourceinfo')
    ? json({ code: '000000', resource: [mgResource] }) : { ok: true, text: async () => lrc })
  await fetchNativeLyric({ ...track, id: 'mg_123', source: 'mg', songmid: '123', copyrightId: 'copyright', album: undefined })
  const calls = (fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('resourceinfo'))
  expect(calls).toHaveLength(1)
  expect(calls[0][1].body).toBe('resourceId=123%7Ccopyright')
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
  let published!: () => void
  const publication = new Promise<void>(resolve => { published = resolve })
  const update = jest.fn(() => published())
  const pending = fetchLyric({ ...track, source: 'wy', songmid: '123' }, update)
  await publication
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ lines: expect.any(Array) }))
  finish(null)
  expect((await pending).lines).toHaveLength(3)
})
