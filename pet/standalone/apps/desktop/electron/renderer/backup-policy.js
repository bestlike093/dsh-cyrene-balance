/**
 * 备份 / 同步口令的统一策略。
 *
 * 设置页与首次启动页校验的是同一件事，阈值和提示只能有一份；
 * 两窗各写一套时，改了一处、另一处仍按旧规则拦人。
 */
;(function initBackupPolicy(global) {
  'use strict'

  const PASSPHRASE_MIN_LENGTH = 8
  const PASSPHRASE_ADVICE_LENGTH = 12

  function isPassphraseLongEnough(value) {
    return typeof value === 'string' && value.length >= PASSPHRASE_MIN_LENGTH
  }

  function passphraseTooShortMessage() {
    return `口令至少 ${PASSPHRASE_MIN_LENGTH} 位`
  }

  /** 够用但偏短时给一句建议；达到建议长度返回空串。 */
  function passphraseAdvice(value) {
    if (typeof value !== 'string' || value.length >= PASSPHRASE_ADVICE_LENGTH) return ''
    return `当前口令 ${value.length} 位，偏短，建议 ${PASSPHRASE_ADVICE_LENGTH} 位以上。`
  }

  global.BackupPolicy = {
    PASSPHRASE_MIN_LENGTH,
    PASSPHRASE_ADVICE_LENGTH,
    isPassphraseLongEnough,
    passphraseTooShortMessage,
    passphraseAdvice
  }
})(globalThis)
