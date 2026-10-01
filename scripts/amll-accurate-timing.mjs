// SPDX-License-Identifier: AGPL-3.0-only
// Build adapter for pinned AMLL 0.6.0. Keep supplied timing atoms intact and
// render zero-duration fallback atoms as ordinary line lyrics, even in a
// song containing other correctly timed rows. Never edit node_modules.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const accurateTimingPlugin = {
  name: 'joy-preserve-source-timing',
  setup(build) {
    build.onLoad({ filter: /amll-core\.mjs$/ }, async ({ path: filename }) => {
      const info = JSON.parse(await readFile(path.join(path.dirname(filename), '../package.json'), 'utf8'))
      if (info.name !== '@applemusic-like-lyrics/core' || info.version !== '0.6.0')
        throw new Error('Review the AMLL timing adapter before upgrading the renderer')
      let source = await readFile(filename, 'utf8')
      const start = source.indexOf('function chunkAndSplitLyricWords(words) {')
      const end = source.indexOf('\n//#endregion', start)
      const plainRow = 'if (this.lyricPlayer._getIsNonDynamic()) {'
      if (start < 0 || end < 0 || source.split(plainRow).length !== 2)
        throw new Error('AMLL timing adapter anchors changed; refusing an unverified build')
      const preserveAtoms = `function chunkAndSplitLyricWords(words) {
        return words.flatMap(word => {
          const content = word.word.trim();
          if (!content) return [{ ...word }];
          const leading = word.word.match(/^\\s+/)?.[0] || '';
          const trailing = word.word.match(/\\s+$/)?.[0] || '';
          return [
            ...(leading ? [{ word: leading, startTime: word.startTime, endTime: word.startTime }] : []),
            { ...word, word: content },
            ...(trailing ? [{ word: trailing, startTime: word.endTime, endTime: word.endTime }] : []),
          ];
        });
      }`
      source = source.slice(0, start) + preserveAtoms + source.slice(end)
      source = source.replace(plainRow,
        'if (this.lyricPlayer._getIsNonDynamic() || this.lyricLine.words.every(word => word.startTime === word.endTime)) {')
      return { contents: source, loader: 'js', resolveDir: path.dirname(filename) }
    })
  },
}
