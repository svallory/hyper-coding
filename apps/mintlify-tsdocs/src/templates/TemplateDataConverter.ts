// Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ApiItem, ApiItemKind, ApiClass, ApiInterface, ApiEnum, ApiFunction, ApiMethod, ApiProperty, ApiPackage, ApiNamespace, ApiTypeAlias, ApiVariable, ApiEnumMember, ReleaseTag, ApiReleaseTagMixin, ApiDeclaredItem, ApiOptionalMixin, ApiStaticMixin, ApiAbstractMixin, ApiProtectedMixin, ApiReadonlyMixin, ApiInitializerMixin, ApiDocumentedItem } from '@microsoft/api-extractor-model';
import { DocSection, DocPlainText, DocParagraph } from '@microsoft/tsdoc';

import { ITemplateData, ITableData, ITableRow, IReturnData } from './TemplateEngine';
import { DocumentationHelper } from '../utils/DocumentationHelper';
import { Utilities } from '../utils/Utilities';

/**
 * Converts API model data to template-friendly format
 */
export class TemplateDataConverter {
  private readonly _documentationHelper: DocumentationHelper;

  public constructor() {
    this._documentationHelper = new DocumentationHelper();
  }

  /**
   * Convert an API item to template data
   */
  public convertApiItem(apiItem: ApiItem, options: {
    pageTitle: string;
    pageDescription: string;
    pageIcon: string;
    breadcrumb: Array<{ name: string; path?: string }>;
    navigation?: { id: string; title: string; group?: string };
    getLinkFilenameForApiItem: (apiItem: ApiItem) => string | undefined;
  }): ITemplateData {
    const baseData: ITemplateData = {
      apiItem: {
        name: apiItem.displayName,
        kind: apiItem.kind,
        displayName: apiItem.displayName,
        description: this._getDescription(apiItem),
        summary: this._getSummary(apiItem),
        remarks: this._getRemarks(apiItem),
        signature: this._getSignature(apiItem),
        isDeprecated: this._isDeprecated(apiItem),
        isAlpha: this._isAlpha(apiItem),
        isBeta: this._isBeta(apiItem),
        releaseTag: this._getReleaseTag(apiItem)
      },
      page: {
        title: options.pageTitle,
        description: options.pageDescription,
        icon: options.pageIcon,
        breadcrumb: options.breadcrumb
      },
      navigation: options.navigation,
      examples: this._getExamples(apiItem),
      heritageTypes: this._getHeritageTypes(apiItem, options.getLinkFilenameForApiItem)
    };

    // Add type-specific data
    switch (apiItem.kind) {
      case ApiItemKind.Class:
        return this._addClassData(baseData, apiItem as ApiClass, options.getLinkFilenameForApiItem);
      case ApiItemKind.Interface:
        return this._addInterfaceData(baseData, apiItem as ApiInterface, options.getLinkFilenameForApiItem);
      case ApiItemKind.Enum:
        return this._addEnumData(baseData, apiItem as ApiEnum, options.getLinkFilenameForApiItem);
      case ApiItemKind.Function:
        return this._addFunctionData(baseData, apiItem as ApiFunction, options.getLinkFilenameForApiItem);
      case ApiItemKind.Method:
      case ApiItemKind.Constructor:
        return this._addMethodData(baseData, apiItem as ApiMethod, options.getLinkFilenameForApiItem);
      case ApiItemKind.Package:
        return this._addPackageData(baseData, apiItem as ApiPackage, options.getLinkFilenameForApiItem);
      case ApiItemKind.Namespace:
        return this._addNamespaceData(baseData, apiItem as ApiNamespace, options.getLinkFilenameForApiItem);
      case ApiItemKind.TypeAlias:
        return this._addTypeAliasData(baseData, apiItem as ApiTypeAlias, options.getLinkFilenameForApiItem);
      case ApiItemKind.Variable:
        return this._addVariableData(baseData, apiItem as ApiVariable, options.getLinkFilenameForApiItem);
      default:
        return baseData;
    }
  }

  private _addClassData(data: ITemplateData, apiClass: ApiClass, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    data.constructors = this._createTableRows(apiClass.members.filter(m => m.kind === ApiItemKind.Constructor), getLinkFilename);
    data.properties = this._createTableRows(apiClass.members.filter(m => m.kind === ApiItemKind.Property), getLinkFilename);
    data.methods = this._createTableRows(apiClass.members.filter(m => m.kind === ApiItemKind.Method), getLinkFilename);
    data.events = this._createTableRows(apiClass.members.filter(m => m.kind === ApiItemKind.Property && this._isEvent(m as ApiProperty)), getLinkFilename);
    return data;
  }

  private _addInterfaceData(data: ITemplateData, apiInterface: ApiInterface, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    data.properties = this._createTableRows(apiInterface.members.filter(m => m.kind === ApiItemKind.Property), getLinkFilename);
    data.methods = this._createTableRows(apiInterface.members.filter(m => m.kind === ApiItemKind.Method), getLinkFilename);
    data.events = this._createTableRows(apiInterface.members.filter(m => m.kind === ApiItemKind.Property && this._isEvent(m as ApiProperty)), getLinkFilename);
    return data;
  }

  private _addEnumData(data: ITemplateData, apiEnum: ApiEnum, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    data.members = this._createTableRows(Array.from(apiEnum.members), getLinkFilename);
    return data;
  }

  private _addFunctionData(data: ITemplateData, apiFunction: ApiFunction, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    data.parameters = this._createParameterRows(apiFunction, getLinkFilename);
    data.returnType = this._createReturnData(apiFunction);
    return data;
  }

  private _addMethodData(data: ITemplateData, apiMethod: ApiMethod, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    data.parameters = this._createParameterRows(apiMethod, getLinkFilename);
    data.returnType = this._createReturnData(apiMethod);
    return data;
  }

  private _addPackageData(data: ITemplateData, apiPackage: ApiPackage, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    const members = Array.from(apiPackage.members);
    data.abstractClasses = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Class && ApiAbstractMixin.isBaseClassOf(m as ApiClass)), getLinkFilename);
    data.classes = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Class && !ApiAbstractMixin.isBaseClassOf(m as ApiClass)), getLinkFilename);
    data.enumerations = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Enum), getLinkFilename);
    data.functions = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Function), getLinkFilename);
    data.interfaces = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Interface), getLinkFilename);
    data.namespaces = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Namespace), getLinkFilename);
    data.typeAliases = this._createTableRows(members.filter(m => m.kind === ApiItemKind.TypeAlias), getLinkFilename);
    data.variables = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Variable), getLinkFilename);
    return data;
  }

  private _addNamespaceData(data: ITemplateData, apiNamespace: ApiNamespace, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    const members = Array.from(apiNamespace.members);
    data.abstractClasses = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Class && ApiAbstractMixin.isBaseClassOf(m as ApiClass)), getLinkFilename);
    data.classes = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Class && !ApiAbstractMixin.isBaseClassOf(m as ApiClass)), getLinkFilename);
    data.enumerations = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Enum), getLinkFilename);
    data.functions = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Function), getLinkFilename);
    data.interfaces = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Interface), getLinkFilename);
    data.namespaces = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Namespace), getLinkFilename);
    data.typeAliases = this._createTableRows(members.filter(m => m.kind === ApiItemKind.TypeAlias), getLinkFilename);
    data.variables = this._createTableRows(members.filter(m => m.kind === ApiItemKind.Variable), getLinkFilename);
    return data;
  }

  private _addTypeAliasData(data: ITemplateData, apiTypeAlias: ApiTypeAlias, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    // Type alias specific data can be added here
    return data;
  }

  private _addVariableData(data: ITemplateData, apiVariable: ApiVariable, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITemplateData {
    // Variable specific data can be added here
    return data;
  }

  private _createTableRows(apiItems: ApiItem[], getLinkFilename: (apiItem: ApiItem) => string | undefined): ITableRow[] {
    return apiItems.map(apiItem => ({
      title: apiItem.displayName,
      titlePath: getLinkFilename(apiItem),
      modifiers: this._getModifiers(apiItem),
      type: this._getTypeDisplay(apiItem),
      typePath: this._getTypePath(apiItem, getLinkFilename),
      description: this._getDescription(apiItem),
      isOptional: this._isOptional(apiItem),
      isInherited: this._isInherited(apiItem),
      isDeprecated: this._isDeprecated(apiItem),
      defaultValue: this._getDefaultValue(apiItem)
    }));
  }

  private _createParameterRows(apiFunction: ApiFunction | ApiMethod, getLinkFilename: (apiItem: ApiItem) => string | undefined): ITableRow[] {
    const parameters = apiFunction.parameters;
    return parameters.map(param => {
      // Get parameter-specific description from TSDoc
      let description = '';
      if (apiFunction instanceof ApiDocumentedItem && apiFunction.tsdocComment) {
        const params = apiFunction.tsdocComment.params;
        if (params) {
          for (const paramBlock of params) {
            if (paramBlock.parameterName === param.name) {
              description = this._getTextFromDocSection(paramBlock.content);
              break;
            }
          }
        }
      }

      return {
        title: param.name,
        type: param.parameterTypeExcerpt.text,
        typePath: undefined, // Could be enhanced with type linking
        description: description,
        isOptional: param.isOptional
      };
    });
  }

  private _createReturnData(apiFunction: ApiFunction | ApiMethod): IReturnData {
    const returnType = apiFunction.returnTypeExcerpt?.text || 'void';
    const description = this._getDescription(apiFunction); // Could extract @returns specifically

    return {
      type: returnType,
      description
    };
  }


  private _getDescription(apiItem: ApiItem): string {
    // Extract description from TSDoc
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment = apiItem.tsdocComment;
      if (tsdocComment?.summarySection) {
        return this._getTextFromDocSection(tsdocComment.summarySection);
      }
    }
    return '';
  }

  private _getSummary(apiItem: ApiItem): string {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment = apiItem.tsdocComment;
      if (tsdocComment?.summarySection) {
        return this._getTextFromDocSection(tsdocComment.summarySection);
      }
    }
    return '';
  }

  private _getRemarks(apiItem: ApiItem): string {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment = apiItem.tsdocComment;
      if (tsdocComment?.remarksBlock) {
        return this._getTextFromDocSection(tsdocComment.remarksBlock.content);
      }
    }
    return '';
  }

  private _getExamples(apiItem: ApiItem): string[] {
    if (apiItem instanceof ApiDocumentedItem) {
      const tsdocComment = apiItem.tsdocComment;
      if (!tsdocComment?.customBlocks) return [];

      return tsdocComment.customBlocks
        .filter((block: any) => block.blockTag.tagName === '@example')
        .map((block: any) => this._getTextFromDocSection(block.content));
    }
    return [];
  }

  private _getSignature(apiItem: ApiItem): string {
    if (apiItem instanceof ApiDeclaredItem) {
      return apiItem.excerpt.text;
    }
    return '';
  }

  private _getHeritageTypes(apiItem: ApiItem, getLinkFilename: (apiItem: ApiItem) => string | undefined): Array<{ name: string; path?: string }> {
    // This would need to be implemented based on inheritance analysis
    return [];
  }

  private _getModifiers(apiItem: ApiItem): string[] {
    const modifiers: string[] = [];

    if (ApiStaticMixin.isBaseClassOf(apiItem) && apiItem.isStatic) {
      modifiers.push('static');
    }
    if (ApiAbstractMixin.isBaseClassOf(apiItem) && apiItem.isAbstract) {
      modifiers.push('abstract');
    }
    if (ApiProtectedMixin.isBaseClassOf(apiItem) && apiItem.isProtected) {
      modifiers.push('protected');
    }
    if (ApiReadonlyMixin.isBaseClassOf(apiItem) && apiItem.isReadonly) {
      modifiers.push('readonly');
    }

    return modifiers;
  }

  private _getTypeDisplay(apiItem: ApiItem): string {
    if (apiItem instanceof ApiDeclaredItem) {
      return apiItem.excerpt.text;
    }
    return '';
  }

  private _getTypePath(apiItem: ApiItem, getLinkFilename: (apiItem: ApiItem) => string | undefined): string | undefined {
    // Could be enhanced to link to type definitions
    return undefined;
  }

  private _isOptional(apiItem: ApiItem): boolean {
    return ApiOptionalMixin.isBaseClassOf(apiItem) && apiItem.isOptional;
  }

  private _isInherited(apiItem: ApiItem): boolean {
    // This would need to be implemented based on inheritance analysis
    return false;
  }

  private _isDeprecated(apiItem: ApiItem): boolean {
    return ApiReleaseTagMixin.isBaseClassOf(apiItem) && apiItem.releaseTag === ReleaseTag.Beta;
  }

  private _isAlpha(apiItem: ApiItem): boolean {
    return ApiReleaseTagMixin.isBaseClassOf(apiItem) && apiItem.releaseTag === ReleaseTag.Alpha;
  }

  private _isBeta(apiItem: ApiItem): boolean {
    return ApiReleaseTagMixin.isBaseClassOf(apiItem) && apiItem.releaseTag === ReleaseTag.Beta;
  }

  private _getReleaseTag(apiItem: ApiItem): string {
    if (ApiReleaseTagMixin.isBaseClassOf(apiItem)) {
      return ReleaseTag[apiItem.releaseTag];
    }
    return '';
  }

  private _getDefaultValue(apiItem: ApiItem): string {
    if (ApiInitializerMixin.isBaseClassOf(apiItem) && apiItem.initializerExcerpt) {
      return apiItem.initializerExcerpt.text;
    }
    return '';
  }

  private _isEvent(apiProperty: ApiProperty): boolean {
    // Simple heuristic - could be enhanced
    return apiProperty.name.startsWith('on') || apiProperty.name.endsWith('Event');
  }

  private _getTextFromDocSection(docSection: DocSection): string {
    // Convert DocSection to plain text
    // This is a simplified implementation
    let text = '';
    for (const node of docSection.getChildNodes()) {
      if (node instanceof DocPlainText) {
        text += node.text;
      } else if (node instanceof DocParagraph) {
        for (const child of node.getChildNodes()) {
          if (child instanceof DocPlainText) {
            text += child.text;
          }
        }
      }
    }
    return text;
  }
}