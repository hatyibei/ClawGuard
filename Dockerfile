FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Dashboard build
COPY dashboard/package.json dashboard/package-lock.json* ./dashboard/
RUN cd dashboard && npm ci
COPY dashboard/ ./dashboard/
RUN cd dashboard && npm run build

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -r clawguard && useradd -r -g clawguard -m clawguard

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY blocklists/ ./blocklists/

RUN mkdir -p /app/data && chown -R clawguard:clawguard /app

USER clawguard

ENV NODE_ENV=production
ENV CLAWGUARD_DATA_DIR=/app/data
ENV CLAWGUARD_PORT=4200

EXPOSE 4200

VOLUME ["/app/data"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
