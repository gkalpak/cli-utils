#!/usr/bin/env node
import {commandUtils} from '../lib/command-utils';
import {internalUtils} from '../lib/internal-utils';


/**
 * Expand a command string by substituting argument identifiers with the specified arguments. It also supports
 * default/fallback arguments (specified either as static values or as commands to execute and use the output).
 *
 * The first argument is the command to be expanded. The rest of the arguments are passed to
 * {@link CommandUtils#preprocessArgs preprocessArgs()} (to separate actual arguments from configuration arguments) and
 * the result is expanded using {@link CommandUtils#expandCmd expandCmd()}.
 *
 * @example
 * ```
 * gkcu-expand-cmd "echo \$1 \${2:bar} \$1" foo
 * #--> echo foo bar foo
 *
 * gkcu-expand-cmd "echo \$1 \${2:bar} \$1" foo BAZ
 * #--> echo foo BAZ foo
 *
 *
 * gkcu-expand-cmd "git checkout \${1:master} \$2*"
 * #--> git checkout master
 *
 * gkcu-expand-cmd "git checkout \${1:master} \$2*" foo
 * #--> git checkout foo
 *
 * gkcu-expand-cmd "git checkout \${1:master} \$2*" foo -b qux
 * #--> git checkout foo -b qux
 *
 *
 * gkcu-expand-cmd "echo \${1:Hello}, \${0:::whoami}!"
 * #--> echo Hello, gkalpak!
 *
 * gkcu-expand-cmd "echo \${1:Hello}, \${0:::whoami}!" Hey
 * #--> echo Hey, gkalpak!
 * ```
 *
 * @param cmd - The command to expand.
 * @param ...rawArgs - The arguments, including both runtime arguments (that will be used for substituting) and
 *     configuration arguments.
 *
 * @return The expanded command, with arguments substituted (including running default/fallback value sub-commands, as
 *     necessary).
 */
if (require.main === module) {
  const [cmd, ...rawArgs] = process.argv.slice(2);
  const {args, config} = commandUtils.preprocessArgs(rawArgs);

  commandUtils.
    expandCmd(cmd, args, config).
    then(console.log, internalUtils.onError.bind(internalUtils));
}
