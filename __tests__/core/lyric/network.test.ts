import { lyricRequest, within } from '../../../src/core/lyric/network'

test('a real-sized slow lyric response arriving after 5 seconds stays usable within the 15-second request limit', async () => {
  jest.useFakeTimers()
  const original = globalThis.fetch
  globalThis.fetch = jest.fn(() => new Promise(resolve => setTimeout(() => resolve({ ok: true } as Response), 11000)))
  try {
    const pending = lyricRequest('https://example.com')
    await jest.advanceTimersByTimeAsync(11000)
    expect(await pending).toEqual({ ok: true })
  } finally { globalThis.fetch = original; jest.useRealTimers() }
})
test('the longer default request limit still aborts a stalled endpoint at 15 seconds', async () => {
  jest.useFakeTimers()
  const original = globalThis.fetch
  let signal: AbortSignal | undefined
  globalThis.fetch = jest.fn((_, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}) })
  try {
    const pending = lyricRequest('https://example.com')
    const checked = expect(pending).rejects.toThrow('timeout')
    await jest.advanceTimersByTimeAsync(15000)
    await checked
    expect(signal?.aborted).toBe(true)
  } finally { globalThis.fetch = original; jest.useRealTimers() }
})

test('a stuck provider aborts and rejects instead of indefinitely blocking fallback', async () => {
  jest.useFakeTimers()
  const original = globalThis.fetch
  let signal: AbortSignal | undefined
  globalThis.fetch = jest.fn((_, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}) })
  try {
    const work = lyricRequest('https://example.com', {}, 1000)
    const checked = expect(work).rejects.toThrow('timeout')
    jest.advanceTimersByTime(1000)
    await checked
    expect(signal?.aborted).toBe(true)
  } finally { globalThis.fetch = original; jest.useRealTimers() }
})
test('a late enrichment result cannot replace the selected fallback', async () => {
  jest.useFakeTimers()
  try {
    let finish!: (value: string) => void
    const pending = within(new Promise<string>(resolve => { finish = resolve }), 'native LRC', 1000)
    jest.advanceTimersByTime(1000)
    expect(await pending).toBe('native LRC')
    finish('late unverified words')
    await Promise.resolve()
    expect(await pending).toBe('native LRC')
  } finally { jest.useRealTimers() }
})
