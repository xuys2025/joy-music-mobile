import { fetchLyric } from '../../../src/core/lyric/fetcher'
import { wyRequest } from '../../../src/core/discover/wyCrypto'
import type { Track } from '../../../src/types/music'

jest.mock('../../../src/core/discover/wyCrypto', () => ({ wyRequest: jest.fn() }))
const request = wyRequest as jest.Mock
const track: Track = { id: 'test-song', songmid: 'test-song', source: 'wy', title: 'Fixture', artist: 'Fixture', duration: 10000, url: '' }
const lrc = '[00:01]你好\n[00:03]世界'
beforeEach(() => request.mockReset())

test('prefers actual YRC and its matching translation', async () => {
  request.mockResolvedValue({ data: { code: 200, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好' }, lrc: { lyric: lrc }, ytlrc: { lyric: '[00:01]Hello' } } })
  const data = await fetchLyric(track)
  expect(data.lines[0].words).toHaveLength(2)
  expect(data.lines[0].translation).toBe('Hello')
  expect(request).toHaveBeenCalledTimes(1)
})
test('uses LRC from the new endpoint when YRC is absent or corrupt', async () => {
  request.mockResolvedValue({ data: { code: 200, yrc: { lyric: 'corrupt' }, lrc: { lyric: lrc } } })
  expect((await fetchLyric(track)).lines).toEqual([{ time: 1000, text: '你好' }, { time: 3000, text: '世界' }])
  expect(request).toHaveBeenCalledTimes(1)
})
test.each(['error', 'empty', 'unauthorized'])('falls back to the legacy endpoint after %s', async kind => {
  if (kind === 'error') request.mockRejectedValueOnce(new Error('network'))
  else request.mockResolvedValueOnce({ data: { code: kind === 'empty' ? 200 : 401 } })
  request.mockResolvedValueOnce({ data: { code: 200, lrc: { lyric: lrc } } })
  expect((await fetchLyric(track)).lines).toHaveLength(2)
  expect(request.mock.calls[1][0]).toBe('https://music.163.com/api/song/lyric')
})
