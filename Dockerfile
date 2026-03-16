FROM node:22-bookworm

# Install Playwright browser dependencies (as root)
RUN npx playwright@1.58.2 install-deps chromium

WORKDIR /app

# Install all deps (including devDeps for tsc)
COPY package.json package-lock.json ./
RUN npm ci

# Install Playwright browsers
RUN npx playwright install chromium

# Build TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
COPY config/ ./config/
RUN npx tsc

# Prune dev deps for smaller image
RUN npm prune --omit=dev

EXPOSE 3737

CMD ["node", "dist/index.js"]
