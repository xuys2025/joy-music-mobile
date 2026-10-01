// SPDX-License-Identifier: AGPL-3.0-only
/** Keep AMLL's DOM writes out of WebKit's ResizeObserver delivery phase. */
export function deferResizeObserverDelivery(onError: () => void) {
  const NativeObserver = window.ResizeObserver
  window.ResizeObserver = class extends NativeObserver {
    private stopDelivery: () => void
    private forgetTarget: (target: Element) => void
    constructor(callback: ResizeObserverCallback) {
      let frame = 0
      const pending = new Map<Element, ResizeObserverEntry>()
      super((entries, observer) => {
        for (const entry of entries) pending.set(entry.target, entry)
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          const batch = [...pending.values()]
          pending.clear()
          if (batch.length) {
            try { callback(batch, observer) } catch { onError() }
          }
        })
      })
      this.stopDelivery = () => {
        if (frame) cancelAnimationFrame(frame)
        frame = 0
        pending.clear()
      }
      this.forgetTarget = target => pending.delete(target)
    }
    unobserve(target: Element) { super.unobserve(target); this.forgetTarget(target) }
    disconnect() { super.disconnect(); this.stopDelivery() }
  }
}
