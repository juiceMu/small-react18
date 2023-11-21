import ReactCurrentBatchConfig from 'react/src/currentBatchConfig';
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

export const SyncLane = 0b00001; // 同步优先级
export const InputContinuousLane = 0b00010; // 连续输入优先级
export const DefaultLane = 0b00100; // 默认优先级
export const TransitionLane = 0b01000; // transition，过渡优先级
export const IdleLane = 0b10000; // 空闲优先级
export const NoLane = 0b00000;
export const NoLanes = 0b00000;

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
	const isTransition = ReactCurrentBatchConfig.transition !== null;
	if (isTransition) {
		// 证明当前有正在处理的transition，则返回过渡优先级
		return TransitionLane;
	}
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
	root.suspendedLanes = NoLanes;
	root.pingedLanes = NoLanes;
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

/**
 * 增加ping lane标记
 * @param root
 * @param pingedLane
 */
export function markRootPinged(root: FiberRootNode, pingedLane: Lane) {
	root.pingedLanes |= root.suspendedLanes & pingedLane;
}

/**
 * 增加被挂起的标识
 * @param root
 * @param suspendedLane
 */
export function markRootSuspended(root: FiberRootNode, suspendedLane: Lane) {
	root.suspendedLanes |= suspendedLane;
	root.pingedLanes &= ~suspendedLane;
}

export function getNextLane(root: FiberRootNode): Lane {
	const pendingLanes = root.pendingLanes;

	if (pendingLanes === NoLanes) {
		return NoLane;
	}
	let nextLane = NoLane;

	// 排除掉挂起的lane
	const suspendedLanes = pendingLanes & ~root.suspendedLanes;
	if (suspendedLanes !== NoLanes) {
		nextLane = getHighestPriorityLane(suspendedLanes);
	} else {
		const pingedLanes = pendingLanes & root.pingedLanes;
		if (pingedLanes !== NoLanes) {
			nextLane = getHighestPriorityLane(pingedLanes);
		}
	}
	return nextLane;
}

/**
 * 是否包含lanes
 * @param set
 * @param subset
 * @returns
 */
export function includeSomeLanes(set: Lanes, subset: Lane | Lanes): boolean {
	return (set & subset) !== NoLanes;
}

/**
 * 去掉lanes合集
 * @param set
 * @param subset
 * @returns
 */
export function removeLanes(set: Lanes, subset: Lanes | Lane): Lanes {
	return set & ~subset;
}
