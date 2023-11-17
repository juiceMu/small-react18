import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	createWorkInProgress,
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects
} from './fiber';
import { MutationMask, NoFlags, PassiveMask } from './fiberFlags';
import {
	getHighestPriorityLane,
	Lane,
	lanesToSchedulerPriority,
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_scheduleCallback as scheduleCallback,
	unstable_NormalPriority as NormalPriority,
	unstable_shouldYield,
	unstable_cancelCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';

// current：与视图中真实UI对应的fiberNode
// workInProgress：触发更新后，正在reconciler中计算的fiberNode
// 正在工作的fiberNode
let workInProgress: FiberNode | null = null;
// 当前本次更新的优先级
let wipRootRenderLane: Lane = NoLane;
// 正在处理需要被触发的effect hook
let rootDoesHasPassiveEffects = false;

type RootExitStatus = number;
const RootInComplete = 1; // root渲染任务被中断
const RootCompleted = 2; // root渲染任务执行完毕
// TODO 执行过程中报错了

// 用于执行初始化的操作
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	// 这里就代表即使是首屏渲染，整颗Fiber树里，也会有一个Fiber同时存在current和workInProgress的
	// 这个Fiber就是RootFiber（即HostRootFiber）
	root.finishedLane = NoLane;
	root.finishedWork = null;
	workInProgress = createWorkInProgress(root.current, {});
	wipRootRenderLane = lane;
}

/**
 * 在Fiber上开始调度更新，直至根节点
 * @param {*} fiber
 * @param lane 优先级
 */
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	// 拿到fiberRootNode
	const root = markUpdateFromFiberToRoot(fiber);
	markRootUpdated(root, lane);
	ensureRootIsScheduled(root);
}

/**
 * 执行调度流程，确保root被调度
 * schedule调度阶段入口
 * @param root
 */
function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取当前所有未处理的lanes集合中的最高优先级lane作为本次更新的优先级
	const updateLane = getHighestPriorityLane(root.pendingLanes);
	// scheduler 的scheduleCallback执行后会返回一个callbackNode
	// 当前正在执行的调度callback
	const existingCallback = root.callbackNode;

	if (updateLane === NoLane) {
		// 代表无更新任务，即当前无更新，不需要更新
		if (existingCallback !== null) {
			// 如果存在上次的调度callback，则取消执行
			unstable_cancelCallback(existingCallback);
		}
		// 重置对应值
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}
	// 本次更新优先级
	const curPriority = updateLane;
	// 上次更新优先级
	const prevPriority = root.callbackPriority;
	if (curPriority === prevPriority) {
		// 两次更新优先级相同，证明为同一优先级的调度，则不需要开启新的调度。
		return;
	}
	// 走到这里，证明需要开启新一轮的调度
	if (existingCallback !== null) {
		// 取消执行上次更新的调度callback
		unstable_cancelCallback(existingCallback);
	}

	let newCallbackNode = null;
	if (updateLane === SyncLane) {
		// 同步优先级 用微任务调度
		if (__DEV__) {
			console.log('在微任务中调度，优先级：', updateLane);
		}
		// 将同步渲染任务放入队列
		// @ts-ignore
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他优先级 用宏任务调度
		// 开启并发模式
		const schedulerPriority = lanesToSchedulerPriority(updateLane);
		newCallbackNode = scheduleCallback(
			schedulerPriority,
			// @ts-ignore
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}
	root.callbackNode = newCallbackNode;
	root.callbackPriority = curPriority;
}

/**
 * 更新整合FiberRoot的未处理lanes集合
 * @param root
 * @param lane 需要加入集合的lane
 */
function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

/**
 * 从fiber中递归得到FiberRoot
 * @param fiber
 * @returns fiberRootNode
 */
function markUpdateFromFiberToRoot(fiber: FiberNode) {
	let node = fiber;
	let parent = node.return;
	while (parent !== null) {
		// 证明为普通fiber节点，则不断向上递归
		node = parent;
		parent = node.return;
	}
	if (node.tag === HostRoot) {
		// 证明node此时为RootFiber，通过stateNode获取到FiberRoot
		return node.stateNode;
	}
	return null;
}

/**
 * 执行并发模式渲染更新(从根节点开始执行渲染)
 * @param root
 * @param didTimeout 任务是否超时/过期 scheduleCallback执行该函数时，会传入这个参数
 */
function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout: boolean
): any {
	const curCallback = root.callbackNode;
	// 保证所有useEffect回调执行。
	// 原因：useEffect中可能存在比本次更新优先级更高优先级的更新操作
	// 如果存在更高优先级的更新，那么当前这次更新就应该被打断，重新开始更高优先级的调度更新
	const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);
	if (didFlushPassiveEffect) {
		if (root.callbackNode !== curCallback) {
			// 证明useEffect中存在比本次更新优先级更高的操作，存在更高优先级的调度
			// 导致root.callbackNode发生了改变。所以需要中断本次调度
			return null;
		}
	}
	const lane = getHighestPriorityLane(root.pendingLanes);
	const curCallbackNode = root.callbackNode;
	if (lane === NoLane) {
		// 无更新
		return null;
	}
	// 需要开启同步优先级的情况：lane为同步优先级，任务已过期，需要立即执行掉
	const needSync = lane === SyncLane || didTimeout;
	// 优先级为同步优先级，所以执行render时，需要使用同步模式，不能开启时间切片模式
	// 获取渲染完后的退出状态
	const exitStatus = renderRoot(root, lane, !needSync);
	ensureRootIsScheduled(root);
	if (exitStatus === RootInComplete) {
		// 任务被中断
		if (root.callbackNode !== curCallbackNode) {
			// 两次callback不是同一个，证明插入了一个更高优先级的任务，所以需要停止此次调度
			return;
		}
		// 继续调度当前的callback，继续执行本次调度
		return performConcurrentWorkOnRoot.bind(null, root);
	}

	if (exitStatus === RootCompleted) {
		const finishedWork = root.current.alternate;
		root.finishedWork = finishedWork;
		root.finishedLane = lane;
		wipRootRenderLane = NoLane;
		commitRoot(root);
	} else if (__DEV__) {
		console.error('还未实现的并发更新结束状态');
	}
}

/**
 * 执行同步模式渲染更新(从根节点开始执行渲染)
 * @param root
 */
function performSyncWorkOnRoot(root: FiberRootNode) {
	const nextLane = getHighestPriorityLane(root.pendingLanes);
	if (nextLane !== SyncLane) {
		// 1.其他比SyncLane低的优先级
		// 2.NoLane
		// 重新执行一遍调度流程
		ensureRootIsScheduled(root);
		return;
	}
	// 获取root渲染后时状态
	const exitStatus = renderRoot(root, nextLane, false);

	if (exitStatus === RootCompleted) {
		// root渲染任务执行完毕

		// 生成的一颗完整的Fiber树
		const finishedWork = root.current.alternate;
		root.finishedWork = finishedWork;
		root.finishedLane = nextLane;
		// 重置
		wipRootRenderLane = NoLane;
		// 根据wip fiberNode树 树中的flags进行dom操作
		commitRoot(root);
	} else if (__DEV__) {
		console.error('还未实现的同步更新结束状态');
	}
}

/**
 * 开始执行渲染(从根节点开始)
 * @param root
 * @param lane
 * @param shouldTimeSlice 是否开启时间切片
 * @returns 当前渲染状态-是否完成
 */
function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
	if (__DEV__) {
		console.log(`开始${shouldTimeSlice ? '并发' : '同步'}更新`, root);
	}
	if (wipRootRenderLane !== lane) {
		// 因为并发模式会出现中断再继续的情况，为避免多次重复初始化，需进行判断
		// 初始化,
		prepareFreshStack(root, lane);
	}
	// 开始执行递归流程
	do {
		try {
			//是否开启时间切片 代表开启并发模式 否则开启同步渲染
			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			workInProgress = null;
		}
	} while (true);

	if (shouldTimeSlice && workInProgress !== null) {
		// 开启时间切片且workInProgress有值代表此时为中断执行
		return RootInComplete;
	}
	// render阶段执行完
	if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
		console.error(`render阶段结束时wip不应该不是null`);
	}
	// TODO 报错
	return RootCompleted;
}

/**
 * commit阶段开始
 * @param root
 * @returns
 */
function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}

	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}
	const lane = root.finishedLane;

	if (lane === NoLane && __DEV__) {
		console.error('commit阶段finishedLane不应该是NoLane');
	}
	// 重置
	root.finishedWork = null;
	root.finishedLane = NoLane;

	// 将执行完毕的lane从root中去掉
	markRootFinished(root, lane);

	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subtreeFlags & PassiveMask) !== NoFlags
	) {
		// 代表存在函数组件需要执行uesEffect回调
		if (!rootDoesHasPassiveEffects) {
			// 开启全局锁，阻止执行多次调度
			rootDoesHasPassiveEffects = true;
			// 调度副作用
			scheduleCallback(NormalPriority, () => {
				// 用NormalPriority的优先级调度一个异步函数(可以理解为在setTimeout中执行回调)
				// 执行副作用
				flushPassiveEffects(root.pendingPassiveEffects);
				return;
			});
		}
	}

	// 根据root的flags和subtreeFlags，判断是否存在3个子阶段需要执行的操作
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & (MutationMask | PassiveMask)) !== NoFlags;
	const rootHasEffect =
		(finishedWork.flags & (MutationMask | PassiveMask)) !== NoFlags;
	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation
		// mutation Placement
		commitMutationEffects(finishedWork, root);

		root.current = finishedWork;

		// layout
	} else {
		root.current = finishedWork;
	}
	rootDoesHasPassiveEffects = false;
	ensureRootIsScheduled(root);
}

/**
 * 执行所有等待被执行的需要触发的effect hook回调
 * @param pendingPassiveEffects 等待被触发的effect集合
 * @returns 是否有effect回调被执行
 */
function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	// 执行流程：
	// 1.首先触发所有unmount effect，且对于某个fiber，如果触发了unmount destroy，本次更新不会再触发update create
	// 2.触发所有上次更新的destroy
	// 3.触发所有这次更新的create

	// 是否有effect回调被执行
	let didFlushPassiveEffect = false;
	pendingPassiveEffects.unmount.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUnmount(Passive, effect);
	});
	pendingPassiveEffects.unmount = [];

	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListCreate(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update = [];
	// 因为effect hook中也可能包含如useState等引发新一轮更新的操作
	// 所以执行完所有effect后，需要flushSyncCallbacks，去处理回调过程触发的一些新的更新流程
	flushSyncCallbacks();
	return didFlushPassiveEffect;
}

/**
 * 同步模式下工作循环
 */
function workLoopSync() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

/**
 * 并发模式下工作循环
 */
function workLoopConcurrent() {
	//unstable_shouldYield 时间切片是否被用完（即是否应该被中断）
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

/**
 * 执行一个工作单元(即fiber进行一系列的计算)
 * @param fiber
 */
function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;
	if (next === null) {
		// 代表没有子fiber，已经递归到最底层了
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next;
	}
}

function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;
	do {
		completeWork(node);
		const sibling = node.sibling;
		if (sibling !== null) {
			workInProgress = sibling;
			return;
		}
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}
