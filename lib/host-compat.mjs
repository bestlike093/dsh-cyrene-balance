/**
 * dsh-cyrene-pet — 宿主兼容垫片。
 *
 * Cyrene 宿主直接调 apply(ctx)，ctx 上只有它自己的服务（webServer/systemPrompt 等），
 * 不提供 Cordis 的 ctx.effect / ctx.on。Cordis 形态下两者都是原生方法。
 *
 * 这里统一出口：
 *   effect(fn)  宿主有原生 effect 时绑定原生；否则「立即执行 + 返回清理函数」。
 *   on(...)      宿主有原生 on 时绑定原生；否则返回空退订函数。
 *
 * 用法（apply 顶部）：
 *   const { effect, on } = adaptHostCtx(ctx)
 * 之后所有生命周期注册一律走 effect/on，不再直接碰 ctx.effect/ctx.on。
 */

export function adaptHostCtx(ctx) {
  const effect = typeof ctx.effect === 'function'
    ? ctx.effect.bind(ctx)
    : (fn) => {
        const cleanup = fn()
        return () => {
          if (typeof cleanup === 'function') cleanup()
        }
      }
  const on = typeof ctx.on === 'function'
    ? ctx.on.bind(ctx)
    : () => () => {}
  return { effect, on }
}
