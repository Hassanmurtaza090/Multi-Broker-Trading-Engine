# Frontend production image (M14 hardened).
#
# Stage 1: build the static terminal bundle (npm ci from the lockfile).
# Stage 2: serve it with the UNPRIVILEGED nginx image (uid 101, port 8080)
#          plus security headers for the served documents.
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Security headers + SPA routing, REPLACING the stock default server block
# (both would otherwise listen on 8080).
COPY nginx-security.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
