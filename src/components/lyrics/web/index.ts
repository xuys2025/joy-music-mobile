// SPDX-License-Identifier: AGPL-3.0-only
import { LyricPlayer, type LyricLine, type LyricLineMouseEvent } from '@applemusic-like-lyrics/core'
import '@applemusic-like-lyrics/core/style.css'
import './style.css'
import { PlaybackClock, type PlaybackState } from '../protocol'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void }
    receiveLyrics(message: Message): void
  }
}
type Message = { type: 'lines'; lines: LyricLine[]; position: number }
  | { type: 'clock'; state: PlaybackState }
  | { type: 'theme'; dark: boolean; reducedMotion: boolean }

function send(message: object) { window.ReactNativeWebView?.postMessage(JSON.stringify(message)) }
window.addEventListener('error', () => send({ type: 'error' }))
window.addEventListener('unhandledrejection', () => send({ type: 'error' }))

const player = new LyricPlayer()
document.getElementById('lyrics')!.appendChild(player.getElement())
player.setAlignPosition(0.34)
player.setEnableAutoSeekDetection(false)
player.setWordFadeWidth(0.6)
const clock = new PlaybackClock()
let state: PlaybackState = { position: 0, duration: 0, playing: false, active: false }
let frame = 0
let lastFrame = 0
let settleUntil = 0
let reducedMotion = false

function tick(now: number) {
  frame = 0
  if (!state.active || document.hidden) return
  player.setCurrentTime(clock.time(now))
  player.update(Math.min(64, Math.max(0, now - lastFrame)))
  lastFrame = now
  if (state.playing || now < settleUntil) frame = requestAnimationFrame(tick)
}
function wake() {
  if (!state.active || document.hidden) {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    player.pause()
    return
  }
  settleUntil = performance.now() + (reducedMotion ? 0 : 900)
  if (!frame) { lastFrame = performance.now(); frame = requestAnimationFrame(tick) }
}
window.receiveLyrics = message => {
  try {
    if (message.type === 'lines') {
      player.setLyricLines(message.lines, message.position)
      player.setCurrentTime(message.position, true)
    } else if (message.type === 'clock') {
      state = message.state
      const seek = clock.sync(state, performance.now())
      player.setCurrentTime(clock.time(performance.now()), seek)
      if (state.playing && state.active) player.resume()
      else player.pause()
    } else if (message.type === 'theme') {
      document.documentElement.dataset.theme = message.dark ? 'dark' : 'light'
      reducedMotion = message.reducedMotion
      player.setEnableBlur(!reducedMotion)
      player.setEnableScale(!reducedMotion)
      player.setEnableSpring(!reducedMotion)
    }
    wake()
  } catch { send({ type: 'error' }) }
}
player.addEventListener('line-click', event => {
  const lineEvent = event as LyricLineMouseEvent
  lineEvent.preventDefault()
  const time = player.getLyricLines()[lineEvent.lineIndex]?.startTime
  if (Number.isFinite(time)) send({ type: 'seek', time })
})
document.addEventListener('visibilitychange', wake)
window.addEventListener('pagehide', () => { if (frame) cancelAnimationFrame(frame); frame = 0; player.pause() })
send({ type: 'ready' })
