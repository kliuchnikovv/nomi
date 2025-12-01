export const oneDarkPalette = {
  red: '#e06c75',
  yellow: '#e5c07b',
  green: '#98c379',
  cyan: '#56b6c2',
  blue: '#61afef',
  magenta: '#c678dd',
  black: '#282c34',
  white: '#abb2bf',
  gutterGrey: '#4b5263',
  commentGrey: '#5c6370',
  // Additional colors for chat UI
  background: '#282c34',
  foreground: '#abb2bf',
  currentLine: '#2c323c',
  selection: '#3e4451',
  comment: '#5c6370',
};

export const oneDark = {
  attention: oneDarkPalette.red,
  background: oneDarkPalette.black,
  icon: oneDarkPalette.white,
  text: oneDarkPalette.white,
  fadedText: 'rgba(171, 178, 191, 0.7)', //oneDarkPalette.white,

  // TODO: replace
  blue: oneDarkPalette.blue,
  gutterGrey: oneDarkPalette.gutterGrey,

  // Additional colors
  border: oneDarkPalette.gutterGrey,
  accent: oneDarkPalette.blue,
  textSecondary: oneDarkPalette.commentGrey,
};