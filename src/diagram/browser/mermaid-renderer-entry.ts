import mermaid from 'mermaid';

export interface RenderResult {
  readonly svg: string;
}

export async function renderDiagram(
  id: string,
  text: string,
  theme: 'light' | 'dark' = 'light'
): Promise<RenderResult> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  });
  const result = await mermaid.render(id, text);
  return {
    svg: result.svg,
  };
}

(
  window as unknown as {
    __mermaidRenderer: { renderDiagram: typeof renderDiagram };
  }
).__mermaidRenderer = {
  renderDiagram,
};
