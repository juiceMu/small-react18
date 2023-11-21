export type WorkTag =
	| typeof FunctionComponent
	| typeof HostRoot
	| typeof HostComponent
	| typeof HostText
	| typeof Fragment
	| typeof ContextProvider
	| typeof SuspenseComponent
	| typeof OffscreenComponent
	| typeof MemoComponent;

export const FunctionComponent = 0; // 表示函数式组件，这是 React 中最基础的组件类型，通过函数返回 UI 结构
export const ClassComponent = 1; // 表示类组件，这是 React 的另一种主要组件类型，通过 class 定义，可以使用生命周期方法等更复杂的特性
export const IndeterminateComponent = 2; // 表示尚未确定类型的组件，在 React 渲染过程中，如果遇到了这种类型，会先尝试将其当做函数式组件处理
export const HostRoot = 3; // 表示宿主环境的根节点,对应的是RootFiber，例如在浏览器环境中，这个就代表了整个 React App 的根节点
export const HostComponent = 5; // 表示宿主环境的常规节点，例如在浏览器环境中，这就代表了一个普通的 DOM 元素，如 div、span 等
export const HostText = 6;
export const Fragment = 7;
export const ContextProvider = 8;
export const SuspenseComponent = 13;
export const OffscreenComponent = 14;
export const MemoComponent = 15;
