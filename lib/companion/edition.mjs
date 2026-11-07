/**
 * 版本分区：旅人版（qiqi）与公开版（public）。
 *
 * 打包时由 scripts/package.mjs --edition=xxx 改写同目录的 edition.txt，
 * 运行时按文件内容判定；环境变量只用于本地临时覆盖，优先级更高。
 *
 * 读不到文件时一律按 public 处理：宁可收住，也不放开。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function readBuiltEdition() {
  try {
    return fs.readFileSync(path.join(here, 'edition.txt'), 'utf8').trim().toLowerCase()
  } catch {
    return ''
  }
}

const raw = String(process.env.CYRENE_INTIMACY_EDITION || readBuiltEdition())
  .trim()
  .toLowerCase()

export const INTIMACY_EDITION = raw === 'qiqi' ? 'qiqi' : 'public'
export const IS_PUBLIC_EDITION = INTIMACY_EDITION === 'public'
export const INTIMACY_EDITION_LABEL = IS_PUBLIC_EDITION ? '公开版' : '旅人版'
