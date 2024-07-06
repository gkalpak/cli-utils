import {resolve as resolvePath} from 'node:path';


// eslint-disable-next-line import/no-unassigned-import
import 'source-map-support/register';


export const IS_WINDOWS = (process.platform === 'win32');

export const ROOT_DIR = resolvePath(__dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reversePromise<T = any>(promise: Promise<unknown>): Promise<T> {
  return promise.then(val => Promise.reject(val), err => err);
}

export function tickAsPromised(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
