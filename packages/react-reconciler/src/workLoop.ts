import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import { commitMutationEffects } from './commitWork';
import { completeWork } from './completeWork';
import { createWorkInProgress, FiberNode, FiberRootNode } from './fiber';
import { MutationMask, NoFlags } from './fiberFlags';
import {
	getHighestPriorityLane,
	Lane,
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';

// current：与视图中真实UI对应的fiberNode
// workInProgress：触发更新后，正在reconciler中计算的fiberNode
// 正在工作的fiberNode
let workInProgress: FiberNode | null = null;
// 当前本次更新的优先级
let wipRootRenderLane: Lane = NoLane;

// 用于执行初始化的操作
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	// 这里就代表即使是首屏渲染，整颗Fiber树里，也会有一个Fiber同时存在current和workInProgress的
	// 这个Fiber就是RootFiber（即HostRootFiber）
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
	if (updateLane === NoLane) {
		// 代表无更新任务，即当前无更新，不需要更新
		return;
	}
	if (updateLane === SyncLane) {
		// 同步优先级 用微任务调度
		if (__DEV__) {
			console.log('在微任务中调度，优先级：', updateLane);
		}
		// 将同步渲染任务放入队列
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他优先级 用宏任务调度
	}
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
 * 开始同步渲染(从根节点开始执行渲染)
 * @param root
 * @param lane
 */
function performSyncWorkOnRoot(root: FiberRootNode, lane: Lane) {
	const nextLane = getHighestPriorityLane(root.pendingLanes);
	if (nextLane !== SyncLane) {
		// 1.其他比SyncLane低的优先级
		// 2.NoLane
		// 重新执行一遍调度流程
		ensureRootIsScheduled(root);
		return;
	}
	if (__DEV__) {
		console.warn('render阶段开始');
	}
	// 初始化
	prepareFreshStack(root, lane);
	// 开始执行递归流程
	do {
		try {
			workLoop();
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			workInProgress = null;
		}
	} while (true);

	// 生成的一颗完整的Fiber树
	const finishedWork = root.current.alternate;
	root.finishedWork = finishedWork;
	root.finishedLane = lane;
	// 重置
	wipRootRenderLane = NoLane;
	// 根据wip fiberNode树 树中的flags进行dom操作
	commitRoot(root);
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
	// 根据root的flags和subtreeFlags，判断是否存在3个子阶段需要执行的操作
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;
	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation
		// mutation Placement
		commitMutationEffects(finishedWork);

		root.current = finishedWork;

		// layout
	} else {
		root.current = finishedWork;
	}
}

function workLoop() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}

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
