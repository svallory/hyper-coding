import type { IconLibraryName } from "./icon-names.ts";

// The site has one icon library (see deviations: agent-stacks-icons/no-client-icon).
export function resolveIconLibrary(_requested?: string): IconLibraryName {
  return "lucide";
}
