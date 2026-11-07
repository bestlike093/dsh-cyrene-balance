import { describe, expect, it } from 'vitest'
import { redactLogText } from '../log-redact.mjs'

describe('redactLogText', () => {
  it('openid= 后面的值不再原样落盘', () => {
    const line = '[qq] 入站来源 openid=9BE3615BE2CA81FFCAA9DD2646DC5BED（private）'
    expect(redactLogText(line)).toBe('[qq] 入站来源 openid=***（private）')
  })

  it('裸的 32 位 openid 保留头尾便于对日志', () => {
    expect(redactLogText('已将 9BE3615BE2CA81FFCAA9DD2646DC5BED 绑定为主人')).toBe(
      '已将 9BE3…5BED 绑定为主人'
    )
  })

  it('被动回复令牌被掩码', () => {
    expect(
      redactLogText('[qq] 入站 private:abc msg=ROBOT1.0_bZExpI5zIdMoW60x9ljgr49N0u')
    ).toBe('[qq] 入站 private:abc msg=***')
  })

  it('QQBot 授权头与裸 ROBOT1.0_ 令牌都被掩码', () => {
    expect(
      redactLogText('Authorization: QQBot ROBOT1.0_bZExpI5zIdMoW60x9ljgr49N0u')
    ).toBe('Authorization: QQBot ***')
    expect(redactLogText('token: ROBOT1.0_bZExpI5zIdMoW60x9ljgr49N0u')).toBe(
      'token: ROBOT1.0_***'
    )
  })

  it('密钥与用户目录被掩码', () => {
    const redacted = redactLogText(
      'token=abc12345 sk-abcdefgh123456 C:\\Users\\tester\\AppData\\Roaming'
    )
    expect(redacted).not.toContain('abc12345')
    expect(redacted).not.toContain('sk-abcdefgh123456')
    expect(redacted).not.toContain('tester')
    expect(redacted).toContain('C:\\Users\\***\\AppData\\Roaming')
  })

  it('普通日志保持原样', () => {
    expect(redactLogText('lifecycle: resumed')).toBe('lifecycle: resumed')
  })
})
