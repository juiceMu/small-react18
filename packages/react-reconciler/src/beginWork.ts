import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import {
	FiberNode,
	createFiberFromFragment,
	createWorkInProgress,
	createFiberFromOffscreen,
	OffscreenProps
} from './fiber';
import { bailoutHook, renderWithHooks } from './fiberHooks';
import { Lane, NoLanes, includeSomeLanes } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText,
	MemoComponent,
	OffscreenComponent,
	SuspenseComponent
} from './workTags';
import {
	Ref,
	NoFlags,
	DidCapture,
	Placement,
	ChildDeletion
} from './fiberFlags';
import {
	prepareToReadContext,
	propagateContextChange,
	pushProvider
} from './fiberContext';
import { pushSuspenseHandler } from './suspenseContext';
import { cloneChildFibers } from './childFibers';
import { shallowEqual } from 'shared/shallowEquals';

// 是否存在更新 (命中bailout策略，则不需要更新)
let didReceiveUpdate = false;

export function markWipReceivedUpdate() {
	didReceiveUpdate = true;
}

/**
 * 开始根据新的虚拟DOM构建新的Fiber树
 * @param wip 当前正在工作计算的Fiber
 * @param renderLane 当前本次更新的优先级
 * @returns 新的子Fiber节点或者nul
 * 递归中的递阶段，往下深度优先遍历
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
	// bailout策略
	didReceiveUpdate = false;
	const current = wip.alternate;
	if (current !== null) {
		const oldProps = current.memoizedProps;
		const newProps = wip.pendingProps;
		// bailout四要素：
		// 1. props不变-比较props变化是通过「全等比较」，使用React.memo后会变为「浅比较」
		// 2. state不变。两种情况可能造成state不变：
		//    ● 不存在update
		//    ● 存在update，但计算得出的state没变化
		// 3. context不变
		// 4. type不变
		// {num: 0, name: 'cpn2'}
		// {num: 0, name: 'cpn2'}
		if (oldProps !== newProps || current.type !== wip.type) {
			didReceiveUpdate = true;
		} else {
			// 是否存在state/context需要调度
			const hasScheduledStateOrContext = checkScheduledUpdateOrContext(
				current,
				renderLane
			);
			if (!hasScheduledStateOrContext) {
				// 四要素～ state context
				// 命中bailout
				didReceiveUpdate = false;
				switch (wip.tag) {
					case ContextProvider:
						const newValue = wip.memoizedProps.value;
						const context = wip.type._context;
						pushProvider(context, newValue);
						break;
					// TODO Suspense
				}
				return bailoutOnAlreadyFinishedWork(wip, renderLane);
			}
		}
	}

	wip.lanes = NoLanes;

	// 比较，返回子fiberNode
	switch (wip.tag) {
		case HostRoot:
			return updateHostRoot(wip, renderLane);
		case HostComponent:
			return updateHostComponent(wip);
		case HostText:
			return null;
		case FunctionComponent:
			return updateFunctionComponent(wip, wip.type, renderLane);
		case Fragment:
			return updateFragment(wip);
		case ContextProvider:
			return updateContextProvider(wip, renderLane);
		case SuspenseComponent:
			return updateSuspenseComponent(wip);
		case OffscreenComponent:
			return updateOffscreenComponent(wip);
		case MemoComponent:
			return updateMemoComponent(wip, renderLane);
		default:
			if (__DEV__) {
				console.warn('beginWork未实现的类型');
			}
			break;
	}
	return null;
};

function updateMemoComponent(wip: FiberNode, renderLane: Lane) {
	// bailout四要素
	// props浅比较
	const current = wip.alternate;
	const nextProps = wip.pendingProps;
	const Component = wip.type.type;

	if (current !== null) {
		const prevProps = current.memoizedProps;
		// state context
		if (!checkScheduledUpdateOrContext(current, renderLane)) {
			// 浅比较props
			if (shallowEqual(prevProps, nextProps) && current.ref === wip.ref) {
				didReceiveUpdate = false;
				wip.pendingProps = prevProps;
				// 满足四要素
				wip.lanes = current.lanes;
				return bailoutOnAlreadyFinishedWork(wip, renderLane);
			}
		}
	}
	return updateFunctionComponent(wip, Component, renderLane);
}

/**
 * 命中bailout策略，复用对应已完成工作的fiber
 * @param wip
 * @param renderLane
 * @returns
 */
function bailoutOnAlreadyFinishedWork(wip: FiberNode, renderLane: Lane) {
	if (!includeSomeLanes(wip.childLanes, renderLane)) {
		// 复用整棵子树，整棵子树跳过beginWork
		if (__DEV__) {
			console.warn('bailout整棵子树', wip);
		}
		return null;
	}

	if (__DEV__) {
		console.warn('bailout一个fiber', wip);
	}
	// 复用当前fiber的子fiber
	cloneChildFibers(wip);
	return wip.child;
}

/**
 * 检查是否有调度更新或context
 * @param current
 * @param renderLane
 * @returns boolean
 */
function checkScheduledUpdateOrContext(
	current: FiberNode,
	renderLane: Lane
): boolean {
	const updateLanes = current.lanes;

	if (includeSomeLanes(updateLanes, renderLane)) {
		return true;
	}
	return false;
}

/**
 * 更新Context.Provider
 * @param wip
 * @returns
 */
function updateContextProvider(wip: FiberNode, renderLane: Lane) {
	const providerType = wip.type;
	const context = providerType._context;
	const newProps = wip.pendingProps;
	const oldProps = wip.memoizedProps;
	const newValue = newProps.value;
	pushProvider(context, newValue);
	if (oldProps !== null) {
		const oldValue = oldProps.value;

		if (
			Object.is(oldValue, newValue) &&
			oldProps.children === newProps.children
		) {
			return bailoutOnAlreadyFinishedWork(wip, renderLane);
		} else {
			propagateContextChange(wip, context, renderLane);
		}
	}
	const nextChildren = newProps.children;
	reconcileChildren(wip, nextChildren);
	return wip.child;
}

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
 * @param Component 函数组件本身函数
 * @param renderLane 当前本次更新的优先级
 * @returns
 */
function updateFunctionComponent(
	wip: FiberNode,
	Component: FiberNode['type'],
	renderLane: Lane
) {
	prepareToReadContext(wip, renderLane);
	// render
	const nextChildren = renderWithHooks(wip, Component, renderLane);

	const current = wip.alternate;
	if (current !== null && !didReceiveUpdate) {
		bailoutHook(wip, renderLane);
		return bailoutOnAlreadyFinishedWork(wip, renderLane);
	}

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
	const prevChildren = wip.memoizedState;
	// 对pending进行计算，获取最新状态值
	const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
	wip.memoizedState = memoizedState;
	const current = wip.alternate;
	// 考虑RootDidNotComplete的情况，需要复用memoizedState
	if (current !== null) {
		if (!current.memoizedState) {
			current.memoizedState = memoizedState;
		}
	}
	// 对于hostRoot来说，updateContainer中创建update时传入的是element
	// 所以 memoizedState中此时就是对应的element DOM
	const nextChildren = wip.memoizedState;
	if (prevChildren === nextChildren) {
		return bailoutOnAlreadyFinishedWork(wip, renderLane);
	}
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

function updateOffscreenComponent(workInProgress: FiberNode) {
	const nextProps = workInProgress.pendingProps;
	const nextChildren = nextProps.children;
	reconcileChildren(workInProgress, nextChildren);
	return workInProgress.child;
}

function updateSuspenseComponent(workInProgress: FiberNode) {
	const current = workInProgress.alternate;
	const nextProps = workInProgress.pendingProps;
	// 是否展示fallback
	let showFallback = false;
	// 判断是否为正常流程还是挂起流程
	const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;
	if (didSuspend) {
		// 挂起流程
		showFallback = true;
		workInProgress.flags &= ~DidCapture;
	}

	const nextPrimaryChildren = nextProps.children;
	const nextFallbackChildren = nextProps.fallback;
	pushSuspenseHandler(workInProgress);
	if (current === null) {
		// mount流程
		if (showFallback) {
			// 挂起流程
			return mountSuspenseFallbackChildren(
				workInProgress,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 正常流程
			return mountSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
		}
	} else {
		if (showFallback) {
			// 挂起流程
			return updateSuspenseFallbackChildren(
				workInProgress,
				nextPrimaryChildren,
				nextFallbackChildren
			);
		} else {
			// 正常流程
			return updateSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
		}
	}
}

function mountSuspensePrimaryChildren(
	workInProgress: FiberNode,
	primaryChildren: any
) {
	const primaryChildProps: OffscreenProps = {
		mode: 'visible',
		children: primaryChildren
	};
	const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
	workInProgress.child = primaryChildFragment;
	primaryChildFragment.return = workInProgress;
	return primaryChildFragment;
}

function mountSuspenseFallbackChildren(
	workInProgress: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	const primaryChildProps: OffscreenProps = {
		mode: 'hidden',
		children: primaryChildren
	};
	const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
	const fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
	// 父组件Suspense已经mount，所以需要这里fallback手动标记Placement
	fallbackChildFragment.flags |= Placement;

	primaryChildFragment.return = workInProgress;
	fallbackChildFragment.return = workInProgress;
	primaryChildFragment.sibling = fallbackChildFragment;
	workInProgress.child = primaryChildFragment;

	return fallbackChildFragment;
}

function updateSuspensePrimaryChildren(
	workInProgress: FiberNode,
	primaryChildren: any
) {
	const current = workInProgress.alternate as FiberNode;
	const currentPrimaryChildFragment = current.child as FiberNode;
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment.sibling;

	const primaryChildProps: OffscreenProps = {
		mode: 'visible',
		children: primaryChildren
	};
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);
	primaryChildFragment.return = workInProgress;
	primaryChildFragment.sibling = null;
	workInProgress.child = primaryChildFragment;
	if (currentFallbackChildFragment !== null) {
		//移除fallback Fragment
		const deletions = workInProgress.deletions;
		if (deletions === null) {
			workInProgress.deletions = [currentFallbackChildFragment];
			workInProgress.flags |= ChildDeletion;
		} else {
			deletions.push(currentFallbackChildFragment);
		}
	}

	return primaryChildFragment;
}

function updateSuspenseFallbackChildren(
	workInProgress: FiberNode,
	primaryChildren: any,
	fallbackChildren: any
) {
	const current = workInProgress.alternate as FiberNode;
	const currentPrimaryChildFragment = current.child as FiberNode;
	const currentFallbackChildFragment: FiberNode | null =
		currentPrimaryChildFragment.sibling;

	const primaryChildProps: OffscreenProps = {
		mode: 'hidden',
		children: primaryChildren
	};
	const primaryChildFragment = createWorkInProgress(
		currentPrimaryChildFragment,
		primaryChildProps
	);
	let fallbackChildFragment;

	if (currentFallbackChildFragment !== null) {
		// 可以复用
		fallbackChildFragment = createWorkInProgress(
			currentFallbackChildFragment,
			fallbackChildren
		);
	} else {
		fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
		fallbackChildFragment.flags |= Placement;
	}
	fallbackChildFragment.return = workInProgress;
	primaryChildFragment.return = workInProgress;
	primaryChildFragment.sibling = fallbackChildFragment;
	workInProgress.child = primaryChildFragment;

	return fallbackChildFragment;
}
