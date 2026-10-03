FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      gnupg \
      jq \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @schpet/linear-cli @anthropic-ai/claude-code

RUN groupmod -n agent node \
    && usermod -d /home/agent -m -l agent node \
    && chown -R agent:agent /home/agent \
    && chmod -R a+rwX /home/agent

RUN chmod a+w /etc/passwd /etc/group

USER agent
WORKDIR /home/agent

COPY --chown=agent:agent <<'EOF' /home/agent/entrypoint.sh
#!/usr/bin/env bash
set -e

USER_ID="$(id -u)"
GROUP_ID="$(id -g)"
if ! getent passwd "$USER_ID" >/dev/null 2>&1; then
  echo "agent:x:${USER_ID}:${GROUP_ID}:agent:/home/agent:/bin/bash" >> /etc/passwd
fi
if ! getent group "$GROUP_ID" >/dev/null 2>&1; then
  echo "agent:x:${GROUP_ID}:" >> /etc/group
fi

if [ -n "${LINEAR_API_KEY:-}" ]; then
  linear auth login --key "$LINEAR_API_KEY" --plaintext >/dev/null 2>&1 || true
fi

if [ -n "${GH_TOKEN:-}" ]; then
  gh auth setup-git >/dev/null 2>&1 || true
  git config --global url."https://github.com/".insteadOf "git@github.com:" || true
  git config --global --add url."https://github.com/".insteadOf "ssh://git@github.com/" || true
fi

exec "$@"
EOF
RUN chmod +x /home/agent/entrypoint.sh

ENTRYPOINT ["/home/agent/entrypoint.sh"]
CMD ["sleep", "infinity"]
