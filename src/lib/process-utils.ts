import {internalUtils} from './internal-utils';


export class ProcessUtils {
  /**
   * Run the specified `action`, when `exit` or `SIGINT` are fired on the specified process.
   *
   * @param proc - The process whose events to listen for.
   * @param action - The callback to call on `exit` or `SIGINT`.
   *
   * @return A function to run for unregistering the listeners from `proc`.
   */
  public doOnExit(proc: NodeJS.Process, action: (codeOrSignal: number | NodeJS.Signals) => void) {
    if (!proc) {
      throw new Error('No process specified.');
    } else if (!action) {
      throw new Error('No action specified.');
    }

    const exitListener: NodeJS.ExitListener = (code: number) => {
      action(code);
      proc.exit(code);
    };
    const signalListener: NodeJS.SignalsListener = (signal: NodeJS.Signals) => {
      action(signal);
      proc.exit(1);
    };
    const signals: NodeJS.Signals[] = ['SIGINT'];

    proc.addListener('exit', exitListener);
    signals.forEach(signal => proc.addListener(signal, signalListener));

    return () => {
      proc.removeListener('exit', exitListener);
      signals.forEach(signal => proc.removeListener(signal, signalListener));
    };
  }

  /**
   * Suppress the "Terminate batch job (Y/N)?" confirmation on Windows for the specified process.
   * Calling this function with a non-Windows process is a no-op.
   *
   * Under the hood, it attaches a listener to `readline` interface and uses
   * [taskkill](https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill) to kill the
   * process.
   *
   * NOTE: This is still an experimental feature and not guaranteed to work as expected.
   *       It is known to not work with certain types of commands (e.g. `vim`).
   *
   * @param proc - The process whose confirmation to suppress.
   *
   * @return A function to run for un-suppressing the confirmation.
   */
  public suppressTerminateBatchJobConfirmation(proc: NodeJS.Process): () => void {
    if (proc.platform !== 'win32') {
      // No need to suppress anything on non-Windows platforms.
      return internalUtils.noop;
    }

    // On Windows, suppress the "Terminate batch job (Y/N)?" confirmation.
    const rl = require('readline');
    const rlInstance = rl.
      createInterface({input: proc.stdin, output: proc.stdout}).
      on('SIGINT', () => {
        const {exec} = require('child_process');
        exec(`taskkill /F /PID ${proc.pid} /T`);
      });

    // Closing synchronously sometimes results in stale output (for whatever reason).
    return () => setTimeout(() => rlInstance.close(), 0);
  }
}

export const processUtils = new ProcessUtils();
