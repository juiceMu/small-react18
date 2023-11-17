export type Flags = number;
export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildDeletion = 0b0000100;

// 代表存在副作用(effect)
export const PassiveEffect = 0b0001000;
export const Ref = 0b0010000;

// mutation阶段需要执行的操作
export const MutationMask = Placement | Update | ChildDeletion | Ref; //mutation阶段卸载之前的ref
// layout 阶段需要执行的操作
export const LayoutMask = Ref; //绑定新的ref

// 存在需要触发effect的情况：有PassiveEffect或者函数组件卸载时
export const PassiveMask = PassiveEffect | ChildDeletion;
