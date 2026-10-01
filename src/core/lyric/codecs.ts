// SPDX-License-Identifier: AGPL-3.0-only
// Hermes lacks some browser text APIs: use the small UTF-8 polyfill, no Node APIs.
import 'fast-text-encoding'
import { decryptQrcHex } from '@applemusic-like-lyrics/lyric'
import { TTMLParser, toAmllLyrics } from '@applemusic-like-lyrics/ttml'
import { DOMParser } from '@xmldom/xmldom'
import { inflate } from 'pako'
import type { LyricLine } from './parser'

export function decodeQrc(input: string): string {
  const text = String(input || '').trim()
  if (!text || text.length > 262144) return ''
  const raw = /^[a-f\d]+$/i.test(text) && text.length % 16 === 0 ? decryptQrcHex(text) : text
  const xml = raw.match(/LyricContent\s*=\s*"([\s\S]*?)"/)
  return (xml?.[1] || raw).replace(/&#10;|&#x0*a;/gi, '\n').replace(/&#13;|&#x0*d;/gi, '\r')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** KRC offsets are relative to their line, unlike YRC/QRC absolute timestamps. */
export function decodeKrc(base64: string): string {
  if (!base64 || base64.length > 262144) return ''
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'krc1') return ''
  const key = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69]
  const data = bytes.subarray(4).map((byte, i) => byte ^ key[i % key.length])
  return inflate(data, { to: 'string' })
}

export function readTTML(raw: string): { lines: LyricLine[]; metadata: [string, string[]][] } {
  if (raw.length > 524288 || /<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('unsupported TTML')
  const parser = new DOMParser({ onError: () => { throw new Error('invalid TTML XML') } })
  const domParser = { parseFromString: (text: string, type: string) => {
    const doc = parser.parseFromString(text, type as 'application/xml')
    // Older community files omit Apple's line keys. Add identifiers only;
    // lyrics, timestamps and vocal attributes are never inferred or changed.
    Array.from(doc.getElementsByTagName('p')).forEach((line, i) => {
      if (!line.hasAttributeNS('http://music.apple.com/lyric-ttml-internal', 'key'))
        line.setAttributeNS('http://music.apple.com/lyric-ttml-internal', 'itunes:key', `joy-line-${i}`)
    })
    return doc
  } }
  const result = toAmllLyrics(TTMLParser.parse(raw, { domParser }))
  return {
    metadata: result.metadata,
    lines: result.lines.map(line => ({
      time: line.startTime, endTime: line.endTime, text: line.words.map(word => word.word).join(''),
      words: line.words.map(word => ({ text: word.word, startTime: word.startTime, endTime: word.endTime })),
      translation: line.translatedLyric || undefined, romanLyric: line.romanLyric || undefined,
      isBG: line.isBG, isDuet: line.isDuet,
    })),
  }
}
