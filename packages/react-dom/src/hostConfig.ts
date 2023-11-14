// 在tsconfig.json中作如下配置后，在其他文件使用Container不需要再单独进行import引入相对路径了
// 如果不懂，再看4-2课程
//   "paths": {
// 		"hostConfig":["./packages/react-reconciler/src/hostConfig.ts"]
//   }
// 这样的做的原因是，如果使用import形式，hostConfig就被限制在react-reconciler中了
// 但实际上对于不同的宿主环境，都要实现hostConfig，比如react-dom包中，就是react-dom目录中了
// 所以不能写死路径

import { FiberNode } from 'react-reconciler/src/fiber';
import { HostComponent, HostText } from 'react-reconciler/src/workTags';
import { Props } from 'shared/ReactTypes';
import { updateFiberProps, DOMElement } from './SyntheticEvent';

export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

export const createInstance = (type: string, props: Props): Instance => {
	const element = document.createElement(type) as unknown;
	updateFiberProps(element as DOMElement, props);
	return element as DOMElement;
};

export const appendInitialChild = (
	parent: Instance | Container,
	child: Instance
) => {
	parent.appendChild(child);
};

export const createTextInstance = (content: string) => {
	return document.createTextNode(content);
};

export const appendChildToContainer = appendInitialChild;

/**
 * commit阶段进行更新
 */
export function commitUpdate(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.memoizedProps?.content;
			return commitTextUpdate(fiber.stateNode, text);
		default:
			if (__DEV__) {
				console.warn('未实现的Update类型', fiber);
			}
			break;
	}
}

/**
 * commit阶段对文本节点进行内容更新
 * @param textInstance 文本节点实例
 * @param content 文本节点的文本内容
 */
export function commitTextUpdate(textInstance: TextInstance, content: string) {
	textInstance.textContent = content;
}

/**
 * 删除子节点DOM
 * @param child 要被删除的子节点DOM
 * @param container child的父节点
 */
export function removeChild(
	child: Instance | TextInstance,
	container: Container
) {
	container.removeChild(child);
}
