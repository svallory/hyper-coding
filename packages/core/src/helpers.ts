import changeCase from 'change-case';
import inflection from 'inflection';

// supports kebab-case to KebabCase
const undasherize = (str: string): string =>
	str
		.split(/[-_]/)
		.map((w: string) => w[0].toUpperCase() + w.slice(1).toLowerCase())
		.join('');

const helpers = {
	capitalize(str: any): string {
		const toBeCapitalized = String(str);
		return toBeCapitalized.charAt(0).toUpperCase() + toBeCapitalized.slice(1);
	},
	inflection: {
		...inflection,
		undasherize,
	},
	changeCase,
};

export default helpers;
