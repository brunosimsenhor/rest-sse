FROM node:16.14.2-slim

WORKDIR /opt/client

# COPY package.json yarn.lock ./

RUN yarn install

COPY . .

CMD ["node", "index.js"]
