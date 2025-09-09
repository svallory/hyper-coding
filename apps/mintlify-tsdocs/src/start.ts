// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as os from 'os';

import { PackageJsonLookup } from '@rushstack/node-core-library';
import { Colorize } from '@rushstack/terminal';

import { DocumenterCli } from './cli/ApiDocumenterCommandLine';

const myPackageVersion: string = PackageJsonLookup.loadOwnPackageJson(__dirname).version;

console.log(
  os.EOL +
    Colorize.bold(
      `mintlify-tsdocs ${myPackageVersion} ` + Colorize.cyan(' - https://api-extractor.com/') + os.EOL
    )
);

const parser: DocumenterCli = new DocumenterCli();

parser.executeAsync().catch(console.error); // CommandLineParser.executeAsync() should never reject the promise
