import { enrichWordLyrics } from '../../../src/core/lyric/wordSources'
import musicSearch from '../../../src/core/search'
import { parseLrc } from '../../../src/core/lyric/parser'
import type { Track } from '../../../src/types/music'

jest.mock('../../../src/core/search', () => ({ __esModule: true, default: { searchTracksBySource: jest.fn() } }))
const search = musicSearch.searchTracksBySource as jest.Mock
const originalFetch = globalThis.fetch
const track: Track = { id: 'wy_123', songmid: '123', source: 'wy', title: '测试歌曲', artist: '测试歌手', album: '测试专辑', duration: 15000, url: '' }
const base = { lines: parseLrc('[00:01]第一句\n[00:04]第二句\n[00:08]第三句\n[00:12]第四句'), rawLrc: 'fixture', rawTlrc: '' }
const ttml = (id = '123', offset = 0) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head><metadata><amll:meta key="ncmMusicId" value="${id}"/></metadata></head><body><div>${base.lines.map(line => `<p begin="${(line.time + offset) / 1000}s" end="${(line.time + offset + 1000) / 1000}s"><span begin="${(line.time + offset) / 1000}s" end="${(line.time + offset + 500) / 1000}s">${line.text[0]}</span><span begin="${(line.time + offset + 500) / 1000}s" end="${(line.time + offset + 1000) / 1000}s">${line.text.slice(1)}</span></p>`).join('')}</div></body></tt>`
const reply = (text: string, status = 200) => ({ ok: status === 200, status, text: async () => text })

beforeEach(() => { globalThis.fetch = jest.fn().mockResolvedValue(reply('', 404)); search.mockReset().mockResolvedValue({ list: [] }) })
afterAll(() => { globalThis.fetch = originalFetch })

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
