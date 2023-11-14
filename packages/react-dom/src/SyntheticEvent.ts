import { Container } from 'hostConfig';
import { Props } from 'shared/ReactTypes';

export const elementPropsKey = '__props';

// 支持的事件类型集合
const validEventTypeList = ['click'];

type EventCallback = (e: Event) => void;

// 合成事件
interface SyntheticEvent extends Event {
	__stopPropagation: boolean; // 是否停止冒泡
}

// 事件集合
interface Paths {
	capture: EventCallback[]; // 捕获
	bubble: EventCallback[]; // 冒泡
}

export interface DOMElement extends Element {
	[elementPropsKey]: Props;
}

/**
 * 将fiber上的props更新到DOM上
 * @param node
 * @param props
 */
export function updateFiberProps(node: DOMElement, props: Props) {
	node[elementPropsKey] = props;
}

/**
 * 初始化事件，在根容器上添加对应事件监听
 * @param container 根容器
 * @param eventType 事件名
 * @returns
 */
export function initEvent(container: Container, eventType: string) {
	if (!validEventTypeList.includes(eventType)) {
		console.warn('当前不支持', eventType, '事件');
		return;
	}
	if (__DEV__) {
		console.log('初始化事件：', eventType);
	}
	container.addEventListener(eventType, (e) => {
		dispatchEvent(container, eventType, e);
	});
}

/**
 * 创建合成事件
 * @param e
 * @returns
 */
function createSyntheticEvent(e: Event) {
	const syntheticEvent = e as SyntheticEvent;
	syntheticEvent.__stopPropagation = false;
	const originStopPropagation = e.stopPropagation;

	syntheticEvent.stopPropagation = () => {
		syntheticEvent.__stopPropagation = true;
		if (originStopPropagation) {
			originStopPropagation();
		}
	};
	return syntheticEvent;
}

/**
 * 派发事件
 * @param container 根容器
 * @param eventType 事件名
 * @param e event对象
 */
function dispatchEvent(container: Container, eventType: string, e: Event) {
	// 触发事件的源头DOM
	const targetElement = e.target;
	if (targetElement === null) {
		console.warn('事件不存在target', e);
		return;
	}
	// 收集自下而上所有层级的同样事件
	const { bubble, capture } = collectPaths(
		targetElement as DOMElement,
		container,
		eventType
	);
	// 构造合成事件
	const se = createSyntheticEvent(e);
	// 遍历captue
	triggerEventFlow(capture, se);
	if (!se.__stopPropagation) {
		// 4. 遍历bubble
		triggerEventFlow(bubble, se);
	}
}

/**
 * 触发事件集合
 * @param paths 事件集合
 * @param se 合成事件
 */
function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
	for (let i = 0; i < paths.length; i++) {
		const callback = paths[i];
		callback.call(null, se);

		if (se.__stopPropagation) {
			// 停止冒泡，则不继续执行
			break;
		}
	}
}

/**
 * 根据事件名获取对应绑定事件名集合
 * @param eventType
 * @returns
 */
function getEventCallbackNameFromEventType(
	eventType: string
): string[] | undefined {
	return {
		click: ['onClickCapture', 'onClick']
	}[eventType];
}

/**
 * 收集事件集合（沿嵌套层级DOM上的对应事件）
 * @param targetElement 触发事件的源DOM
 * @param container 根容器
 * @param eventType 事件名
 * @returns 事件集合
 */
function collectPaths(
	targetElement: DOMElement,
	container: Container,
	eventType: string
) {
	// 事件集合
	const paths: Paths = {
		capture: [],
		bubble: []
	};

	while (targetElement && targetElement !== container) {
		// 收集DOM上的所有props值
		const elementProps = targetElement[elementPropsKey];
		if (elementProps) {
			// click -> onClick onClickCapture
			const callbackNameList = getEventCallbackNameFromEventType(eventType);
			if (callbackNameList) {
				callbackNameList.forEach((callbackName, i) => {
					const eventCallback = elementProps[callbackName];
					if (eventCallback) {
						if (i === 0) {
							// capture
							paths.capture.unshift(eventCallback);
						} else {
							paths.bubble.push(eventCallback);
						}
					}
				});
			}
		}
		// 自下而上遍历层层父级
		targetElement = targetElement.parentNode as DOMElement;
	}
	return paths;
}
