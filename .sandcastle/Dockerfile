FROM node:22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI (still used for git ops / PR commands; issue tracker is Linear)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Install Linear CLI for issue tracker integration
RUN npm install -g @schpet/linear-cli

# Rename the base image's "node" user (UID 1000) to "agent".
# This keeps UID 1000 so that --userns=keep-id (Podman) and
# --user 1000:1000 (Docker) map to the correct home directory owner.
RUN groupmod -n agent node \
  && usermod -d /home/agent -m -l agent node \
  && chown -R agent:agent /home/agent \
  && chmod -R a+rwX /home/agent

# Install pi coding agent (run as root before USER agent)
RUN npm install -g @mariozechner/pi-coding-agent

USER agent

WORKDIR /home/agent

# Linear CLI auth: at container start, if LINEAR_API_KEY is set, log in once.
# `--plaintext` stores the key in ~/.config/linear/credentials instead of the
# system keyring (which isn't available inside a headless container).
# Override the entrypoint so this runs before `sleep infinity`.
COPY --chown=agent:agent <<'EOF' /home/agent/entrypoint.sh
#!/usr/bin/env bash
set -e
if [ -n "${LINEAR_API_KEY:-}" ]; then
  linear auth login --key "$LINEAR_API_KEY" --plaintext >/dev/null 2>&1 || true
fi
exec "$@"
EOF
RUN chmod +x /home/agent/entrypoint.sh

ENTRYPOINT ["/home/agent/entrypoint.sh"]
CMD ["sleep", "infinity"]

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
