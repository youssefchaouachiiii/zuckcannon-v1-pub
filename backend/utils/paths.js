import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root directory (2 levels up from backend/utils)
const projectRoot = path.join(__dirname, '..', '..');

// Base directory for data storage
export const getDataDir = () => {
  return process.env.NODE_ENV === 'development' 
    ? path.join(projectRoot, 'data')
    : '/data';
};

// Specific directory paths
export const getPaths = () => {
  const dataDir = getDataDir();
  
  return {
    data: dataDir,
    db: path.join(dataDir, 'db'),
    uploads: path.join(dataDir, 'uploads'),
    creativeLibrary: path.join(dataDir, 'creative-library'),
    videos: path.join(dataDir, 'creative-library', 'videos'),
    images: path.join(dataDir, 'creative-library', 'images'),
    thumbnails: path.join(dataDir, 'creative-library', 'thumbnails'),
  };
};

// Get specific database paths
export const getDbPath = (dbName) => {
  const paths = getPaths();
  return path.join(paths.db, dbName);
};