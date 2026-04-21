import { createComponents } from "./components/index.js";

export const initUI = (theme, i18n) => ({
  theme,
  ...createComponents(theme, i18n),
});
