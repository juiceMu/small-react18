import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { isSubsetOfLanes, Lane, mergeLanes, NoLane } from './fiberLanes';
import { FiberNode } from './fiber';

export interface Update<State> {
	action: Action<State>;
	lane: Lane; // 优先级
	next: Update<any> | null;
	hasEagerState: boolean;
	eagerState: State | null;
}

export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null;
	};
	dispatch: Dispatch<State> | null;
}

/**
 * 创建update实例
 * @param action
 * @param lane 优先级
 * @param hasEagerState
 * @param eagerState
 * @returns update实例
 */
export const createUpdate = <State>(
	action: Action<State>,
	lane: Lane,
	hasEagerState = false,
	eagerState = null
): Update<State> => {
	return {
		action,
		lane,
		next: null,
		hasEagerState,
		eagerState
	};
};

/**
 * 初始化updateQueue
 * @returns updateQueue
 */
export const createUpdateQueue = <State>() => {
	return {
		shared: {
			pending: null
		},
		dispatch: null
	} as UpdateQueue<State>;
};

/**
 * 往updateQueue内增加update对象
 * @param updateQueue 单个hook的更新队列
 * @param update 新加入的更新对象
 * @param fiber
 * @param lane
 */
export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>,
	fiber: FiberNode,
	lane: Lane
) => {
	const pending = updateQueue.shared.pending;
	if (pending === null) {
		// a(pending) -> a
		update.next = update;
	} else {
		// a -> b(pending) -> a
		// a -> b -> c(pending) -> a
		// pending永远指向链表的最后一个
		// pending.next永远指向链表的第一个
		update.next = pending.next;
		pending.next = update;
	}
	updateQueue.shared.pending = update;
	fiber.lanes = mergeLanes(fiber.lanes, lane);
	const alternate = fiber.alternate;
	if (alternate !== null) {
		alternate.lanes = mergeLanes(alternate.lanes, lane);
	}
};

/**
 * 计算state
 * @param state
 * @param action
 * @returns
 */
export function basicStateReducer<State>(
	state: State,
	action: Action<State>
): State {
	if (action instanceof Function) {
		// baseState 1 update (x) => 4x -> memoizedState 4
		return action(state);
	} else {
		// baseState 1 update 2 -> memoizedState 2
		return action;
	}
}

/**
 * 计算状态最新值 消费update
 * @param baseState 初始状态
 * @param pendingUpdate 需要被消费的update
 * @param renderLane 当前本次更新的优先级
 * @param onSkipUpdate 对跳过的update执行的callback
 * @returns {
 *  baseState: 最后一个没被跳过的update计算后的结果
 *  memoizedState: 上次更新计算的最终state
 *  baseQueue: 保存上次更新计算中被跳过的update及其后面的所有update,且参与下次state计算
 * }
 */
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane,
	onSkipUpdate?: <State>(update: Update<State>) => void
): {
	memoizedState: State;
	baseState: State;
	baseQueue: Update<State> | null;
} => {
	// ● baseState是本次更新参与计算的初始state，memoizedState是上次更新计算的最终state
	// ● 如果本次更新没有update被跳过，则下次更新开始时baseState === memoizedState
	// ● 如果本次更新有update被跳过，则本次更新计算出的memoizedState为「考虑优先级」情况下计算的结果，baseState为「最后一个没被跳过的update计算后的结果」，下次更新开始时baseState !== memoizedState
	// ● 本次更新「被跳过的update及其后面的所有update」都会被保存在baseQueue中参与下次state计算
	// ● 本次更新「参与计算但保存在baseQueue中的update」，优先级会降低到NoLane
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState,
		baseState,
		baseQueue: null
	};

	if (pendingUpdate !== null) {
		// 更新队列中的第一个update
		const first = pendingUpdate.next;
		let pending = pendingUpdate.next as Update<State>;
		let newBaseState = baseState;
		let newBaseQueueFirst: Update<State> | null = null;
		let newBaseQueueLast: Update<State> | null = null;
		// 即新的memoizedState
		let newState = baseState;
		// 遍历整个更新队列链表
		do {
			const updateLane = pending.lane;
			if (!isSubsetOfLanes(renderLane, updateLane)) {
				// 优先级不够，被跳过，即不在本次更新lanes集合中
				// 本次更新「被跳过的update及其后面的所有update」都会被保存在baseQueue中参与下次state计算
				const clone = createUpdate(pending.action, pending.lane);
				// 对跳过的update执行callback
				onSkipUpdate?.(clone);
				if (newBaseQueueFirst === null) {
					// 是第一个被跳过的update
					newBaseQueueFirst = clone;
					newBaseQueueLast = clone;
					newBaseState = newState;
				} else {
					(newBaseQueueLast as Update<State>).next = clone;
					newBaseQueueLast = clone;
				}
			} else {
				//优先级足够 可执行/消费该update
				if (newBaseQueueLast !== null) {
					// 虽然优先级足够，参与计算，但因为前面存在被跳过的update，所以被跳过的update后面的所有update也需要被保存的到baseQueue中，且优先级会降低到NoLane
					// 降低到NoLane代表着: 一定会参与到下次计算。因为NoLane和任何lanes集合的结果都是NoLane与该lanes存在交集
					const clone = createUpdate(pending.action, NoLane);
					newBaseQueueLast.next = clone;
					newBaseQueueLast = clone;
				}

				const action = pending.action;
				if (pending.hasEagerState) {
					newState = pending.eagerState;
				} else {
					newState = basicStateReducer(baseState, action);
				}
			}
			// 遍历下一个update
			pending = pending.next as Update<any>;
		} while (pending !== first);

		if (newBaseQueueLast === null) {
			// 本次计算没有update被跳过，则baseState === memoizedState
			// 将新的memoizedState赋值给新的baseState
			newBaseState = newState;
		} else {
			newBaseQueueLast.next = newBaseQueueFirst;
		}
		result.memoizedState = newState;
		result.baseState = newBaseState;
		result.baseQueue = newBaseQueueLast;
	}
	return result;
};
