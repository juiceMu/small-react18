import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import { Props, ReactElementType } from 'shared/ReactTypes';
import {
	createFiberFromElement,
	createWorkInProgress,
	FiberNode
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { HostText } from './workTags';

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
			returnFiber.flags |= ChildDeletion;
		} else {
			deletions.push(childToDelete);
		}
	}

	/**
	 * 根据element/虚拟dom创建Fiber
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
		// 1.比较是否可以复用current fiber：
		//    a.比较key，如果key不同，不能复用
		//    b.比较type，如果type不同，不能复用
		//    c.如果key与type都相同，则可复用
		// 2.不能复用，则创建新的（同mount流程），可以复用则复用旧的
		const key = element.key;
		work: if (currentFiber !== null) {
			// 证明为更新阶段
			if (currentFiber.key === key) {
				// key相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (currentFiber.type === element.type) {
						// type相同，则可以复用fiber
						const existing = useFiber(currentFiber, element.props);
						existing.return = returnFiber;
						// 返回复用的Fiber，无需重现创建新Fiber
						return existing;
					}
					// 无法复用，则删除旧Fiber，创建新fiber
					deleteChild(returnFiber, currentFiber);
					break work;
				} else {
					if (__DEV__) {
						console.warn('还未实现的react类型', element);
						break work;
					}
				}
			} else {
				// 无法复用，则删除旧Fiber，创建新fiber
				deleteChild(returnFiber, currentFiber);
			}
		}
		const fiber = createFiberFromElement(element);
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
		content: string | null
	) {
		if (currentFiber !== null) {
			// 证明在update阶段
			if (currentFiber.tag === HostText) {
				// 类型没变，可以复用
				const existing = useFiber(currentFiber, { content });
				existing.return = returnFiber;
				return existing;
			}
			deleteChild(returnFiber, currentFiber);
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
	 * 对子Fiber进行调和对比创建/更新
	 * @param returnFiber 父Fiber
	 * @param currentFiber 当前Fiber（当前UI视图对应的Fiber）
	 * @param newChild 当前的子element/虚拟dom
	 * @returns 返回新的子Fiber或null
	 */
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: ReactElementType
	) {
		// 判断当前fiber的类型
		if (typeof newChild === 'object' && newChild !== null) {
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
		// TODO 多节点的情况 ul> li*3

		// HostText
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}

		if (currentFiber !== null) {
			// 兜底删除
			deleteChild(returnFiber, currentFiber);
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

// 更新时使用
export const reconcileChildFibers = ChildReconciler(true);
// 初次挂载时使用
export const mountChildFibers = ChildReconciler(false);
