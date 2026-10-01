/**
 * LRC 歌词解析器。
 * 将标准 LRC 格式文本解析为带时间戳的行数组，
 * 支持翻译歌词合并与当前行索引查找。
 */

/** 单行歌词 */
export interface LyricLine {
  /** 时间戳（毫秒） */
  time: number
  /** 歌词文本 */
  text: string
  /** 翻译文本 */
  translation?: string
  /** 真实逐词时间，均为歌曲绝对时间（毫秒） */
  words?: LyricWord[]
  endTime?: number
  romanLyric?: string
  isBG?: boolean
  isDuet?: boolean
}

export interface LyricWord {
  text: string
  startTime: number
  endTime: number
}

/** A provider may give a layout space a zero duration; it is never sung or animated. */
export const validWordDuration = (word: LyricWord): boolean => word.endTime > word.startTime
  || (word.endTime === word.startTime && word.text.length > 0 && !word.text.trim())

/** 网易云 YRC / 已解码的 QQ QRC。保留真实时间，不为普通 LRC 猜测字时间。 */
export function parseTimedLyric(raw: string): LyricLine[] {
  if (/\[offset:\s*[+-]?[1-9]\d*\s*\]/i.test(raw)) return []
  const result: LyricLine[] = []
  const content = raw.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  for (const match of content.matchAll(/\[(\d+),(\d+)\]([^\r\n]*)/g)) {
    const time = Number(match[1])
    const endTime = time + Number(match[2])
    const words: LyricWord[] = []
    const text = match[3]
    if (/\(-?\d+,-?\d+,-?\d+\)/.test(text)) {
      const tokens = [...text.matchAll(/\((-?\d+),(-?\d+),-?\d+\)/g)]
      if (tokens[0]?.index !== 0) continue
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]
        const word = text.slice(token.index! + token[0].length, tokens[i + 1]?.index ?? text.length)
        if (word) words.push({ text: word, startTime: Number(token[1]), endTime: Number(token[1]) + Number(token[2]) })
      }
    } else {
      for (const word of text.matchAll(/([^()]+)\((\d+),(\d+)\)/g)) {
        words.push({ text: word[1], startTime: Number(word[2]), endTime: Number(word[2]) + Number(word[3]) })
      }
    }
    if (words.length && Number.isFinite(endTime) && words.every((w, i) => Number.isFinite(w.startTime) && Number.isFinite(w.endTime) && validWordDuration(w) && w.startTime >= time && w.endTime <= endTime && (!i || w.startTime + 1 >= words[i - 1].endTime))) {
      result.push({ time, endTime: Math.max(endTime, ...words.map(w => w.endTime)), text: words.map(w => w.text).join(''), words })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

/** Parse decrypted KRC; preserve malformed rows as ordinary line lyrics. */
export function parseKrc(raw: string): LyricLine[] {
  const hasOffset = /\[offset:\s*[+-]?[1-9]\d*\s*\]/i.test(raw)
  return [...raw.matchAll(/^\[(\d+),(\d+)\](.*)$/gm)].map(match => {
    const time = Number(match[1]), endTime = time + Number(match[2])
    const body = match[3].replace(/\r$/, '')
    const tokens = [...body.matchAll(/<(-?\d+),(-?\d+),-?\d+>/g)]
    const words = tokens.map((token, i) => ({
      text: body.slice(token.index! + token[0].length, tokens[i + 1]?.index ?? body.length),
      startTime: time + Number(token[1]), endTime: time + Number(token[1]) + Number(token[2]),
    }))
    const text = body.replace(/<-?\d+,-?\d+,-?\d+>/g, '')
    return { time, endTime, text, words: !hasOffset && tokens[0]?.index === 0 ? words : undefined }
  })
}

/** Kuwo's encoded offsets require the octal [kuwo:] calibration tag.
 * Formula documented by LX Music's lrcTools; never assume untagged values are ms.
 */
export function parseKwWords(body: string, time: number, calibration: string): LyricWord[] | undefined {
  const value = /^[0-7]+$/.test(calibration) ? Number.parseInt(calibration, 8) : 0
  const a = Math.trunc(value / 10), b = value % 10
  if (a <= 0 || b <= 0) return undefined
  const tokens = [...body.matchAll(/<(-?\d+),(-?\d+)(?:,-?\d+)?>/g)]
  if (!tokens.length || tokens[0].index !== 0) return undefined
  return tokens.map((token, i) => {
    const x = Number(token[1]), y = Number(token[2])
    const startTime = time + Math.trunc(Math.abs((x + y) / (a * 2)))
    return { text: body.slice(token.index! + token[0].length, tokens[i + 1]?.index ?? body.length),
      startTime, endTime: startTime + Math.trunc(Math.abs((x - y) / (b * 2))) }
  })
}

/** 匹配 LRC 时间标签，如 [01:23.456] */
const TIME_TAG_REG = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g

/**
 * 将时间标签的分/秒/毫秒部分解析为毫秒数。
 * @param m - 分钟字符串
 * @param s - 秒字符串
 * @param ms - 毫秒字符串（可能是 2 或 3 位）
 */
function parseTimeTag(m: string, s: string, ms: string): number {
  const minutes = parseInt(m, 10)
  const seconds = parseInt(s, 10)
  const millis = ms ? parseInt(ms.padEnd(3, '0'), 10) : 0
  return minutes * 60000 + seconds * 1000 + millis
}

/**
 * 解析 LRC 格式歌词文本为 LyricLine 数组。
 * 支持多时间标签行（如 [00:01.00][00:05.00]歌词）。
 * @param lrcText - 标准 LRC 格式文本
 * @returns 按时间排序的歌词行数组
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText) return []

  const lines = lrcText.split(/\r?\n/)
  const result: LyricLine[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const times: number[] = []
    let lastIndex = 0

    TIME_TAG_REG.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TIME_TAG_REG.exec(trimmed)) !== null) {
      times.push(parseTimeTag(match[1], match[2], match[3]))
      lastIndex = TIME_TAG_REG.lastIndex
    }

    if (!times.length) continue

    const text = trimmed.substring(lastIndex).trim()
    if (!text) continue

    for (const time of times) {
      result.push({ time, text })
    }
  }

  result.sort((a, b) => a.time - b.time)
  return result
}

/**
 * 将翻译歌词按时间戳合并到主歌词行。
 * @param lyrics - 主歌词数组
 * @param translations - 翻译歌词数组
 * @returns 合并后的歌词数组
 */
export function mergeLyricTranslation(
  lyrics: LyricLine[],
  translations: LyricLine[]
): LyricLine[] {
  if (!translations.length) return lyrics

  const tMap = new Map<number, string>()
  for (const t of translations) {
    tMap.set(t.time, t.text)
  }

  return lyrics.map((line) => {
    const translation = tMap.get(line.time)
    return translation ? { ...line, translation } : line
  })
}

/**
 * 根据当前播放位置查找对应的歌词行索引。
 * @param lyrics - 歌词行数组（需已按 time 排序）
 * @param positionMs - 当前播放位置（毫秒）
 * @returns 当前行索引；无歌词或尚未开始时返回 -1
 */
export function findCurrentLineIndex(
  lyrics: LyricLine[],
  positionMs: number
): number {
  if (!lyrics.length) return -1

  let idx = -1
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time <= positionMs) {
      idx = i
    } else {
      break
    }
  }
  return idx
}
