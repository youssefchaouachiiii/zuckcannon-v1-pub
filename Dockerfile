# Use Node.js 20 Alpine for smaller image size
FROM node:20-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --only=production

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p data uploads creative-library

# Expose application port
EXPOSE 6969

# Start the application
CMD ["sh", "-c", "node init-directories.js && node server.js"]