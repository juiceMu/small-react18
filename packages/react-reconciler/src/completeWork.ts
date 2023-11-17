import {
	appendInitialChild,
	Container,
	createInstance,
	createTextInstance,
	Instance
} from 'hostConfig';
import { FiberNode } from './fiber';
import { NoFlags, Ref, Update } from './fiberFlags';
import {
	HostRoot,
	HostText,
	HostComponent,
	FunctionComponent,
	Fragment
} from './workTags';

/**
 * 对fiber增加Ref标记
 * @param fiber
 */
function markRef(fiber: FiberNode) {
	fiber.flags |= Ref;
}

/**
 * 对fiber增加update标记
 * @param fiber
 */
function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update;
}

// 递归中的归阶段
export const completeWork = (wip: FiberNode) => {
	// 对于Host类型的Fiber：构建离屏DOM树

	const newProps = wip.pendingProps;
	// current：与视图中真实UI对应的fiberNode
	const current = wip.alternate;
	switch (wip.tag) {
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// update
				// 1. props是否变化 {onClick: xx} {onClick: xxx}
				// 2. 变了 Update flag
				// className style
				markUpdate(wip);
				// 标记Ref
				if (current.ref !== wip.ref) {
					markRef(wip);
				}
			} else {
				// 构建DOM
				const instance = createInstance(wip.type, newProps);
				// 将DOM插入DOM树中
				appendAllChildren(instance, wip);
				wip.stateNode = instance;
				// 标记Ref
				if (wip.ref !== null) {
					markRef(wip);
				}
			}
			bubbleProperties(wip);
			return null;
		case HostText:
			if (current !== null && wip.stateNode) {
				// update
				const oldText = current.memoizedProps?.content;
				const newText = newProps.content;
				if (oldText !== newText) {
					// 前后文本内容不同，需要进行更新，打上更新标记
					markUpdate(wip);
				}
			} else {
				// 1. 构建DOM
				const instance = createTextInstance(newProps.content);
				wip.stateNode = instance;
			}
			bubbleProperties(wip);
			return null;
		case HostRoot:
		case FunctionComponent:
		case Fragment:
			bubbleProperties(wip);
			return null;
		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况', wip);
			}
			break;
	}
};

function appendAllChildren(parent: Container | Instance, wip: FiberNode) {
	let node = wip.child;
	while (node !== null) {
		if (node.tag === HostComponent || node.tag === HostText) {
			appendInitialChild(parent, node?.stateNode);
		} else if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}
		if (node === wip) {
			return;
		}
		while (node.sibling === null) {
			if (node.return === null || node.return === wip) {
				return;
			}
			node = node?.return;
		}
		node.sibling.return = node.return;
		node = node.sibling;
	}
}

/**
 * 冒泡属性
 * @param wip
 */
function bubbleProperties(wip: FiberNode) {
	let subtreeFlags = NoFlags;
	let child = wip.child;
	while (child !== null) {
		subtreeFlags |= child.subtreeFlags;
		subtreeFlags |= child.flags;
		child.return = wip;
		child = child.sibling;
	}
	wip.subtreeFlags |= subtreeFlags;
}
