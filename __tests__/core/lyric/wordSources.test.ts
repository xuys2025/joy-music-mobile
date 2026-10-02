import { enrichWordLyrics } from '../../../src/core/lyric/wordSources'
import musicSearch from '../../../src/core/search'
import { parseLrc } from '../../../src/core/lyric/parser'
import type { Track } from '../../../src/types/music'
import type { LyricData } from '../../../src/core/lyric/fetcher'

jest.mock('../../../src/core/search', () => ({ __esModule: true, default: { searchTracksBySource: jest.fn() } }))
const search = musicSearch.searchTracksBySource as jest.Mock
const originalFetch = globalThis.fetch
const track: Track = { id: 'wy_123', songmid: '123', source: 'wy', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 15000, url: '' }
const base = { lines: parseLrc('[00:01]第一句\n[00:04]第二句\n[00:08]第三句\n[00:12]第四句'), rawLrc: 'fixture', rawTlrc: '' }
const ttml = (id = '123', offset = 0) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head><metadata><amll:meta key="ncmMusicId" value="${id}"/></metadata></head><body><div>${base.lines.map(line => `<p begin="${(line.time + offset) / 1000}s" end="${(line.time + offset + 1000) / 1000}s"><span begin="${(line.time + offset) / 1000}s" end="${(line.time + offset + 500) / 1000}s">${line.text[0]}</span><span begin="${(line.time + offset + 500) / 1000}s" end="${(line.time + offset + 1000) / 1000}s">${line.text.slice(1)}</span></p>`).join('')}</div></body></tt>`
const reply = (text: string, status = 200) => ({ ok: status === 200, status, text: async () => text })
const words = { ...base, lines: base.lines.map(line => ({ ...line, endTime: line.time + 1000,
  words: [{ text: line.text[0], startTime: line.time, endTime: line.time + 500 },
    { text: line.text.slice(1), startTime: line.time + 500, endTime: line.time + 1000 }] })) }
const kw = { ...track, id: 'kw_234', source: 'kw', songmid: '234' }
const delayed = <T,>(value: T, ms: number) => new Promise<T>(resolve => setTimeout(() => resolve(value), ms))

beforeEach(() => { globalThis.fetch = jest.fn().mockResolvedValue(reply('', 404)); search.mockReset().mockResolvedValue({ list: [] }) })
afterAll(() => { globalThis.fetch = originalFetch })
afterEach(() => { jest.useRealTimers() })

test('accepts exact-ID TTML only after native whole-song timeline verification', async () => {
  ;(fetch as jest.Mock).mockResolvedValue(reply(ttml()))
  const result = await enrichWordLyrics(track, base, jest.fn())
  expect(result.timingSource).toBe('community')
  expect(result.lines[0].words).toHaveLength(2)
  expect(search).not.toHaveBeenCalled()
})
test.each([ttml('456'), ttml('123', 900), '<tt>broken', '<!DOCTYPE tt><tt/>'])('rejects a wrong-ID, shifted or malformed community result', async xml => {
  ;(fetch as jest.Mock).mockResolvedValue(reply(xml))
  expect(await enrichWordLyrics(track, base, jest.fn())).toBe(base)
})
test('does not perform broad matching without independent native lyric anchors', async () => {
  const incomplete = { ...base, lines: base.lines.slice(0, 2) }
  expect(await enrichWordLyrics(track, incomplete, jest.fn())).toBe(incomplete)
  expect(fetch).not.toHaveBeenCalled()
  expect(search).not.toHaveBeenCalled()
})
test('fails closed when cross-source metadata or timeline does not match', async () => {
  const other = { ...track, id: 'tx_mid', source: 'tx', songmid: 'mid', songId: '234', duration: 19000 }
  search.mockResolvedValue({ list: [other] })
  const native = jest.fn()
  expect(await enrichWordLyrics(track, base, native)).toBe(base)
  expect(native).not.toHaveBeenCalled()
})
test('accepts cross-source only when metadata, duration, text and all anchors agree', async () => {
  const other = { ...track, id: 'tx_mid', source: 'tx', songmid: 'mid', songId: '234' }
  search.mockResolvedValue({ list: [other] })
  const native = jest.fn().mockResolvedValue({ ...base, lines: base.lines.map(line => ({ ...line,
    endTime: line.time + 1000, words: [{ text: line.text[0], startTime: line.time, endTime: line.time + 500 },
      { text: line.text.slice(1), startTime: line.time + 500, endTime: line.time + 1000 }] })) })
  expect((await enrichWordLyrics(track, base, native)).timingSource).toBe('matched')
})
test('provider outage falls back without deleting the native lyrics', async () => {
  ;(fetch as jest.Mock).mockRejectedValue(new Error('offline'))
  search.mockRejectedValue(new Error('offline'))
  expect(await enrichWordLyrics(track, base, jest.fn())).toBe(base)
})

test('Kuwo can supplement another platform without waiting for an unrelated stalled search', async () => {
  jest.useFakeTimers()
  search.mockImplementation(({ source }) => source === 'kw' ? Promise.resolve({ list: [kw] }) : new Promise(() => {}))
  const native = jest.fn().mockResolvedValue(words)
  const pending = enrichWordLyrics(track, base, native)
  await jest.advanceTimersByTimeAsync(100)
  expect(await pending).toMatchObject({ timingSource: 'matched', lines: words.lines })
  expect(native).toHaveBeenCalledWith(kw)
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ source: 'kw', includeArtwork: false }))
})

test('a slow search and native word response survive the former 2.5-second cutoff', async () => {
  jest.useFakeTimers()
  search.mockImplementation(({ source }) => source === 'tx'
    ? delayed({ list: [{ ...kw, id: 'tx_234', source: 'tx' }] }, 4000) : Promise.resolve({ list: [] }))
  const native = jest.fn(() => delayed(words, 20000))
  const pending = enrichWordLyrics(track, base, native)
  await jest.advanceTimersByTimeAsync(24001)
  expect((await pending).timingSource).toBe('matched')
})

test('duplicate candidates and one failed platform cannot crowd out a verified later recording', async () => {
  search.mockImplementation(({ source }) => source === 'tx'
    ? Promise.resolve({ list: [1, 1, 2, 3].map(id => ({ ...kw, source, id: `tx_${id}`, songmid: `mid${id}` })) })
    : Promise.resolve({ list: [] }))
  const native = jest.fn(async candidate => candidate.id === 'tx_3' ? words : base)
  const result = await enrichWordLyrics(track, base, native)
  expect(result.timingSource).toBe('matched')
  expect(native.mock.calls.filter(([candidate]) => candidate.id === 'tx_1')).toHaveLength(1)
  expect(native).toHaveBeenCalledTimes(3)
})

test('a quick result with shifted anchors is rejected while a slower verified result is accepted', async () => {
  jest.useFakeTimers()
  search.mockImplementation(({ source }) => Promise.resolve({ list: source === 'kw' ? [kw]
    : source === 'tx' ? [{ ...kw, id: 'tx_234', source: 'tx' }] : [] }))
  const shifted = { ...words, lines: words.lines.map(line => ({ ...line, time: line.time + 900 })) }
  const native = jest.fn(candidate => delayed(candidate.source === 'kw' ? shifted : words, candidate.source === 'kw' ? 100 : 5000))
  const pending = enrichWordLyrics(track, base, native)
  await jest.advanceTimersByTimeAsync(5001)
  expect((await pending).lines).toEqual(words.lines)
})

test('hung providers finish with the original LRC and cannot start late candidate requests', async () => {
  jest.useFakeTimers()
  search.mockImplementation(({ source }) => delayed({ list: [kw] }, source === 'kw' ? 60000 : 0))
  const native = jest.fn(() => new Promise<LyricData>(() => {}))
  const pending = enrichWordLyrics(track, base, native)
  await jest.advanceTimersByTimeAsync(50000)
  expect(await pending).toBe(base)
  const count = native.mock.calls.length
  await jest.advanceTimersByTimeAsync(20000)
  expect(native).toHaveBeenCalledTimes(count)
})

test('native timing arriving after its deadline cannot replace the fallback result', async () => {
  jest.useFakeTimers()
  search.mockImplementation(({ source }) => Promise.resolve({ list: source === 'kw' ? [kw] : [] }))
  const native = jest.fn(() => delayed(words, 40000))
  const pending = enrichWordLyrics(track, base, native)
  await jest.advanceTimersByTimeAsync(30001)
  const result = await pending
  expect(result).toBe(base)
  await jest.advanceTimersByTimeAsync(10000)
  expect(result.lines.every(line => !line.words)).toBe(true)
})
