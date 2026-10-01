import { parseLrc, parseTimedLyric, mergeLyricTranslation } from '../../../src/core/lyric/parser'
import { PlaybackClock, bridgeScript, toRenderLines } from '../../../src/components/lyrics/protocol'

const yrc = '[1000,2000](1000,400,0)你(1400,800,0)好(2200,800,0)呀'

describe('real lyric timings and graceful LRC conversion', () => {
  test('preserves word timestamps, spaces and translations', () => {
    const lines = mergeLyricTranslation(parseTimedLyric(yrc), parseLrc('[00:01.00]Hello'))
    expect(lines[0]).toMatchObject({ time: 1000, endTime: 3000, text: '你好呀', translation: 'Hello' })
    expect(toRenderLines(lines)[0].words).toEqual([
      { word: '你', startTime: 1000, endTime: 1400 },
      { word: '好', startTime: 1400, endTime: 2200 },
      { word: '呀', startTime: 2200, endTime: 3000 },
    ])
    expect(parseTimedLyric('[0,1000](0,500,0)Hello (500,500,0)world')[0].text).toBe('Hello world')
  })
  test('preserves parentheses in lyrics and rejects negative word duration', () => {
    expect(parseTimedLyric('[0,1000](0,1000,0)Hello (world)')[0].text).toBe('Hello (world)')
    expect(parseTimedLyric('[0,1000](0,-500,0)无效')).toEqual([])
  })
  test('ordinary LRC remains one timed line, including the final line', () => {
    const lines = toRenderLines(parseLrc('[00:01]一行\n[00:04]下一行'), 10000)
    expect(lines.map(line => line.words.length)).toEqual([1, 1])
    expect(lines.map(line => line.endTime)).toEqual([4000, 10000])
  })
  test.each(['', '[00:01]普通歌词', '[1000,1000](0,500,0)越界', '[1000,1000](1000,5000,0)越界', '[0,1000](800,100,0)乱(200,100,0)序'])('rejects unavailable or invalid timing: %s', raw => {
    expect(parseTimedLyric(raw)).toEqual([])
  })
  test('invalid word timestamps fall back as a whole line', () => {
    expect(toRenderLines([{ time: 1000, text: '歌词', words: [{ text: '词', startTime: -1, endTime: 1000 }] }])[0].words)
      .toEqual([{ word: '歌词', startTime: 1000, endTime: 1000 }])
  })
  test('never executes lyric text in the bridge', () => {
    const value = { type: 'lines', text: '</script>\"; globalThis.attack = true; //\n\u2028你好\\' }
    const receive = jest.fn()
    new Function('window', bridgeScript(value))({ receiveLyrics: receive })
    expect(receive).toHaveBeenCalledWith(value)
    expect((globalThis as any).attack).toBeUndefined()
  })
})

describe('native audio remains the authority for the lyric clock', () => {
  const base = { position: 1000, duration: 10000, playing: true, active: true }
  test('interpolates updates, caps stalls and clamps song end', () => {
    const clock = new PlaybackClock()
    clock.sync(base, 0)
    expect(clock.time(250)).toBe(1250)
    expect(clock.time(5000)).toBe(2000)
    clock.sync({ ...base, position: 9900 }, 5000)
    expect(clock.time(5250)).toBe(10000)
  })
  test.each([{ playing: false }, { active: false }])('does not advance when paused or hidden: %p', patch => {
    const clock = new PlaybackClock()
    clock.sync({ ...base, ...patch }, 0)
    expect(clock.time(500)).toBe(1000)
  })
  test('seek protects against late old progress and accepts the new audio position', () => {
    const clock = new PlaybackClock()
    clock.sync(base, 0)
    expect(clock.sync({ ...base, position: 8000, seek: true }, 100)).toBe(true)
    clock.sync({ ...base, position: 1100 }, 200)
    expect(clock.time(200)).toBe(8100)
    clock.sync({ ...base, position: 8200 }, 300)
    expect(clock.time(400)).toBe(8300)
  })
  test('failed seek eventually reconciles with actual native playback', () => {
    const clock = new PlaybackClock()
    clock.sync({ ...base, position: 8000, seek: true }, 0)
    clock.sync(base, 1300)
    expect(clock.time(1300)).toBe(1000)
  })
})
