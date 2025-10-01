import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('Initializing directories...');

// Use local directories in development, /data in production
const baseDir = process.env.NODE_ENV === 'development' ? __dirname : '/data';

const dirs = process.env.NODE_ENV === 'development' ? [
  path.join(baseDir, 'data'),
  path.join(baseDir, 'data', 'db'),
  path.join(baseDir, 'data', 'uploads'),
  path.join(baseDir, 'data', 'creative-library'),
  path.join(baseDir, 'data', 'creative-library', 'videos'),
  path.join(baseDir, 'data', 'creative-library', 'images'),
  path.join(baseDir, 'data', 'creative-library', 'thumbnails')
] : [
  '/data',
  '/data/db',
  '/data/uploads',
  '/data/creative-library',
  '/data/creative-library/videos',
  '/data/creative-library/images',
  '/data/creative-library/thumbnails'
];

// Check if base directory exists (only for production)
if (process.env.NODE_ENV === 'production' && !fs.existsSync('/data')) {
  console.error('ERROR: /data directory does not exist. Persistent disk might not be mounted.');
  process.exit(1);
}

// Create all required directories
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error);
      process.exit(1);
    }
  } else {
    console.log(`Directory exists: ${dir}`);
  }
});

console.log('Directory initialization complete!');