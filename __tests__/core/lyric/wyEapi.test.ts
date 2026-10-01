import { wyLyricEapiBody } from '../../../src/core/lyric/wyEapi'
import fixture from '../../fixtures/wy-eapi.json'

test('lyric EAPI encryption interoperates with independent Node AES + MD5', () => {
  // Vector generated using Node createCipheriv/createHash, not production CryptoJS.
  expect(wyLyricEapiBody(fixture.songId)).toBe(fixture.body)
})
