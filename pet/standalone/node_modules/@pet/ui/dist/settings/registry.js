/**
 * 设置字段注册表
 *
 * 三条硬约束：
 * 1. 重复 id 必须抛错（静默覆盖 = 字段丢失无人知晓）
 * 2. list() 顺序确定（先分组 order、再字段 order、再 id），不依赖注册顺序
 * 3. unregister 必须真的移除（注册了删不掉 = 泄漏）
 */
import { MODULE_TIERS } from '@pet/shared';
function byOrderThenId(a, b) {
    const oa = a.order ?? Number.MAX_SAFE_INTEGER;
    const ob = b.order ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob)
        return oa - ob;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/**
 * 无 tier 的分组排在所有模块分组之前 —— 应用自身设置优先，模块开关在后。
 * 有 tier 的按 MODULE_TIERS 声明顺序，顺序只在 shared 维护一份。
 */
function tierRank(tier) {
    if (tier === undefined)
        return -1;
    const index = MODULE_TIERS.indexOf(tier);
    // 类型上不会出现 -1；真出现了也排到最后，别混进最前面冒充重要分组。
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
function byGroupOrder(a, b) {
    const ra = tierRank(a.tier);
    const rb = tierRank(b.tier);
    if (ra !== rb)
        return ra - rb;
    return byOrderThenId(a, b);
}
export class SettingsRegistryV1 {
    #fields = new Map();
    #groups = new Map();
    registerGroup(g) {
        if (this.#groups.has(g.id)) {
            throw new Error(`[settings] 分组重复注册：${g.id}`);
        }
        this.#groups.set(g.id, g);
    }
    unregisterGroup(id) {
        for (const f of this.#fields.values()) {
            if (f.group === id) {
                throw new Error(`[settings] 分组仍有字段，不能删除：${id}`);
            }
        }
        this.#groups.delete(id);
    }
    register(f) {
        if (this.#fields.has(f.id)) {
            throw new Error(`[settings] 字段重复注册：${f.id}`);
        }
        if (!this.#groups.has(f.group)) {
            throw new Error(`[settings] 字段引用了未注册的分组：${f.group}`);
        }
        if (f.kind === 'select' && (!f.options || f.options.length === 0)) {
            throw new Error(`[settings] select 字段缺少 options：${f.id}`);
        }
        if (f.readonly === true && !f.readonlyReason) {
            throw new Error(`[settings] readonly 字段必须给出 readonlyReason：${f.id}`);
        }
        this.#fields.set(f.id, f);
    }
    unregister(id) {
        if (!this.#fields.delete(id)) {
            throw new Error(`[settings] 字段不存在，无法注销：${id}`);
        }
    }
    get(id) {
        return this.#fields.get(id);
    }
    list() {
        return [...this.#fields.values()].sort(byOrderThenId);
    }
    listGroups() {
        return [...this.#groups.values()].sort(byGroupOrder);
    }
    /** 按分组归类，分组顺序与组内顺序都确定 */
    grouped() {
        return this.listGroups().map((group) => ({
            group,
            fields: this.list().filter((f) => f.group === group.id),
        }));
    }
}
