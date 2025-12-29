import multer from "multer";
import fs from "fs";
import path from "path";
import { getPaths } from "../backend/utils/paths.js";

const paths = getPaths();

/**
 * Create a multer storage configuration for a specific subfolder
 * @param {string} subFolder - Subfolder name (e.g., 'videos', 'images', 'characters')
 * @returns {multer.StorageEngine}
 */
const createStorage = (subFolder = "") => {
    return multer.diskStorage({
        destination: function (req, file, cb) {
            // Build upload directory path
            const uploadDir = subFolder
                ? path.join(paths.uploads, subFolder)
                : paths.uploads;

            // Ensure directory exists
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            cb(null, uploadDir);
        },
        filename: function (req, file, cb) {
            // Use timestamp + original filename to prevent collisions
            const timestamp = Date.now();
            const ext = path.extname(file.originalname);
            const nameWithoutExt = path.basename(file.originalname, ext);
            const sanitizedName = nameWithoutExt.replace(/[^a-zA-Z0-9_-]/g, '_');

            cb(null, `${timestamp}-${sanitizedName}${ext}`);
        },
    });
};

/**
 * Create a multer upload middleware with custom configuration
 * @param {Object} options - Configuration options
 * @param {string} options.subFolder - Subfolder for uploads (default: '')
 * @param {number} options.fileSize - Max file size in bytes (default: 4GB)
 * @param {string[]} options.allowedMimeTypes - Allowed MIME types (default: all)
 * @returns {multer.Multer}
 */
export const createUploadMiddleware = (options = {}) => {
    const {
        subFolder = "",
        fileSize = 4 * 1024 * 1024 * 1024, // 4GB default
        allowedMimeTypes = null,
    } = options;

    const storage = createStorage(subFolder);

    const fileFilter = (req, file, cb) => {
        if (allowedMimeTypes && !allowedMimeTypes.includes(file.mimetype)) {
            return cb(
                new Error(
                    `File type not allowed. Allowed types: ${allowedMimeTypes.join(", ")}`
                )
            );
        }
        cb(null, true);
    };

    return multer({
        storage,
        limits: { fileSize },
        fileFilter: allowedMimeTypes ? fileFilter : undefined,
    });
};

// Default upload middleware (general purpose - 4GB limit)
export const upload = createUploadMiddleware({
    subFolder: "",
    fileSize: 4 * 1024 * 1024 * 1024,
});

// Video upload middleware
export const uploadVideo = createUploadMiddleware({
    subFolder: "videos",
    fileSize: 4 * 1024 * 1024 * 1024, // 4GB
    allowedMimeTypes: [
        "video/mp4",
        "video/quicktime",
        "video/x-msvideo",
        "video/x-matroska",
        "video/webm",
    ],
});

// Image upload middleware
export const uploadImage = createUploadMiddleware({
    subFolder: "images",
    fileSize: 100 * 1024 * 1024, // 100MB
    allowedMimeTypes: [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
    ],
});

// Character/Creative upload middleware
export const uploadCreative = createUploadMiddleware({
    subFolder: "creatives",
    fileSize: 4 * 1024 * 1024 * 1024, // 4GB (supports both images and videos)
});

// General files (no restrictions)
export const uploadGeneral = createUploadMiddleware({
    subFolder: "general",
    fileSize: 4 * 1024 * 1024 * 1024,
});