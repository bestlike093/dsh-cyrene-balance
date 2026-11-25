/**
 * 记忆快照落盘 —— B2-007 的 mode 那一半。
 *
 * 现状（搬进来之前）：lib/index.js:897-898
 *   await mkdir(MEMORY_SNAPSHOT_DIR, { recursive: true })
 *   await writeFile(MEMORY_SNAPSHOT_PATH, JSON.stringify(payload, null, 2), 'utf8')
 * 两处都没传 mode，于是走 Node 默认：文件 0o666、目录 0o777（再各自 & ~umask）。
 * 下面两个常量记录的就是这个现状值，不是期望值。
 *
 * 对照物：system/file-sync-transport.mjs:90 写自己的临时件时给的是
 *   { encoding: 'utf8', mode: 0o600 }
 * 同一个仓里两套落盘权限口径。
 *
 * 明文那一半（payload 里含 ownerOpenIds / scopes / peers 的身份键与好感分）
 * 不在这里解，它卡在跨进程约束上，见总账 §50.3。
 *
 * io 由调用方注入：mkdir / writeFile 两个方法，签名与 node:fs/promises 一致。
 * 注入是为了让「传给 fs 的 opts 到底是什么」变成可观察面 —— 在 Windows/NTFS 上
 * mode 会被忽略，只有在 POSIX 上才落成真实权限位，所以判据量的是契约面。
 */

/** 快照文件权限：只有属主可读写。对齐 file-sync-transport.mjs:90 那套口径。 */
export const SNAPSHOT_FILE_MODE = 0o600

/** 快照目录权限：只有属主可进出。目录放开的话，文件权限等于白设。 */
export const SNAPSHOT_DIR_MODE = 0o700

/**
 * 把快照 payload 写成 JSON。
 * 先建目录再写文件，顺序不能反；写失败照原样抛给调用方（index.js 那侧自己 catch + bootLog）。
 */
export async function writeSnapshot({ io, dir, file, payload }) {
  if (io === null || typeof io !== 'object') throw new TypeError('writeSnapshot 需要注入 io')
  if (typeof io.mkdir !== 'function') throw new TypeError('writeSnapshot 需要 io.mkdir')
  if (typeof io.writeFile !== 'function') throw new TypeError('writeSnapshot 需要 io.writeFile')
  if (typeof dir !== 'string' || dir === '') throw new TypeError('writeSnapshot 需要目录路径')
  if (typeof file !== 'string' || file === '') throw new TypeError('writeSnapshot 需要文件路径')

  await io.mkdir(dir, { recursive: true, mode: SNAPSHOT_DIR_MODE })
  await io.writeFile(file, JSON.stringify(payload, null, 2), {
    encoding: 'utf8',
    mode: SNAPSHOT_FILE_MODE,
  })
}
