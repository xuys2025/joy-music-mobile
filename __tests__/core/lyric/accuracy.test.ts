import { hasWordTiming, mergeNativeTiming, sameRecordingMetadata, sanitizeTiming, validWordLine, verifiedTimeline } from '../../../src/core/lyric/accuracy'
import { parseKrc, parseKwWords, parseLrc, parseTimedLyric } from '../../../src/core/lyric/parser'
import { toRenderLines } from '../../../src/components/lyrics/protocol'
import type { Track } from '../../../src/types/music'

const baseline = parseLrc('[00:01]第一句\n[00:04]第二句\n[00:08]第三句\n[00:12]第四句')
const timed = baseline.map(line => ({ ...line, endTime: line.time + 1000,
  words: [{ text: line.text.slice(0, 1), startTime: line.time, endTime: line.time + 500 },
    { text: line.text.slice(1), startTime: line.time + 500, endTime: line.time + 1000 }] }))
const track: Track = { id: '1', source: 'kw', title: 'Song (Live)', artist: 'A / B', album: 'Album', duration: 15000, url: '' }

test('mixed untimed rows have no estimated word interval at the renderer bridge', () => {
  const rows = toRenderLines([timed[0], baseline[1]], 15000)
  expect(rows[0].words.map(word => [word.startTime, word.endTime])).toEqual([[1000, 1500], [1500, 2000]])
  expect(rows[1].words).toEqual([{ word: '第二句', startTime: 4000, endTime: 4000 }])
  expect(rows[1].endTime).toBe(15000)
})

test('same text is insufficient: verify timing throughout the song', () => {
  expect(verifiedTimeline(timed, baseline, 15000)).toBe(true)
  expect(verifiedTimeline(timed.map(line => ({ ...line, time: line.time + 600 })), baseline, 15000)).toBe(false)
  expect(verifiedTimeline(timed.map((line, i) => i === 3 ? { ...line, text: '另一句' } : line), baseline)).toBe(false)
  expect(verifiedTimeline(timed.slice(0, 2), baseline)).toBe(false)
  expect(verifiedTimeline(timed, baseline.slice(0, 2))).toBe(false)
})

test.each([
  { title: 'Song' }, { title: 'Song (Remix)' }, { artist: 'C' }, { album: 'Another album' },
  { album: '' }, { duration: 0 }, { duration: 17000 },
])('rejects different or unknown recording metadata: %p', patch => {
  expect(sameRecordingMetadata(track, { ...track, ...patch })).toBe(false)
})
test('artist order and punctuation can normalize; recording version remains significant', () => {
  expect(sameRecordingMetadata(track, { ...track, artist: 'B、A', duration: 15500 })).toBe(true)
})

test.each([
  { words: [{ text: '第一句', startTime: -1, endTime: 2000 }] },
  { words: [{ text: '第一句', startTime: 1000, endTime: 1000 }] },
  { words: [{ text: '第一句', startTime: 1000, endTime: 2100 }] },
  { words: [{ text: '第', startTime: 1000, endTime: 1800 }, { text: '一句', startTime: 1700, endTime: 2000 }] },
  { words: [{ text: '缺字', startTime: 1000, endTime: 2000 }] },
  { words: [{ text: '第一句', startTime: NaN, endTime: Infinity }] },
])('invalid row keeps its text but removes every word timing: %p', patch => {
  const line = { ...timed[0], ...patch }
  expect(validWordLine(line)).toBe(false)
  expect(sanitizeTiming([line])[0]).toEqual(baseline[0])
  expect(toRenderLines([line], 15000)[0].words).toHaveLength(1)
  expect(verifiedTimeline([line, ...timed.slice(1)], baseline)).toBe(false)
})

test('rejects timing outside actual song duration', () => {
  expect(validWordLine(timed[3], 10000)).toBe(false)
  expect(hasWordTiming(baseline)).toBe(false)
})
test('retains 1 ms integer quantization without rewriting source timestamps', () => {
  const line = { ...timed[0], words: [{ text: '第', startTime: 1000, endTime: 1501 }, { text: '一句', startTime: 1500, endTime: 2000 }] }
  expect(validWordLine(line)).toBe(true)
  expect(sanitizeTiming([line])[0].words?.[0].endTime).toBe(1501)
})
test('native partial timing preserves missing and invalid LRC rows', () => {
  const rows = mergeNativeTiming([timed[0], { ...timed[1], words: [] }], baseline, 15000)
  expect(rows).toHaveLength(4)
  expect(rows[0].words).toHaveLength(2)
  expect(rows[1]).toEqual(baseline[1])
  expect(rows[3]).toEqual(baseline[3])
})
test('KRC offsets are relative to line time; corrupt words remain plain text', () => {
  const rows = sanitizeTiming(parseKrc('[1000,1000]<0,500,0>你<500,500,0>好\n[4000,1000]<0,-2,0>坏'), 15000)
  expect(rows[0].words?.map(word => word.startTime)).toEqual([1000, 1500])
  expect(rows[1].text).toBe('坏')
  expect(rows[1].words).toBeUndefined()
})
test('nonzero document offsets do not pretend to be precise', () => {
  expect(parseTimedLyric('[offset:50]\n[1000,1000](1000,1000,0)句子')).toEqual([])
  expect(parseKrc('[offset:50]\n[1000,1000]<0,1000,0>句子')[0].words).toBeUndefined()
})
test('Kuwo encoded offsets require valid calibration, no guessed millisecond values', () => {
  expect(parseKwWords('<500,-500>你<1500,-500>好', 1000, '13')).toEqual([
    { text: '你', startTime: 1000, endTime: 1500 }, { text: '好', startTime: 1500, endTime: 2500 },
  ])
  expect(parseKwWords('<500,-500>你', 1000, '')).toBeUndefined()
  expect(parseKwWords('<500,-500>你', 1000, '10')).toBeUndefined()
})

test('verified TTML vocal/romanization attributes reach the existing renderer', () => {
  expect(toRenderLines([{ ...timed[0], isBG: true, isDuet: true, romanLyric: 'roman' }])[0])
    .toMatchObject({ isBG: true, isDuet: true, romanLyric: 'roman' })
})
test.each([Infinity, NaN, 999999])('invalid word end falls back using ordinary line boundaries: %s', endTime => {
  expect(toRenderLines([{ ...timed[0], endTime }, baseline[1]], 15000)[0].endTime).toBe(4000)
})
test('credit rows cannot count as independent whole-song lyric anchors', () => {
  const text = ['歌手：测试', '专辑：测试', '制作人：测试', '实际歌词']
  const rows = timed.map((line, i) => ({ ...line, text: text[i], words: [{ text: text[i][0], startTime: line.time, endTime: line.time + 500 },
    { text: text[i].slice(1), startTime: line.time + 500, endTime: line.time + 1000 }] }))
  expect(verifiedTimeline(rows, rows.map(({ words, ...line }) => line))).toBe(false)
})
