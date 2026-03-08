# -- deps stage --
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# -- runner stage --
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Run as non-root
USER node

COPY --from=deps /app/node_modules ./node_modules
COPY package.json import.js dumpGroups.js ./

CMD ["node", "import.js"]
