/**
 * TypeTree Component
 *
 * A recursive, expandable component for documenting complex type structures.
 * Works for TypeScript types, JSON schemas, API parameters, return types, or any structured data.
 *
 * Distributed with mintlify-tsdocs and automatically installed to docs/snippets/.
 *
 * @version 1.0.0
 */

import React, { useState } from 'react';

/**
 * TypeTree - Recursive expandable type documentation component
 *
 * @param {Object} props - Component properties
 * @param {string} props.name - Property/field name
 * @param {string} props.type - Type annotation (e.g., "string", "object", "Array<string>")
 * @param {string} [props.description] - Human-readable description
 * @param {boolean} [props.required=false] - Whether this field is required
 * @param {boolean} [props.deprecated=false] - Whether this field is deprecated
 * @param {Array<Object>} [props.properties=[]] - Nested properties for objects/arrays
 * @param {string} [props.defaultValue] - Default value if any
 * @param {number} [props.level=0] - Current nesting level (used internally)
 *
 * @example
 * <TypeTree
 *   name="config"
 *   type="object"
 *   description="Configuration settings"
 *   required={true}
 *   properties={[
 *     { name: "host", type: "string", description: "Database host", required: true },
 *     { name: "port", type: "number", description: "Port number", defaultValue: "5432" },
 *     {
 *       name: "ssl",
 *       type: "object",
 *       description: "SSL configuration",
 *       properties: [
 *         { name: "enabled", type: "boolean", required: true },
 *         { name: "cert", type: "string" }
 *       ]
 *     }
 *   ]}
 * />
 */
export const TypeTree = ({
  name,
  type,
  description,
  required = false,
  deprecated = false,
  properties = [],
  defaultValue,
  level = 0
}) => {
  // Auto-expand first two levels for better UX
  const [isOpen, setIsOpen] = useState(level < 2);
  const hasNested = properties && properties.length > 0;

  return (
    <div
      className="border-l-2 border-primary-500/20 dark:border-primary-400/20 pl-4 my-2"
      style={{ marginLeft: level > 0 ? '0' : undefined }}
    >
      {/* Main Property Row */}
      <div className="flex items-start gap-3">
        {/* Expand/Collapse Button */}
        {hasNested && (
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex-shrink-0 mt-1 p-0.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <svg
              className={`w-3 h-3 text-gray-600 dark:text-gray-400 transition-transform duration-200 ${
                isOpen ? 'rotate-90' : ''
              }`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}

        {/* Property Details */}
        <div className="flex-1 min-w-0">
          {/* Name, Type, and Badges */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <code className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100">
              {name}
            </code>

            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {type}
            </span>

            {required && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                required
              </span>
            )}

            {deprecated && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                deprecated
              </span>
            )}

            {!required && !deprecated && (
              <span className="text-xs text-gray-500 dark:text-gray-500">
                optional
              </span>
            )}
          </div>

          {/* Description */}
          {description && (
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-1">
              {description}
            </p>
          )}

          {/* Default Value */}
          {defaultValue !== undefined && defaultValue !== null && (
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              Default: <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{defaultValue}</code>
            </div>
          )}
        </div>
      </div>

      {/* Nested Properties */}
      {hasNested && isOpen && (
        <div className="mt-3 space-y-2">
          {properties.map((prop, idx) => (
            <TypeTree
              key={idx}
              {...prop}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * TypeTreeGroup - Wrapper for grouping multiple TypeTree components
 *
 * @param {Object} props - Component properties
 * @param {string} [props.title] - Optional group title
 * @param {React.ReactNode} props.children - TypeTree components
 *
 * @example
 * <TypeTreeGroup title="Parameters">
 *   <TypeTree name="id" type="string" required />
 *   <TypeTree name="name" type="string" />
 * </TypeTreeGroup>
 */
export const TypeTreeGroup = ({ title, children }) => {
  return (
    <div className="my-4">
      {title && (
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          {title}
        </h3>
      )}
      <div className="space-y-1 border-l-2 border-gray-200 dark:border-gray-700 pl-0">
        {children}
      </div>
    </div>
  );
};

export default TypeTree;
