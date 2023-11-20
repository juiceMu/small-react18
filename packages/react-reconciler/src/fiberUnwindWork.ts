import { FiberNode } from './fiber';
import { popProvider } from './fiberContext';
import { DidCapture, NoFlags, ShouldCapture } from './fiberFlags';
import { popSuspenseHandler } from './suspenseContext';
import { ContextProvider, HostRoot, SuspenseComponent } from './workTags';

export function unwindWork(wip: FiberNode) {
	const flags = wip.flags;
	switch (wip.tag) {
		case SuspenseComponent:
			popSuspenseHandler();
			if (
				(flags & ShouldCapture) !== NoFlags &&
				(flags & DidCapture) === NoFlags
			) {
				// 代表此时的wip就是离抛出错误的fiber最近的那个suspense
				// 移除掉ShouldCapture标记，增加DidCapture标记
				wip.flags = (flags & ~ShouldCapture) | DidCapture;
				return wip;
			}
			return null;

		case ContextProvider:
			const context = wip.type._context;
			popProvider(context);
			return null;
		default:
			return null;
	}
}
