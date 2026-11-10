/**
 * 轻量错误类型：给从 TS 移植过来的规则模块共用。
 *
 * 旧版用 @pet/shared 的 PetError + ErrorCode；DSH 侧只需要「带 reason 的错误」，
 * 因此保留同名类，错误码用字符串常量，未知码也不会崩。
 */
export const ErrorCode = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  NOT_FOUND: 'NOT_FOUND',
  TIMESTAMP_EXPIRED: 'TIMESTAMP_EXPIRED',
  VAULT_TAMPERED: 'VAULT_TAMPERED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CONFLICT: 'CONFLICT',
  IO_ERROR: 'IO_ERROR',
  INTERNAL: 'INTERNAL'
})

export class PetError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'PetError'
    this.code = code
    this.reason = code
    if (options && typeof options === 'object') {
      if (options.details !== undefined) this.details = options.details
      if (options.cause !== undefined) this.cause = options.cause
    }
  }
}

/** 把任意异常收敛成 { ok: false, reason } 需要的 reason 字符串。 */
export function reasonOf(error, fallback = 'unknown') {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    if (typeof error.reason === 'string' && error.reason) return error.reason
    if (typeof error.code === 'string' && error.code) return error.code
    if (typeof error.message === 'string' && error.message) return error.message
  }
  return fallback
}
