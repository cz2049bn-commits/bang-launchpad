import {jsx as originalJsx,jsxs as originalJsxs,Fragment} from 'react/jsx-runtime';
import {translateProps} from '../i18n';
export {Fragment};
export const jsx=(type,props,key)=>originalJsx(type,translateProps(type,props),key);
export const jsxs=(type,props,key)=>originalJsxs(type,translateProps(type,props),key);
