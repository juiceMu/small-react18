import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import {
	createFiberFromElement,
	createFiberFromFragment,
	createWorkInProgress,
	FiberNode
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Fragment, HostText } from './workTags';

// 用于保存当前已存在的所有子FiberMap
type ExistingChildren = Map<string | number, FiberNode>;

/**
 * 创建进行子Fiber对比调和的函数
 * @param {boolean} shouldTrackEffects 是否需要跟踪副作用
 * @returns {function} reconcileChildFibers 用于处理子Fiber的函数
 */
function ChildReconciler(shouldTrackEffects: boolean) {
	/**
	 * 删除子fiber
	 * @param returnFiber 父级Fiber
	 * @param childToDelete 要删除的Fiber
	 * @returns
	 */
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		if (!shouldTrackEffects) {
			return;
		}
		// 要被删除的子Fiber集合
		const deletions = returnFiber.deletions;
		if (deletions === null) {
			returnFiber.deletions = [childToDelete];
			// 添加删除标记
			returnFiber.flags |= ChildDeletion;
		} else {
			deletions.push(childToDelete);
		}
	}

	/**
	 * 删除剩余所有子Fiber
	 * @param returnFiber 父级Fiber
	 * @param currentFirstChild 要删除的第一个子Fiber
	 */
	function deleteRemainingChildren(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null
	) {
		if (!shouldTrackEffects) {
			return;
		}
		let childToDelete = currentFirstChild;
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete);
			childToDelete = childToDelete.sibling;
		}
	}

	/**
	 * 单个fiber diff对比，根据element/虚拟dom创建Fiber
	 * @param returnFiber 父级Fiber
	 * @param currentFiber 当前Fiber（当前UI视图对应的Fiber）
	 * @param element element/虚拟dom
	 * @returns 返回新创建的Fiber
	 */
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		// 单节点diff对比需要支持的操作：插入Placement 删除ChildDeletion

		// 对比原则：
		// 1.比较是否可以复用current fiber：
		//    a.比较key，如果key不同，不能复用
		//    b.比较type，如果type不同，不能复用
		//    c.如果key与type都相同，则可复用
		// 2.不能复用，则创建新的（同mount流程），可以复用则复用旧的
		const key = element.key;
		while (currentFiber !== null) {
			// 证明为更新阶段
			if (currentFiber.key === key) {
				// key相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (currentFiber.type === element.type) {
						let props = element.props;
						if (element.type === REACT_FRAGMENT_TYPE) {
							// 考虑为Fragment情况
							props = element.props.children;
						}
						// type相同，则可以复用fiber，无需重现创建新Fiber
						const existing = useFiber(currentFiber, props);
						existing.return = returnFiber;
						// 当前节点可复用，标记剩下的节点删除
						deleteRemainingChildren(returnFiber, currentFiber.sibling);
						// 返回复用的Fiber
						return existing;
					}
					// key相同，type不同无法复用，则删除所有旧Fiber，创建新fiber
					deleteRemainingChildren(returnFiber, currentFiber);
					break;
				} else {
					if (__DEV__) {
						console.warn('还未实现的react类型', element);
						break;
					}
				}
			} else {
				//  key不同无法复用，则删除旧Fiber，创建新fiber
				deleteChild(returnFiber, currentFiber);
				// 如果有兄弟fiber 则继续上述对比过程
				currentFiber = currentFiber.sibling;
			}
		}
		let fiber;
		if (element.type === REACT_FRAGMENT_TYPE) {
			// 考虑为Fragment情况
			fiber = createFiberFromFragment(element.props.children, key);
		} else {
			fiber = createFiberFromElement(element);
		}
		fiber.return = returnFiber;
		return fiber;
	}

	/**
	 * 根据文本节点创建Fiber
	 * @param returnFiber 父级Fiber
	 * @param currentFiber 当前Fiber（当前UI视图对应的Fiber）
	 * @param content 文本内容
	 * @returns  返回新创建的Fiber
	 */
	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number | null
	) {
		while (currentFiber !== null) {
			// 证明在update阶段
			if (currentFiber.tag === HostText) {
				// 类型没变，可以复用
				const existing = useFiber(currentFiber, { content });
				existing.return = returnFiber;
				// 已找到可复用fiber，删除剩余fiber
				deleteRemainingChildren(returnFiber, currentFiber.sibling);
				return existing;
			}
			// 不可复用，删除该节点
			deleteChild(returnFiber, currentFiber);
			// 如果有兄弟fiber 则继续上述对比过程
			currentFiber = currentFiber.sibling;
		}
		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}

	/**
	 * 对Fiber标记副作用
	 * @param fiber
	 * @returns
	 */
	function placeSingleChild(fiber: FiberNode) {
		if (shouldTrackEffects && fiber.alternate === null) {
			// 追踪副作用&&首屏渲染时
			// 标记副作用
			fiber.flags |= Placement;
		}
		return fiber;
	}

	/**
	 * 多节点diff对比，根据element/虚拟dom数组集合创建子Fiber链表集合
	 * @param returnFiber 父级Fiber
	 * @param currentFirstChild 子fiber中的第一个
	 * @param newChild element/虚拟dom
	 * @returns 返回新子Fiber中的第一个子Fiber
	 */
	function reconcileChildrenArray(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null,
		newChild: any[]
	) {
		// 多节点diff对比需要支持的操作：插入Placement 删除ChildDeletion 移动Placement

		// 最后一个可复用的fiber在current中的index
		let lastPlacedIndex = 0;
		// 创建的最后一个fiber
		let lastNewFiber: FiberNode | null = null;
		// 创建的第一个fiber
		let firstNewFiber: FiberNode | null = null;

		// 用于保存所有旧的子Fiber（即current的子fiber）
		const existingChildren: ExistingChildren = new Map();
		let current = currentFirstChild;
		while (current !== null) {
			// 如果存在key，则用key，否则用index作为key
			const keyToUse = current.key !== null ? current.key : current.index;
			// 将旧的所有子fiber（即current中的所有子fiber）遍历后保存在Map中，用于后续和新Fiber做对比，判断是否可复用
			existingChildren.set(keyToUse, current);
			current = current.sibling;
		}

		// 遍历新的子element集合(newChild)，寻找是否有可复用fiber
		for (let i = 0; i < newChild.length; i++) {
			const after = newChild[i];
			// 新子节点
			const newFiber = updateFromMap(returnFiber, existingChildren, i, after);
			if (newFiber === null) {
				continue;
			}

			// 给fiber标记index值
			newFiber.index = i;
			newFiber.return = returnFiber;
			if (lastNewFiber === null) {
				lastNewFiber = newFiber;
				firstNewFiber = newFiber;
			} else {
				lastNewFiber.sibling = newFiber;
				lastNewFiber = lastNewFiber.sibling;
			}
			if (!shouldTrackEffects) {
				continue;
			}
			const current = newFiber.alternate;

			// 判断是需要插入还是移动
			if (current !== null) {
				// 存在可复用的fiber，需判断可直接复用，还是需要移动

				// 移动是指向右移动
				// 移动的判断依据：element的index与「element对应current fiber」的index的比较
				// 当遍历element时，「当前遍历到的element」一定是「所有已遍历的element」中最靠右那个。
				// 所以只需要记录「最后一个可复用fiber」在current中的index（lastPlacedIndex），在接下来的遍历中：
				// 如果接下来遍历到的「可复用fiber」的index < lastPlacedIndex，则标记Placement。否则，不标记
				// A1 B2 C3 -> B2 C3 A1
				// 0__1__2______0__1__2
				const oldIndex = current.index;
				if (oldIndex < lastPlacedIndex) {
					// 需要移动，添加移动标记
					newFiber.flags |= Placement;
					continue;
				} else {
					// 不需要移动
					lastPlacedIndex = oldIndex;
				}
			} else {
				// mount
				newFiber.flags |= Placement;
			}
		}
		// 4. Map中剩下的子Fiber代表均无法复用，将剩余所有均标记为删除
		existingChildren.forEach((fiber) => {
			deleteChild(returnFiber, fiber);
		});
		// 返回新的子Fiber中的第一个fiber
		return firstNewFiber;
	}

	function getElementKeyToUse(element: any, index?: number): Key {
		if (
			Array.isArray(element) ||
			typeof element === 'string' ||
			typeof element === 'number' ||
			element === undefined ||
			element === null
		) {
			// 考虑fragment array的情况
			return index;
		}
		// 如果存在key，则用key，否则用index作为key
		return element.key !== null ? element.key : index;
	}

	/**
	 * 从存储的current 子Fiber集合中查找是否有对应可以复用的fiber
	 * @param returnFiber 父级fiber
	 * @param existingChildren current 子Fiber集合
	 * @param index element在同级中对应的index
	 * @param element element元素
	 * @returns Fiber
	 */
	function updateFromMap(
		returnFiber: FiberNode,
		existingChildren: ExistingChildren,
		index: number,
		element: any
	): FiberNode | null {
		const keyToUse = getElementKeyToUse(element, index);
		// 从current的子fiber集合中寻找是否有相同key的fiber
		const before = existingChildren.get(keyToUse);
		// HostText
		if (typeof element === 'string' || typeof element === 'number') {
			if (before) {
				if (before.tag === HostText) {
					// 可复用，则从Map中删除该fiber
					existingChildren.delete(keyToUse);
					return useFiber(before, { content: element + '' });
				}
			}
			// 无法复用，创建新fiber
			return new FiberNode(HostText, { content: element + '' }, null);
		}
		// ReactElement
		if (typeof element === 'object' && element !== null) {
			switch (element.$$typeof) {
				case REACT_ELEMENT_TYPE:
					if (element.type === REACT_FRAGMENT_TYPE) {
						return updateFragment(
							returnFiber,
							before,
							element,
							keyToUse,
							existingChildren
						);
					}
					if (before) {
						if (before.type === element.type) {
							// key和type都相同，可以复用fiber，从Map中删除该fiber
							existingChildren.delete(keyToUse);
							return useFiber(before, element.props);
						}
					}
					// 无法复用，创建新fiber
					return createFiberFromElement(element);
			}
		}

		if (Array.isArray(element)) {
			// 数组形式的Fragment,比如
			// arr = [<li>c</li>, <li>d</li>]
			// <ul>
			// <li>a</li>
			// <li>b</li>
			// {arr}
			// </ul>
			// 转化结果为：
			// jsx('ul', {
			// 	children: [
			// 		jsx('li', {
			// 			children: 'a'
			// 		}),
			// 		jsx('li', {
			// 			children: 'b'
			// 		}),
			// 		arr
			// 	]
			// });
			return updateFragment(
				returnFiber,
				before,
				element,
				keyToUse,
				existingChildren
			);
		}
		return null;
	}

	/**
	 * 对子Fiber进行调和对比创建/更新
	 * @param returnFiber 父Fiber
	 * @param currentFiber 当前Fiber（当前UI视图对应的Fiber）
	 * @param newChild 当前的子element/虚拟dom
	 * @returns 返回新的子Fiber或null
	 */
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: any
	) {
		// 判断Fragment
		const isUnkeyedTopLevelFragment =
			typeof newChild === 'object' &&
			newChild !== null &&
			newChild.type === REACT_FRAGMENT_TYPE &&
			newChild.key === null;
		if (isUnkeyedTopLevelFragment) {
			newChild = newChild.props.children;
		}
		// 判断当前fiber的类型
		if (typeof newChild === 'object' && newChild !== null) {
			//单节点/多节点是指【更新后是单节点/多节点】，以更新后的为准

			// 多节点diff对比 ul> li*3
			if (Array.isArray(newChild)) {
				return reconcileChildrenArray(returnFiber, currentFiber, newChild);
			}

			// 单节点diff对比
			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcileSingleElement(returnFiber, currentFiber, newChild)
					);
				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型', newChild);
					}
					break;
			}
		}

		// HostText
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}

		if (currentFiber !== null) {
			// 兜底删除
			deleteRemainingChildren(returnFiber, currentFiber);
		}

		if (__DEV__) {
			console.warn('未实现的reconcile类型', newChild);
		}
		return null;
	};
}

/**
 * 复用Fiber
 * @param fiber
 * @param pendingProps
 * @returns Fiber
 */
function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
	const clone = createWorkInProgress(fiber, pendingProps);
	clone.index = 0;
	clone.sibling = null;
	return clone;
}

/**
 * 更新基于Fragment创建的fiber
 * @param returnFiber
 * @param current
 * @param elements
 * @param key
 * @param existingChildren
 * @returns
 */
function updateFragment(
	returnFiber: FiberNode,
	current: FiberNode | undefined,
	elements: any[],
	key: Key,
	existingChildren: ExistingChildren
) {
	let fiber;
	if (!current || current.tag !== Fragment) {
		// 需要创建新的fragment
		fiber = createFiberFromFragment(elements, key);
	} else {
		// 前后都是fragment，可复用
		existingChildren.delete(key);
		fiber = useFiber(current, elements);
	}
	fiber.return = returnFiber;
	return fiber;
}

// 更新时使用
export const reconcileChildFibers = ChildReconciler(true);
// 初次挂载时使用
export const mountChildFibers = ChildReconciler(false);

/**
 * 克隆子fibe
 * @param wip
 * @returns
 */
export function cloneChildFibers(wip: FiberNode) {
	// child  sibling
	if (wip.child === null) {
		return;
	}
	let currentChild = wip.child;
	let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
	wip.child = newChild;
	newChild.return = wip;

	while (currentChild.sibling !== null) {
		currentChild = currentChild.sibling;
		newChild = newChild.sibling = createWorkInProgress(
			newChild,
			newChild.pendingProps
		);
		newChild.return = wip;
	}
}
