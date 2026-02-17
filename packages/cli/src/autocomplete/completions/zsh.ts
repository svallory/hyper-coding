import { format } from "node:util";

import { CompletionScriptBase } from "./shared.js";
import type { FlagCompletion } from "./types.js";

const argTemplate = '        "%s")\n          %s\n        ;;\n';

export default class ZshCompWithSpaces extends CompletionScriptBase {
	generate(): string {
		const firstArgs: { id: string; summary: string }[] = [];

		for (const t of this.topics) {
			if (!t.name.includes(":"))
				firstArgs.push({
					id: t.name,
					summary: t.description,
				});
		}

		for (const c of this.commands) {
			if (!firstArgs.some((a) => a.id === c.id) && !c.id.includes(":"))
				firstArgs.push({
					id: c.id,
					summary: c.summary,
				});
		}

		const mainArgsCaseBlock = (): string => {
			let caseBlock = "case $line[1] in\n";

			for (const arg of firstArgs) {
				if (this.coTopics.includes(arg.id)) {
					caseBlock += `${arg.id})\n  _${this.config.bin}_${arg.id}\n  ;;\n`;
				} else {
					const cmd = this.commands.find((c) => c.id === arg.id);
					if (cmd) {
						if (Object.keys(cmd.flags).length > 0) {
							caseBlock += `${arg.id})\n${this.genZshFlagArgumentsBlock(cmd.flags)} ;; \n`;
						}
					} else {
						caseBlock += `${arg.id})\n  _${this.config.bin}_${arg.id}\n  ;;\n`;
					}
				}
			}

			caseBlock += `*)\n  _${this.config.bin}_dynamic \${words[@]:1}\n  ;;\n`;
			caseBlock += "esac\n";
			return caseBlock;
		};

		return `#compdef ${this.config.bin}
${this.config.binAliases?.map((a) => `compdef ${a}=${this.config.bin}`).join("\n") ?? ""}

# Dynamic completion helper - calls ${this.config.bin} autocomplete generate for kit/cookbook/recipe completion
# Output format: "name\tdescription" or just "name" per line
_${this.config.bin}_dynamic() {
  local -a completions
  local output
  output=$(${this.config.bin} autocomplete generate -- "$@" 2>/dev/null)
  if [[ -n "$output" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      # Convert "name\tdescription" to "name:description" for _describe
      if [[ "$line" == *$'\t'* ]]; then
        local name="\${line%%	*}"
        local desc="\${line#*	}"
        completions+=("\${name}:\${desc}")
      else
        completions+=("\${line}")
      fi
    done <<< "$output"
    _describe "completions" completions
    return 0
  fi
  return 1
}

${this.topics.map((t) => this.genZshTopicCompFun(t.name)).join("\n")}

_${this.config.bin}() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C "1: :->cmds" "*::arg:->args"

  case "$state" in
    cmds)
      ${this.genZshValuesBlock(firstArgs)}
      _${this.config.bin}_dynamic \${words[@]:1}
    ;;
    args)
      ${mainArgsCaseBlock()}
    ;;
  esac
}

_${this.config.bin}
`;
	}

	genZshFlagArgumentsBlock(
		flags: Record<string, FlagCompletion> | undefined,
		options?: { skipFiles?: boolean },
	): string {
		if (!flags) {
			const filesSpec = options?.skipFiles ? "" : ' "*: :_files';
			return `_arguments -S \\\n --help"[Show help for command]"${filesSpec}`;
		}

		const flagNames = Object.keys(flags);
		let argumentsBlock = "_arguments -S \\\n";

		for (const flagName of flagNames) {
			const f = flags[flagName];

			if (f.hidden) continue;

			const flagSummary = this.sanitizeSummary(f.summary ?? f.description);
			let flagSpec = "";

			if (f.type === "option") {
				if (f.char) {
					if (f.multiple) {
						flagSpec += `"*"{-${f.char},--${f.name}}`;
					} else {
						flagSpec += `"(-${f.char} --${f.name})"{-${f.char},--${f.name}}`;
					}

					flagSpec += `"[${flagSummary}]`;
					flagSpec += f.options ? `:${f.name} options:(${f.options?.join(" ")})"` : ':file:_files"';
				} else {
					if (f.multiple) {
						flagSpec += '"*"';
					}

					flagSpec += `--${f.name}"[${flagSummary}]:`;
					flagSpec += f.options ? `${f.name} options:(${f.options.join(" ")})"` : 'file:_files"';
				}
			} else if (f.char) {
				flagSpec += `"(-${f.char} --${f.name})"{-${f.char},--${f.name}}"[${flagSummary}]"`;
			} else {
				flagSpec += `--${f.name}"[${flagSummary}]"`;
			}

			flagSpec += " \\\n";
			argumentsBlock += flagSpec;
		}

		argumentsBlock += '--help"[Show help for command]"';
		if (!options?.skipFiles) {
			argumentsBlock += ' \\\n"*: :_files"';
		}

		return argumentsBlock;
	}

	genZshTopicCompFun(id: string): string {
		const coTopics: string[] = [];
		for (const topic of this.topics) {
			for (const cmd of this.commands) {
				if (topic.name === cmd.id) {
					coTopics.push(topic.name);
				}
			}
		}

		const flagArgsTemplate = '        "%s")\n          %s\n        ;;\n';
		const dynamicBin = `_${this.config.bin}_dynamic`;
		const underscoreSepId = id.replaceAll(":", "_");
		const depth = id.split(":").length;
		const isCotopic = coTopics.includes(id);

		if (isCotopic) {
			const compFuncName = `${this.config.bin}_${underscoreSepId}`;
			const coTopicCompFunc = `_${compFuncName}() {
  _${compFuncName}_flags() {
    local context state state_descr line
    typeset -A opt_args

    ${this.genZshFlagArgumentsBlock(this.commands.find((c) => c.id === id)?.flags)}
  }

  local context state state_descr line
  typeset -A opt_args

  _arguments -C "1: :->cmds" "*: :->args"

  case "$state" in
    cmds)
      if [[ "\${words[CURRENT]}" == -* ]]; then
        _${compFuncName}_flags
      else
%s
      fi
      ;;
    args)
      case $line[1] in
%s
      *)
        _${compFuncName}_flags
        _${this.config.bin}_dynamic ${id.replaceAll(":", " ")} $line[1] \${words[CURRENT]}
      ;;
      esac
      ;;
  esac
}
`;
			const subArgs: { id: string; summary: string }[] = [];
			let argsBlock = "";

			for (const t of this.topics.filter(
				(t) => t.name.startsWith(`${id}:`) && t.name.split(":").length === depth + 1,
			)) {
				const subArg = t.name.split(":")[depth];
				subArgs.push({
					id: subArg,
					summary: t.description,
				});
				argsBlock += format(
					argTemplate,
					subArg,
					`_${this.config.bin}_${underscoreSepId}_${subArg}`,
				);
			}

			for (const c of this.commands.filter(
				(c) => c.id.startsWith(`${id}:`) && c.id.split(":").length === depth + 1,
			)) {
				if (coTopics.includes(c.id)) continue;
				const subArg = c.id.split(":")[depth];
				subArgs.push({
					id: subArg,
					summary: c.summary,
				});
				const flagsBlock = this.genZshFlagArgumentsBlock(c.flags, { skipFiles: true });
				const dynamicCall = `${dynamicBin} ${id.replaceAll(":", " ")} ${subArg} \${words[CURRENT]}`;
				argsBlock += format(flagArgsTemplate, subArg, `${flagsBlock}\n          ${dynamicCall}`);
			}

			return format(coTopicCompFunc, this.genZshValuesBlock(subArgs), argsBlock);
		}

		let argsBlock = "";
		const subArgs: { id: string; summary: string }[] = [];

		for (const t of this.topics.filter(
			(t) => t.name.startsWith(`${id}:`) && t.name.split(":").length === depth + 1,
		)) {
			const subArg = t.name.split(":")[depth];
			subArgs.push({
				id: subArg,
				summary: t.description,
			});
			argsBlock += format(argTemplate, subArg, `_${this.config.bin}_${underscoreSepId}_${subArg}`);
		}

		for (const c of this.commands.filter(
			(c) => c.id.startsWith(`${id}:`) && c.id.split(":").length === depth + 1,
		)) {
			if (coTopics.includes(c.id)) continue;
			const subArg = c.id.split(":")[depth];
			subArgs.push({
				id: subArg,
				summary: c.summary,
			});
			const flagsBlock = this.genZshFlagArgumentsBlock(c.flags, { skipFiles: true });
			const dynamicCall = `${dynamicBin} ${id.replaceAll(":", " ")} ${subArg} \${words[CURRENT]}`;
			argsBlock += format(flagArgsTemplate, subArg, `${flagsBlock}\n          ${dynamicCall}`);
		}

		const topicCompFunc = `_${this.config.bin}_${underscoreSepId}() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C "1: :->cmds" "*::arg:->args"

  case "$state" in
    cmds)
%s
      _${this.config.bin}_dynamic ${id.replaceAll(":", " ")} \${words[CURRENT]}
      ;;
    args)
      case $line[1] in
%s
      *)
        _${this.config.bin}_dynamic ${id.replaceAll(":", " ")} $line[1] \${words[CURRENT]}
      ;;
      esac
      ;;
  esac
}
`;

		return format(topicCompFunc, this.genZshValuesBlock(subArgs), argsBlock);
	}

	genZshValuesBlock(subArgs: { id: string; summary: string }[]): string {
		let valuesBlock = '_values "completions" \\\n';
		for (const subArg of subArgs) {
			valuesBlock += `"${subArg.id}[${subArg.summary}]" \\\n`;
		}

		return valuesBlock;
	}

	sanitizeSummary(summary: string | undefined): string {
		if (summary === undefined) {
			return "";
		}

		return summary
			.replace(/<%= config\.bin %>/g, this.config.bin)
			.replaceAll(/(["`])/g, "\\\\\\$1")
			.replaceAll(/([[\]])/g, "\\\\$1")
			.split("\n")[0];
	}
}
