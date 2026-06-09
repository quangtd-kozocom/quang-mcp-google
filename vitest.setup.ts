import { beforeEach } from "vitest";
import { setPolicyStore } from "./src/policy/guard.js";
import { PolicyStore } from "./src/policy/store.js";

// Give every test a fresh in-memory policy store (default mode `read_open`) so
// the permission gate never reads or writes the real `~/.terra-mcp/policy.db`.
// Policy-specific tests construct their own stores; this just keeps the gate
// transparent and filesystem-free for the handler/registration tests.
beforeEach(() => {
  setPolicyStore(new PolicyStore(":memory:"));
});
