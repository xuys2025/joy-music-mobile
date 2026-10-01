// SPDX-License-Identifier: Apache-2.0
// Adapted from lyswhut/lx-music-desktop, src/renderer/utils/musicSdk/mg/utils/mrc.js
// Reference: ad95d5091c9ed689fa72b5e5c849df65f5a679ce; license: licenses/LX-Apache-2.0.txt.
// Changes: bounded inputs, BigInt.asIntN wrapping and UTF-16 decoding without Node Buffer.
const DELTA = 2654435769n
const KEY = [27303562373562475n, 18014862372307051n, 22799692160172081n, 34058940340699235n]
const long = (value: bigint): bigint => BigInt.asIntN(64, value)

/** Migu MRC uses signed 64-bit XXTEA and UTF-16LE, unlike QRC/KRC. */
export function decodeMrc(input: string): string {
  const text = String(input || '').trim()
  if (text.length < 32 || text.length > 262144 || text.length % 16 || !/^[\da-f]+$/i.test(text)) return ''
  const data: bigint[] = []
  for (let i = 0; i < text.length; i += 16) data.push(long(BigInt(`0x${text.slice(i, i + 16)}`)))
  const mix = (z: bigint, y: bigint, sum: bigint, key: bigint) => long(
    long(long(y ^ sum) + long(z ^ key)) ^
    long(long(long(z >> 5n) ^ long(y << 2n)) + long(long(y >> 3n) ^ long(z << 4n))))
  let y = data[0]
  let sum = long((6n + 52n / BigInt(data.length)) * DELTA)
  while (sum !== 0n) {
    const e = Number((sum >> 2n) & 3n)
    for (let p = data.length - 1; p > 0; p--) {
      y = data[p] = long(data[p] - mix(data[p - 1], y, sum, KEY[(p & 3) ^ e]))
    }
    y = data[0] = long(data[0] - mix(data[data.length - 1], y, sum, KEY[e]))
    sum = long(sum - DELTA)
  }
  let raw = ''
  for (const value of data) {
    for (let shift = 0n; shift < 64n; shift += 16n) raw += String.fromCharCode(Number((value >> shift) & 65535n))
  }
  // Real Migu files can end with zero padding followed by a newline.
  raw = raw.replace(/[\0\r\n]+$/, '')
  return /^\[\d+,\d+\]/m.test(raw) && !raw.includes('\0') ? raw : ''
}
