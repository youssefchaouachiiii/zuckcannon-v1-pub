import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { CreativeDB, CreativeAccountDB } from './database.js'
import { getPaths } from './paths.js'

// Calculate SHA-256 hash of a file
export async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    
    stream.on('data', data => hash.update(data))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// Get the appropriate subdirectory based on file type
export function getCreativeSubdir(mimeType) {
  if (mimeType.startsWith('video/')) return 'videos'
  if (mimeType.startsWith('image/')) return 'images'
  throw new Error(`Unsupported file type: ${mimeType}`)
}

// Move file to creative library
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

// Process uploaded creative with deduplication
export async function processCreative(file, adAccountId) {
  try {
    // Calculate file hash
    const fileHash = await calculateFileHash(file.path)
    
    // Check if creative already exists
    let creative = await CreativeDB.findByHash(fileHash)
    
    if (creative) {
      // Creative exists, check if it's already uploaded to this account
      const isUploaded = await CreativeAccountDB.isUploadedToAccount(creative.id, adAccountId)
      
      if (isUploaded) {
        // Already uploaded to this account, return existing IDs
        const facebookIds = await CreativeAccountDB.getFacebookIds(creative.id, adAccountId)
        
        // Delete the temporary file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path)
        }
        
        return {
          isNew: false,
          isDuplicate: true,
          creative,
          facebookIds,
          message: 'Creative already exists in this ad account'
        }
      } else {
        // Creative exists but not uploaded to this account
        // Delete the temporary file since we have it in library
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path)
        }
        
        return {
          isNew: false,
          isDuplicate: false,
          creative,
          needsUpload: true,
          message: 'Creative exists in library but not uploaded to this account'
        }
      }
    } else {
      // New creative, move to library
      const mimeType = file.mimetype || (file.originalname.match(/\.(mp4|mov|avi)$/i) ? 'video/mp4' : 'image/jpeg')
      const { fileName, filePath, relativePath } = await moveToCreativeLibrary(
        file.path,
        file.originalname,
        mimeType
      )
      
      // Create database entry
      const creativeId = await CreativeDB.create({
        fileHash,
        fileName,
        originalName: file.originalname,
        filePath: relativePath,
        fileType: mimeType,
        fileSize: file.size,
        thumbnailPath: null // Will be updated after thumbnail creation
      })
      
      creative = await CreativeDB.getById(creativeId)
      
      return {
        isNew: true,
        isDuplicate: false,
        creative,
        needsUpload: true,
        libraryPath: filePath,
        message: 'New creative added to library'
      }
    }
  } catch (error) {
    console.error('Error processing creative:', error)
    throw error
  }
}

// Update creative with thumbnail path
export async function updateCreativeThumbnail(creativeId, thumbnailPath) {
  const db = (await import('./database.js')).default
  
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
  try {
    // Check if source thumbnail exists
    if (!fs.existsSync(thumbnailPath)) {
      console.error(`Source thumbnail does not exist: ${thumbnailPath}`)
      throw new Error(`Thumbnail file not found: ${thumbnailPath}`)
    }
    
    fs.copyFileSync(thumbnailPath, newThumbnailPath)
    console.log(`Thumbnail copied from ${thumbnailPath} to ${newThumbnailPath}`)
  } catch (error) {
    console.error('Error copying thumbnail:', error)
    throw error
  }
  
  const relativePath = path.join('creative-library', 'thumbnails', newThumbnailName)
  
  // Use the same promise pattern as other DB operations
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE creatives SET thumbnail_path = ? WHERE id = ?',
      [relativePath, creativeId],
      function(err) {
        if (err) {
          console.error('Error updating thumbnail path in database:', err)
          reject(err)
        } else {
          console.log(`Updated thumbnail path for creative ${creativeId}: ${relativePath}`)
          resolve(relativePath)
        }
      }
    )
  })
}

// Get creative file path from library
export function getCreativeFilePath(creative) {
  const paths = getPaths()
  // If file_path is absolute, return as is
  if (path.isAbsolute(creative.file_path)) {
    return creative.file_path
  }
  // Otherwise, resolve relative to data directory
  return path.join(paths.data, creative.file_path)
}

// Get thumbnail file path from library
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