/**
 * LLM provider 抽象：装配只依赖这一层，真机后端只是最后一块替换件。
 *
 * 超时走真的 AbortController：外层放弃 Promise 时连接仍在，配额会被白占；
 * 这里在超时点 abort，FallbackChain 的 catch 再退预扣令牌。
 */
export class LlmTimeoutError extends Error {
    timeoutMs;
    code = 'LLM_TIMEOUT';
    constructor(timeoutMs) {
        super(`LLM 请求超时：${timeoutMs}ms`);
        this.timeoutMs = timeoutMs;
        this.name = 'LlmTimeoutError';
    }
}
/** 每日额度耗尽时抛出：调用方不该重试，重试也不会放行。 */
export class LlmBudgetExceededError extends Error {
    used;
    limit;
    code = 'LLM_BUDGET_EXCEEDED';
    constructor(used, limit) {
        super(`今日额度已用尽：${used}/${limit}`);
        this.used = used;
        this.limit = limit;
        this.name = 'LlmBudgetExceededError';
    }
}
/** mock 覆盖除真实网络往返外的全部链路；真机替换时不需要改上层。 */
export class MockLlmProvider {
    id = 'mock';
    calls = 0;
    aborted = false;
    lastSignal;
    mode;
    text;
    model;
    promptVersion;
    usage;
    constructor(options = {}) {
        this.mode = options.mode ?? 'ok';
        this.text = options.text ?? 'mock 台词';
        this.model = options.model ?? 'mock-model';
        this.promptVersion = options.promptVersion ?? 'mock-v1';
        this.usage = options.usage ?? { inputTokens: 1, outputTokens: 1 };
    }
    async generate(request) {
        this.calls += 1;
        this.lastSignal = request.signal;
        if (this.mode === 'throw') {
            throw new Error('mock provider failure');
        }
        if (this.mode === 'hang') {
            return new Promise((_, reject) => {
                const fail = () => {
                    this.aborted = true;
                    reject(new Error('mock aborted'));
                };
                if (request.signal.aborted) {
                    fail();
                    return;
                }
                request.signal.addEventListener('abort', fail, { once: true });
            });
        }
        return {
            text: this.text,
            model: this.model,
            promptVersion: this.promptVersion,
            usage: this.usage
        };
    }
}
/** 把 ILLMProvider 包成 FallbackChain 认识的 LlmAdapter，并在超时点真 abort。 */
export function createTimeoutLlmAdapter(provider, timeoutMs, options = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error(`timeoutMs 必须是正数：${timeoutMs}`);
    }
    const budget = options.budget;
    const fixedEstimate = options.estimateTokens;
    // 没有显式估算值时按输入长度粗估，不能按 0 预检——那等于对未耗尽额度放行。
    const estimateFor = (input) => {
        if (fixedEstimate !== undefined)
            return Math.max(0, fixedEstimate);
        return Math.max(1, Math.ceil([...input.text].length / 3));
    };
    return {
        async generate(input) {
            if (budget !== undefined) {
                const verdict = budget.canSpend(estimateFor(input));
                if (!verdict.allowed) {
                    throw new LlmBudgetExceededError(verdict.used, verdict.limit);
                }
            }
            const controller = new AbortController();
            let timer;
            try {
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        reject(new LlmTimeoutError(timeoutMs));
                    }, timeoutMs);
                });
                const response = await Promise.race([
                    provider.generate({ prompt: input.text, signal: controller.signal }),
                    timeout
                ]);
                // usage 缺席时标 'unknown'，但预扣不能白退：按输入估算量记账。
                const totalTokens = response.usage === undefined
                    ? 'unknown'
                    : response.usage.inputTokens + response.usage.outputTokens;
                if (budget !== undefined) {
                    budget.record(typeof totalTokens === 'number' ? totalTokens : estimateFor(input));
                }
                return {
                    text: response.text,
                    model: response.model,
                    promptVersion: response.promptVersion,
                    totalTokens
                };
            }
            finally {
                if (timer !== undefined)
                    clearTimeout(timer);
            }
        }
    };
}
