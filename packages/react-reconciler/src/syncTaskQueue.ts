// 同步调度队列
let syncQueue: ((...args: any) => void)[] | null = null;
// 全局标识/锁--是否正在执行同步队列中的任务
let isFlushingSyncQueue = false;

/**
 * 将任务(callback回调函数)放入同步任务队列中
 * @param callback
 */
export function scheduleSyncCallback(callback: (...args: any) => void) {
	if (syncQueue === null) {
		syncQueue = [callback];
	} else {
		syncQueue.push(callback);
	}
}

/**
 * 执行同步队列中的任务
 */
export function flushSyncCallbacks() {
	if (!isFlushingSyncQueue && syncQueue) {
		// 开启正在执行同步队列中的任务的全局标识/锁
		// 全局标识的作用：避免syncQueue被重复遍历和执行
		isFlushingSyncQueue = true;
		try {
			// 依次执行掉同步队列中的任务(callback函数)
			syncQueue.forEach((callback) => callback());
		} catch (e) {
			if (__DEV__) {
				console.error('flushSyncCallbacks报错', e);
			}
		} finally {
			// 同步队列内的任务全部执行完成后
			// 关闭正在执行同步队列中的任务的全局标识
			isFlushingSyncQueue = false;
			syncQueue = null;
		}
	}
}
