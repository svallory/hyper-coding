// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

export { TemplateEngine } from './TemplateEngine';
export type {
  ITemplateData,
  ITableData,
  ITableRow,
  IReturnData,
  ITemplateEngineOptions
} from './TemplateEngine';

// Template engines
export { LiquidTemplateEngine } from './LiquidTemplateEngine';

// Template managers
export { TemplateManager } from './TemplateManager';
export { LiquidTemplateManager } from './LiquidTemplateManager';
export type { ITemplateManagerOptions } from './TemplateManager';

// Data conversion
export { TemplateDataConverter } from './TemplateDataConverter';