export type Ref = any;
export type ElementType = any;
export type Key = string | null;
export type Props = {
	[key: string]: any;
	children?: ReactElementType;
};

export interface ReactElementType {
	$$typeof: symbol;
	type: ElementType;
	key: Key;
	props: Props;
	ref: Ref;
	__mark: 'Lynn';
}
export type Action<State> = State | ((prevState: State) => State);
