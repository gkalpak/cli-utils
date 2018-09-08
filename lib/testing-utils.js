'use strict';

// Imports
const commandUtils = require('./command-utils');

// Exports
const testingUtils = module.exports = {
  /**
   * @function testCmd
   *
   * @description
   * Run the specified command using {@link commandUtils#spawnAsPromised spawnAsPromised()}, capture the output and
   * return it. Before returning the captured output, it removes non-visible, clean-up characters written by
   * `spawnAsPromised()`, normalizes newlines to `\n`, and trims it.
   *
   * This can be useful (among other things) if you want to compare the output of a command with an
   * expected output.
   *
   * NOTE 1: Normally, `spawnAsPromised()` only captures `stdout`. If you want to also capture `stderr`, you can
   *         redirect it to `stdout` by appending `2>&1` to the command.
   *
   * NOTE 2: Normally, `spawnAsPromised()` will reject without returning the output if the executed command fails. If
   *         you want the output nonetheless, you can make the command succeed by appending `|| true` to it.
   *
   * @example
   * ```js
   * const output = await testCmd('node -p "\'foo\r\nbar\r\n\'"');
   * // output === 'foo\nbar';
   * ```
   *
   * @param {string} cmd - The command to run.
   *
   * @return {Promise<string>} - A promise that resolves once the command has been executed. The resolved value is the
   *     output of the command.
   */
  testCmd: _testCmd,

  /**
   * @function testScriptFactory
   *
   * @description
   * Create a function that can be used for testing a Node.js script with {@link testingUtils#testCmd testCmd()}. It can
   * be used, for example, to test `bin` scripts.
   *
   * Basically, it takes a script path and returns a function that calls `testCmd('node <script-path>')`. The returned
   * function can also get extra arguments (as a string) to be appended to the executed command per call.
   *
   * @example
   * ```js
   * const testScript = testScriptFactory('/foo/bar.js');
   * testScript();               // Runs: node /foo/bar.js
   * testScript('--baz --qux');  // Runs: node /foo/bar.js --baz --qux
   * ```
   *
   * @param {string} scriptPath - The path to the Node.js script to be run.
   *
   * @return {Function} - A function that runs the script (via `testCmd()`) when called. Optionally accepts extra
   *     arguments (as a string) to be appended to the command.
   */
  testScriptFactory: _testScriptFactory,

  /**
   * @function withJasmineTimeout
   *
   * @description
   * Run a test suite (i.e. `describe()` block) with a different `DEFAULT_TIMEOUT_INTERVAL`. The previous timeout
   * interval is restored after all tests of the suite have completed.
   *
   * @example
   * ```js
   * describe('My slow suite', withJasmineTimeout(30000, () => {
   *   it('should take its time', done => setTimeout(done, 15000));
   * }));
   * ```
   *
   * @param {number} newTimeout - The new timeout to use for the test suite (in milliseconds).
   * @param {Function} testSuite - The test suite function (same as a `describe()` block's second argument).
   */
  withJasmineTimeout: _withJasmineTimeout,
};

// Functions - Definitions
async function _testCmd(cmd) {
  const result = await commandUtils.spawnAsPromised(cmd, {returnOutput: true});
  return normalizeNewlines(stripCleanUpCharacters(result)).trim();
}

function _testScriptFactory(scriptPath) {
  const baseCmd = `node ${scriptPath}`;
  return (argsStr = '') => testingUtils.testCmd(`${baseCmd} ${argsStr}`);
}

function _withJasmineTimeout(newTimeout, testSuite) {
  return () => {
    let originalDefaultTimeoutInterval;

    global.beforeAll(() => {
      originalDefaultTimeoutInterval = global.jasmine.DEFAULT_TIMEOUT_INTERVAL;
      global.jasmine.DEFAULT_TIMEOUT_INTERVAL = newTimeout;
    });

    global.afterAll(() => global.jasmine.DEFAULT_TIMEOUT_INTERVAL = originalDefaultTimeoutInterval);

    testSuite();
  };
}

function normalizeNewlines(str) {
  return str.replace(/\r\n?/g, '\n');
}

function stripCleanUpCharacters(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[(?:0m|\?25h)/gi, '');
}
