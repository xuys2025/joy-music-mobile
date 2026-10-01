// Exercise the shipped codecs in a Hermes-like JS environment (no Node Buffer,
// DOM, TextEncoder or TextDecoder), not only in Node's native environment.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { encryptQrcHex } from '@applemusic-like-lyrics/lyric'
import { deflate } from 'pako'
import { readFile } from 'node:fs/promises'
import { createDecipheriv } from 'node:crypto'

const result = await build({ stdin: { contents: `export * from './src/core/lyric/codecs'; export * from './src/core/lyric/mrc'; export { wyLyricEapiBody } from './src/core/lyric/wyEapi'`, resolveDir: process.cwd() }, bundle: true, write: false,
  platform: 'browser', format: 'iife', globalName: 'codecs', target: ['es2020'] })
const context = vm.createContext({ atob, btoa, console })
context.global = context
vm.runInContext(result.outputFiles[0].text, context)
assert.equal(vm.runInContext('typeof Buffer', context), 'undefined')
const xml = '<QrcInfos><Lyric_1 LyricContent="[1000,1000]你(1000,500)好(1500,500)"/></QrcInfos>'
assert.equal(context.codecs.decodeQrc(encryptQrcHex(xml)), '[1000,1000]你(1000,500)好(1500,500)')
const krc = '[1000,1000]<0,500,0>你<500,500,0>好'
const key = [0x40,0x47,0x61,0x77,0x5e,0x32,0x74,0x47,0x51,0x36,0x31,0x2d,0xce,0xd2,0x6e,0x69]
const data = deflate(krc).map((byte, i) => byte ^ key[i % 16])
const encoded = Buffer.concat([Buffer.from('krc1'), data]).toString('base64')
assert.equal(context.codecs.decodeKrc(encoded), krc)
const ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:amll="http://www.example.com/ns/amll" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><head><metadata><amll:meta key="ncmMusicId" value="123"/></metadata></head><body><div><p begin="1s" end="2s"><span begin="1s" end="1.5s">你</span><span begin="1.5s" end="2s">好</span></p></div></body></tt>'
const parsed = context.codecs.readTTML(ttml)
assert.equal(parsed.lines[0].text, '你好')
assert.equal(parsed.lines[0].words[1].startTime, 1500)
assert.ok(parsed.metadata.some(([key, values]) => key === 'ncmMusicId' && values.includes('123')))
assert.throws(() => context.codecs.readTTML('<!DOCTYPE tt><tt/>'))
const fixtures = JSON.parse(await readFile('__tests__/fixtures/mrc.json', 'utf8'))
for (const fixture of Object.values(fixtures)) assert.equal(context.codecs.decodeMrc(fixture.cipher), fixture.decoded)
assert.equal(context.codecs.decodeMrc('f'.repeat(33)), '')
const body = context.codecs.wyLyricEapiBody('185709')
const decipher = createDecipheriv('aes-128-ecb', 'e82ckenh8dichen8', null)
const request = Buffer.concat([decipher.update(Buffer.from(body.slice(7), 'hex')), decipher.final()]).toString()
assert.equal(JSON.parse(request.split('-36cd479b6b5-')[1]).id, '185709')
process.stdout.write('Browser/Hermes-like codecs: QRC, KRC, MRC, EAPI and TTML passed without Node/DOM globals.\n')
