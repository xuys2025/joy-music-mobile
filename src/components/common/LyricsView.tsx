// SPDX-License-Identifier: AGPL-3.0-only
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useTheme } from '../../theme'
import type { LyricLine } from '../../core/lyric'
import NativeLyricsView from './NativeLyricsView'
import { lyricsHtml } from '../lyrics/generated/lyricsHtml'
import { bridgeScript, toRenderLines } from '../lyrics/protocol'

interface Props {
  lyrics: LyricLine[]
  position: number
  duration?: number
  isPlaying?: boolean
  loading?: boolean
  active?: boolean
  onSeek?: (timeMs: number) => void
}
const source = { html: lyricsHtml, baseUrl: 'about:blank' }
const SOURCE_URL = 'https://github.com/xuys2025/joy-music-mobile/tree/feature/applemusic-lyrics'

export default function LyricsView({ lyrics, position, duration = 0, isPlaying = false, loading, active = true, onSeek }: Props) {
  const { isDark, colors } = useTheme()
  const web = useRef<WebView>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const [reducedMotion, setReducedMotion] = useState(false)
  const [screenReader, setScreenReader] = useState(false)
  const current = useRef({ position, duration, isPlaying, active: active && foreground })
  current.current = { position, duration, isPlaying, active: active && foreground }
  const send = useCallback((message: unknown) => web.current?.injectJavaScript(bridgeScript(message)), [])
  const hasLyrics = lyrics.length > 0 && !loading

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReducedMotion(value) })
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (mounted) setScreenReader(value) })
    const app = AppState.addEventListener('change', value => setForeground(value === 'active'))
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion)
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader)
    return () => { mounted = false; app.remove(); motion.remove(); reader.remove() }
  }, [])
  useEffect(() => { if (!hasLyrics || screenReader) setReady(false) }, [hasLyrics, screenReader])
  useEffect(() => {
    if (!hasLyrics || ready || failed || screenReader || !foreground) return
    const timer = setTimeout(() => setFailed('启动超时'), 12000)
    return () => clearTimeout(timer)
  }, [hasLyrics, ready, failed, screenReader, foreground])
  useEffect(() => {
    if (ready) send({ type: 'lines', lines: toRenderLines(lyrics, duration), position: current.current.position })
  }, [ready, lyrics, duration, send])
  useEffect(() => { if (ready) send({ type: 'theme', dark: isDark, reducedMotion }) }, [ready, isDark, reducedMotion, send])
  useEffect(() => {
    if (ready) send({ type: 'clock', state: { position, duration, playing: isPlaying, active: active && foreground } })
  }, [ready, position, duration, isPlaying, active, foreground, send])

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data)
      if (message.type === 'ready') setReady(true)
      else if (message.type === 'error') {
        const phases: Record<string, string> = { startup: '初始化', runtime: '脚本运行', lines: '歌词加载', clock: '播放同步', theme: '主题设置' }
        setFailed(phases[message.phase] || '页面运行')
      }
      else if (message.type === 'seek' && typeof message.time === 'number' && Number.isFinite(message.time)
        && message.time >= 0 && (!current.current.duration || message.time <= current.current.duration)) {
        if (!current.current.active) return
        send({ type: 'clock', state: { ...current.current, position: message.time, playing: current.current.isPlaying, seek: true } })
        onSeek?.(message.time)
      }
    } catch { /* Ignore malformed WebView messages. */ }
  }, [onSeek, send])

  if (!hasLyrics || failed || screenReader) return (
    <View style={styles.container}>
      <NativeLyricsView lyrics={lyrics} position={position} loading={loading} active={active} onSeek={onSeek} />
      {failed && hasLyrics && !screenReader && (
        <TouchableOpacity accessibilityRole="button" style={styles.retry} onPress={() => { setReady(false); setFailed(null) }}>
          <Text style={[styles.creditText, { color: colors.textSecondary }]}>高级歌词不可用（{failed}） · 轻点重试</Text>
        </TouchableOpacity>
      )}
    </View>
  )
  return (
    <View style={styles.container}>
      <WebView
        ref={web} source={source} originWhitelist={['*']} onMessage={onMessage}
        style={styles.web} containerStyle={styles.web} scrollEnabled={false}
        onLoadStart={() => setReady(false)}
        onLoadEnd={() => web.current?.injectJavaScript("if (typeof window.receiveLyrics === 'function') window.ReactNativeWebView?.postMessage(JSON.stringify({type:'ready'})); true;")}
        javaScriptEnabled domStorageEnabled={false} cacheEnabled={false} bounces={false}
        dataDetectorTypes="none" allowsInlineMediaPlayback={false}
        onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
        onError={() => setFailed('网页加载')} onHttpError={() => setFailed('网页加载')}
        onContentProcessDidTerminate={() => setFailed('渲染进程退出')}
        onRenderProcessGone={() => setFailed('渲染进程退出')}
        accessibilityLabel="同步歌词，轻点歌词跳转播放"
      />
      <View style={styles.credit}>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="AMLL 开源项目" onPress={() => { void Linking.openURL('https://github.com/Steve-xmh/applemusic-like-lyrics') }}>
          <Text style={[styles.creditText, { color: colors.textSecondary }]}>AMLL</Text>
        </TouchableOpacity>
        <Text style={[styles.creditText, { color: colors.textSecondary }]}> · </Text>
        <TouchableOpacity accessibilityRole="link" accessibilityLabel="查看本版本源代码与许可证" onPress={() => { void Linking.openURL(SOURCE_URL) }}>
          <Text style={[styles.creditText, { color: colors.textSecondary }]}>源码与许可</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  container: { flex: 1 }, web: { flex: 1, backgroundColor: 'transparent' },
  credit: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 8 },
  creditText: { fontSize: 10, opacity: 0.7 },
  retry: { alignItems: 'center', paddingVertical: 8 },
})
