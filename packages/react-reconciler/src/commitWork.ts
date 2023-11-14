import {
	appendChildToContainer,
	commitUpdate,
	Container,
	insertChildToContainer,
	Instance,
	removeChild
} from 'hostConfig';
import { FiberNode, FiberRootNode } from './fiber';
import {
	ChildDeletion,
	MutationMask,
	NoFlags,
	Placement,
	Update
} from './fiberFlags';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';

// 指向下一个需要执行的effect
let nextEffect: FiberNode | null = null;

export const commitMutationEffects = (finishedWork: FiberNode) => {
	nextEffect = finishedWork;
	while (nextEffect !== null) {
		// 向下遍历
		const child: FiberNode | null = nextEffect.child;
		if (
			(nextEffect.subtreeFlags & MutationMask) !== NoFlags &&
			child !== null
		) {
			// 存在mutation阶段需要执行的工作，并且有子级
			// 则需要继续向子级遍历
			nextEffect = child;
		} else {
			// 向上遍历
			up: while (nextEffect !== null) {
				commitMutationEffectsOnFiber(nextEffect);
				const sibling: FiberNode | null = nextEffect.sibling;
				if (sibling !== null) {
					nextEffect = sibling;
					break up;
				}
				nextEffect = nextEffect.return;
			}
		}
	}
};

/**
 * 执行Fiber上标记的操作
 * @param finishedWork
 */
const commitMutationEffectsOnFiber = (finishedWork: FiberNode) => {
	const flags = finishedWork.flags;
	if ((flags & Placement) !== NoFlags) {
		// 存在Placement操作
		commitPlacement(finishedWork);
		// 去掉Placement标记
		finishedWork.flags &= ~Placement;
	}

	if ((flags & Update) !== NoFlags) {
		// 存在Update更新操作
		commitUpdate(finishedWork);
		// 去掉Update更新标记
		finishedWork.flags &= ~Update;
	}

	if ((flags & ChildDeletion) !== NoFlags) {
		// 存在ChildDeletion删除子级操作
		// 获取要被删除的子Fiber合集
		const deletions = finishedWork.deletions;
		if (deletions !== null) {
			deletions.forEach((childToDelete) => {
				commitDeletion(childToDelete);
			});
		}
		// 去掉ChildDeletion删除子级标记
		finishedWork.flags &= ~ChildDeletion;
	}
};

// 执行删除操作
function commitDeletion(childToDelete: FiberNode) {
	let rootHostNode: FiberNode | null = null;
	// 递归子树
	// 对于FC，需要处理useEffect unmout执行、解绑ref
	// 对于HostComponent，需要解绑ref
	// 对于子树的根HostComponent，需要移除DOM
	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				if (rootHostNode === null) {
					rootHostNode = unmountFiber;
				}
				// TODO 解绑ref
				return;
			case HostText:
				if (rootHostNode === null) {
					rootHostNode = unmountFiber;
				}
				return;
			case FunctionComponent:
				// TODO useEffect unmount 、解绑ref
				return;
			default:
				if (__DEV__) {
					console.warn('未处理的unmount类型', unmountFiber);
				}
		}
	});

	// 移除rootHostComponent的DOM
	if (rootHostNode !== null) {
		const hostParent = getHostParent(childToDelete);
		if (hostParent !== null) {
			removeChild((rootHostNode as FiberNode).stateNode, hostParent);
		}
	}
	childToDelete.return = null;
	childToDelete.child = null;
}

/**
 * 进行递归嵌套树级fiber结构操作
 * @param root fiber 递归开始的起点
 * @param onCommitUnmount 针对每个fiber要执行的函数
 */
function commitNestedComponent(
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) {
	let node = root;
	while (true) {
		onCommitUnmount(node);
		if (node.child !== null) {
			// 向下遍历
			node.child.return = node;
			node = node.child;
			continue;
		}

		if (node === root) {
			// 循环终止条件
			return;
		}

		while (node.sibling === null) {
			if (node.return === null || node.return === root) {
				return;
			}
			// 向上递归
			node = node.return;
		}

		node.sibling.return = node.return;
		node = node.sibling;
	}
}

// 执行插入操作
const commitPlacement = (finishedWork: FiberNode) => {
	if (__DEV__) {
		console.warn('执行Placement操作', finishedWork);
	}
	// 获取父级DOM
	const hostParent = getHostParent(finishedWork);
	// 获取兄弟DOM
	const sibling = getHostSibling(finishedWork);
	if (hostParent !== null) {
		insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
	}
};

/**
 * 获取兄弟DOM
 * @param fiber
 * @returns 真实dom元素
 */
function getHostSibling(fiber: FiberNode) {
	// 查找兄弟DOM节点，需要考虑两点：
	// 1. 可能并不是目标fiber的直接兄弟节点
	//    比如兄弟fiber为函数组件的fiber，则实际需要找到的目标兄弟DOM节点为兄弟fiber的子Fiber对应的stateNode
	// 2. 不稳定的DOM节点(即节点自身也存在着移动操作)不能作为「目标兄弟Host节点」
	let node: FiberNode = fiber;
	findSibling: while (true) {
		while (node.sibling === null) {
			// 没有找到符合条件的兄弟fiber，则向上查找，对父级fiber和父级fiber的兄弟fiber里进行查找
			// <App/><div/>
			// function App() {
			//   return <A/>;
			// }
			// 针对A来说，目标兄弟节点则为父级Fiber(APP)的兄弟节点div
			const parent = node.return;
			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				return null;
			}
			node = parent;
		}
		node.sibling.return = node.return;
		node = node.sibling;
		while (node.tag !== HostText && node.tag !== HostComponent) {
			// 存在兄弟fiber，则需要考虑如果兄弟fiber中可能不是直接的兄弟节点
			// <A/><B/>
			// function B() {
			//   return <div/>;
			// }
			// 针对A来说，目标兄弟节点则是兄弟Fiber(B)的子节点div

			// 向下遍历
			if ((node.flags & Placement) !== NoFlags) {
				// 该fiber存在移动操作，不予考虑，直接对下一个fiber进行对比
				continue findSibling;
			}
			if (node.child === null) {
				continue findSibling;
			} else {
				node.child.return = node;
				node = node.child;
			}
		}

		if ((node.flags & Placement) === NoFlags) {
			return node.stateNode;
		}
	}
}

/**
 * 获取父级DOM
 * @param fiber
 * @returns 真实dom元素
 */
function getHostParent(fiber: FiberNode): Container | null {
	let parent = fiber.return;
	while (parent) {
		const parentTag = parent.tag;
		if (parentTag === HostComponent) {
			return parent.stateNode as Container;
		}
		if (parentTag === HostRoot) {
			return (parent.stateNode as FiberRootNode).container;
		}
		parent = parent.return;
	}
	if (__DEV__) {
		console.warn('未找到host parent');
	}
	return null;
}

/**
 * 将DOM元素插入到父级元素中/插入兄弟节点前
 * @param finishedWork
 * @param hostParent 父级DOM
 * @param before 兄弟DOM
 * @returns
 */
function insertOrAppendPlacementNodeIntoContainer(
	finishedWork: FiberNode,
	hostParent: Container,
	before?: Instance
) {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		if (before) {
			// 有兄弟节点，代表需要插入到兄弟节点前
			insertChildToContainer(finishedWork.stateNode, hostParent, before);
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode);
		}
		return;
	}
	const child = finishedWork.child;
	if (child !== null) {
		insertOrAppendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sibling;

		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sibling;
		}
	}
}
