import * as chrome from "vitest-chrome/lib/index.esm.js";

// Add chrome object to global scope so imported modules can use it
Object.assign(global, chrome);
