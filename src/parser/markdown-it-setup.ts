import MarkdownIt from 'markdown-it';
import { slideContainerPlugin } from './slide-container-plugin.js';

export function createSlideMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    breaks: false,
    linkify: true,
  });

  md.use(slideContainerPlugin);

  return md;
}
