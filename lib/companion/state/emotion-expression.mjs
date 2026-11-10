/**
 * 表情表达实验：把情绪映射到表情标签，并记录命中计数。
 *
 * 三组对照：
 * - off：不启用，始终用默认表情；
 * - experiment：按当前情绪切换表情；
 * - control：保持默认表情，只记录反事实的「本会切到哪个」。
 *
 * 计数只留在内存里供复盘，不落盘、不出网。这里不产生任何台词。
 */
export class ExpressionExperiment {
    now;
    defaultEmotion;
    group;
    total = 0;
    changed = 0;
    byTag = new Map();
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.defaultEmotion = options.defaultEmotion ?? 'neutral';
        this.group = options.group ?? 'off';
    }
    get currentGroup() {
        return this.group;
    }
    setGroup(group) {
        this.group = group;
    }
    decide(emotion) {
        const at = this.now();
        const wanted = emotion === 'neutral' ? this.defaultEmotion : emotion;
        const tag = this.group === 'experiment' ? wanted : this.defaultEmotion;
        const changed = tag !== this.defaultEmotion;
        // off 不算实验数据，免得把「没开」混进对照结果。
        if (this.group !== 'off') {
            this.total += 1;
            if (changed)
                this.changed += 1;
            this.byTag.set(tag, (this.byTag.get(tag) ?? 0) + 1);
        }
        return { group: this.group, emotion, tag, changed, at };
    }
    stats() {
        const byTag = {};
        for (const [tag, count] of this.byTag)
            byTag[tag] = count;
        return { total: this.total, changed: this.changed, byTag };
    }
    resetStats() {
        this.total = 0;
        this.changed = 0;
        this.byTag.clear();
    }
}
