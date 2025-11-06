# ---- Builder Stage ----
# This stage builds the client-side React application.
FROM node:20 AS builder

# Set the working directory for the client
WORKDIR /usr/src/app/client

# Copy client's package.json and package-lock.json
COPY client/package*.json ./

# Install client dependencies
RUN npm install

# Copy the rest of the client's code
COPY client/ ./

# Build the client application
RUN npm run build

# ---- Production Stage ----
# This stage creates the final, lean production image.
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy server's package.json and package-lock.json
COPY package*.json ./

# Install only production dependencies for the server
RUN npm install --only=production

# Copy the server-side code
COPY . .

# Copy the built client application from the builder stage
COPY --from=builder /usr/src/app/client/dist ./client/dist

# Expose port 6969
EXPOSE 6969

# Command to run the application
CMD [ "node", "server.js" ]