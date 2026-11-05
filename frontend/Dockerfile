# ------ Build Stage ------
FROM oven/bun:1 AS builder
WORKDIR /app

ARG VITE_GOOGLE_MAPS_API_KEY
ARG VITE_GOOGLE_MAP_ID
ARG VITE_BACKEND_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAP_ID=$VITE_GOOGLE_MAP_ID
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY bun.lock* package.json ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

# ------ Runtime ------
FROM oven/bun:1-slim
WORKDIR /app

# Copy only built dist/ and server.ts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock* ./

# Install runtime dependencies
RUN bun install --production

EXPOSE 3000
CMD ["bun", "run", "server.ts"]