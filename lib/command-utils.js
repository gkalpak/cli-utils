'use strict';

// Imports
const childProcess = require('child_process');
const stream = require('stream');
const utils = require('./internal-utils');
const processUtils = require('./process-utils');

// Exports
const commandUtils = module.exports = {
  /**
   * @typedef {Object} RunConfig
   *
   * @description
   * A configuration object, specifying the behavior of {@link commandUtils#run run()}.
   *
   * @property {boolean} debug - If true, produce verbose, debug-friendly output.
   *     (Default: false)
   * @property {boolean} dryrun - If true, print the command instead of actually running it.
   *     (Default: false)
   *     NOTE: This is still an experimental feature and not guaranteed to work as expected.
   * @property {boolean|Number} returnOutput - If true, return the output of the command instead of printing it to
   *     stdout. If a number (`n`), print the output to stdout, but also return the `n` last lines (ignoring trailing
   *     whitespace).
   *     (Default: false)
   * @property {boolean} suppressTbj - If true, suppress the "Terminate batch job (Y/N)?" confirmation on Windows.
   *     (Default: false)
   *     NOTE: This is still an experimental feature and not guaranteed to work as expected.
   *           It is known to not work with certain types of commands (e.g. `vim`).
   */

  /**
   * @function expandCmd
   *
   * @description
   * Expand a command string, by substituting argument identifiers with the specified arguments. It also supports
   * default/fallback arguments (specified either as static values or as commands to execute and use the output).
   *
   * The following rules apply (independently of the underlying OS):
   * - `$*`, `${*}`: Substitute with all arguments (if any).
   * - `$n`, `${n}`: Substitute with the nth argument (if specified), where `n` is a positive integer.
   * - `$n*`, `${n*}`: Substitute with all arguments starting at the nth one (if any).
   * - `${*:value}`, `${n:value}`, `${n*:value}`: Substitute with all arguments (`*`) or the nth argument (`n`) or the
   *   nth and all subsequent arguments (`n*`). If not specified, substitute with `value`.
   * - `${*:::command}`, `${n:::command}`, `${n*:::command}`: Substitute with all arguments (`*`) or the nth
   *   argument (`n`) or the nth and all subsequent arguments (`n*`). If not specified, run `command` and substitute
   *   with its trimmed output.
   *
   * In all rules above, `$`s can also be escaped with `\`, which will be removed when executing the command. This
   * allows avoiding variable expansion in non-Windows platforms, while still not affecting the output on Windows.
   *
   * Hint: `${0:::command}` will always be substituted with the output of `command`. This is useful when you want to
   *       always use the output of `command` in an OS-independent way.
   *
   * You can use {@link commandUtils#preprocessArgs preprocessArgs()} to obtain the basic `runtimeArgs` and `config`
   * values. For example: `const {args, config} = preprocessArgs(process.argv.slice(2))`.
   *
   * @param {string} cmd - The command to expand.
   * @param {string[]} runtimeArgs - The runtime arguments that will be used for substituting.
   * @param {RunConfig} config - A configuration object. See {@link commandUtils#RunConfig} for more details.
   *
   * @return {Promise<string>} - A promise that resolves with the expanded command, with arguments substituted
   *     (including running default/fallback value sub-commands, as necessary).
   */
  expandCmd: _expandCmd,

  /**
   * @function preprocessArgs
   *
   * @description
   * Preprocess a list of input arguments (e.g. `process.argv.slice(2)`) into a list of arguments that can be used for
   * substituting into commands (i.e. filtering out `--gkcu-` arguments and wrapping the remaining argument in
   * double-quotes, if necessary). Also, derive a {@link commandUtils#RunConfig configuration object} (based on
   * `--gkcu-` arguments) to modify the behavior of {@link commandUtils#run run()} (e.g. enable debug output).
   *
   * NOTE: If you want to pass a value to a `--gkcu-` argument, you need to use `=` (using a space will not work).
   *       For example: `some-command --gkcu-returnOutput=1`
   *
   * @param {string[]} rawArgs - The input arguments that will be preprocessed.
   *
   * @return {{args: string[], config: RunConfig}} result - An object contaning a list of arguments that can be used for
   *     substituting and a {@link commandUtils#RunConfig configuration object}.
   */
  preprocessArgs: _preprocessArgs,

  /**
   * @function run
   *
   * @description
   * Run a command. Could be a complex command with `|`, `&&` and `||` (but not guaranteed to work if too complex :P).
   *
   * It supports argument substitution with {@link commandUtils#expandCmd expandCmd()} and uses
   * {@link commandUtils#spawnAsPromised spawnAsPromised()} to run the resulting command (after substitution).
   *
   * You can use {@link commandUtils#preprocessArgs preprocessArgs()} to obtain the basic `runtimeArgs` and `config`
   * values. For example: `const {args, config} = preprocessArgs(process.argv.slice(2))`.
   *
   * @param {string} cmd - The command to run. Could be a complex command with `|`, `&&` and `||` (but not guaranteed to
   *     work if too complex :P).
   * @param {string[]} [runtimeArgs=[]] - The runtime arguments that will be used for substituting.
   * @param {RunConfig} [config={}] - A configuration object. See {@link commandUtils#RunConfig} for more details.
   *
   * @return {Promise<string>} - A promise that resolves once the command has been executed. The resolved value is
   *     either an empty string or (some part of) the output of the command (if `returnOutput` is set and not false).
   */
  run: _run,

  /**
   * @function spawnAsPromised
   *
   * @description
   * Spawn a complex command (or series of piped commands) and return a promise that resolves or rejects based on the
   * command's outcome. It uses `child_process.spawn()` under the hood, but provides the following extras:
   *
   * - You do not have to separate the executable from the arguments.
   * - It supports complex command with `|`, correctly piping a sub-command's output to the next sub-command's input.
   * - Cleans up once finished, resetting the output style (e.g. bold) and cursor style (e.g. hidden).
   *   _This is useful, when a sub-command errors and leaves the terminal in an unclean state._
   * - Supports all {@link commandUtils#RunConfig} options.
   *
   * @param {string} cmd - The command to run. Could be a complex command with `|`.
   * @param {RunConfig} config - A configuration object. See {@link commandUtils#RunConfig} for more details.
   *
   * @return {Promise<string>} - A promise that resolves once the command has been executed. The resolved value is
   *     either an empty string or (some part of) the output of the command (if `returnOutput` is set and not false).
   */
  spawnAsPromised: _spawnAsPromised,
};

// Functions - Definitions
function _expandCmd(cmd, runtimeArgs, config) {
  // 1: leading \s
  // 2, 5: $*
  // 3, 6: $\d+*
  // 4, 7: $\d+
  // 8: default/fallback value (possibly with `returnOutput` limit)
  const re = /(\s{0,1})\\?\$(?:(\*)|([1-9]+)\*|(\d+)|{(?:(?:(\*)|([1-9]+)\*|(\d+))(?::([^}]*))?)})/g;
  const cmdPromises = Object.create(null);

  let expandedCmd = cmd.replace(re, (_, g1, g2, g3, g4, g5, g6, g7, g8) => {
    const valToReplacement = val => !val ? '' : `${g1}${val}`;

    // Value based on the supplied arguments.
    const startIdx = (g2 || g5) ? 0 : (g3 || g6 || g4 || g7) - 1;
    const endIdx = (g2 || g5 || g3 || g6) ? runtimeArgs.length : (g4 || g7);
    let value = runtimeArgs.slice(startIdx, endIdx).join(' ');

    // No argument(s), fall back to default.
    if (!value && g8) {
      const match = /^::(.+)$/.exec(g8);

      if (!match) {
        // It is a plain ol' fallback value.
        value = g8;
      } else {
        // It is a command.
        let returnOutput = true;
        const cmd = match[1].replace(/ --gkcu-returnOutput=(\d+)$/, (_, g) => {
          returnOutput = +g;
          return '';
        });
        const placeholder = Math.random();

        if (!cmdPromises[cmd]) {
          const runConfig = Object.assign({}, config, {returnOutput});
          cmdPromises[cmd] = _run(cmd, runtimeArgs, runConfig).
            then(result => trimOutput(result)).
            then(result => valToReplacement(runConfig.dryrun ? `{{${result.replace(/\s/g, '_')}}}` : result));
        }

        cmdPromises[cmd] = cmdPromises[cmd].then(repl => {
          expandedCmd = expandedCmd.replace(placeholder, repl);
          return repl;
        });

        return placeholder;
      }
    }

    return valToReplacement(value);
  });

  return Promise.
    all(Object.keys(cmdPromises).map(cmd => cmdPromises[cmd])).
    then(() => expandedCmd);
}

function _preprocessArgs(rawArgs) {
  const metaArgRe = /^--gkcu-(?=[a-z])/;
  const quoteIfNecessary = arg => /\s/.test(arg) ? `"${arg}"` : arg;
  const processMetaArg = arg => {
    const [key, ...rest] = arg.split('=');
    const value = rest.join('=');

    config[key] = +value || value || true;
  };

  const config = Object.create(null);
  const args = rawArgs.
    filter(arg => !metaArgRe.test(arg) || processMetaArg(arg.replace(metaArgRe, ''))).
    map(quoteIfNecessary);

  return {args, config};
}

function _run(cmd, runtimeArgs, config) {
  runtimeArgs = runtimeArgs || [];
  config = config || {};

  return commandUtils.
    expandCmd(cmd, runtimeArgs, config).
    then(expandedCmd => {
      if (config.debug) {
        console.log(`Input command: '${cmd}'`);
        console.log(`Expanded command: '${expandedCmd}'`);
      }
      return commandUtils.spawnAsPromised(expandedCmd, config);
    });
}

function _spawnAsPromised(rawCmd, {debug, dryrun, returnOutput, suppressTbj}) {
  const returnOutputSubset = (typeof returnOutput === 'number');

  const cleanUp = () => {
    if (returnOutput && !returnOutputSubset) {
      // The output has not been written to stdout. No need to clean up.
      return;
    }

    if (debug) {
      console.log('  Reseting the output and cursor styles.');
    }

    // Reset the output style (e.g. bold) and show the cursor.
    process.stdout.write('\u001b[0m');
    process.stdout.write('\u001b[?25h');
  };
  const cancelCleanUp = processUtils.doOnExit(process, cleanUp);
  const unsuppressTbj = suppressTbj ? processUtils.suppressTerminateBatchJobConfirmation(process) : utils.noop;
  const onDone = () => {
    unsuppressTbj();
    cancelCleanUp();
    cleanUp();
  };

  const promise = new Promise((resolve, reject) => {
    let data = '';

    const getReturnData = !returnOutputSubset ?
      () => data :
      () => data.trim().split('\n').slice(-returnOutput).join('\n');

    const pipedCmdSpecs = rawCmd.
      split(/\s+\|\s+/).
      map(cmd => parseSingleCmd(cmd, dryrun));

    const lastStdout = pipedCmdSpecs.reduce((prevStdout, cmdSpec, idx, arr) => {
      const isLast = (idx === arr.length - 1);
      const pipeOutput = !isLast || returnOutput;

      const executable = cmdSpec.executable;
      const args = cmdSpec.args;
      const options = {
        shell: true,
        stdio: [
          prevStdout ? 'pipe' : 'inherit',
          pipeOutput ? 'pipe' : 'inherit',
          'inherit',
        ],
      };

      if (debug) {
        console.log(`  Running ${idx + 1}/${arr.length}: '${executable}', '${args}', (stdio: ${options.stdio})`);
      }

      const proc = childProcess.spawn(executable, args, options).
        on('error', reject).
        on('exit', (code, signal) => {
          if (code !== 0) return reject(code || signal);
          if (isLast) return resolve(getReturnData());
        });

      if (prevStdout) prevStdout.pipe(proc.stdin);

      return proc.stdout;
    }, null);

    if (returnOutput) {
      const outputStream = new stream.PassThrough();
      outputStream.on('data', d => data += d);
      lastStdout.pipe(outputStream);

      if (returnOutputSubset) {
        outputStream.pipe(process.stdout);
      }
    }
  });

  return utils.finallyAsPromised(promise, onDone);
}

function insertAfter(items, newItem, afterItem) {
  for (let i = 0; i < items.length; ++i) {
    if (items[i] === afterItem) {
      insertAt(items, newItem, ++i);
    }
  }
}

function insertAt(items, newItem, idx) {
  if (items[idx] === '(') {
    ++idx;
  }

  items.splice(idx, 0, newItem);
}

function parseSingleCmd(cmd, dryrun) {
  const tokens = cmd.
    split('"').
    reduce((arr, str, idx) => {
      const newTokens = (idx % 2) ? [`"${str}"`] : str.split(' ');
      const lastToken = arr[arr.length - 1];

      if (lastToken) arr[arr.length - 1] += newTokens.shift();

      return arr.concat(newTokens);
    }, []).
    filter(x => x).
    reduce((arr, str) => {
      if (str[0] === '(') {
        arr.push('(', str.slice(1));
      } else {
        arr.push(str);
      }
      return arr;
    }, []);

  if (dryrun) {
    transformForDryrun(tokens);
  }

  return {
    executable: tokens.shift(),
    args: tokens,
  };
}

function transformForDryrun(tokens) {
  insertAt(tokens, 'echo', 0);
  insertAfter(tokens, 'echo', '&&');
  insertAfter(tokens, 'echo', '||');
}

function trimOutput(str) {
  // eslint-disable-next-line no-control-regex
  const cursorMoveRe = /\u001b\[\d+[a-d]/gi;
  return str.
    replace(cursorMoveRe, '').
    trim();
}
