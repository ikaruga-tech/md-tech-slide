declare module 'markdown-it-container' {
  import type MarkdownIt from 'markdown-it';

  export interface ContainerOptions {
    validate?: (params: string) => boolean;
    render?: (
      tokens: { info: string; nesting: number }[],
      index: number,
      options: unknown,
      env: unknown,
      self: unknown
    ) => string;
    marker?: string;
  }

  export default function containerPlugin(
    md: MarkdownIt,
    name: string,
    options?: ContainerOptions
  ): void;
}
