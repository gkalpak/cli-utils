export class InternalUtils {
  public readonly escapeSeqs = {
    resetBold: '\u001b[0m',
    showCursor: '\u001b[?25h',
  } as const;
  public readonly escapeSeqRes = {
    /* eslint-disable no-control-regex */
    moveCursor: /\u001b\[\d+[a-d]/gi,
    resetBold: /\u001b\[0m/gi,
    showCursor: /\u001b\[\?25h/gi,
    /* eslint-enable no-control-regex */
  } as const;

  private outputStyleResetSeqNames = ['resetBold', 'showCursor'] as const;

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

  public resetOutputStyle(stream: NodeJS.WriteStream) {
    // Reset the output style (e.g. bold) and show the cursor.
    this.outputStyleResetSeqNames.forEach(seqName => stream.write(this.escapeSeqs[seqName]));
  }

  public stripOutputStyleResetSequences(str: string): string {
    return this.outputStyleResetSeqNames.reduce((aggr, seqName) => aggr.replace(this.escapeSeqRes[seqName], ''), str);
  }
}

export const internalUtils = new InternalUtils();
