FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN apk add --no-cache gettext
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O - http://127.0.0.1/healthz || exit 1
EXPOSE 80
CMD ["/bin/sh", "-c", "envsubst < /usr/share/nginx/html/runtime-env.template.js > /usr/share/nginx/html/runtime-env.js && exec nginx -g 'daemon off;'"]
