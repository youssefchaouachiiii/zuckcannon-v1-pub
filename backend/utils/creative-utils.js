import { CreativeDB, CreativeAccountDB } from './database.js'
import {
  calculateFileHash,
  moveToCreativeLibrary,
  getCreativeFilePath,
  getThumbnailFilePath,
  saveThumbnailToLibrary,
  deleteFileIfExists,
  getCreativeSubdir
} from './file-handler.js'

// ============================================
// Creative Processing
// ============================================

/**
 * Process uploaded creative with deduplication
 * Checks if creative already exists by file hash, handles duplicates and new uploads
 * @param {Object} file - Multer file object
 * @param {string} adAccountId - Ad account ID
 * @returns {Promise<Object>} - Processing result with creative data and metadata
 */
export async function processCreative(file, adAccountId) {
  try {
    // Calculate file hash for deduplication
    const fileHash = await calculateFileHash(file.path)

    // Check if creative already exists
    let creative = await CreativeDB.findByHash(fileHash)

    if (creative) {
      // Creative exists, check if it's already uploaded to this account
      const isUploaded = await CreativeAccountDB.isUploadedToAccount(creative.id, adAccountId)

      if (isUploaded) {
        // Already uploaded to this account, return existing IDs
        const facebookIds = await CreativeAccountDB.getFacebookIds(creative.id, adAccountId)
        deleteFileIfExists(file.path)

        return {
          isNew: false,
          isDuplicate: true,
          creative,
          facebookIds,
          message: 'Creative already exists in this ad account'
        }
      } else {
        // Creative exists but not uploaded to this account
        deleteFileIfExists(file.path)

        return {
          isNew: false,
          isDuplicate: false,
          creative,
          needsUpload: true,
          message: 'Creative exists in library but not uploaded to this account'
        }
      }
    } else {
      // New creative, move to library and create database entry
      const mimeType = file.mimetype || (file.originalname.match(/\.(mp4|mov|avi)$/i) ? 'video/mp4' : 'image/jpeg')
      const { fileName, filePath, relativePath } = await moveToCreativeLibrary(
        file.path,
        file.originalname,
        mimeType
      )

      const result = await CreativeDB.create({
          fileHash,
          fileName,
          originalName: file.originalname,
          filePath: relativePath,
          fileType: mimeType,
          fileSize: file.size,
          thumbnailPath: null
      })

      creative = await CreativeDB.getById(result.id)

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

// ============================================
// Thumbnail Management
// ============================================

/**
 * Update creative with thumbnail path
 * Saves thumbnail to library and updates database reference
 * @param {number} creativeId - Creative ID
 * @param {string} thumbnailPath - Source thumbnail path
 * @returns {Promise<string>} - Relative path to saved thumbnail
 */
export async function updateCreativeThumbnail(creativeId, thumbnailPath) {
  const db = (await import('./database.js')).default

  const relativePath = await saveThumbnailToLibrary(creativeId, thumbnailPath)

  // Update database with new thumbnail path
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

// ============================================
// Path Resolution (Legacy exports for compatibility)
// ============================================

/**
 * Get creative file path from library
 * @param {Object} creative - Creative object
 * @returns {string} - Absolute file path
 */
export { getCreativeFilePath } from './file-handler.js'

/**
 * Get thumbnail file path from library
 * @param {Object} creative - Creative object
 * @returns {string|null} - Absolute file path or null
 */
export { getThumbnailFilePath } from './file-handler.js'

/**
 * Get creative subdirectory based on MIME type
 * @param {string} mimeType - MIME type
 * @returns {string} - Subdirectory name
 */
export { getCreativeSubdir } from './file-handler.js'