import { ReactContext } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import {
	Lane,
	NoLanes,
	includeSomeLanes,
	isSubsetOfLanes,
	mergeLanes
} from './fiberLanes';
import { markWipReceivedUpdate } from './beginWork';
import { ContextProvider } from './workTags';

let lastContextDep: ContextItem<any> | null = null;

export interface ContextItem<Value> {
	context: ReactContext<Value>;
	memoizedState: Value;
	next: ContextItem<Value> | null;
}

// 上一次的Context中的值
let prevContextValue: any = null;
// 存储旧的Context value 栈
const prevContextValueStack: any[] = [];

export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
	prevContextValueStack.push(prevContextValue);
	prevContextValue = context._currentValue;
	context._currentValue = newValue;
}

export function popProvider<T>(context: ReactContext<T>) {
	context._currentValue = prevContextValue;
	prevContextValue = prevContextValueStack.pop();
}

/**
 * 读取context前的准备操作
 * @param wip
 * @param renderLane
 */
export function prepareToReadContext(wip: FiberNode, renderLane: Lane) {
	lastContextDep = null;
	const deps = wip.dependencies;
	if (deps !== null) {
		const firstContext = deps.firstContext;
		if (firstContext !== null) {
			if (includeSomeLanes(deps.lanes, renderLane)) {
				markWipReceivedUpdate();
			}
			deps.firstContext = null;
		}
	}
}

/**
 * 读取context
 * @param consumer
 * @param context
 */
export function readContext<T>(
	consumer: FiberNode | null,
	context: ReactContext<T>
): T {
	if (consumer === null) {
		throw new Error('只能在函数组件中调用useContext');
	}
	const value = context._currentValue;
	// 建立 fiber -> context
	const contextItem: ContextItem<T> = {
		context,
		next: null,
		memoizedState: value
	};

	if (lastContextDep === null) {
		lastContextDep = contextItem;
		consumer.dependencies = {
			firstContext: contextItem,
			lanes: NoLanes
		};
	} else {
		lastContextDep = lastContextDep.next = contextItem;
	}

	return value;
}

/**
 * 传播context的变化
 * @param wip
 * @param context
 * @param renderLane
 */
export function propagateContextChange<T>(
	wip: FiberNode,
	context: ReactContext<T>,
	renderLane: Lane
) {
	// 是从当前的context.Provider的beginWork开启向下深度优先遍历
	// 而不是beginWork本身的深度优先遍历，所以fiber之间的连接，需要手动保持
	let fiber = wip.child;
	if (fiber !== null) {
		fiber.return = wip;
	}

	while (fiber !== null) {
		let nextFiber = null;
		const deps = fiber.dependencies;
		if (deps !== null) {
			//deps不为空代表fiber为函数组件且依赖了某些context
			nextFiber = fiber.child;

			let contextItem = deps.firstContext;
			while (contextItem !== null) {
				if (contextItem.context === context) {
					// 找到了依赖这个变化的context的函数组件
					fiber.lanes = mergeLanes(fiber.lanes, renderLane);
					const alternate = fiber.alternate;
					if (alternate !== null) {
						alternate.lanes = mergeLanes(alternate.lanes, renderLane);
					}
					// 开始往上沿途编辑fiber.childLanes
					scheduleContextWorkOnParentPath(fiber.return, wip, renderLane);
					deps.lanes = mergeLanes(deps.lanes, renderLane);
					break;
				}
				// 开始遍历下一个context
				contextItem = contextItem.next;
			}
		} else if (fiber.tag === ContextProvider) {
			// 代表又遇到一个Provider，需判断是不是同一个context的Provider
			// 如果是同一个context的Provider，则无需往下再遍历。因为beginWork遍历遇到这个Provider时，会开启属于这个Provider的向下深度优先遍历
			// 如果不是同一个context的Provider，则返回Provider fiber的子fiber，从子fiber开始继续遍历

			nextFiber = fiber.type === wip.type ? null : fiber.child;
		} else {
			nextFiber = fiber.child;
		}

		if (nextFiber !== null) {
			// 保持连接
			nextFiber.return = fiber;
		} else {
			// 到了叶子结点
			nextFiber = fiber;
			while (nextFiber !== null) {
				if (nextFiber === wip) {
					nextFiber = null;
					break;
				}
				const sibling = nextFiber.sibling;
				if (sibling !== null) {
					sibling.return = nextFiber.return;
					nextFiber = sibling;
					break;
				}
				nextFiber = nextFiber.return;
			}
		}
		fiber = nextFiber;
	}
}

/**
 * 在父级路径上调度context 工作
 * @param from 开始fiber
 * @param to 目标fiber
 * @param renderLane
 */
function scheduleContextWorkOnParentPath(
	from: FiberNode | null,
	to: FiberNode,
	renderLane: Lane
) {
	let node = from;
	while (node !== null) {
		const alternate = node.alternate;

		if (!isSubsetOfLanes(node.childLanes, renderLane)) {
			node.childLanes = mergeLanes(node.childLanes, renderLane);
			if (alternate !== null) {
				alternate.childLanes = mergeLanes(alternate.childLanes, renderLane);
			}
		} else if (
			alternate !== null &&
			!isSubsetOfLanes(alternate.childLanes, renderLane)
		) {
			alternate.childLanes = mergeLanes(alternate.childLanes, renderLane);
		}

		if (node === to) {
			break;
		}
		node = node.return;
	}
}
