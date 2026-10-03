import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

export function sandcastleDocker() {
  return docker();
}

export const copyToWorktree = ["node_modules"];

export function setupChain(
  steps: string[],
  timeoutMs: number,
): { sandbox: { onSandboxReady: { command: string; timeoutMs: number }[] } } {
  return {
    sandbox: {
      onSandboxReady: [{ command: steps.join(" && "), timeoutMs }],
    },
  };
}

export const NODE_SETUP_TIMEOUT_MS = 10 * 60_000;

export const NODE_SETUP_STEPS = ["npm install"];

export const nodeHooks = setupChain(NODE_SETUP_STEPS, NODE_SETUP_TIMEOUT_MS);

export const lightweightHooks = {
  sandbox: { onSandboxReady: [] as { command: string }[] },
};
