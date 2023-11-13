import { REACT_ELEMENT_TYPE } from 'shared/ReactSymbols';
import {
	Key,
	ElementType,
	Ref,
	Props,
	ReactElementType
} from 'shared/ReactTypes';

const ReactElement = function (
	type: ElementType,
	key: Key,
	ref: Ref,
	props: Props
): ReactElementType {
	const element: ReactElementType = {
		$$typeof: REACT_ELEMENT_TYPE,
		type,
		key,
		ref,
		props,
		__mark: 'Lynn'
	};
	return element;
};

/**
 * key是否有值
 * @param config
 * @returns
 */
function hasValidKey(config: any) {
	return config.key !== undefined;
}

/**
 * Ref是否有值
 * @param config
 * @returns
 */
function hasValidRef(config: any) {
	return config.ref !== undefined;
}

const jsx = (type: ElementType, config: any) => {
	let key: Key = null;
	const props: any = {};
	let ref: Ref = null;
	for (const prop in config) {
		const val = config[prop];
		if (prop === 'key') {
			if (hasValidKey(config)) {
				key = '' + val;
			}
			continue;
		}

		if (prop === 'ref' && val !== undefined) {
			if (hasValidRef(config)) {
				ref = '' + val;
			}
			continue;
		}
		if ({}.hasOwnProperty.call(config, prop)) {
			props[prop] = val;
		}
	}
	return ReactElement(type, key, ref, props);
};
export const jsxDEV = jsx;
