import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import { ReactElementType } from 'shared/ReactTypes';
import { createFiberFromElement, FiberNode } from './fiber';
import { Placement } from './fiberFlags';
import { HostText } from './workTags';

/**
 * 创建进行子Fiber对比调和的函数
 * @param {boolean} shouldTrackEffects 是否需要跟踪副作用
 * @returns {function} reconcileChildFibers 用于处理子Fiber的函数
 */
function ChildReconciler(shouldTrackEffects: boolean) {
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

		if (__DEV__) {
			console.warn('未实现的reconcile类型', newChild);
		}
		return null;
	};
}
// 更新时使用
export const reconcileChildFibers = ChildReconciler(true);
// 初次挂载时使用
export const mountChildFibers = ChildReconciler(false);
