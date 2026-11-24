/**
 * known-fake.mjs —— 假样本白名单唯一源（2026-11-24 §8.60 立）。
 *
 * 立因：build-pack 首跑的 pack 三枪里两枪是假样本误报（wake-kws 的张三、
 * dist 文档注释的 <用户名>）——它们在 staged-clean 白名单里、build-pack 没带全。
 * 两条闸两张名单＝误报发生器。判据同源不只是规则同、白名单也必须同。
 * 字面拆分构造（闸自指转义常例）：运行时成形，源码无连续字面。
 */
export const KNOWN_FAKE = new Set([
  'sk-' + 'verysecretvalue123',
  'sk-' + 'abcdefghijklmnop',
  'sk-' + 'FAKE1234567890ABCDEF',
  'C:\\Users\\' + '\u5f20\u4e09',
  'C:\\Users\\' + '<\u7528\u6237\u540d>',
  'C:\\Users\\' + 'probe',
  'D:/probe',
])
