// ============================================
// UPLOAD HANDLERS
// Handler functions for upload endpoints
// ============================================

import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "url";
import {
    processCreative,
    updateCreativeThumbnail,
    getCreativeFilePath
} from "../backend/utils/creative-utils.js";
import { CreativeAccountDB } from "../backend/utils/database.js";
import { getPaths } from "../backend/utils/paths.js";
import {
    uploadSessions,
    createUploadSession,
    broadcastToSession
} from "../utils/sse.utils.js";

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const paths = getPaths();
const api_version = "v24.0";

// Helper function to normalize account ID
function normalizeAdAccountId(accountId) {
    if (!accountId) return null;
    return accountId.toString().replace(/^act_/, "");
}

// ============================================
// HANDLER: Upload Videos
// ============================================
export async function handleUploadVideos(req, res) {
    try {
        const files = req.files;
        const adAccountId = req.body.account_id;
        const userAccessToken = req.user?.facebook_access_token;

        if (!userAccessToken) {
            return res.status(403).json({
                error: "Facebook account not connected",
                needsAuth: true,
            });
        }

        let sessionId = req.body.sessionId;
        let session;

        if (sessionId && uploadSessions.has(sessionId)) {
            session = uploadSessions.get(sessionId);
            console.log("Using existing session:", sessionId);
        } else {
            sessionId = createUploadSession();
            session = uploadSessions.get(sessionId);
            console.log("Created new session:", sessionId);
        }

        if (session) {
            session.totalFiles = files.length;
            session.processedFiles = 0;
            broadcastToSession(sessionId, "session-start", {
                sessionId,
                totalFiles: files.length,
            });
        }

        const results = await Promise.allSettled(
            files.map((file, index) => {
                return handleVideoUpload(file, index, userAccessToken, adAccountId, sessionId, session, files)
                    .then((response) => ({
                        type: "video",
                        file: file.originalname,
                        data: response,
                        status: "success",
                    }))
                    .catch((error) => ({
                        file: file.originalname,
                        status: "failed",
                        error: error.message,
                    }));
            })
        );

        broadcastToSession(sessionId, "session-complete", {
            totalFiles: files.length,
            processedFiles: session.processedFiles,
            results: results,
        });

        res.status(200).json({ results, sessionId });
    } catch (err) {
        console.log("There was an error in uploading videos to facebook.", err);
        res.status(500).send("Could not upload videos to facebook.");
    }

    // ============================================
    // Internal helper functions for video upload
    // ============================================

    async function handleVideoUpload(file, index, userAccessToken, adAccountId, sessionId, session, files) {
        console.log("File: ", file);
        console.log(`File size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);

        broadcastToSession(sessionId, "file-start", {
            fileIndex: index,
            fileName: file.originalname,
            fileSize: (file.size / (1024 * 1024)).toFixed(2) + "MB",
            totalFiles: files.length,
        });

        try {
            if (session) {
                session.currentFile = {
                    name: file.originalname,
                    size: (file.size / (1024 * 1024)).toFixed(2) + "MB",
                    status: "processing",
                    progress: 0,
                    stage: "Processing creative",
                };
            }

            broadcastToSession(sessionId, "file-progress", {
                fileIndex: index,
                fileName: file.originalname,
                stage: "Processing creative",
                progress: 5,
            });

            file.mimetype = "video/mp4";
            const creativeResult = await processCreative(file, adAccountId);

            let uploadVideo, getImageHash;
            let filePath = file.path;

            if (creativeResult.isDuplicate) {
                uploadVideo = creativeResult.facebookIds.facebook_video_id;
                getImageHash = creativeResult.facebookIds.facebook_image_hash;

                if (session) {
                    session.processedFiles++;
                }

                broadcastToSession(sessionId, "file-complete", {
                    fileIndex: index,
                    fileName: file.originalname,
                    processedFiles: session.processedFiles,
                    totalFiles: files.length,
                    isDuplicate: true,
                    message: "Using existing creative from library",
                });

                return { uploadVideo, getImageHash, adAccountId, isDuplicate: true };
            } else {
                if (!creativeResult.isNew) {
                    filePath = getCreativeFilePath(creativeResult.creative);
                } else {
                    filePath = creativeResult.libraryPath || getCreativeFilePath(creativeResult.creative);
                }

                file.path = filePath;

                broadcastToSession(sessionId, "file-progress", {
                    fileIndex: index,
                    fileName: file.originalname,
                    stage: "Creating thumbnail",
                    progress: 10,
                });
                const thumbnail = await getThumbnailFromVideo(file);

                broadcastToSession(sessionId, "file-progress", {
                    fileIndex: index,
                    fileName: file.originalname,
                    stage: "Uploading video to Meta",
                    progress: 30,
                });
                uploadVideo = await uploadVideosToMeta(file, adAccountId, sessionId, index, userAccessToken);

                broadcastToSession(sessionId, "file-progress", {
                    fileIndex: index,
                    fileName: file.originalname,
                    stage: "Uploading thumbnail",
                    progress: 90,
                });
                getImageHash = await uploadThumbnailImage(thumbnail, adAccountId, userAccessToken);

                await CreativeAccountDB.recordUpload(creativeResult.creative.id, adAccountId, {
                    videoId: uploadVideo,
                    imageHash: getImageHash,
                });

                if (creativeResult.isNew) {
                    await updateCreativeThumbnail(creativeResult.creative.id, thumbnail);
                }

                try {
                    if (fs.existsSync(thumbnail)) {
                        fs.unlinkSync(thumbnail);
                        console.log(`Deleted temporary thumbnail file: ${thumbnail}`);
                    }
                } catch (cleanupErr) {
                    console.error("Error cleaning up thumbnail:", cleanupErr);
                }

                if (session) {
                    session.processedFiles++;
                }

                broadcastToSession(sessionId, "file-complete", {
                    fileIndex: index,
                    fileName: file.originalname,
                    processedFiles: session.processedFiles,
                    totalFiles: files.length,
                    isNew: creativeResult.isNew,
                });

                return { uploadVideo, getImageHash, adAccountId, isNew: creativeResult.isNew };
            }
        } catch (err) {
            console.log("There was an error inside handleVideoUpload() try catch block.", err);

            broadcastToSession(sessionId, "file-error", {
                fileIndex: index,
                fileName: file.originalname,
                error: err.message,
            });

            try {
                if (file.path && fs.existsSync(file.path) && file.path.includes(paths.uploads)) {
                    fs.unlinkSync(file.path);
                }
            } catch (cleanupErr) {
                console.error("Error cleaning up files on error:", cleanupErr);
            }

            throw err;
        }
    }

    async function getThumbnailFromVideo(file) {
        const videoPath = file.path;
        const thumbnailDir = path.join(__dirname, "..", "uploads");
        const thumbnailName = `${path.basename(file.path)}-thumb.png`;
        const thumbnailPath = path.join(thumbnailDir, thumbnailName);

        console.log("Attempting to create thumbnail:");
        console.log("  Video path:", videoPath);
        console.log("  Thumbnail path:", thumbnailPath);
        console.log("  Video exists:", fs.existsSync(videoPath));

        if (!fs.existsSync(thumbnailDir)) {
            console.log("Creating uploads directory:", thumbnailDir);
            fs.mkdirSync(thumbnailDir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .seekInput("00:00:01")
                .screenshots({
                    timestamps: ["00:00:01"],
                    filename: thumbnailName,
                    folder: thumbnailDir,
                })
                .on("end", () => {
                    console.log("Thumbnail created successfully:", thumbnailPath);
                    console.log("Thumbnail exists:", fs.existsSync(thumbnailPath));
                    resolve(thumbnailPath);
                })
                .on("error", (err) => {
                    console.error("Error creating thumbnail:", err);
                    reject(err);
                });
        });
    }

    async function uploadVideosToMeta(file, adAccountId, sessionId, fileIndex, userAccessToken) {
        const normalizedAccountId = normalizeAdAccountId(adAccountId);
        const fileStats = fs.statSync(file.path);
        const fileSize = fileStats.size;

        if (fileSize > 20 * 1024 * 1024) {
            return await uploadLargeVideoToMetaWithProgress(file, adAccountId, sessionId, fileIndex, userAccessToken);
        }

        const upload_url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

        try {
            const fd = new FormData();
            fd.append("source", fs.createReadStream(file.path));
            fd.append("name", file.originalname);
            fd.append("access_token", userAccessToken);

            const response = await axios.post(upload_url, fd, {
                headers: {
                    ...fd.getHeaders(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            console.log("Successfully uploaded video to Meta!");
            console.log("Video ID:", response.data.id);

            return response.data.id;
        } catch (err) {
            console.log("There was an error uploading video to Facebook:", err.response?.data || err.message);
            throw err;
        }
    }

    async function uploadLargeVideoToMetaWithProgress(file, adAccountId, sessionId, fileIndex, userAccessToken) {
        const normalizedAccountId = normalizeAdAccountId(adAccountId);
        const fileStats = fs.statSync(file.path);
        const fileSize = fileStats.size;

        const initUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

        try {
            const initResponse = await axios.post(initUrl, {
                upload_phase: "start",
                file_size: fileSize,
                access_token: userAccessToken,
            });

            const { upload_session_id, video_id } = initResponse.data;
            console.log(`Upload session initialized. Session ID: ${upload_session_id}`);

            const chunkSize = 4 * 1024 * 1024;
            let offset = 0;
            const totalChunks = Math.ceil(fileSize / chunkSize);
            let currentChunk = 0;

            while (offset < fileSize) {
                currentChunk++;
                const endChunk = Math.min(offset + chunkSize, fileSize);
                const chunk = fs.createReadStream(file.path, {
                    start: offset,
                    end: endChunk - 1,
                });

                const fd = new FormData();
                fd.append("video_file_chunk", chunk);
                fd.append("upload_phase", "transfer");
                fd.append("upload_session_id", upload_session_id);
                fd.append("start_offset", offset.toString());
                fd.append("access_token", userAccessToken);

                await axios.post(initUrl, fd, {
                    headers: {
                        ...fd.getHeaders(),
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });

                const percentComplete = Math.round((endChunk / fileSize) * 100);
                console.log(`Uploaded chunk: ${offset}-${endChunk} of ${fileSize} (${percentComplete}%)`);

                broadcastToSession(sessionId, "file-progress", {
                    fileIndex: fileIndex,
                    fileName: file.originalname,
                    stage: `Uploading video chunk ${currentChunk}/${totalChunks}`,
                    progress: 30 + Math.round(percentComplete * 0.6),
                });

                offset = endChunk;
            }

            await axios.post(initUrl, {
                upload_phase: "finish",
                upload_session_id: upload_session_id,
                access_token: userAccessToken,
                title: file.originalname,
            });

            console.log("Successfully completed large video upload to Meta!");
            return video_id;
        } catch (err) {
            console.log("Error uploading large video to Facebook:", err.response?.data || err.message);
            throw err;
        }
    }

    async function uploadThumbnailImage(thumbnailPath, adAccountId, userAccessToken) {
        const normalizedAccountId = normalizeAdAccountId(adAccountId);
        const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;

        try {
            const fd = new FormData();
            fd.append("source", fs.createReadStream(thumbnailPath));
            fd.append("access_token", userAccessToken);

            const response = await axios.post(imageUrl, fd, {
                headers: {
                    ...fd.getHeaders(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            console.log("Successfully uploaded thumbnail image!");
            console.log(response.data);

            const images = response.data.images;
            const dynamicKey = Object.keys(images)[0];
            const imageHash = images[dynamicKey].hash;

            return imageHash;
        } catch (err) {
            console.log("Error uploading thumbnail image:", err.response?.data || err.message);
            throw err;
        }
    }
}

// ============================================
// HANDLER: Upload Images
// ============================================
export async function handleUploadImages(req, res) {
    const files = req.files;
    const accountId = req.body.account_id;
    const userAccessToken = req.user?.facebook_access_token;
    const normalizedAccountId = normalizeAdAccountId(accountId);
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;

    if (!userAccessToken) {
        return res.status(403).json({
            error: "Facebook account not connected",
            needsAuth: true,
        });
    }

    try {
        const results = await Promise.allSettled(
            files.map(async (file) => {
                try {
                    file.mimetype = file.mimetype || "image/jpeg";
                    const creativeResult = await processCreative(file, accountId);

                    if (creativeResult.isDuplicate) {
                        return {
                            type: "image",
                            file: file.originalname,
                            imageHash: creativeResult.facebookIds.facebook_image_hash,
                            status: "success",
                            isDuplicate: true,
                            message: "Using existing creative from library",
                        };
                    } else {
                        let filePath;
                        if (!creativeResult.isNew) {
                            filePath = getCreativeFilePath(creativeResult.creative);
                        } else {
                            filePath = creativeResult.libraryPath || getCreativeFilePath(creativeResult.creative);
                        }
                        file.path = filePath;

                        const imageHash = await uploadImages(filePath, file.originalname, imageUrl, userAccessToken);

                        await CreativeAccountDB.recordUpload(creativeResult.creative.id, accountId, {
                            imageHash: imageHash,
                        });

                        return {
                            type: "image",
                            file: file.originalname,
                            imageHash: imageHash,
                            status: "success",
                            isNew: creativeResult.isNew,
                        };
                    }
                } catch (error) {
                    return {
                        file: file.originalname,
                        status: "failed",
                        error: error.message,
                    };
                }
            })
        );

        res.status(200).json(results);
    } catch (err) {
        console.log("There was an error in uploading images to facebook.", err);
        res.status(500).send("Could not upload images to facebook.");
    }

    async function uploadImages(filePath, originalName, imageUrl, userAccessToken) {
        const file_path = fs.createReadStream(filePath);

        try {
            const fd = new FormData();
            fd.append(`${originalName}`, file_path);
            fd.append("access_token", userAccessToken);

            const response = await axios.post(imageUrl, fd, {
                headers: {
                    ...fd.getHeaders(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            console.log("Successfully uploaded images!");

            const images = response.data.images;
            const dynamicKey = Object.keys(images)[0];
            const imageHash = images[dynamicKey].hash;

            return imageHash;
        } catch (err) {
            console.log("There was an error uploading images to facebook.", err.response?.data);
            throw err;
        }
    }
}