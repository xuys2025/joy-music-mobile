// SPDX-License-Identifier: AGPL-3.0-only
export async function lyricRequest(url: string, init: RequestInit = {}, timeout = 5000): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('lyric request timeout')) }, timeout)
  })
  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), deadline])
  } finally { clearTimeout(timer!) }
}

/** Also bound providers that do not accept an AbortSignal; no late result is applied. */
export async function within<T>(work: Promise<T>, fallback: T, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(fallback), timeout)
    })])
  } finally { clearTimeout(timer!) }
}
