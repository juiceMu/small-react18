import {
	unstable_getCurrentPriorityLevel,
	unstable_IdlePriority,
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_UserBlockingPriority
} from 'scheduler';
import { FiberRootNode } from './fiber';

export type Lane = number; // 优先级
export type Lanes = number; // lane集合

export const SyncLane = 0b0001; // 同步优先级
export const InputContinuousLane = 0b0010; // 连续输入优先级
export const DefaultLane = 0b0100; // 默认优先级
export const IdleLane = 0b1000; // 空闲优先级
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
	// 从上下文环境中获取Scheduler优先级
	const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
	const lane = schedulerPriorityToLane(currentSchedulerPriority);
	return lane;
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
 * 是否是lanes集合中存在的lane优先级
 * @param set lanes集合
 * @param subset 需要判断的lane优先级
 * @returns boolean
 */
export function isSubsetOfLanes(set: Lanes, subset: Lane) {
	return (set & subset) === subset;
}

/**
 * 从lane集合中去掉已经完成的lane
 * @param root
 * @param lane
 */
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}

/**
 * lane优先级转换为scheduler优先级
 * @param lanes
 * @returns schedulerPriority
 */
export function lanesToSchedulerPriority(lanes: Lanes) {
	const lane = getHighestPriorityLane(lanes);

	if (lane === SyncLane) {
		return unstable_ImmediatePriority;
	}
	if (lane === InputContinuousLane) {
		return unstable_UserBlockingPriority;
	}
	if (lane === DefaultLane) {
		return unstable_NormalPriority;
	}
	return unstable_IdlePriority;
}

/**
 * scheduler优先级转换为lane优先级
 * @param schedulerPriority scheduler优先级
 * @returns lanes
 */
export function schedulerPriorityToLane(schedulerPriority: number): Lane {
	if (schedulerPriority === unstable_ImmediatePriority) {
		return SyncLane;
	}
	if (schedulerPriority === unstable_UserBlockingPriority) {
		return InputContinuousLane;
	}
	if (schedulerPriority === unstable_NormalPriority) {
		return DefaultLane;
	}
	return NoLane;
}
