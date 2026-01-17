import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests serially to avoid database contention  
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
