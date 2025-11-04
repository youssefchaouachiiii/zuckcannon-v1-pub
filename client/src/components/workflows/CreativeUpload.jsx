import React, { useState } from "react";
import { useUploadProtection } from "../../hooks/useUploadProtection";
import "./UploadWorkflow.css";

/**
 * Creative Upload Component
 * Reusable component for uploading creatives (images/videos)
 * Used in multiple workflows: create-new, upload-existing, duplicate-existing
 */
function CreativeUpload({ adSetId, adSetName, onUploadComplete }) {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [gdriveLink, setGdriveLink] = useState("");
  const [fetchingGdrive, setFetchingGdrive] = useState(false);

  // Enable upload protection
  useUploadProtection();

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...selectedFiles]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    setFiles((prev) => [...prev, ...droppedFiles]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    if (window.confirm("Clear all selected files?")) {
      setFiles([]);
    }
  };

  const handleFetchGdrive = async () => {
    if (!gdriveLink.trim()) {
      window.showWarning?.("Please enter a Google Drive link");
      return;
    }

    setFetchingGdrive(true);
    try {
      const response = await fetch("/api/fetch-gdrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ link: gdriveLink }),
      });

      if (!response.ok) throw new Error("Failed to fetch from Google Drive");

      const data = await response.json();
      window.showSuccess?.(`Fetched ${data.files?.length || 0} files from Google Drive`);
      // Add fetched files to the list
      if (data.files && data.files.length > 0) {
        setFiles((prev) => [...prev, ...data.files]);
      }
      setGdriveLink("");
    } catch (error) {
      console.error("Error fetching from Google Drive:", error);
      window.showError?.("Failed to fetch from Google Drive. Please try again.");
    } finally {
      setFetchingGdrive(false);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      window.showWarning?.("Please select files to upload");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("adset_id", adSetId);

      // Add all files to FormData
      files.forEach((file, index) => {
        formData.append(`creative_${index}`, file);
      });

      const response = await fetch("/api/upload-creatives", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      setUploadProgress(100);

      window.showSuccess?.(`Successfully uploaded ${files.length} creative(s)!`);

      // Clear files after successful upload
      setTimeout(() => {
        setFiles([]);
        setUploadProgress(0);
        if (onUploadComplete) {
          onUploadComplete(result);
        }
      }, 1000);
    } catch (error) {
      console.error("Upload error:", error);
      window.showError?.("Upload failed. Please try again.");
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const openCreativeLibrary = () => {
    window.showWarning?.("Creative Library feature coming soon!");
  };

  return (
    <div className="creative-upload">
      <div className="column-header">
        <h2>Upload Creatives</h2>
        {adSetName && (
          <p style={{ fontSize: "14px", color: "#666", marginTop: "8px" }}>
            Uploading to: <strong>{adSetName}</strong>
          </p>
        )}
      </div>

      <div className="creative-upload-content">
        {/* Drag & Drop Zone */}
        <div className="file-drop-zone" onDrop={handleDrop} onDragOver={handleDragOver}>
          <div className="drop-zone-icon">📁</div>
          <p className="drop-zone-text">
            Drag & drop <strong>images and videos</strong> here
          </p>
          <p style={{ fontSize: "12px", color: "#999", margin: "8px 0" }}>or</p>

          {/* Browse Files Button */}
          <input type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} id="file-upload-input" style={{ display: "none" }} />
          <label htmlFor="file-upload-input" className="browse-btn">
            Browse Files
          </label>

          {/* Google Drive Link */}
          <div className="gdrive-input-container">
            <p style={{ margin: "15px 0 10px 0", color: "#666", fontSize: "14px" }}>or</p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%" }}>
              <input
                type="text"
                className="gdrive-link-input"
                placeholder="Paste Google Drive link..."
                value={gdriveLink}
                onChange={(e) => setGdriveLink(e.target.value)}
                disabled={fetchingGdrive}
              />
              <button className="gdrive-fetch-btn" onClick={handleFetchGdrive} disabled={fetchingGdrive}>
                {fetchingGdrive ? "Fetching..." : "Fetch"}
              </button>
            </div>
          </div>

          {/* Creative Library Button */}
          <div className="creative-library-link-container">
            <p style={{ margin: "10px 0", color: "#666", fontSize: "14px" }}>or</p>
            <button className="open-library-btn" onClick={openCreativeLibrary}>
              📚 Browse Creative Library
            </button>
          </div>
        </div>

        {/* Selected Files List */}
        {files.length > 0 && (
          <div className="uploaded-files-list">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <h3 style={{ margin: 0 }}>
                {files.length} file{files.length > 1 ? "s" : ""} selected
              </h3>
              <button className="clear-all-btn" onClick={clearAllFiles} disabled={uploading}>
                Clear All
              </button>
            </div>

            <div className="files-list-container">
              {files.map((file, index) => (
                <div key={index} className="file-item">
                  <div className="file-info">
                    <span className="file-icon">{file.type?.startsWith("image/") ? "🖼️" : file.type?.startsWith("video/") ? "🎥" : "📄"}</span>
                    <div className="file-details">
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                    </div>
                  </div>
                  <button className="remove-file-btn" onClick={() => removeFile(index)} disabled={uploading}>
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Upload Progress */}
            {uploading && (
              <div className="upload-progress-container">
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                </div>
                <p className="progress-text">Uploading... {uploadProgress}%</p>
              </div>
            )}

            {/* Upload Button */}
            <button className="upload-btn" onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading..." : `Upload ${files.length} Creative${files.length > 1 ? "s" : ""}`}
            </button>
          </div>
        )}

        {/* Supported Formats Info */}
        <div className="supported-formats-info">
          <p style={{ fontSize: "12px", color: "#999", textAlign: "center", margin: "16px 0 0 0" }}>
            Supported formats: JPG, PNG, GIF, MP4, MOV • Max size: 4GB per file
          </p>
        </div>
      </div>
    </div>
  );
}

export default CreativeUpload;
