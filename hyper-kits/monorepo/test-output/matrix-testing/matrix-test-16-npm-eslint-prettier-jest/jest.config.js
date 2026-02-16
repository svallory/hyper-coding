module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	roots: ["<rootDir>/packages"],
	testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
	transform: {
		"^.+.ts$": "ts-jest",
	},
	collectCoverageFrom: ["packages/*/src/**/*.ts", "!packages/*/src/**/*.d.ts"],
};
