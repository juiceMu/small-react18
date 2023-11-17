import {
	appendChildToContainer,
	commitUpdate,
	Container,
	insertChildToContainer,
	Instance,
	removeChild
} from 'hostConfig';
import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
	ChildDeletion,
	Flags,
	LayoutMask,
	MutationMask,
	NoFlags,
	PassiveEffect,
	PassiveMask,
	Placement,
	Update,
	Ref
} from './fiberFlags';
import { Effect, FCUpdateQueue } from './fiberHooks';
import { HookHasEffect } from './hookEffectTags';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';

// 指向下一个需要执行的effect
let nextEffect: FiberNode | null = null;
/**

 * @param finishedWork
 * @param root FiberRoot
 */
/**
 * 深度优先遍历触发变化的effect
 * @param phrase 处于哪种阶段 mutation/layout
 * @param mask 操作标记
 * @param callback 对单个fiber要执行的回调
 * @returns
 */
export const commitEffects = (
	phrase: 'mutation' | 'layout',
	mask: Flags,
	callback: (fiber: FiberNode, root: FiberRootNode) => void
) => {
	return (finishedWork: FiberNode, root: FiberRootNode) => {
		nextEffect = finishedWork;
		while (nextEffect !== null) {
			// 向下遍历
			const child: FiberNode | null = nextEffect.child;

			if ((nextEffect.subtreeFlags & mask) !== NoFlags && child !== null) {
				nextEffect = child;
			} else {
				// 向上遍历 DFS
				up: while (nextEffect !== null) {
					callback(nextEffect, root);
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
};

/**
 * mutation阶段执行Fiber上标记的操作
 * @param finishedWork
 * @param root FiberRoot
 */
const commitMutationEffectsOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const { flags, tag } = finishedWork;
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
				commitDeletion(childToDelete, root);
			});
		}
		// 去掉ChildDeletion删除子级标记
		finishedWork.flags &= ~ChildDeletion;
	}

	if ((flags & PassiveEffect) !== NoFlags) {
		// 存在useEffect
		// 收集effect回调
		commitPassiveEffect(finishedWork, root, 'update');
		// 去掉已触发effect回调的标识
		finishedWork.flags &= ~PassiveEffect;
	}

	if ((flags & Ref) !== NoFlags && tag === HostComponent) {
		// 存在ref操作，解绑ref
		safelyDetachRef(finishedWork);
	}
};

/**
 * 解绑ref
 * @param current
 */
function safelyDetachRef(current: FiberNode) {
	const ref = current.ref;
	if (ref !== null) {
		if (typeof ref === 'function') {
			ref(null);
		} else {
			ref.current = null;
		}
	}
}

/**
 * 绑定ref
 * @param fiber
 */
function safelyAttachRef(fiber: FiberNode) {
	const ref = fiber.ref;
	if (ref !== null) {
		const instance = fiber.stateNode;
		if (typeof ref === 'function') {
			ref(instance);
		} else {
			ref.current = instance;
		}
	}
}

/**
 * layout阶段 执行effect
 * @param finishedWork
 * @param root
 */
const commitLayoutEffectsOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const { flags, tag } = finishedWork;

	if ((flags & Ref) !== NoFlags && tag === HostComponent) {
		// 绑定新的ref
		safelyAttachRef(finishedWork);
		finishedWork.flags &= ~Ref;
	}
};

/**
 * mutation阶段深度优先遍历触发变化的effect
 * @param finishedWork
 * @param root FiberRoot
 */
export const commitMutationEffects = commitEffects(
	'mutation',
	MutationMask | PassiveMask,
	commitMutationEffectsOnFiber
);

export const commitLayoutEffects = commitEffects(
	'layout',
	LayoutMask,
	commitLayoutEffectsOnFiber
);

/**
 * 存储需要触发的effect hook回调的更新对象
 * @param fiber 存在触发的effect 回调的fiber
 * @param root FiberRoot
 * @param type 触发的时机类型 update/unmount
 */
function commitPassiveEffect(
	fiber: FiberNode,
	root: FiberRootNode,
	type: keyof PendingPassiveEffects
) {
	// update mount
	if (
		fiber.tag !== FunctionComponent ||
		(type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
	) {
		// 如果不是函数组件 || 不存在useEffect
		return;
	}
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue !== null) {
		if (updateQueue.lastEffect === null && __DEV__) {
			console.error('当FC存在PassiveEffect flag时，不应该不存在effect');
		}
		// 将需要更新的effect hook链表的最末端放入根节点的pendingPassiveEffects对应数组中
		// 只需要存effect hook链表的最末端，使用时沿着最末端获取第一个开始遍历链表即可
		root.pendingPassiveEffects[type].push(updateQueue.lastEffect as Effect);
	}
}

/**
 * 执行需要触发的effect hook的回调列表
 * @param flags effect hook类型标记（比如useEffect）
 * @param lastEffect effect hook链表的最末端节点
 * @param callback 对effect对象执行的函数
 */
function commitHookEffectList(
	flags: Flags,
	lastEffect: Effect,
	callback: (effect: Effect) => void
) {
	let effect = lastEffect.next as Effect;
	do {
		// effect是否为本次需要执行的effect hook类型
		if ((effect.tag & flags) === flags) {
			callback(effect);
		}
		effect = effect.next as Effect;
	} while (effect !== lastEffect.next);
}

/**
 * 执行需要被触发的effect的卸载回调数组(即函数组件被卸载)
 * @param flags effect hook类型标记（比如useEffect）
 * @param lastEffect effect hook链表的最末端节点
 */
export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
		// 因为destroy被触发代表该函数组件已被注销，也不会再触发该组件的任何effect hook了
		// 所以fiber上需要除去HookHasEffect标识
		effect.tag &= ~HookHasEffect;
	});
}

/**
 * 执行需要被触发的effect依赖变化时的destroy回调数组(即依赖项变化先执行上一次的destroy，再执行create)
 * @param flags effect hook类型标记（比如useEffect）
 * @param lastEffect effect hook链表的最末端节点
 */
export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
	});
}

/**
 * 执行需要被触发的effect依赖变化时的create回调数组
 * @param flags effect hook类型标记（比如useEffect）
 * @param lastEffect effect hook链表的最末端节点
 */
export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const create = effect.create;
		if (typeof create === 'function') {
			// 将create函数的返回值作为destroy函数
			effect.destroy = create();
		}
	});
}

/**
 * 记录要被删除的子Fiber
 * @param childrenToDelete
 * @param unmountFiber
 */
function recordHostChildrenToDelete(
	childrenToDelete: FiberNode[],
	unmountFiber: FiberNode
) {
	// 1. 找到第一个root host节点（数组中的最后一个节点）
	const lastOne = childrenToDelete[childrenToDelete.length - 1];

	// 2. 每找到一个 host节点，判断下这个节点是不是 1 找到那个节点的兄弟节点
	if (!lastOne) {
		// 证明这是找到的第一个节点
		childrenToDelete.push(unmountFiber);
	} else {
		let node = lastOne.sibling;
		while (node !== null) {
			if (unmountFiber === node) {
				childrenToDelete.push(unmountFiber);
			}
			node = node.sibling;
		}
	}
}

/**
 * 执行删除操作
 * @param childToDelete 要被删除的子fiber
 * @param root FiberRoot
 */
function commitDeletion(childToDelete: FiberNode, root: FiberRootNode) {
	const rootChildrenToDelete: FiberNode[] = [];
	// 递归子树
	// 对于FC，需要处理useEffect unmount执行、解绑ref
	// 对于HostComponent，需要解绑ref
	// 对于子树的根HostComponent，需要移除DOM
	commitNestedComponent(childToDelete, (unmountFiber) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				// TODO 解绑ref
				safelyDetachRef(unmountFiber);
				return;
			case HostText:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				return;
			case FunctionComponent:
				// TODO 解绑ref
				// 将fiber上需要在组件卸载时触发的effect hook进行存储
				commitPassiveEffect(unmountFiber, root, 'unmount');
				return;
			default:
				if (__DEV__) {
					console.warn('未处理的unmount类型', unmountFiber);
				}
		}
	});

	// 移除rootHostComponent的DOM
	if (rootChildrenToDelete.length) {
		const hostParent = getHostParent(childToDelete);
		if (hostParent !== null) {
			rootChildrenToDelete.forEach((node) => {
				removeChild(node.stateNode, hostParent);
			});
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
