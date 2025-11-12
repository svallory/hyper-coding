// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import * as path from 'path';
import type * as tsdoc from '@microsoft/tsdoc';

import {
  CommandLineAction,
  type CommandLineStringParameter,
  type ICommandLineActionOptions
} from '@rushstack/ts-command-line';
import { FileSystem } from '@rushstack/node-core-library';
import {
  ApiModel,
  type ApiItem,
  ApiItemContainerMixin,
  ApiDocumentedItem,
  type IResolveDeclarationReferenceResult
} from '@microsoft/api-extractor-model';
import { Colorize } from '@rushstack/terminal';

import { SecurityUtils } from '../utils/SecurityUtils';
import { DocumentationError, ErrorCode, FileSystemError, ValidationError, ApiModelError } from '../errors/DocumentationError';
import { ErrorBoundary } from '../errors/ErrorBoundary';

export interface IBuildApiModelResult {
  apiModel: ApiModel;
  inputFolder: string;
  outputFolder: string;
}

export abstract class BaseAction extends CommandLineAction {
  private readonly _inputFolderParameter: CommandLineStringParameter;
  private readonly _outputFolderParameter: CommandLineStringParameter;

  protected constructor(options: ICommandLineActionOptions) {
    super(options);

    this._inputFolderParameter = this.defineStringParameter({
      parameterLongName: '--input-folder',
      parameterShortName: '-i',
      argumentName: 'FOLDER1',
      description:
        `Specifies the input folder containing the *.api.json files to be processed.` +
        ` If omitted, the default is "./input"`
    });

    this._outputFolderParameter = this.defineStringParameter({
      parameterLongName: '--output-folder',
      parameterShortName: '-o',
      argumentName: 'FOLDER2',
      description:
        `Specifies the output folder where the documentation will be written.` +
        ` ANY EXISTING CONTENTS WILL BE DELETED!` +
        ` If omitted, the default is "./${this.actionName}"`
    });
  }

  protected buildApiModel(): IBuildApiModelResult {
    const errorBoundary = new ErrorBoundary({
      continueOnError: false, // Fail fast for critical setup operations
      logErrors: true
    });

    const result = errorBoundary.executeSync(() => {
      const apiModel: ApiModel = new ApiModel();

      // Validate and sanitize input folder parameter
      const inputFolderParam = this._inputFolderParameter.value || './input';
      const inputFolder = SecurityUtils.validateCliInput(inputFolderParam, 'Input folder');

      if (!FileSystem.exists(inputFolder)) {
        throw new FileSystemError(
          `The input folder does not exist: ${inputFolder}`,
          ErrorCode.DIRECTORY_NOT_FOUND,
          { resource: inputFolder, operation: 'validateInputFolder' }
        );
      }

      // Validate and sanitize output folder parameter
      const outputFolderParam = this._outputFolderParameter.value || `./${this.actionName}`;
      const outputFolder = SecurityUtils.validateCliInput(outputFolderParam, 'Output folder');

      // Resolve to absolute path (allow parent directories in monorepo context)
      const validatedOutputFolder = path.resolve(process.cwd(), outputFolder);

      // Ensure output folder exists
      try {
        FileSystem.ensureFolder(validatedOutputFolder);
      } catch (error) {
        throw new FileSystemError(
          `Failed to create output folder: ${validatedOutputFolder}`,
          ErrorCode.FILE_WRITE_ERROR,
          { resource: validatedOutputFolder, operation: 'createOutputFolder', cause: error instanceof Error ? error : new Error(String(error)) }
        );
      }

      // Process API files with security validation
      const apiFiles = FileSystem.readFolderItemNames(inputFolder);

      for (const filename of apiFiles) {
        // Validate filename before processing
        if (!filename.match(/\.api\.json$/i)) {
          continue; // Skip non-API files
        }

        try {
          // Validate filename to prevent path traversal
          const safeFilename = SecurityUtils.validateFilename(filename);

          // Validate the full file path
          const filenamePath = SecurityUtils.validateFilePath(inputFolder, safeFilename);

          console.log(`Reading ${safeFilename}`);

          // Validate JSON content before loading
          const fileContent = FileSystem.readFile(filenamePath);
          SecurityUtils.validateJsonContent(fileContent);

          apiModel.loadPackage(filenamePath);
        } catch (error) {
          throw new ApiModelError(
            `Failed to load API package from ${filename}`,
            ErrorCode.API_LOAD_ERROR,
            {
              resource: filename,
              operation: 'loadApiPackage',
              cause: error instanceof Error ? error : new Error(String(error)),
              suggestion: 'Ensure the .api.json file is valid and not corrupted'
            }
          );
        }
      }

      if (apiFiles.filter(f => f.match(/\.api\.json$/i)).length === 0) {
        throw new ValidationError(
          'No .api.json files found in input folder',
          { resource: inputFolder, operation: 'findApiFiles' }
        );
      }

      // Apply inherit doc with error handling
      this._applyInheritDoc(apiModel, apiModel);

      return { apiModel, inputFolder, outputFolder: validatedOutputFolder };
    });

    if (!result.success) {
      // Re-throw the error with full context
      throw result.error || new DocumentationError(
        'Unknown error occurred during API model building',
        ErrorCode.UNKNOWN_ERROR
      );
    }

    return result.data!;
  }

  // TODO: This is a temporary workaround.  The long term plan is for API Extractor's DocCommentEnhancer
  // to apply all @inheritDoc tags before the .api.json file is written.
  // See DocCommentEnhancer._applyInheritDoc() for more info.
  private _applyInheritDoc(apiItem: ApiItem, apiModel: ApiModel): void {
    if (apiItem instanceof ApiDocumentedItem) {
      if (apiItem.tsdocComment) {
        const inheritDocTag: tsdoc.DocInheritDocTag | undefined = apiItem.tsdocComment.inheritDocTag;

        if (inheritDocTag && inheritDocTag.declarationReference) {
          // Attempt to resolve the declaration reference
          const result: IResolveDeclarationReferenceResult = apiModel.resolveDeclarationReference(
            inheritDocTag.declarationReference,
            apiItem
          );

          if (result.errorMessage) {
            console.log(
              Colorize.yellow(
                `Warning: Unresolved @inheritDoc tag for ${apiItem.displayName}: ` + result.errorMessage
              )
            );
          } else {
            if (
              result.resolvedApiItem instanceof ApiDocumentedItem &&
              result.resolvedApiItem.tsdocComment &&
              result.resolvedApiItem !== apiItem
            ) {
              this._copyInheritedDocs(apiItem.tsdocComment, result.resolvedApiItem.tsdocComment);
            }
          }
        }
      }
    }

    // Recurse members
    if (ApiItemContainerMixin.isBaseClassOf(apiItem)) {
      for (const member of apiItem.members) {
        this._applyInheritDoc(member, apiModel);
      }
    }
  }

  /**
   * Copy the content from `sourceDocComment` to `targetDocComment`.
   * This code is borrowed from DocCommentEnhancer as a temporary workaround.
   */
  private _copyInheritedDocs(targetDocComment: tsdoc.DocComment, sourceDocComment: tsdoc.DocComment): void {
    targetDocComment.summarySection = sourceDocComment.summarySection;
    targetDocComment.remarksBlock = sourceDocComment.remarksBlock;

    targetDocComment.params.clear();
    for (const param of sourceDocComment.params) {
      targetDocComment.params.add(param);
    }
    for (const typeParam of sourceDocComment.typeParams) {
      targetDocComment.typeParams.add(typeParam);
    }
    targetDocComment.returnsBlock = sourceDocComment.returnsBlock;

    targetDocComment.inheritDocTag = undefined;
  }
}
