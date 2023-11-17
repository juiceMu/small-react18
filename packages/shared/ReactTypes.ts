export type Ref = { current: any } | ((instance: any) => void);
export type ElementType = any;
export type Key = any;
export type Props = any;

export interface ReactElementType {
	$$typeof: symbol | number;
	type: ElementType;
	key: Key;
	props: Props;
	ref: Ref;
	__mark: 'Lynn';
}
export type Action<State> = State | ((prevState: State) => State);
