# Changelog

## [0.2.1](https://github.com/svallory/hyper-coding/compare/v0.2.0...v0.2.1) (2026-03-24)


### Features

* add terminal UI enhancements (markdown, diffs, fx viewer) ([b210848](https://github.com/svallory/hyper-coding/commit/b210848dcbf5dfae5d054cc6fb361251ad0e4ff1))
* **cli:** add custom markdown-based help system ([7a71d00](https://github.com/svallory/hyper-coding/commit/7a71d0060bc903214edd63354ee7dfbacdf73b8f))
* **cli:** add oclif topic descriptions and manifest generation ([4a2c634](https://github.com/svallory/hyper-coding/commit/4a2c634a6aecf1101bc7a2d42b84fcacda214d12))
* finish cli desing system ([229ecc1](https://github.com/svallory/hyper-coding/commit/229ecc1153267596718fb1a1ca60ea2c45c0f9b8))
* **gen:** add --ask=stdout for 2-pass generation ([21f6f40](https://github.com/svallory/hyper-coding/commit/21f6f405ada5584a53419eda56a67a49de1a9357))
* **gen:** coerce CLI flag values to native types ([de78175](https://github.com/svallory/hyper-coding/commit/de7817525899d3433a183af5e3cf938f5991ca3e))
* **gen:** include recipe variables as questions in AI prompt document ([67e9e8f](https://github.com/svallory/hyper-coding/commit/67e9e8fd812484dda1f3d4e35455e807be46c283))
* **gen:** intercept '&lt;topic&gt; help' in command_not_found hook ([5df1a72](https://github.com/svallory/hyper-coding/commit/5df1a72d1be33089c339c5016f091d28050f0166))
* **hq:** add @hypercli/hq — Claude Code session management plugin ([#5](https://github.com/svallory/hyper-coding/issues/5)) ([23de847](https://github.com/svallory/hyper-coding/commit/23de847738848967cc6d7d0b31533bd341c0d164))
* **hq:** rewrite Telegram to use channels plugin, bump to v0.2.0 ([#11](https://github.com/svallory/hyper-coding/issues/11)) ([24e046b](https://github.com/svallory/hyper-coding/commit/24e046b2cef30266154faf3184599a719b315911))
* **kit:** add browse commands for kits, cookbooks, and recipes ([fc41ff9](https://github.com/svallory/hyper-coding/commit/fc41ff94d59023e69d04b16027295e5fe1e7f26a))
* **kit:** add browse commands for kits, cookbooks, and recipes ([24ba56b](https://github.com/svallory/hyper-coding/commit/24ba56be4ab757b9a003960ad8564d29aab4e557))


### Bug Fixes

* **build:** disable moon routeOutDirToCache and set outDir to ./dist ([493550b](https://github.com/svallory/hyper-coding/commit/493550bbc5910c7171702daee31203af89494a0c))
* **cookbook:** fix layout of cookbook list output ([0818711](https://github.com/svallory/hyper-coding/commit/0818711976416c7ecac30e37398d3c165fee1beb))
* **gen:** allow recipe variables as --key=value flags ([b664353](https://github.com/svallory/hyper-coding/commit/b6643537c6bec2e2af95991a47d09402ed3142df))
* **gen:** handle unknown commands gracefully with friendly suggestions ([b4ced89](https://github.com/svallory/hyper-coding/commit/b4ced89842ee3e4fe00d565724d69ce41d3d7064))
* **gen:** improve error message formatting ([4cfc215](https://github.com/svallory/hyper-coding/commit/4cfc2150dab13569de8b87e9980a26cf6adb2edf))
* **gen:** improve file conflict handling and suppress output during collect mode ([0deea47](https://github.com/svallory/hyper-coding/commit/0deea47bbf6e980fedc0cf211485a876a9f2ce12))
* handle EPIPE error when writing to child process stdin ([efb18d2](https://github.com/svallory/hyper-coding/commit/efb18d27a89bd6021e6b9b8121ff37bfeed9f9b1))
* lint and typecheck issues ([53340dc](https://github.com/svallory/hyper-coding/commit/53340dca4e21b2adc4e6ee9b2c2ba34117447a8a))
* **moon:** fix task configuration for v2.0.0-rc.3 compatibility ([cb24252](https://github.com/svallory/hyper-coding/commit/cb2425267189f1f5d7212a4e38890182b240dc7a))
* project root resolution ([18105b8](https://github.com/svallory/hyper-coding/commit/18105b8f6d457e2b5e27cc24e209cb1a322e13f0))
* several issues in monorepo kit ([f6ebb43](https://github.com/svallory/hyper-coding/commit/f6ebb436293cad8935010ca5609c3d3d32e35d81))
* two minor issues with tests ([4fa386d](https://github.com/svallory/hyper-coding/commit/4fa386d8960aa1e8a537354b5f899a54d1dd875d))
* **vitest:** add archive and test-output exclusions to base coverage config ([7ca2846](https://github.com/svallory/hyper-coding/commit/7ca2846e15c085f0d75b8fa4c05af972a9d2bcc0))
* **vitest:** clean up root config and remove dead alias patterns ([7ca2846](https://github.com/svallory/hyper-coding/commit/7ca2846e15c085f0d75b8fa4c05af972a9d2bcc0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @hypercli/core bumped to 0.2.1
    * @hypercli/kit bumped to 0.2.1
    * @hypercli/ui bumped to 0.2.1

## [0.1.1](https://github.com/svallory/hyper-coding/compare/v0.1.0...v0.1.1) (2026-03-23)


### Features

* add terminal UI enhancements (markdown, diffs, fx viewer) ([b210848](https://github.com/svallory/hyper-coding/commit/b210848dcbf5dfae5d054cc6fb361251ad0e4ff1))
* **cli:** add custom markdown-based help system ([7a71d00](https://github.com/svallory/hyper-coding/commit/7a71d0060bc903214edd63354ee7dfbacdf73b8f))
* **cli:** add oclif topic descriptions and manifest generation ([4a2c634](https://github.com/svallory/hyper-coding/commit/4a2c634a6aecf1101bc7a2d42b84fcacda214d12))
* finish cli desing system ([229ecc1](https://github.com/svallory/hyper-coding/commit/229ecc1153267596718fb1a1ca60ea2c45c0f9b8))
* **gen:** add --ask=stdout for 2-pass generation ([21f6f40](https://github.com/svallory/hyper-coding/commit/21f6f405ada5584a53419eda56a67a49de1a9357))
* **gen:** coerce CLI flag values to native types ([de78175](https://github.com/svallory/hyper-coding/commit/de7817525899d3433a183af5e3cf938f5991ca3e))
* **gen:** include recipe variables as questions in AI prompt document ([67e9e8f](https://github.com/svallory/hyper-coding/commit/67e9e8fd812484dda1f3d4e35455e807be46c283))
* **gen:** intercept '&lt;topic&gt; help' in command_not_found hook ([5df1a72](https://github.com/svallory/hyper-coding/commit/5df1a72d1be33089c339c5016f091d28050f0166))
* **hq:** add @hypercli/hq — Claude Code session management plugin ([#5](https://github.com/svallory/hyper-coding/issues/5)) ([23de847](https://github.com/svallory/hyper-coding/commit/23de847738848967cc6d7d0b31533bd341c0d164))
* **kit:** add browse commands for kits, cookbooks, and recipes ([fc41ff9](https://github.com/svallory/hyper-coding/commit/fc41ff94d59023e69d04b16027295e5fe1e7f26a))
* **kit:** add browse commands for kits, cookbooks, and recipes ([24ba56b](https://github.com/svallory/hyper-coding/commit/24ba56be4ab757b9a003960ad8564d29aab4e557))


### Bug Fixes

* **build:** disable moon routeOutDirToCache and set outDir to ./dist ([493550b](https://github.com/svallory/hyper-coding/commit/493550bbc5910c7171702daee31203af89494a0c))
* **cookbook:** fix layout of cookbook list output ([0818711](https://github.com/svallory/hyper-coding/commit/0818711976416c7ecac30e37398d3c165fee1beb))
* **gen:** allow recipe variables as --key=value flags ([b664353](https://github.com/svallory/hyper-coding/commit/b6643537c6bec2e2af95991a47d09402ed3142df))
* **gen:** handle unknown commands gracefully with friendly suggestions ([b4ced89](https://github.com/svallory/hyper-coding/commit/b4ced89842ee3e4fe00d565724d69ce41d3d7064))
* **gen:** improve error message formatting ([4cfc215](https://github.com/svallory/hyper-coding/commit/4cfc2150dab13569de8b87e9980a26cf6adb2edf))
* **gen:** improve file conflict handling and suppress output during collect mode ([0deea47](https://github.com/svallory/hyper-coding/commit/0deea47bbf6e980fedc0cf211485a876a9f2ce12))
* handle EPIPE error when writing to child process stdin ([efb18d2](https://github.com/svallory/hyper-coding/commit/efb18d27a89bd6021e6b9b8121ff37bfeed9f9b1))
* lint and typecheck issues ([53340dc](https://github.com/svallory/hyper-coding/commit/53340dca4e21b2adc4e6ee9b2c2ba34117447a8a))
* **moon:** fix task configuration for v2.0.0-rc.3 compatibility ([cb24252](https://github.com/svallory/hyper-coding/commit/cb2425267189f1f5d7212a4e38890182b240dc7a))
* project root resolution ([18105b8](https://github.com/svallory/hyper-coding/commit/18105b8f6d457e2b5e27cc24e209cb1a322e13f0))
* several issues in monorepo kit ([f6ebb43](https://github.com/svallory/hyper-coding/commit/f6ebb436293cad8935010ca5609c3d3d32e35d81))
* two minor issues with tests ([4fa386d](https://github.com/svallory/hyper-coding/commit/4fa386d8960aa1e8a537354b5f899a54d1dd875d))
* **vitest:** add archive and test-output exclusions to base coverage config ([7ca2846](https://github.com/svallory/hyper-coding/commit/7ca2846e15c085f0d75b8fa4c05af972a9d2bcc0))
* **vitest:** clean up root config and remove dead alias patterns ([7ca2846](https://github.com/svallory/hyper-coding/commit/7ca2846e15c085f0d75b8fa4c05af972a9d2bcc0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @hypercli/core bumped to 0.1.1
    * @hypercli/kit bumped to 0.1.1
    * @hypercli/ui bumped to 0.1.1
