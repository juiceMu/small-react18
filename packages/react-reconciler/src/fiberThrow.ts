import { Wakeable } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import { ShouldCapture } from './fiberFlags';
import { Lane, Lanes, SyncLane, markRootPinged } from './fiberLanes';
import { ensureRootIsScheduled, markRootUpdated } from './workLoop';
import { getSuspenseHandler } from './suspenseContext';

/**
 * 增加ping监听器 用于触发更新
 * @param root
 * @param wakeable
 * @param lane
 */
function attachPingListener(
	root: FiberRootNode,
	wakeable: Wakeable<any>,
	lane: Lane
) {
	let pingCache = root.pingCache;
	// 线程id(本质就是lanes)
	let threadIDs: Set<Lane> | undefined;

	// WeakMap{ wakeable: Set[lane1, lane2, ...]}
	if (pingCache === null) {
		// 没有缓存
		threadIDs = new Set<Lane>();
		pingCache = root.pingCache = new WeakMap<Wakeable<any>, Set<Lane>>();
		pingCache.set(wakeable, threadIDs);
	} else {
		threadIDs = pingCache.get(wakeable);
		if (threadIDs === undefined) {
			threadIDs = new Set<Lane>();
			pingCache.set(wakeable, threadIDs);
		}
	}
	if (!threadIDs.has(lane)) {
		// 第一次进入
		threadIDs.add(lane);

		// eslint-disable-next-line no-inner-declarations
		function ping() {
			if (pingCache !== null) {
				pingCache.delete(wakeable);
			}
			// 触发一次新的更新
			markRootUpdated(root, lane);
			markRootPinged(root, lane);
			ensureRootIsScheduled(root);
		}
		// 即使多次进入attachPingListener，也只有第一次会触发wakeable.then
		// 避免了挂载多余的ping方法
		wakeable.then(ping, ping);
	}
}

/**
 * 抛出异常
 * @param root
 * @param value
 * @param lane
 */
export function throwException(root: FiberRootNode, value: any, lane: Lane) {
	if (
		value !== null &&
		typeof value === 'object' &&
		typeof value.then === 'function'
	) {
		const weakable: Wakeable<any> = value;
		// 获取离当前抛出错误的fiber最近的suspense
		const suspenseBoundary = getSuspenseHandler();
		if (suspenseBoundary) {
			suspenseBoundary.flags |= ShouldCapture;
		}
		attachPingListener(root, weakable, lane);
	}
}
