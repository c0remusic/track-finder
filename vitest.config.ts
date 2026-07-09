import { defineConfig } from "vitest/config";

// No @vitejs/plugin-react/jsdom: every test in this project's plan is a
// Node-environment unit test (mocked fetch/Playwright), none render React
// components. Adding the React plugin also hit a peer-dependency conflict
// (@vitejs/plugin-react@6's optional @rolldown/plugin-babel peer vs. the
// installed @babel/core) — revisit if a future task needs component tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
