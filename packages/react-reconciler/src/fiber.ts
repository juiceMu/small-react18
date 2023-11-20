import { Props, Key, Ref, ReactElementType, Wakeable } from 'shared/ReactTypes';
import {
	ContextProvider,
	Fragment,
	FunctionComponent,
	HostComponent,
	WorkTag,
	SuspenseComponent,
	OffscreenComponent
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';
import { REACT_PROVIDER_TYPE, REACT_SUSPENSE_TYPE } from 'shared/ReactSymbols';

export class FiberNode {
	type: any;
	tag: WorkTag; // 代表fiberNode 是什么类型的节点
	pendingProps: Props;
	key: Key;
	stateNode: any;
	ref: Ref | null;
	return: FiberNode | null;
	sibling: FiberNode | null;
	child: FiberNode | null;
	index: number;
	memoizedProps: Props | null;
	memoizedState: any;
	alternate: FiberNode | null;
	flags: Flags;
	subtreeFlags: Flags;
	updateQueue: unknown;
	deletions: FiberNode[] | null;

	constructor(tag: WorkTag, pendingProps: Props, key: Key) {
		// 下面这些是实例属性
		this.tag = tag;
		this.key = key || null;
		this.stateNode = null; // 存放dom等
		this.type = null; // 如果是函数组件，就是函数本身

		// 下面这些是fiber节点之间关系
		this.return = null; // 父级节点
		this.sibling = null; // 兄弟节点
		this.child = null; // 子节点
		this.index = 0; // 在同级节点中的index值

		this.ref = null;

		// 工作单元属性
		this.pendingProps = pendingProps; // 刚开始准备工作时的prop值
		this.memoizedProps = null; // 工作结束后的prop值，也就是确定下来的prop值
		this.memoizedState = null; // 对于函数组件的fiber，这里存储的是该函数组件hooks链表
		this.updateQueue = null;
		this.alternate = null;

		// 副作用
		this.flags = NoFlags; // 对应操作标记
		this.subtreeFlags = NoFlags; // 层层叠加的操作标记集合
		this.deletions = null; // 要被删除的子Fiber合集
	}
}

export interface PendingPassiveEffects {
	unmount: Effect[];
	update: Effect[];
}

export class FiberRootNode {
	container: Container; // 根元素DOM element
	current: FiberNode;
	finishedWork: FiberNode | null; // 更新完成后的rootFiber，这里就是hostRootFiber
	pendingLanes: Lanes;
	suspendedLanes: Lanes;
	pingedLanes: Lanes;
	finishedLane: Lane;
	pendingPassiveEffects: PendingPassiveEffects;
	callbackNode: CallbackNode | null;
	callbackPriority: Lane;
	pingCache: WeakMap<Wakeable<any>, Set<Lane>> | null;
	constructor(container: Container, hostRootFiber: FiberNode) {
		this.container = container;
		this.current = hostRootFiber;
		hostRootFiber.stateNode = this;
		this.finishedWork = null;
		this.pendingLanes = NoLanes; // 所有未被执行的lane的集合
		this.suspendedLanes = NoLanes; // 所有被挂起的lane
		this.pingedLanes = NoLanes; // 所有被挂起的lane中被ping的lane
		this.finishedLane = NoLane; //  本次更新执行的lane
		this.callbackNode = null; // scheduler 的scheduleCallback执行后会返回一个调度的回调函数
		this.callbackPriority = NoLane; // 调度的回调函数优先级

		this.pendingPassiveEffects = {
			// 所有待执行的effect hooks集合
			unmount: [], // 卸载触发回调集合
			update: [] // 更新触发回调集合
		};

		this.pingCache = null;
	}
}

/**
 * 基于传入的fiber创建一个新的对应fiber
 * @param current 当前已存在的fiber
 * @param pendingProps 新的属性
 * @returns FiberNode
 */
export const createWorkInProgress = (
	current: FiberNode,
	pendingProps: Props
): FiberNode => {
	let wip = current.alternate;
	if (wip === null) {
		// mount 挂载阶段
		wip = new FiberNode(current.tag, pendingProps, current.key);
		wip.stateNode = current.stateNode;
		wip.alternate = current;
		current.alternate = wip;
	} else {
		// update 更新阶段
		wip.pendingProps = pendingProps;
		wip.flags = NoFlags;
		wip.subtreeFlags = NoFlags;
		wip.deletions = null;
	}
	// 复用属性
	wip.type = current.type;
	wip.updateQueue = current.updateQueue;
	wip.child = current.child;
	wip.memoizedProps = current.memoizedProps;
	wip.memoizedState = current.memoizedState;
	wip.ref = current.ref;
	return wip;
};

/**
 * 根据element/虚拟dom创建Fiber
 * @param element  element/虚拟dom
 * @returns {FiberNode} 新创建的Fiber
 */
export function createFiberFromElement(element: ReactElementType): FiberNode {
	const { type, key, props, ref } = element;
	let fiberTag: WorkTag = FunctionComponent;

	if (typeof type === 'string') {
		// <div/> type: 'div'
		fiberTag = HostComponent;
	} else if (
		typeof type === 'object' &&
		type.$$typeof === REACT_PROVIDER_TYPE
	) {
		// <Context.Provider>
		fiberTag = ContextProvider;
	} else if (type === REACT_SUSPENSE_TYPE) {
		fiberTag = SuspenseComponent;
	} else if (typeof type !== 'function' && __DEV__) {
		console.warn('为定义的type类型', element);
	}
	const fiber = new FiberNode(fiberTag, props, key);
	fiber.type = type;
	fiber.ref = ref;
	return fiber;
}

/**
 * 根据Fragment创建Fiber
 * @param elements element集合
 * @param key
 * @returns
 */
export function createFiberFromFragment(elements: any[], key: Key): FiberNode {
	const fiber = new FiberNode(Fragment, elements, key);
	return fiber;
}

export interface OffscreenProps {
	mode: 'visible' | 'hidden';
	children: any;
}

/**
 * 基于Offscreen组件创建fiber（用于Suspense）
 * @param pendingProps
 * @returns
 */
export function createFiberFromOffscreen(pendingProps: OffscreenProps) {
	const fiber = new FiberNode(OffscreenComponent, pendingProps, null);
	// TODO stateNode
	return fiber;
}
