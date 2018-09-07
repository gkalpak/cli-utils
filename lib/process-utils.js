'use strict';

// Imports
const utils = require('./internal-utils');

// Exports
module.exports = {
  /**
   * @function doOnExit
   *
   * @description
   * Run the specified `action`, when `exit` or `SIGINT` are fired on the specified process.
   *
   * @param {Process} proc - The process whose events to listen for.
   * @param {Function} action - The callback to call on `exit` or `SIGINT`.
   *
   * @return {Function} - A function to run for unregistering the listeners from `proc`.
   */
  doOnExit: _doOnExit,

  /**
   * @function suppressTerminateBatchJobConfirmation
   *
   * @description
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
   * @param {Process} proc - The process whose confirmation to suppress.
   *
   * @return {Function} - A function to run for un-suppressing the confirmation.
   */
  suppressTerminateBatchJobConfirmation: _suppressTerminateBatchJobConfirmation,
};

// Functions - Definitions
function _doOnExit(proc, action) {
  if (!proc) {
    throw new Error('No process specified.');
  } else if (!action) {
    throw new Error('No action specified.');
  }

  const events = ['exit', 'SIGINT'];
  const listener = code => {
    action(code);
    proc.exit(code);
  };

  events.forEach(evt => proc.addListener(evt, listener));

  return () => events.forEach(evt => proc.removeListener(evt, listener));
}

function _suppressTerminateBatchJobConfirmation(proc) {
  if (proc.platform !== 'win32') {
    // No need to suppress anything on non-Windows platforms.
    return utils.noop;
  }

  // On Windows, suppress the "Terminate batch job (Y/N)?" confirmation.
  const rl = require('readline');
  const rlInstance = rl.
    createInterface({input: proc.stdin, output: proc.stdout}).
    on('SIGINT', () => {
      const exec = require('child_process').exec;
      exec(`taskkill /F /PID ${proc.pid} /T`);
    });

  // Closing synchronously sometimes results in stale output (for whatever reason).
  return () => setTimeout(() => rlInstance.close());
}
