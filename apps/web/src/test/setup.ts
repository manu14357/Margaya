import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// findBy and waitFor give up after 1s by default, which a busy machine can miss.
configure({ asyncUtilTimeout: 10_000 });
