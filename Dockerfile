# -- deps stage --
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# -- runner stage --
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Prepare data directory with node user ownership for volume mounting
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json import.js dumpGroups.js ./

CMD ["node", "import.js"]
