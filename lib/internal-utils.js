'use strict';

// Exports
module.exports = {
  finallyAsPromised: _finallyAsPromised,
  noop: _noop,
  onError: _onError,
};

// Functions - Definitions
function _finallyAsPromised(promise, callback) {
  return promise.then(
    val => Promise.resolve(callback()).then(() => val),
    err => Promise.resolve(callback()).then(() => Promise.reject(err)));
}

function _noop() {
}

function _onError(err) {
  const chalk = require('chalk');
  const isExitCode = err && (typeof err === 'number');
  const errorMsg = (err instanceof Error) ? err.stack : `${isExitCode ? 'Exit code' : 'Error'}: ${err}`;

  console.error(chalk.red(errorMsg));
  process.exit(isExitCode ? err : 1);
}
