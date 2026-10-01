// DOM smoke test of the exact inline bundle shipped in the IPA, not a visual/device test.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM, VirtualConsole } from 'jsdom'

const source = await readFile(new URL('../src/components/lyrics/generated/lyricsHtml.ts', import.meta.url), 'utf8')
const html = JSON.parse(source.slice(source.indexOf('= ') + 2).trim())
const messages = []
const errors = []
const frames = new Map()
let nextFrame = 0
const console = new VirtualConsole()
console.on('jsdomError', error => { if (!error.message.includes('Could not parse CSS')) errors.push(error) })
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: console,
  beforeParse(window) {
    window.ReactNativeWebView = { postMessage: text => messages.push(JSON.parse(text)) }
    const getStyle = window.getComputedStyle.bind(window)
    window.getComputedStyle = element => { const style = getStyle(element); style.fontSize = '32px'; return style }
    window.CSS = { supports: () => true, escape: value => value }
    window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.seen = new Set() }
      observe(target) {
        if (this.seen.has(target)) return
        this.seen.add(target)
        queueMicrotask(() => this.callback([{ target, contentRect: { width: 390, height: target.classList.contains('amll-lyric-player') ? 600 : 90 }, borderBoxSize: [{ inlineSize: 390, blockSize: 90 }] }]))
      }
      unobserve() {} disconnect() {}
    }
    window.requestAnimationFrame = fn => { const id = ++nextFrame; frames.set(id, fn); return id }
    window.cancelAnimationFrame = id => frames.delete(id)
    window.Element.prototype.animate = () => ({ play() {}, pause() {}, cancel() {}, finish() {}, currentTime: 0, effect: { getComputedTiming: () => ({ progress: 0 }) }, finished: new Promise(() => {}) })
  },
})
const window = dom.window
await Promise.resolve()
assert.deepEqual(errors, [])
assert.ok(messages.some(message => message.type === 'ready'), 'inline bundle initializes the actual AMLL player')
assert.equal(messages.some(message => message.type === 'error'), false)
assert.ok(window.document.querySelector('.amll-lyric-player'))
window.receiveLyrics({ type: 'lines', position: 1000, lines: [{
  startTime: 1000, endTime: 3000, isBG: false, isDuet: false, translatedLyric: 'Hello', romanLyric: '',
  words: [{ word: '你好 </script>', startTime: 1000, endTime: 2000 }, { word: '世界', startTime: 2000, endTime: 3000 }],
}] })
assert.equal(messages.some(message => message.type === 'error'), false, 'real AMLL accepts the bridge lyric schema')
window.receiveLyrics({ type: 'clock', state: { position: 1000, duration: 4000, playing: true, active: true } })
for (let index = 0; index < 60; index++) {
  const pending = [...frames.values()]; frames.clear()
  pending.forEach(fn => fn(window.performance.now() + index * 16))
  await Promise.resolve()
}
assert.ok(window.document.getElementById('lyrics').textContent.includes('你好 </script>'))
window.receiveLyrics({ type: 'clock', state: { position: 1000, duration: 4000, playing: true, active: true } })
assert.equal(frames.size, 1, 'starts exactly one animation loop')
window.document.querySelector('[class*="_lyricLineWrapper"]:not([class*="_bottomLineWrapper"])')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
assert.ok(messages.some(message => message.type === 'seek' && message.time === 1000), 'click forwards the lyric start time')
window.receiveLyrics({ type: 'theme', dark: false, reducedMotion: true })
assert.equal(window.document.documentElement.dataset.theme, 'light')
window.receiveLyrics({ type: 'clock', state: { position: 1200, duration: 4000, playing: true, active: false } })
assert.equal(frames.size, 0, 'leaving lyrics cancels animation')
assert.equal(messages.some(message => message.type === 'error'), false)
window.dispatchEvent(new window.ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }))
assert.equal(messages.some(message => message.type === 'error'), false, 'deferred WebKit layout notification does not discard the renderer')
window.dispatchEvent(new window.ErrorEvent('error', { message: 'Synthetic runtime failure' }))
assert.ok(messages.some(message => message.type === 'error' && message.phase === 'runtime'), 'real page failures report a safe diagnostic phase')
assert.ok(window.document.getElementById('open-source-licenses').textContent.includes('GNU AFFERO GENERAL PUBLIC LICENSE'))
assert.ok(html.includes("connect-src 'none'"))
dom.window.close()
process.stdout.write('Bundled AMLL DOM smoke: initialization, schema, safe text, seek, theme, visibility and licenses passed.\n')
