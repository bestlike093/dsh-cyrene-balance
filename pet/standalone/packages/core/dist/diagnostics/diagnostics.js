import { toPetError } from '@pet/shared';
/**
 * 诊断数据源聚合器。
 * 每个 provider 独立执行：单个抛错只污染自己那一节，剩余诊断照常输出。
 */
export class Diagnostics {
    providers = new Map();
    sectionProviders = new Map();
    options;
    constructor(options) {
        this.options = {
            version: options.version,
            now: options.now ?? Date.now,
            ...(options.bridge === undefined ? {} : { bridge: options.bridge })
        };
    }
    /** 注册数据源，返回注销函数。同名重复注册会覆盖旧 provider。 */
    register(name, provider) {
        this.providers.set(name, provider);
        return () => {
            if (this.providers.get(name) === provider)
                this.providers.delete(name);
        };
    }
    unregister(name) {
        this.providers.delete(name);
        this.sectionProviders.delete(name);
    }
    /**
     * 注册「返回完整 section」的数据源。
     * 与 register 的区别：保留 level（severity），不做 ok → level 的推导。
     */
    registerSection(name, provider) {
        this.sectionProviders.set(name, provider);
        return () => {
            if (this.sectionProviders.get(name) === provider)
                this.sectionProviders.delete(name);
        };
    }
    /** 当前注册的数据源名字，便于测试与面板排序。 */
    names() {
        return [...this.providers.keys(), ...this.sectionProviders.keys()];
    }
    async section(name, provider) {
        try {
            const data = await provider();
            return { name, ok: true, data };
        }
        catch (error) {
            const petError = toPetError(error);
            return { name, ok: false, code: petError.code, message: petError.message };
        }
    }
    async collect() {
        const sections = [];
        for (const [name, provider] of this.providers) {
            sections.push(await this.section(name, provider));
        }
        for (const [name, provider] of this.sectionProviders) {
            try {
                sections.push({ name, ...(await provider()) });
            }
            catch (error) {
                const petError = toPetError(error);
                sections.push({ name, ok: false, level: 'error', code: petError.code, message: petError.message });
            }
        }
        const bridge = this.options.bridge;
        return {
            version: this.options.version,
            generatedAt: this.options.now(),
            ok: sections.every((section) => section.ok),
            sections,
            bridge: bridge === undefined ? 'not-connected' : bridge.describe()
        };
    }
}
