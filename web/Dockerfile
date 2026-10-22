# Temporary Fly.io deploy while Railway deploys are paused (see README, "Temporary deploy on Fly.io").
# Runs the app on its in-process Postgres (DATABASE_URL=pglite:memory), seeded at every start from .seed/, which comes
# from the local build context (gitignored, never committed). Secrets are Fly secrets, never build args or ENV here.
FROM node:22.22.0@sha256:20a424ecd1d2064a44e12fe287bf3dae443aab31dc5e0c0cb6c74bef9c78911c
ENV NEXT_TELEMETRY_DISABLED=1
RUN mkdir /app && chown node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock.json ./
# Dev dependencies stay: the in-process database (PGlite) is one.
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .
RUN test -f .seed/scheduling_db/meridian_scheduling.sqlite && test -f .seed/chunks.json \
  || { echo "copy the seed files into web/.seed/ first (README, Temporary deploy on Fly.io)"; exit 1; }
RUN npm run build
ENV NODE_ENV=production PORT=3000 DATABASE_URL=pglite:memory MERIDIAN_DATA_DIR=/app/.seed \
  KB_CHUNKS=/app/.seed/chunks.json CLIENT_IP_SOURCE=fly_client_ip CLOCK_FLOOR=2026-10-19T14:00:00Z
EXPOSE 3000
CMD ["npm", "start"]
