#!/usr/bin/env node
import {commandUtils} from '../lib/command-utils';
import {internalUtils} from '../lib/internal-utils';


/**
 * Run a command with support for argument substitution. Could be a complex command with `|`, `&&` and `||` (but not
 * guaranteed to work if too complex :P).
 *
 * The first argument is the command to be run (after substitution). The rest of the arguments are passed to
 * {@link CommandUtils#preprocessArgs preprocessArgs()} (to separate actual arguments from configuration arguments) and
 * the result is run using {@link CommandUtils#run run()}, which calls {@link CommandUtils#expandCmd expandCmd()} under
 * the hood.
 *
 * @example
 * ```
 * gkcu-run "echo \$1 \${2:bar} \$1" foo
 * #--> foo bar foo
 *
 * gkcu-run "echo \$1 \${2:bar} \$1" foo BAZ
 * #--> foo BAZ foo
 *
 *
 * gkcu-run "git checkout \${1:master} \$2*"
 * #--> *checks out branch `master`*
 *
 * gkcu-run "git checkout \${1:master} \$2*" foo
 * #--> *checks out branch `foo`*
 *
 * gkcu-run "git checkout \${1:master} \$2*" foo -b qux
 * #--> *creates a new `qux` branch from branch `foo`*
 *
 *
 * gkcu-run "echo \${1:Hello}, \${0:::whoami}!"
 * #--> Hello, gkalpak!
 *
 * gkcu-run "echo \${1:Hello}, \${0:::whoami}!" Hey
 * #--> Hey, gkalpak!
 *
 * gkcu-run "echo \${1:Hello}, \${0:::whoami}!" Howdy --gkcu-dryrun
 * #--> echo Howdy, {{whoami}}!
 * ```
 *
 * @param cmd - The command to run (after substitution).
 * @param ...rawArgs - The arguments, including both runtime arguments (that will be used for substituting) and
 *     {@link commandUtils#IRunConfig configuration arguments}.
 *
 * @return The output of the command (and any sub-commands that were run during argument substitution).
 */
if (require.main === module) {
  const [cmd, ...rawArgs] = process.argv.slice(2);
  const {args, config} = commandUtils.preprocessArgs(rawArgs);

  commandUtils.
    run(cmd, args, config).
    catch(internalUtils.onError.bind(internalUtils));
}
