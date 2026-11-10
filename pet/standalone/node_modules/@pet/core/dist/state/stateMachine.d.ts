export type PetState = 'idle' | 'talking' | 'dragging' | 'thinking' | 'sleeping';
export interface StateChange {
    readonly from: PetState;
    readonly to: PetState;
    readonly at: number;
}
export type StateListener = (change: StateChange) => void;
/** 状态转移表：只允许表内边，其余一律拒绝。 */
export declare const TRANSITIONS: Readonly<Record<PetState, readonly PetState[]>>;
export declare const ALL_STATES: readonly PetState[];
/**
 * 桌宠状态机。
 * 非法转移既不改变状态、也不触发监听器，调用方拿到稳定错误码自行决定提示方式。
 */
export declare class PetStateMachine {
    private currentState;
    private readonly listeners;
    private readonly now;
    constructor(initial?: PetState, now?: () => number);
    get state(): PetState;
    can(to: PetState): boolean;
    /** 非法转移抛 INVALID_ARGUMENT；成功时返回这条转移记录。 */
    transition(to: PetState): StateChange;
    /** 不确定当前状态是否允许时用它，避免上层写 try/catch。 */
    tryTransition(to: PetState): StateChange | null;
    onChange(listener: StateListener): () => void;
    reset(): void;
}
