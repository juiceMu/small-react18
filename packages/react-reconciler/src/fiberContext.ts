import { ReactContext } from 'shared/ReactTypes';

// 上一次的Context中的值
let prevContextValue: any = null;
// 存储旧的Context value 栈
const prevContextValueStack: any[] = [];

export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
	prevContextValueStack.push(prevContextValue);
	prevContextValue = context._currentValue;
	context._currentValue = newValue;
}

export function popProvider<T>(context: ReactContext<T>) {
	context._currentValue = prevContextValue;
	prevContextValue = prevContextValueStack.pop();
}
