import chalk from "chalk";

export const styles = {
	command: (text: string): string => chalk.hex("4EC9B0")(text),
	danger: (text: string): string => chalk.hex("F67280")(text),
};
