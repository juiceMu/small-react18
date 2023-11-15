import { FiberRootNode } from './fiber';

export type Lane = number; // 优先级
export type Lanes = number; // lane集合

export const SyncLane = 0b0001; // 同步优先级
export const NoLane = 0b0000;
export const NoLanes = 0b0000;

/**
 * 合并lane整合为lanes集合
 * @param laneA
 * @param laneB
 * @returns lanes lane集合
 */
export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}

/**
 * 获取优先级
 * @returns
 */
export function requestUpdateLane() {
	return SyncLane;
}

/**
 * 在lane集合中获取集合中最高优先级的lane
 * @param lanes
 * @returns
 */
export function getHighestPriorityLane(lanes: Lanes): Lane {
	return lanes & -lanes;
}

/**
 * 从lane集合中去掉已经完成的lane
 * @param root
 * @param lane
 */
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}
