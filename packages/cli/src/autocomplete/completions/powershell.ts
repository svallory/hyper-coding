import { EOL } from "node:os";
import { format } from "node:util";

import { CompletionScriptBase } from "./shared.js";
import type { CommandCompletion } from "./types.js";

export default class PowerShellComp extends CompletionScriptBase {
	generate(): string {
		const genNode = (partialId: string): Record<string, unknown> => {
			const node: Record<string, unknown> = {};
			const nextArgs: string[] = [];
			const depth = partialId.split(":").length;

			for (const t of this.topics) {
				const topicNameSplit = t.name.split(":");
				if (t.name.startsWith(`${partialId}:`) && topicNameSplit.length === depth + 1) {
					nextArgs.push(topicNameSplit[depth]);
					node[topicNameSplit[depth]] = this.coTopics.includes(t.name)
						? {
								...genNode(`${partialId}:${topicNameSplit[depth]}`),
							}
						: {
								_summary: t.description,
								...genNode(`${partialId}:${topicNameSplit[depth]}`),
							};
				}
			}

			for (const c of this.commands) {
				const cmdIdSplit = c.id.split(":");
				if (partialId === c.id && this.coTopics.includes(c.id)) {
					node._command = c.id;
				}

				if (
					c.id.startsWith(`${partialId}:`) &&
					cmdIdSplit.length === depth + 1 &&
					!nextArgs.includes(cmdIdSplit[depth])
				) {
					node[cmdIdSplit[depth]] = {
						_command: c.id,
					};
				}
			}

			return node;
		};

		const commandTree: Record<string, Record<string, unknown>> = {};
		const topLevelArgs: string[] = [];

		for (const t of this.topics) {
			if (!t.name.includes(":")) {
				commandTree[t.name] = this.coTopics.includes(t.name)
					? {
							...genNode(t.name),
						}
					: {
							_summary: t.description,
							...genNode(t.name),
						};
				topLevelArgs.push(t.name);
			}
		}

		for (const c of this.commands) {
			if (!c.id.includes(":") && !this.coTopics.includes(c.id)) {
				commandTree[c.id] = {
					_command: c.id,
				};
				topLevelArgs.push(c.id);
			}
		}

		const hashtables: string[] = [];
		for (const topLevelArg of topLevelArgs) {
			hashtables.push(this.genHashtable(topLevelArg, commandTree));
		}

		const commandsHashtable = `
@{
${hashtables.join("\n")}
}`;

		const compRegister = `
using namespace System.Management.Automation
using namespace System.Management.Automation.Language

$scriptblock = {
    param($WordToComplete, $CommandAst, $CursorPosition)

    $Commands =${commandsHashtable}

    # Get the current mode
    $Mode = (Get-PSReadLineKeyHandler | Where-Object {$_.Key -eq "Tab" }).Function

    # Everything in the current line except the CLI executable name.
    $CurrentLine = $commandAst.CommandElements[1..$commandAst.CommandElements.Count] -split " "

    # Remove $WordToComplete from the current line.
    if ($WordToComplete -ne "") {
      if ($CurrentLine.Count -eq 1) {
        $CurrentLine = @()
      } else {
        $CurrentLine = $CurrentLine[0..$CurrentLine.Count]
      }
    }

    # Save flags in current line without the \`--\` prefix.
    $Flags = $CurrentLine | Where-Object {
      $_ -Match "^-{1,2}(\\w+)"
    } | ForEach-Object {
      $_.trim("-")
    }
    # Set $flags to an empty hashtable if there are no flags in the current line.
    if ($Flags -eq $null) {
      $Flags = @{}
    }

    # No command in the current line, suggest top-level args.
    if ($CurrentLine.Count -eq 0) {
        $Commands.GetEnumerator() | Where-Object {
            $_.Key.StartsWith("$WordToComplete")
          } | Sort-Object -Property key | ForEach-Object {
          New-Object -Type CompletionResult -ArgumentList \`
              $($Mode -eq "MenuComplete" ? "$($_.Key) " : "$($_.Key)"),
              $_.Key,
              "ParameterValue",
              "$($_.Value._summary ?? $_.Value._command.summary ?? " ")"
          }

        # Dynamic completion for kit/cookbook/recipe names
        $DynamicOutput = & ${this.config.bin} autocomplete generate -- $WordToComplete 2>$null
        if ($DynamicOutput) {
            $DynamicOutput | ForEach-Object {
                New-Object -Type CompletionResult -ArgumentList \`
                    $($Mode -eq "MenuComplete" ? "$_ " : "$_"),
                    $_,
                    "ParameterValue",
                    " "
            }
        }
    } else {
      # Start completing command/topic/coTopic

      $NextArg = $null
      $PrevNode = $null

      # Iterate over the current line to find the command/topic/coTopic hashtable
      $CurrentLine | ForEach-Object {
        if ($NextArg -eq $null) {
          $NextArg = $Commands[$_]
        } elseif ($PrevNode[$_] -ne $null) {
          $NextArg = $PrevNode[$_]
        } elseif ($_.StartsWith('-')) {
          return
        } else {
          $NextArg = $PrevNode
        }

        $PrevNode = $NextArg
      }

      # Start completing command.
      if ($NextArg._command -ne $null) {
          # Complete flags
          # \`cli config list -<TAB>\`
          if ($WordToComplete -like '-*') {
              $NextArg._command.flags.GetEnumerator() | Sort-Object -Property key
                  | Where-Object {
                      # Filter out already used flags (unless \`flag.multiple = true\`).
                      $_.Key.StartsWith("$($WordToComplete.Trim("-"))") -and ($_.Value.multiple -eq $true -or !$flags.Contains($_.Key))
                  }
                  | ForEach-Object {
                      New-Object -Type CompletionResult -ArgumentList \`
                          $($Mode -eq "MenuComplete" ? "--$($_.Key) " : "--$($_.Key)"),
                          $_.Key,
                          "ParameterValue",
                          "$($NextArg._command.flags[$_.Key].summary ?? " ")"
                  }
          } else {
              # This could be a coTopic. We remove the "_command" hashtable
              # from $NextArg and check if there's a command under the current partial ID.
              $NextArg.remove("_command")

              if ($NextArg.keys -gt 0) {
                  $NextArg.GetEnumerator() | Where-Object {
                      $_.Key.StartsWith("$WordToComplete")
                    } | Sort-Object -Property key | ForEach-Object {
                    New-Object -Type CompletionResult -ArgumentList \`
                      $($Mode -eq "MenuComplete" ? "$($_.Key) " : "$($_.Key)"),
                      $_.Key,
                      "ParameterValue",
                      "$($NextArg[$_.Key]._summary ?? " ")"
                  }
              }
          }
      } else {
          # Start completing topic.

          # Topic summary is stored as "_summary" in the hashtable.
          # At this stage it is no longer needed so we remove it
          # so that $NextArg contains only commands/topics hashtables

          $NextArg.remove("_summary")

          $NextArg.GetEnumerator() | Where-Object {
                $_.Key.StartsWith("$WordToComplete")
              } | Sort-Object -Property key | ForEach-Object {
              New-Object -Type CompletionResult -ArgumentList \`
                  $($Mode -eq "MenuComplete" ? "$($_.Key) " : "$($_.Key)"),
                  $_.Key,
                  "ParameterValue",
                  "$($NextArg[$_.Key]._summary ?? $NextArg[$_.Key]._command.summary ?? " ")"
          }
      }

      # Dynamic completion fallback for kit/cookbook/recipe names
      $DynamicOutput = & ${this.config.bin} autocomplete generate -- @($CurrentLine) $WordToComplete 2>$null
      if ($DynamicOutput) {
          $DynamicOutput | ForEach-Object {
              New-Object -Type CompletionResult -ArgumentList \`
                  $($Mode -eq "MenuComplete" ? "$_ " : "$_"),
                  $_,
                  "ParameterValue",
                  " "
          }
      }
    }
}
Register-ArgumentCompleter -Native -CommandName ${this.config.binAliases ? `@(${[...this.config.binAliases, this.config.bin].map((alias) => `"${alias}"`).join(",")})` : this.config.bin} -ScriptBlock $scriptblock
`;

		return compRegister;
	}

	genCmdHashtable(cmd: CommandCompletion): string {
		const flaghHashtables: string[] = [];
		const flagNames = Object.keys(cmd.flags);

		if (!flagNames.includes("help")) {
			flaghHashtables.push('    "help" = @{ "summary" = "Show help for command" }');
		}

		if (flagNames.length > 0) {
			for (const flagName of flagNames) {
				const f = cmd.flags[flagName];

				if (f.hidden) continue;

				const flagSummary = this.sanitizeSummary(f.summary ?? f.description);
				if (f.type === "option" && f.multiple) {
					flaghHashtables.push(`    "${f.name}" = @{
      "summary" = "${flagSummary}"
      "multiple" = $true
}`);
				} else {
					flaghHashtables.push(`    "${f.name}" = @{ "summary" = "${flagSummary}" }`);
				}
			}
		}

		const cmdHashtable = `@{
  "summary" = "${cmd.summary}"
  "flags" = @{
${flaghHashtables.join("\n")}
  }
}`;

		return cmdHashtable;
	}

	genHashtable(
		key: string,
		node: Record<string, Record<string, unknown>>,
		leafTpl?: string,
	): string {
		if (!leafTpl) {
			leafTpl = `"${key}" = @{
%s
}
`;
		}

		const nodeKeys = Object.keys(node[key]);

		if (nodeKeys.includes("_summary")) {
			let childTpl = `"_summary" = "${node[key]._summary}"\n%s`;
			const newKeys = nodeKeys.filter((k) => k !== "_summary");

			if (newKeys.length > 0) {
				const childNodes: string[] = [];
				for (const newKey of newKeys) {
					childNodes.push(
						this.genHashtable(newKey, node[key] as Record<string, Record<string, unknown>>),
					);
				}

				childTpl = format(childTpl, childNodes.join("\n"));
				return format(leafTpl, childTpl);
			}

			return format(leafTpl, childTpl);
		}

		const childNodes: string[] = [];
		for (const k of nodeKeys) {
			if (k === "_command") {
				const cmd = this.commands.find((c) => c.id === node[key][k]);
				if (!cmd) throw new Error("no command");
				childNodes.push(format('"_command" = %s', this.genCmdHashtable(cmd)));
			} else if ((node[key][k] as Record<string, unknown>)?._command) {
				const cmd = this.commands.find(
					(c) => c.id === (node[key][k] as Record<string, unknown>)._command,
				);
				if (!cmd) throw new Error("no command");
				childNodes.push(format(`"${k}" = @{\n"_command" = %s\n}`, this.genCmdHashtable(cmd)));
			} else {
				const childTpl = `"summary" = "${(node[key][k] as Record<string, unknown>)._summary}"\n"${k}" = @{ \n    %s\n   }`;
				childNodes.push(
					this.genHashtable(k, node[key] as Record<string, Record<string, unknown>>, childTpl),
				);
			}
		}

		if (childNodes.length > 0) {
			return format(leafTpl, childNodes.join("\n"));
		}

		return leafTpl;
	}

	sanitizeSummary(summary: string | undefined): string {
		if (summary === undefined) {
			return " ";
		}

		return summary
			.replace(/<%= config\.bin %>/g, this.config.bin)
			.replaceAll('"', '""')
			.replaceAll("`", "``")
			.split(EOL)[0];
	}
}
