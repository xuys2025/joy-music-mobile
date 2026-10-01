// SPDX-License-Identifier: AGPL-3.0-only
import CryptoJS from 'crypto-js'
import { lyricRequest } from './network'

const PATH = '/api/song/lyric/v1'

/** Public EAPI protocol, as used by LX desktop. No account cookies or user keys. */
export function wyLyricEapiBody(songId: string): string {
  const text = JSON.stringify({ id: songId, cp: false, tv: 0, lv: 0, rv: 0, kv: 0, yv: 0, ytv: 0, yrv: 0 })
  const digest = CryptoJS.MD5(`nobody${PATH}use${text}md5forencrypt`).toString()
  const encrypted = CryptoJS.AES.encrypt(`${PATH}-36cd479b6b5-${text}-36cd479b6b5-${digest}`,
    CryptoJS.enc.Utf8.parse('e82ckenh8dichen8'), { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 })
  return `params=${encrypted.ciphertext.toString().toUpperCase()}`
}

export async function fetchWyEapiLyric(songId: string): Promise<any> {
  const response = await lyricRequest('https://interface3.music.163.com/eapi/song/lyric/v1', {
    method: 'POST', body: wyLyricEapiBody(songId), headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://music.163.com',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
    },
  }, 20000)
  if (!response.ok) throw new Error(`WY lyric HTTP ${response.status}`)
  return response.json()
}
