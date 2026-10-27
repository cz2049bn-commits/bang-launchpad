import {createRequire} from 'node:module';
import {scopeKeytar} from './keytar-scope.mjs';
const require=createRequire(import.meta.url);
export default scopeKeytar(require('@github/keytar'),process.env.BIA_KEYCHAIN_SCOPE);
