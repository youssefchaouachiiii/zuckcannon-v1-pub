/**
 * File Handler Utilities
 * Handles file operations for creative library (hashing, moving, path resolution)
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getPaths } from './paths.js'

/**
 * Calculate SHA-256 hash of a file
 * Used for deduplication of uploaded files
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} - SHA-256 hash of the file
 */
export async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    
    stream.on('data', data => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Get the appropriate subdirectory based on MIME type
 * @param {string} mimeType - MIME type of the file
 * @returns {string} - Subdirectory name ('videos' or 'images')
 * @throws {Error} - If MIME type is not supported
 */
export function getCreativeSubdir(mimeType) {
  if (mimeType.startsWith('video/')) return 'videos'
  if (mimeType.startsWith('image/')) return 'images'
  throw new Error(`Unsupported file type: ${mimeType}`)
}

/**
 * Move file to creative library
 * Creates organized subdirectories and generates timestamped filenames
 * @param {string} tempPath - Temporary file path
 * @param {string} originalName - Original filename
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<Object>} - Object with fileName, filePath, and relativePath
 */
export async function moveToCreativeLibrary(tempPath, originalName, mimeType) {
  const subdir = getCreativeSubdir(mimeType)
  const timestamp = Date.now()
  const ext = path.extname(originalName)
  const baseName = path.basename(originalName, ext)
  const newFileName = `${timestamp}-${baseName}${ext}`
  const paths = getPaths()
  const newPath = path.join(paths.creativeLibrary, subdir, newFileName)
  
  // Create directory if it doesn't exist
  const dir = path.dirname(newPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  
  // Copy the file (can't use rename across different filesystems)
  fs.copyFileSync(tempPath, newPath)
  // Delete the original file
  fs.unlinkSync(tempPath)
  
  return {
    fileName: newFileName,
    filePath: newPath,
    relativePath: path.join('creative-library', subdir, newFileName)
  }
}

/**
 * Copy thumbnail to creative library and update database reference
 * Creates a timestamped backup of the thumbnail file
 * @param {number} creativeId - ID of the creative
 * @param {string} thumbnailPath - Source thumbnail path
 * @returns {Promise<string>} - Relative path to saved thumbnail
 * @throws {Error} - If source file doesn't exist or copy operation fails
 */
export async function saveThumbnailToLibrary(creativeId, thumbnailPath) {
  // Move thumbnail to library
  const timestamp = Date.now()
  const newThumbnailName = `thumb-${timestamp}.png`
  const paths = getPaths()
  const newThumbnailPath = path.join(paths.thumbnails, newThumbnailName)
  
  // Create directory if it doesn't exist
  const dir = path.dirname(newThumbnailPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  
  // Copy thumbnail (don't move, as it might be needed for upload)
  if (!fs.existsSync(thumbnailPath)) {
    throw new Error(`Thumbnail file not found: ${thumbnailPath}`)
  }
  
  fs.copyFileSync(thumbnailPath, newThumbnailPath)
  console.log(`Thumbnail copied from ${thumbnailPath} to ${newThumbnailPath}`)
  
  return path.join('creative-library', 'thumbnails', newThumbnailName)
}

/**
 * Get creative file path from library
 * Resolves relative paths to absolute paths based on data directory
 * @param {Object} creative - Creative object with file_path property
 * @returns {string} - Absolute file path
 */
export function getCreativeFilePath(creative) {
  const paths = getPaths()
  // If file_path is absolute, return as is
  if (path.isAbsolute(creative.file_path)) {
    return creative.file_path
  }
  // Otherwise, resolve relative to data directory
  return path.join(paths.data, creative.file_path)
}

/**
 * Get thumbnail file path from library
 * Resolves relative paths to absolute paths based on data directory
 * @param {Object} creative - Creative object with thumbnail_path property
 * @returns {string|null} - Absolute file path or null if no thumbnail
 */
export function getThumbnailFilePath(creative) {
  if (!creative.thumbnail_path) return null
  const paths = getPaths()
  // If thumbnail_path is absolute, return as is
  if (path.isAbsolute(creative.thumbnail_path)) {
    return creative.thumbnail_path
  }
  // Otherwise, resolve relative to data directory
  return path.join(paths.data, creative.thumbnail_path)
}

/**
 * Delete file from filesystem safely
 * @param {string} filePath - Path to file to delete
 * @returns {boolean} - True if file was deleted, false if it didn't exist
 */
export function deleteFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
      return true
    } catch (error) {
      console.error(`Failed to delete file ${filePath}:`, error)
      return false
    }
  }
  return false
}
