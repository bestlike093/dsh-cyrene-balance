const WALL_DIGITS = 13;
const COUNTER_DIGITS = 4;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;
function pad(value, digits) {
    return String(Math.max(0, Math.trunc(value))).padStart(digits, '0');
}
function normalizeNode(node) {
    return (node || 'local').slice(0, 16);
}
export function formatHlc(stamp) {
    return pad(stamp.wall, WALL_DIGITS) + pad(stamp.counter, COUNTER_DIGITS) + '-' + normalizeNode(stamp.node);
}
export function parseHlc(value) {
    const dash = value.indexOf('-');
    const body = dash < 0 ? value : value.slice(0, dash);
    const node = dash < 0 ? 'local' : value.slice(dash + 1);
    const wall = Number(body.slice(0, WALL_DIGITS));
    const counter = Number(body.slice(WALL_DIGITS));
    return {
        wall: Number.isFinite(wall) ? wall : 0,
        counter: Number.isFinite(counter) ? counter : 0,
        node
    };
}
/** 比较两个 HLC 字符串：<0 表示 a 更早，>0 表示 a 更晚。 */
export function compareHlc(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
export class HybridClock {
    wall = 0;
    counter = 0;
    node;
    constructor(node = 'local') {
        this.node = normalizeNode(node);
    }
    /** 产生一个本地事件时间戳。 */
    now() {
        const physical = Date.now();
        if (physical > this.wall) {
            this.wall = physical;
            this.counter = 0;
        }
        else {
            this.counter = this.counter >= MAX_COUNTER ? 0 : this.counter + 1;
            if (this.counter === 0)
                this.wall += 1;
        }
        return formatHlc({ wall: this.wall, counter: this.counter, node: this.node });
    }
    /** 收到远端时间戳后推进本地时钟，保证因果不倒退。 */
    receive(remote) {
        const r = parseHlc(remote);
        const physical = Date.now();
        const maxWall = Math.max(physical, this.wall, r.wall);
        if (maxWall === this.wall && maxWall === r.wall) {
            this.counter = Math.max(this.counter, r.counter) + 1;
        }
        else if (maxWall === this.wall) {
            this.counter += 1;
        }
        else if (maxWall === r.wall) {
            this.counter = r.counter + 1;
        }
        else {
            this.counter = 0;
        }
        this.wall = maxWall;
        if (this.counter > MAX_COUNTER) {
            this.wall += 1;
            this.counter = 0;
        }
        return formatHlc({ wall: this.wall, counter: this.counter, node: this.node });
    }
}
//# sourceMappingURL=hlc.js.map