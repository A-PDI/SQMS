# Public gateway for the Render Blueprint (render.yaml). Build context: infra/render.
FROM caddy:2.11.7-alpine
# The image gives the caddy binary the cap_net_bind_service file capability for ports below 1024. Render runs
# containers without that capability, and Linux refuses to execute a binary whose file capabilities exceed the
# container's ("operation not permitted"). The gateway listens on $PORT (10000), so the capability is removed.
RUN setcap -r /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
