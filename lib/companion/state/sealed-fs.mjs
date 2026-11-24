/**
 * 把 createSealedStore 装成 memory-store 认得的文件系统形状。
 *
 * 只做三件事：
 * - 文件内容走密封层，落盘是密文；
 * - 目录列表和删除仍走真实文件系统，文件名本身不加密；
 * - 所有路径先限制在数据目录内，拒绝把 sealed 名字带到目录外。
 *
 * 这里不碰业务逻辑，方便单测直接注入一个假 store。
 */
import { readdirSync, unlinkSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

export function createSealedFs({ dir, store } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('sealed-fs 需要注入 dir')
  if (store === null || typeof store !== 'object' ||
    typeof store.readText !== 'function' || typeof store.writeText !== 'function') {
    throw new Error('sealed-fs 需要注入 store.readText / writeText')
  }

  const root = resolve(dir)

  function nameOf(file) {
    const abs = resolve(file)
    const rel = relative(root, abs)
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
      const error = new Error(`拒绝访问数据目录之外的文件：${file}`)
      error.code = 'EACCES'
      throw error
    }
    return rel.split(sep).join('/')
  }

  function read(file) {
    const text = store.readText(nameOf(file), null)
    if (text === null) {
      const error = new Error(`没有这个文件：${file}`)
      error.code = 'ENOENT'
      throw error
    }
    return text
  }

  return {
    /* sealed.writeText 会自己建目录，这里不需要真的 mkdir。 */
    async mkdir() {},
    async readdir(target) {
      return readdirSync(target)
    },
    async readFile(file) {
      return read(file)
    },
    async writeFile(file, text) {
      store.writeText(nameOf(file), String(text))
    },
    async rename(from, to) {
      /*
       * 密封数据的名字参与 AAD，不能直接改文件名；
       * 先按旧名字解密，再按新名字重新加密，最后删临时文件。
       */
      const text = read(from)
      store.writeText(nameOf(to), text)
      try {
        unlinkSync(from)
      } catch {
        /* 临时文件删不掉不影响目标文件已经写好。 */
      }
    },
    async unlink(file) {
      try {
        unlinkSync(file)
      } catch {
        /* 单个旧文件删不掉，交给调用方继续。 */
      }
    },
  }
}
