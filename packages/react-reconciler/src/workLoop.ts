import { beginWork } from './beginWork';
import { commitMutationEffects } from './commitWork';
import { completeWork } from './completeWork';
import { createWorkInProgress, FiberNode, FiberRootNode } from './fiber';
import { MutationMask, NoFlags } from './fiberFlags';
import { HostRoot } from './workTags';

// current：与视图中真实UI对应的fiberNode
// workInProgress：触发更新后，正在reconciler中计算的fiberNode
// 正在工作的fiberNode
let workInProgress: FiberNode | null = null;

// 用于执行初始化的操作
function prepareFreshStack(root: FiberRootNode) {
	// 这里就代表即使是首屏渲染，整颗Fiber树里，也会有一个Fiber同时存在current和workInProgress的
	// 这个Fiber就是RootFiber（即HostRootFiber）
	workInProgress = createWorkInProgress(root.current, {});
}

/**
 * 在Fiber上调度更新，直至根节点
 * @param {*} fiber
 */
export function scheduleUpdateOnFiber(fiber: FiberNode) {
	//TODO: 调度功能
	// 拿到fiberRootNode
	const root = markUpdateFromFiberToRoot(fiber);
	renderRoot(root);
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
 * 渲染根节点
 * @param root
 */
function renderRoot(root: FiberRootNode) {
	// 初始化
	prepareFreshStack(root);
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

	// 根据wip fiberNode树 树中的flags进行dom操作
	commitRoot(root);
}

function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}

	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}
	// 重置
	root.finishedWork = null;
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
	const next = beginWork(fiber);
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
