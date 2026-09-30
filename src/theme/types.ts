export interface ColorPalette {
  readonly background: string;
  readonly title: string;
  readonly text: string;
  readonly muted: string;
  readonly codeBackground: string;
  readonly codeText: string;
  readonly accent: string;
}

export interface FontSettings {
  readonly heading: string;
  readonly body: string;
  readonly code: string;
}

export interface SlideTheme {
  readonly name: string;
  readonly colors: ColorPalette;
  readonly fonts: FontSettings;
  readonly shikiTheme: string;
}
