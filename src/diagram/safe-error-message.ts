import type { DiagramErrorCode } from '../types/ir.js';

/**
 * Returns a deterministic, sanitized user-facing error message for a DiagramErrorCode.
 * Prevents leaking raw internal parser errors, stack traces, paths, or secrets.
 */
export function getSafeDiagramErrorMessage(code: DiagramErrorCode): string {
  switch (code) {
    case 'mermaid-invalid-syntax':
      return 'Mermaid diagram syntax is invalid. Please verify syntax and structure.';
    case 'mermaid-render-timeout':
      return 'Mermaid diagram rendering timed out after 10000ms.';
    case 'mermaid-queue-full':
      return 'Mermaid diagram rendering queue capacity exceeded.';
    case 'mermaid-output-unsafe':
      return 'Mermaid diagram output rejected due to unsafe SVG attributes or external references.';
    case 'mermaid-empty-source':
      return 'Mermaid diagram source is empty.';
    case 'mermaid-cancelled':
      return 'Mermaid diagram rendering was cancelled.';
    case 'mermaid-service-disposed':
      return 'Diagram rendering service was disposed.';
    case 'mermaid-browser-not-found':
      return 'Compatible browser for Mermaid diagram rendering was not found.';
    case 'mermaid-invalid-browser-path':
      return 'Configured browser executable path is invalid or inaccessible.';
    case 'mermaid-invalid-svg':
      return 'Mermaid renderer produced invalid SVG XML structure.';
    case 'mermaid-render-failed':
    default:
      return 'Mermaid diagram rendering failed.';
  }
}
