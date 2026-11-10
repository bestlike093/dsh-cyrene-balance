import type { IPetalModule } from '@pet/shared';
/** 宿主按这个键读余额快照。改名字要和桌面壳同步。 */
export declare const BALANCE_SNAPSHOT_KEY = "balance.snapshot";
/**
 * 余额模块：只读网络，不写配置。
 *
 * bootstrap 拉一次余额，把结果写进 memory 快照，宿主读快照渲染状态栏和气泡。
 * 没配 Key、网络失败都只记进快照、不抛错 —— 缺钥匙是正常状态，
 * 抛出去会在界面底部留一张占位卡，那属于噪音。
 *
 * 真正的请求在宿主侧完成：沙箱拿到的 net.fetch 只认余额这一个端点，
 * Key 也只在主进程里短暂存在。
 */
export declare const balanceModule: IPetalModule;
