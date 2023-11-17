import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import { FiberNode } from './fiber';
import { renderWithHooks } from './fiberHooks';
import { Lane } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import {
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import { Ref } from './fiberFlags';

/**
 * 开始根据新的虚拟DOM构建新的Fiber树
 * @param wip 当前正在工作计算的Fiber
 * @param renderLane 当前本次更新的优先级
 * @returns 新的子Fiber节点或者nul
 * 递归中的递阶段
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// 比较，返回子fiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip, renderLane);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			return null;
		case FunctionComponent:
			return updateFunctionComponent(wip, renderLane);
		case Fragment:
			return updateFragment(wip);
		default:
			if (__DEV__) {
				console.warn('beginWork未实现的类型');
			}
			break;
	}
	return null;
};

/**
 * 更新Fragment
 * @param wip
 * @returns
 */
function updateFragment(wip: FiberNode) {
	const nextChildren = wip.pendingProps;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 更新函数组件
 * @param wip
 * @param renderLane 当前本次更新的优先级
 * @returns
 */
function updateFunctionComponent(wip: FiberNode, renderLane: Lane) {
	const nextChildren = renderWithHooks(wip, renderLane);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 更新HostRoot类型的Fiber节点
 * @param wip 当前正在工作计算的Fiber
 * @param renderLane 当前本次更新的优先级
 * @returns 传入Fiber的新子Fiber节点
 */
function updateHostRoot(wip: FiberNode, renderLane: Lane) {
	const baseState = wip.memoizedState;
	const updateQueue = wip.updateQueue as UpdateQueue<Element>;
	// 获取pending值
	const pending = updateQueue.shared.pending;
	// 重置pending
	updateQueue.shared.pending = null;
	// 对pending进行计算，获取最新状态值
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
	wip.memoizedState = memoizedState;
	// 对于hostRoot来说，updateContainer中创建update时传入的是element
	// 所以 memoizedState中此时就是对应的element DOM
	const nextChildren = wip.memoizedState;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 更新HostComponent类型的Fiber节点
 * @param wip 当前正在工作计算的Fiber
 * @returns 传入Fiber的新子Fiber节点
 */
function updateHostComponent(wip: FiberNode) {
	const nextProps = wip.pendingProps;
	// 获取子element
	const nextChildren = nextProps.children;
	markRef(wip.alternate, wip);
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

/**
 * 根据传入Fiber和对应的子element创建对应子Fiber
 * @param wip Fiber节点
 * @param children 子元素element
 */
function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
	// 旧的对应Fiber节点
	const current = wip.alternate;
	if (current !== null) {
		// update
		wip.child = reconcileChildFibers(wip, current?.child, children);
	} else {
		// mount
		wip.child = mountChildFibers(wip, null, children);
	}
}

/**
 * 对fiber增加Ref标识
 * @param current
 * @param workInProgress
 */
function markRef(current: FiberNode | null, workInProgress: FiberNode) {
	const ref = workInProgress.ref;

	if (
		(current === null && ref !== null) ||
		(current !== null && current.ref !== ref)
	) {
		workInProgress.flags |= Ref;
	}
}
