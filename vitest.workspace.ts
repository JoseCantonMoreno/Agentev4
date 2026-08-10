import { defineWorkspace } from "vitest/config";

const projects = ["shared", "core", "tools"].map((name) => ({
  test: {
    name,
    root: `./packages/${name}`,
    passWithNoTests: true
  }
}));

export default defineWorkspace([
  ...projects,
  {
    test: {
      name: "desktop",
      root: "./apps/desktop",
      passWithNoTests: true
    }
  }
]);
