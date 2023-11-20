import { Action, ReactContext } from 'shared/ReactTypes';

export interface Dispatcher {
	useState: <T>(initialState: (() => T) | T) => [T, Dispatch<T>];
	useEffect: (callback: () => void | void, deps: any[] | void) => void;
	useTransition: () => [boolean, (callback: () => void) => void];
	useRef: <T>(initialValue: T) => { current: T };
	useContext: <T>(context: ReactContext<T>) => T;
	use: <T>(usable: Usable<T>) => T;
}

export type Dispatch<State> = (action: Action<State>) => void;

// 当前使用的Hooks集合
const currentDispatcher: { current: Dispatcher | null } = {
	current: null
};

/**
 * 获取当前使用的Hooks集合中的dispatcher
 * @returns dispatcher
 */
export const resolveDispatcher = (): Dispatcher => {
	const dispatcher = currentDispatcher.current;
	if (dispatcher === null) {
		throw new Error('hook只能在函数组件中执行');
	}

	return dispatcher;
};

export default currentDispatcher;
