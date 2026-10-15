# Public gateway for the Render Blueprint (render.yaml). Build context: infra/render.
FROM caddy:2.11.7-alpine
COPY Caddyfile /etc/caddy/Caddyfile
