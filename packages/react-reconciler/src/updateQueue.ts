import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { Lane } from './fiberLanes';

export interface Update<State> {
	action: Action<State>;
	lane: Lane; // 优先级
	next: Update<any> | null;
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
 * @returns update实例
 */
export const createUpdate = <State>(
	action: Action<State>,
	lane: Lane
): Update<State> => {
	return {
		action,
		lane,
		next: null
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
 */
export const enqueueUpdate = <State>(
	updateQueue: UpdateQueue<State>,
	update: Update<State>
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
};

/**
 * 计算状态最新值 消费update
 * @param baseState 初始状态
 * @param pendingUpdate 需要被消费的update
 * @param renderLane 当前本次更新的优先级
 * @returns 包含最新状态memoizedState的对象
 */
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane
): { memoizedState: State } => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState
	};

	if (pendingUpdate !== null) {
		// 更新队列中的第一个update
		const first = pendingUpdate.next;
		let pending = pendingUpdate.next as Update<State>;
		// 遍历整个更新队列链表
		do {
			const updateLane = pending.lane;
			if (updateLane === renderLane) {
				// update的优先级和当前本次更新的优先级同级则可执行/消费该update
				const action = pending.action;
				if (action instanceof Function) {
					// baseState 1 update (x) => 4x -> memoizedState 4
					baseState = action(baseState);
				} else {
					// baseState 1 update 2 -> memoizedState 2
					baseState = action;
				}
			} else {
				if (__DEV__) {
					console.error('不应该进入updateLane !== renderLane逻辑');
				}
			}
			// 遍历下一个update
			pending = pending.next as Update<any>;
		} while (pending !== first);

		result.memoizedState = baseState;
	}
	return result;
};
