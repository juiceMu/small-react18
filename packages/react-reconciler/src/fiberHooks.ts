import { Dispatch } from 'react/src/currentDispatcher';
import { Dispatcher } from 'react/src/currentDispatcher';
import currentBatchConfig from 'react/src/currentBatchConfig';
import internals from 'shared/internals';
import { Action, ReactContext, Thenable, Usable } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { Flags, PassiveEffect } from './fiberFlags';
import {
	Lane,
	NoLane,
	NoLanes,
	mergeLanes,
	removeLanes,
	requestUpdateLane
} from './fiberLanes';
import { HookHasEffect, Passive } from './hookEffectTags';
import {
	basicStateReducer,
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue,
	Update,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { trackUsedThenable } from './thenable';
import { REACT_CONTEXT_TYPE } from 'shared/ReactSymbols';
import { markWipReceivedUpdate } from './beginWork';
import { readContext as readContextOrigin } from './fiberContext';

// 当前正在render的Fiber，在fiber中保存hook数据
let currentlyRenderingFiber: FiberNode | null = null;
// 当前正在处理的hook
let workInProgressHook: Hook | null = null;

// 获取到的从当前正在render的Fiber（currentlyRenderingFiber）对应的currentFiber上存储的hook数据
// 即workInProgressHook对应的存储在current Fiber上的hook数据
let currentHook: Hook | null = null;
// 当前本次更新的优先级
let renderLane: Lane = NoLane;

const { currentDispatcher } = internals;

/**
 * 读取context
 * @param context
 * @returns
 */
function readContext<Value>(context: ReactContext<Value>): Value {
	const consumer = currentlyRenderingFiber as FiberNode;
	return readContextOrigin(consumer, context);
}

interface Hook {
	memoizedState: any; // hook自身的状态值,上次更新计算的最终state
	updateQueue: unknown;
	next: Hook | null; // 指向下一个hook
	baseState: any; // 最后一个没被跳过的update计算后的结果
	baseQueue: Update<any> | null; // 保存上次更新计算中被跳过的update及其后面的所有update,且参与下次state计算
}

// effect 对象
export interface Effect {
	tag: Flags;
	create: EffectCallback | void;
	destroy: EffectCallback | void;
	deps: HookDeps;
	next: Effect | null;
}

// 函数组件的effect hook链表
export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null;
	lastRenderedState: State;
}

type EffectCallback = () => void;
export type HookDeps = any[] | null;

/**
 * 渲染Hooks
 * @param wip
 * @param Component 函数组件本身函数
 * @param lane 优先级
 * @returns 函数组件return的渲染内容
 */
export function renderWithHooks(
	wip: FiberNode,
	Component: FiberNode['type'],
	lane: Lane
) {
	// 赋值
	currentlyRenderingFiber = wip;
	// 重置 hooks链表
	wip.memoizedState = null;
	// 重置 effect hooks链表
	wip.updateQueue = null;
	// 设置当前本次更新的优先级
	renderLane = lane;
	const current = wip.alternate;

	if (current !== null) {
		// update
		currentDispatcher.current = HooksDispatcherOnUpdate;
	} else {
		// mount
		currentDispatcher.current = HooksDispatcherOnMount;
	}

	const props = wip.pendingProps;
	// 函数组件render
	const children = Component(props);

	// 函数组件内的hook都执行完毕后，进行重置
	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;
	return children;
}

// 首次挂载时，hooks集合
const HooksDispatcherOnMount: Dispatcher = {
	useState: mountState,
	useEffect: mountEffect,
	useTransition: mountTransition,
	useRef: mountRef,
	useContext: readContext,
	use,
	useMemo: mountMemo,
	useCallback: mountCallback
};

// 更新时，hooks集合
const HooksDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
	useEffect: updateEffect,
	useTransition: updateTransition,
	useRef: updateRef,
	useContext: readContext,
	use,
	useMemo: updateMemo,
	useCallback: updateCallback
};

/**
 * mount阶段，对应的useEffect函数
 * @param create 处理Effect的函数。create函数选择性返回一个destroy函数
 * @param deps 依赖项 触发create函数执行的依赖项
 */
function mountEffect(create: EffectCallback | void, deps: HookDeps | void) {
	const hook = mountWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;

	// mount、update时的区别:
	// mount时：一定标记PassiveEffect
	// update时：deps变化时标记PassiveEffect
	(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
	// effect的hook对象的memoizedState存储的是effect对象
	hook.memoizedState = pushEffect(
		Passive | HookHasEffect,
		create,
		undefined,
		nextDeps
	);
}

/**
 * update阶段，对应的useEffect函数
 * @param create 处理Effect的函数。create函数选择性返回一个destroy函数
 * @param deps 依赖项 触发create函数执行的依赖项
 */
function updateEffect(create: EffectCallback | void, deps: HookDeps | void) {
	const hook = updateWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	let destroy: EffectCallback | void;
	if (currentHook !== null) {
		const prevEffect = currentHook.memoizedState as Effect;
		destroy = prevEffect.destroy;
		if (nextDeps !== null) {
			// 对依赖进行浅比较
			// 获取上一次的依赖
			const prevDeps = prevEffect.deps;
			if (areHookInputsEqual(nextDeps, prevDeps)) {
				// 证明依赖没有发生变化，无需执行effect hook内的函数
				hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
				return;
			}
		}
		// 浅比较 不相等
		// 证明依赖发生变化，需要触发effect hook内的函数，
		// 对fiber 增加存在effect且effect被触发的标记
		// mount、update时的区别:
		// mount时：一定标记PassiveEffect
		// update时：deps变化时标记PassiveEffect
		(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
		hook.memoizedState = pushEffect(
			Passive | HookHasEffect,
			create,
			destroy,
			nextDeps
		);
	}
}

/**
 * 比较effect hook的前后依赖项是否相等(浅比较)
 * @param nextDeps 新的依赖项
 * @param prevDeps 旧的依赖项
 * @returns boolean
 */
function areHookInputsEqual(nextDeps: HookDeps, prevDeps: HookDeps) {
	if (prevDeps === null || nextDeps === null) {
		return false;
	}
	for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
		if (Object.is(prevDeps[i], nextDeps[i])) {
			continue;
		}
		return false;
	}
	return true;
}

/**
 * mount阶段 useRef hook
 * @param initialValue
 * @returns
 */
function mountRef<T>(initialValue: T): { current: T } {
	const hook = mountWorkInProgressHook();
	const ref = { current: initialValue };
	hook.memoizedState = ref;
	return ref;
}

/**
 * update阶段 useRef hook
 * @param initialValue
 * @returns
 */
function updateRef<T>(initialValue: T): { current: T } {
	const hook = updateWorkInProgressHook();
	return hook.memoizedState;
}

/**
 * 新生成一个effect对象并放入该fiber的effect链表的最末端
 * @param hookFlags hook flag标识
 * @param create create 处理Effect的函数
 * @param destroy create函数返回的destroy函数
 * @param deps 依赖项 触发create函数执行的依赖项
 * @returns 新生成的effect对象
 */
function pushEffect(
	hookFlags: Flags,
	create: EffectCallback | void,
	destroy: EffectCallback | void,
	deps: HookDeps
): Effect {
	// 生成一个新的effect对象
	const effect: Effect = {
		tag: hookFlags,
		create,
		destroy,
		deps,
		next: null
	};
	const fiber = currentlyRenderingFiber as FiberNode;
	// 函数组件的fiber的updateQueue存放着该函数对象的effect hooks链表（注意 与hooks链表区分开，不是同一个链表）
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;

	if (updateQueue === null) {
		const updateQueue = createFCUpdateQueue();
		fiber.updateQueue = updateQueue;
		effect.next = effect;
		updateQueue.lastEffect = effect;
	} else {
		// 插入effect
		const lastEffect = updateQueue.lastEffect;
		if (lastEffect === null) {
			effect.next = effect;
			updateQueue.lastEffect = effect;
		} else {
			const firstEffect = lastEffect.next;
			lastEffect.next = effect;
			effect.next = firstEffect;
			// lastEffect 永远指向effect hooks链表的最后一个
			// lastEffect.next 永远指向effect hooks链表的第一个
			updateQueue.lastEffect = effect;
		}
	}
	return effect;
}

/**
 * 创建函数组件的更新对象队列
 * （只针对函数组件的fiber新增updateQueue的lastEffect字段）
 * @returns
 */
function createFCUpdateQueue<State>() {
	const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
	updateQueue.lastEffect = null;
	return updateQueue;
}

/**
 * 更新时，对应的useState hook函数
 * @param initialState
 * @returns [state,dispatch]
 */
function updateState<State>(): [State, Dispatch<State>] {
	// 找到当前useState对应的hook数据
	const hook = updateWorkInProgressHook();

	// 计算新state的逻辑
	const queue = hook.updateQueue as FCUpdateQueue<State>;
	const baseState = hook.baseState;
	const pending = queue.shared.pending;
	const current = currentHook as Hook;
	let baseQueue = current.baseQueue;
	if (pending !== null) {
		// 将pending 和baseQueue update 保存在current中
		// 原因：只要不进入commit阶段，current与wip不会互换，所以保存在current中，即使多次执行render阶段，只要不进入commit阶段，都能从current中恢复数据。
		if (baseQueue !== null) {
			// 将pending 和baseQueue 首尾连接组合成一条环形链表
			const baseFirst = baseQueue.next;
			const pendingFirst = pending.next;
			baseQueue.next = pendingFirst;
			pending.next = baseFirst;
		}
		baseQueue = pending;
		// 保存在current中
		current.baseQueue = pending;
		// 重置pending
		queue.shared.pending = null;
	}
	if (baseQueue !== null) {
		const prevState = hook.memoizedState;
		// 证明有需要执行的update
		const {
			memoizedState,
			baseQueue: newBaseQueue,
			baseState: newBaseState
		} = processUpdateQueue(baseState, baseQueue, renderLane, (update) => {
			const skippedLane = update.lane;
			const fiber = currentlyRenderingFiber as FiberNode;
			// NoLanes
			fiber.lanes = mergeLanes(fiber.lanes, skippedLane);
		});
		if (!Object.is(prevState, memoizedState)) {
			markWipReceivedUpdate();
		}
		hook.memoizedState = memoizedState;
		hook.baseState = newBaseState;
		hook.baseQueue = newBaseQueue;
		// lastRenderedState 存储的为最后一次渲染时的state
		queue.lastRenderedState = memoizedState;
	}
	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

/**
 * update阶段 获取workInProgress对应的hook数据
 * @returns hook对象
 */
function updateWorkInProgressHook(): Hook {
	// TODO render阶段触发的更新
	let nextCurrentHook: Hook | null;
	if (currentHook === null) {
		// 函数组件更新时的第一个hook
		const current = (currentlyRenderingFiber as FiberNode).alternate;
		if (current !== null) {
			// 从current Fiber上获取到存储的hooks数据
			nextCurrentHook = current.memoizedState;
		} else {
			// mount
			nextCurrentHook = null;
		}
	} else {
		// 函数组件更新时的第二个及后续的hook
		nextCurrentHook = currentHook.next;
	}

	if (nextCurrentHook === null) {
		// 证明hook数量和首次挂载时不一致，为不合法操作
		// mount/update u1 u2 u3
		// update       u1 u2 u3 u4
		throw new Error(
			`组件 ${currentlyRenderingFiber?.type.name} 本次执行时的Hook比上次执行时多`
		);
	}
	currentHook = nextCurrentHook as Hook;
	const newHook: Hook = {
		memoizedState: currentHook.memoizedState,
		updateQueue: currentHook.updateQueue,
		next: null,
		baseQueue: currentHook.baseQueue,
		baseState: currentHook.baseState
	};

	if (workInProgressHook === null) {
		// mount时 第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = newHook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时 后续的hook
		workInProgressHook.next = newHook;
		workInProgressHook = newHook;
	}
	return workInProgressHook;
}

/**
 * 首次挂载时，对应的useState hook函数
 * @param initialState
 * @returns [state,dispatch]
 */
function mountState<State>(
	initialState: (() => State) | State
): [State, Dispatch<State>] {
	// 找到当前useState对应的hook数据
	const hook = mountWorkInProgressHook();
	let memoizedState;
	if (initialState instanceof Function) {
		memoizedState = initialState();
	} else {
		memoizedState = initialState;
	}
	const queue = createFCUpdateQueue<State>();
	hook.updateQueue = queue;
	hook.memoizedState = memoizedState;
	hook.baseState = memoizedState;
	// @ts-ignore
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
	queue.dispatch = dispatch;
	// lastRenderedState 存储的为最后一次渲染时的state
	queue.lastRenderedState = memoizedState;
	return [memoizedState, dispatch];
}

/**
 * 首次挂载时，对应的useTransition hook函数
 * @returns [isPending, startTransition] [是否存在待处理的 transition,使用此方法将状态更新标记为 transition]
 */
function mountTransition(): [boolean, (callback: () => void) => void] {
	const [isPending, setPending] = mountState(false);
	const hook = mountWorkInProgressHook();
	const start = startTransition.bind(null, setPending);
	hook.memoizedState = start;
	return [isPending, start];
}

/**
 * update时，对应的useTransition hook函数
 * @returns [isPending, startTransition] [是否存在待处理的 transition,使用此方法将状态更新标记为 transition]
 */
function updateTransition(): [boolean, (callback: () => void) => void] {
	const [isPending] = updateState();
	const hook = updateWorkInProgressHook();
	const start = hook.memoizedState;
	return [isPending as boolean, start];
}

/**
 * 将状态更新标记为transition
 * @param setPending 设置表示是否存在待处理的 transition的函数
 * @param callback
 */
function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
	// 设置当前正在开启过渡
	setPending(true);
	// 获取上一次transition值
	const prevTransition = currentBatchConfig.transition;
	currentBatchConfig.transition = 1;
	// 执行传入的callback
	callback();
	// 执行完成，将isPending设置为false
	setPending(false);
	// 将transition值恢复到上一次的值
	currentBatchConfig.transition = prevTransition;
}

/**
 * useState hook函数中返回的dispatch方法
 * @param fiber
 * @param updateQueue
 * @param action
 */
function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: FCUpdateQueue<State>,
	action: Action<State>
) {
	// 创建update的优先级
	const lane = requestUpdateLane();
	const update = createUpdate(action, lane);
	// eager策略
	const current = fiber.alternate;
	if (
		fiber.lanes === NoLanes &&
		(current === null || current.lanes === NoLanes)
	) {
		// 当前产生的update是这个fiber的第一个update
		//  更新前的状态
		const currentState = updateQueue.lastRenderedState;
		// 计算状态的方法
		const eagerState = basicStateReducer(currentState, action);
		update.hasEagerState = true;
		update.eagerState = eagerState;
		if (Object.is(currentState, eagerState)) {
			enqueueUpdate(updateQueue, update, fiber, NoLane);
			// 命中eagerState
			if (__DEV__) {
				console.warn('命中eagerState', fiber);
			}
			return;
		}
	}
	enqueueUpdate(updateQueue, update);
	scheduleUpdateOnFiber(fiber, lane);
}

/**
 * 首次挂载时，正在处理的hook
 * @returns hook对象
 */
function mountWorkInProgressHook(): Hook {
	// 创建一个hook对象
	const hook: Hook = {
		memoizedState: null, //usesSate的hook对象存放的是state， effect的hook对象中存放的是effect对象
		updateQueue: null,
		next: null,
		baseQueue: null,
		baseState: null
	};
	if (workInProgressHook === null) {
		// mount时 第一个hook
		if (currentlyRenderingFiber === null) {
			// 代表没有在一个函数组件内使用hook，即不合理法使用
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = hook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时 非第一个hook，即使用链表形式进行存储
		workInProgressHook.next = hook;
		workInProgressHook = hook;
	}
	return workInProgressHook;
}

function use<T>(usable: Usable<T>): T {
	if (usable !== null && typeof usable === 'object') {
		if (typeof (usable as Thenable<T>).then === 'function') {
			const thenable = usable as Thenable<T>;
			return trackUsedThenable(thenable);
		} else if ((usable as ReactContext<T>).$$typeof === REACT_CONTEXT_TYPE) {
			const context = usable as ReactContext<T>;
			return readContext(context);
		}
	}
	throw new Error('不支持的use参数 ' + usable);
}

/**
 * 在unwind流程重置hooks全局变量
 * @param wip
 */
export function resetHooksOnUnwind(wip: FiberNode) {
	currentlyRenderingFiber = null;
	currentHook = null;
	workInProgressHook = null;
}

export function bailoutHook(wip: FiberNode, renderLane: Lane) {
	const current = wip.alternate as FiberNode;
	wip.updateQueue = current.updateQueue;
	wip.flags &= ~PassiveEffect;

	current.lanes = removeLanes(current.lanes, renderLane);
}

/**
 * mount阶段useCallback
 * @param callback
 * @param deps
 * @returns
 */
function mountCallback<T>(callback: T, deps: HookDeps | undefined) {
	const hook = mountWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	hook.memoizedState = [callback, nextDeps];
	return callback;
}

/**
 * update阶段useCallback
 * @param callback
 * @param deps
 * @returns
 */
function updateCallback<T>(callback: T, deps: HookDeps | undefined) {
	const hook = updateWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	const prevState = hook.memoizedState;

	if (nextDeps !== null) {
		const prevDeps = prevState[1];
		if (areHookInputsEqual(nextDeps, prevDeps)) {
			return prevState[0];
		}
	}
	hook.memoizedState = [callback, nextDeps];
	return callback;
}

/**
 * mount阶段useMemo
 * @param nextCreate
 * @param deps
 * @returns
 */
function mountMemo<T>(nextCreate: () => T, deps: HookDeps | undefined) {
	const hook = mountWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	const nextValue = nextCreate();
	hook.memoizedState = [nextValue, nextDeps];
	return nextValue;
}

/**
 * update阶段useMemo
 * @param nextCreate
 * @param deps
 * @returns
 */
function updateMemo<T>(nextCreate: () => T, deps: HookDeps | undefined) {
	const hook = updateWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;
	const prevState = hook.memoizedState;

	if (nextDeps !== null) {
		const prevDeps = prevState[1];
		if (areHookInputsEqual(nextDeps, prevDeps)) {
			return prevState[0];
		}
	}
	const nextValue = nextCreate();
	hook.memoizedState = [nextValue, nextDeps];
	return nextValue;
}
