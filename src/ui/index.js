import { createComponents } from "./components/index.js";

export const initUI = (theme) => ({
  theme,
  ...createComponents(theme),
});
