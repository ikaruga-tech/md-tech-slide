export function splitSlides(content: string): readonly string[] {
  // 8連以上の#のみで構成される行をスライド区切りとする
  const slideDelimiterRegex = /^#{8,}\s*$/m;
  const rawSections = content.split(slideDelimiterRegex);

  const slides: string[] = [];
  for (const section of rawSections) {
    const trimmed = section.trim();
    if (trimmed.length > 0) {
      slides.push(trimmed);
    }
  }

  if (slides.length === 0) {
    return [''];
  }

  return slides;
}
