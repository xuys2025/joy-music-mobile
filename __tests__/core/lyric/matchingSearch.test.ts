import musicSearch from '../../../src/core/search'
import { httpRequest } from '../../../src/core/discover/http'

jest.mock('../../../src/core/discover/http', () => ({ httpRequest: jest.fn(), withRetry: (task: () => unknown) => task() }))
const request = httpRequest as jest.Mock
beforeEach(() => {
  request.mockReset().mockImplementation(async (url: string) => url.includes('pic.web')
    ? { data: 'https://img4.kuwo.cn/fixture.jpg' }
    : { data: { TOTAL: '1', abslist: [{ MUSICRID: 'MUSIC_234', SONGNAME: 'Fixture', ARTIST: 'Singer',
      ALBUM: 'Album', DURATION: '15' }] } })
})

test('lyric matching obtains Kuwo recording metadata without waiting for cover downloads', async () => {
  const page = await musicSearch.searchTracksBySource({ query: 'Fixture Singer', source: 'kw', includeArtwork: false })
  expect(page.list).toHaveLength(1)
  expect(page.list[0]).toMatchObject({ songmid: '234', title: 'Fixture', artist: 'Singer', album: 'Album', duration: 15000 })
  expect(request).toHaveBeenCalledTimes(1)
})

test('normal Kuwo search continues to fetch missing artwork by default', async () => {
  const page = await musicSearch.searchTracksBySource({ query: 'Fixture Singer', source: 'kw' })
  expect(request).toHaveBeenCalledTimes(2)
  expect(page.list[0].coverUrl).toBe('https://img4.kuwo.cn/fixture.jpg')
})
