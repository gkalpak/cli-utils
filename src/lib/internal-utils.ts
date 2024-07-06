export class InternalUtils {
  public async finallyAsPromised<T>(promise: Promise<T>, callback: () => void | Promise<void>): Promise<T> {
    return promise.then(
        val => Promise.resolve(callback()).then(() => val),
        err => Promise.resolve(callback()).then(() => Promise.reject(err)));
  }

  public noop() {
    return undefined;
  }

  public onError(err?: Error | string | number): void {
    const {red} = require('chalk'); // eslint-disable-line @typescript-eslint/no-var-requires

    const isExitCode = !!err && (typeof err === 'number');
    const errorMsg = (err instanceof Error) ?
      err.stack : isExitCode ?
        `Exit code: ${err}` :
        `Error: ${err}`;

    console.error(red(errorMsg));
    process.exit(isExitCode ? err as number : 1);
  }
}

export const internalUtils = new InternalUtils();
