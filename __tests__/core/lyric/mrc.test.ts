import { decodeMrc } from '../../../src/core/lyric/mrc'
import { parseMrc, parseTimedLyric } from '../../../src/core/lyric/parser'
import { toRenderLines } from '../../../src/components/lyrics/protocol'
import fixtures from '../../fixtures/mrc.json'

// Synthetic vectors generated independently in Python and checked with LX's
// original decoder. No actual song lyrics or user credentials are included.
test.each(Object.values(fixtures))('decodes signed 64-bit MRC with original UTF-16 text', fixture => {
  expect(decodeMrc(fixture.cipher)).toBe(fixture.decoded)
})
test('MRC zero-time credits remain plain while vocal atoms retain exact times', () => {
  const lines = parseMrc(decodeMrc(fixtures.valid.cipher))
  expect(lines).toHaveLength(2)
  expect(lines[0]).toEqual({ time: 0, text: '测试' })
  expect(lines[1].words).toEqual([{ text: '你', startTime: 1000, endTime: 1500 }, { text: '好', startTime: 1500, endTime: 2000 }])
  expect(toRenderLines(lines)[0].words).toEqual([{ word: '测试', startTime: 0, endTime: 0 }])
})
test('literal parentheses are preserved inside a timed atom', () => {
  const lines = parseMrc(decodeMrc(fixtures.literal.cipher))
  expect(lines[0].text).toBe('测(试)词')
  expect(lines[0].words?.[0].text).toBe('测(试)')
})
test.each(['[1000,1000]你(1000,0)好(1500,500)', '[1000,1000]你(1000,-500)好(1500,500)',
  '[1000,1000]你(1000,600)好(1500,500)', '[1000,1000]你(1000,500)好(1500,500)丢失'])('malformed vocal timing rejects the document: %s', raw => {
  expect(parseMrc('[0,0]测试(0,0)\n' + raw)).toEqual([])
})
test('untimed trailing layout spaces never receive invented timestamps', () => {
  const lines = parseMrc('[1000,1000]你(1000,500)好(1500,500) ')
  expect(lines[0].words).toHaveLength(2)
  expect(parseTimedLyric('[1000,1000]你(1000,500)坏(1500,-500)')).toEqual([])
})
test.each(['', '0'.repeat(32), 'f'.repeat(33), 'z'.repeat(64), 'a'.repeat(262160)])('invalid MRC falls back safely', raw => {
  expect(decodeMrc(raw)).toBe('')
})
