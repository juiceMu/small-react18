export type Flags = number;
export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildDeletion = 0b0000100;
// mutation阶段需要执行的操作
export const MutationMask = Placement | Update | ChildDeletion;

// 代表存在副作用(effect)
export const PassiveEffect = 0b0001000;

// 存在需要触发effect的情况：有PassiveEffect或者函数组件卸载时
export const PassiveMask = PassiveEffect | ChildDeletion;
