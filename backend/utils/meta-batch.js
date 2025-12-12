import axios from "axios";
import FormData from "form-data";
import fs from "fs";

const API_VERSION = process.env.META_API_VERSION || "v24.0";
const BATCH_SIZE_LIMIT = 50;

/**
 * Create a batch operation object
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} relativeUrl - Relative URL (e.g., "act_123/ads")
 * @param {Object} body - Request body for POST/PUT operations
 * @param {string} name - Optional name for dependent operations
 * @param {Array} attachedFiles - Optional array of file attachment names
 * @param {string} accessToken - Optional access token for this specific operation
 * @returns {Object} Batch operation object
 */
export function createBatchOperation(method, relativeUrl, body = null, name = null, attachedFiles = null, accessToken = null) {
  const operation = {
    method: method.toUpperCase(),
    relative_url: relativeUrl,
  };

  // Add name for dependent operations
  if (name) {
    operation.name = name;
  }

  // Add body for POST/PUT operations (URL-encoded format)
  if (body && (method === "POST" || method === "PUT")) {
    if (typeof body === "object") {
      // Convert object to URL-encoded string
      operation.body = new URLSearchParams(body).toString();
    } else {
      operation.body = body;
    }
  }

  // Add attached files reference
  if (attachedFiles && Array.isArray(attachedFiles)) {
    operation.attached_files = attachedFiles.join(",");
  }

  // Add access token for this specific operation
  if (accessToken) {
    // Append to relative_url as query param
    const separator = relativeUrl.includes("?") ? "&" : "?";
    operation.relative_url = `${relativeUrl}${separator}access_token=${accessToken}`;
  }

  return operation;
}

/**
 * Execute a batch request to Meta Graph API
 * @param {Array} operations - Array of batch operations
 * @param {string} defaultAccessToken - Default access token (fallback)
 * @param {Object} binaryFiles - Optional object mapping file names to file paths
 * @param {boolean} includeHeaders - Include response headers (default: false)
 * @returns {Promise<Array>} Array of responses
 */
export async function executeBatchRequest(operations, defaultAccessToken, binaryFiles = null, includeHeaders = false) {
  if (!operations || operations.length === 0) {
    throw new Error("No operations provided for batch request");
  }

  if (!defaultAccessToken) {
    throw new Error("Access token is required for batch requests");
  }

  if (operations.length > BATCH_SIZE_LIMIT) {
    throw new Error(`Batch size exceeds limit of ${BATCH_SIZE_LIMIT} operations`);
  }

  const graphUrl = `https://graph.facebook.com/${API_VERSION}/`;

  try {
    let response;

    // Check if we have binary files to upload
    if (binaryFiles && Object.keys(binaryFiles).length > 0) {
      // Use multipart/form-data for binary uploads
      const formData = new FormData();

      // Add batch operations
      formData.append("batch", JSON.stringify(operations));

      // Add access token
      formData.append("access_token", defaultAccessToken);

      // Add include_headers parameter
      formData.append("include_headers", includeHeaders.toString());

      // Add binary files
      for (const [fileName, filePath] of Object.entries(binaryFiles)) {
        if (fs.existsSync(filePath)) {
          formData.append(fileName, fs.createReadStream(filePath));
        } else {
          console.warn(`File not found: ${filePath}`);
        }
      }

      response = await axios.post(graphUrl, formData, {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
    } else {
      // Regular batch request without binary files
      const params = new URLSearchParams();
      params.append("batch", JSON.stringify(operations));
      params.append("access_token", defaultAccessToken);
      params.append("include_headers", includeHeaders.toString());

      response = await axios.post(graphUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    }

    // Parse responses
    return parseBatchResponse(response.data);
  } catch (error) {
    console.error("Batch request failed:", error.response?.data || error.message);
    throw error;
  }
}

/**
 * Parse batch response and extract data
 * @param {Array} batchResponse - Raw batch response from Meta API
 * @returns {Array} Parsed responses
 */
function parseBatchResponse(batchResponse) {
  if (!Array.isArray(batchResponse)) {
    throw new Error("Invalid batch response format");
  }

  return batchResponse.map((response, index) => {
    const result = {
      index,
      code: response.code,
      success: response.code >= 200 && response.code < 300,
      headers: response.headers || [],
    };

    // Parse body if present
    if (response.body) {
      try {
        result.data = JSON.parse(response.body);

        // Check for error in body
        if (result.data.error) {
          result.success = false;
          result.error = result.data.error;
        }

        // Normalize response formats - Meta returns different field names for copy operations
        // Standardize to 'id' field for consistency
        if (result.data && !result.data.error) {
          result.data.id = result.data.id || result.data.copied_adset_id || result.data.copied_campaign_id || result.data.copied_ad_id;
        }
      } catch (e) {
        result.body = response.body;
      }
    }

    // Handle null responses (timeouts or incomplete operations)
    if (response.code === null || response.code === undefined) {
      result.success = false;
      result.error = { message: "Operation timed out or was not completed" };
      result.timeout = true;
    }

    return result;
  });
}

/**
 * Split a large batch into smaller chunks and execute sequentially
 * @param {Array} operations - Array of batch operations
 * @param {string} defaultAccessToken - Default access token
 * @param {Object} binaryFiles - Optional binary files
 * @param {boolean} includeHeaders - Include response headers
 * @returns {Promise<Array>} Combined array of all responses
 */
export async function executeChunkedBatchRequest(operations, defaultAccessToken, binaryFiles = null, includeHeaders = false) {
  if (operations.length <= BATCH_SIZE_LIMIT) {
    return executeBatchRequest(operations, defaultAccessToken, binaryFiles, includeHeaders);
  }

  console.log(`Splitting ${operations.length} operations into chunks of ${BATCH_SIZE_LIMIT}`);

  const chunks = [];
  for (let i = 0; i < operations.length; i += BATCH_SIZE_LIMIT) {
    chunks.push(operations.slice(i, i + BATCH_SIZE_LIMIT));
  }

  const allResults = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Executing chunk ${i + 1} of ${chunks.length}`);
    const chunkResults = await executeBatchRequest(chunks[i], defaultAccessToken, binaryFiles, includeHeaders);
    allResults.push(...chunkResults);
  }

  return allResults;
}

/**
 * Create multiple ads in batch
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @param {Array} adsData - Array of ad data objects
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} Array of created ad results
 */
export async function batchCreateAds(accountId, adsData, accessToken) {
  const normalizedAccountId = accountId.replace(/^act_/, "");

  const operations = adsData.map((adData, index) => {
    const body = {
      name: adData.name,
      adset_id: adData.adset_id,
      status: adData.status || "PAUSED",
      creative: JSON.stringify({ creative_id: adData.creative_id }),
    };

    return createBatchOperation("POST", `act_${normalizedAccountId}/ads`, body, `create-ad-${index}`);
  });

  return executeChunkedBatchRequest(operations, accessToken);
}

/**
 * Create multiple ad creatives in batch
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @param {Array} creativesData - Array of creative data objects
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} Array of created creative results
 */
export async function batchCreateAdCreatives(accountId, creativesData, accessToken) {
  const normalizedAccountId = accountId.replace(/^act_/, "");

  const operations = creativesData.map((creativeData, index) => {
    const body = {
      name: creativeData.name,
      object_story_spec: JSON.stringify(creativeData.object_story_spec),
    };

    return createBatchOperation("POST", `act_${normalizedAccountId}/adcreatives`, body, `create-creative-${index}`);
  });

  return executeChunkedBatchRequest(operations, accessToken);
}

/**
 * Create ads with creatives in a single batch (dependent operations)
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @param {Array} adsData - Array of objects with creative and ad data
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} Array of results
 */
export async function batchCreateCreativesAndAds(accountId, adsData, accessToken) {
  const normalizedAccountId = accountId.replace(/^act_/, "");

  const operations = [];

  adsData.forEach((adData, index) => {
    // First, create the creative
    const creativeBody = {
      name: adData.creativeName || adData.adName,
      object_story_spec: JSON.stringify(adData.object_story_spec),
    };

    operations.push(createBatchOperation("POST", `act_${normalizedAccountId}/adcreatives`, creativeBody, `create-creative-${index}`));

    // Then, create the ad using the creative ID from the previous operation
    const adBody = {
      name: adData.adName,
      adset_id: adData.adset_id,
      status: adData.status || "PAUSED",
      creative: JSON.stringify({ creative_id: `{result=create-creative-${index}:$.id}` }),
    };

    operations.push(createBatchOperation("POST", `act_${normalizedAccountId}/ads`, adBody, `create-ad-${index}`));
  });

  return executeChunkedBatchRequest(operations, accessToken);
}

/**
 * Update multiple campaign statuses in batch
 * @param {Array} campaignIds - Array of campaign IDs
 * @param {string} status - New status (ACTIVE, PAUSED, etc.)
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} Array of update results
 */
export async function batchUpdateCampaignStatus(campaignIds, status, accessToken) {
  const operations = campaignIds.map((campaignId, index) => {
    return createBatchOperation("POST", `${campaignId}`, { status }, `update-campaign-${index}`);
  });

  return executeChunkedBatchRequest(operations, accessToken);
}

/**
 * Upload multiple images in batch with binary data
 * @param {string} accountId - Ad account ID (without act_ prefix)
 * @param {Array} imagePaths - Array of image file paths
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} Array of upload results
 */
export async function batchUploadImages(accountId, imagePaths, accessToken) {
  const normalizedAccountId = accountId.replace(/^act_/, "");

  // Meta's batch API limitation: Cannot batch binary uploads to adimages endpoint
  // This is a known limitation, we need to use sequential uploads
  // Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-image

  console.warn("Note: Image uploads cannot be batched via Graph API. Using optimized sequential uploads.");

  const operations = [];
  const binaryFiles = {};

  imagePaths.forEach((imagePath, index) => {
    const fileName = `file${index}`;
    binaryFiles[fileName] = imagePath;

    operations.push(createBatchOperation("POST", `act_${normalizedAccountId}/adimages`, { name: `image-${index}` }, `upload-image-${index}`, [fileName]));
  });

  return executeChunkedBatchRequest(operations, accessToken, binaryFiles);
}

/**
 * Fetch data from multiple accounts in batch
 * @param {Array} accountIds - Array of account IDs
 * @param {string} fields - Fields to fetch
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} Array of account data
 */
export async function batchFetchAccountData(accountIds, fields, accessToken) {
  const operations = accountIds.map((accountId, index) => {
    const normalizedAccountId = accountId.replace(/^act_/, "");
    return createBatchOperation("GET", `act_${normalizedAccountId}?fields=${fields}`, null, `fetch-account-${index}`);
  });

  return executeChunkedBatchRequest(operations, accessToken);
}

/**
 * Retry failed operations from a batch response
 * @param {Array} batchResponse - Previous batch response
 * @param {Array} originalOperations - Original operations array
 * @param {string} accessToken - Access token
 * @param {Object} binaryFiles - Optional binary files
 * @returns {Promise<Array>} Array of retry results
 */
export async function retryFailedOperations(batchResponse, originalOperations, accessToken, binaryFiles = null) {
  const failedOperations = [];
  const failedIndices = [];

  batchResponse.forEach((response, index) => {
    if (!response.success && !response.timeout) {
      failedOperations.push(originalOperations[index]);
      failedIndices.push(index);
    }
  });

  if (failedOperations.length === 0) {
    console.log("No failed operations to retry");
    return [];
  }

  console.log(`Retrying ${failedOperations.length} failed operations`);

  const retryResults = await executeChunkedBatchRequest(failedOperations, accessToken, binaryFiles);

  // Map retry results back to original indices
  return retryResults.map((result, i) => ({
    ...result,
    originalIndex: failedIndices[i],
  }));
}

/**
 * Fetch DSA (Dynamic Search Ads) configuration for an ad account
 * Includes promote_pages and dsa_recommendations
 * @param {string} accountId - Ad account ID (without 'act_' prefix)
 * @param {string} accessToken - User's access token
 * @returns {Promise<Object>} DSA configuration with promote_pages and recommendations
 */
export async function fetchDSAConfiguration(accountId, accessToken) {
  try {
    const normalizedId = accountId.replace(/^act_/, "");
    const url = `https://graph.facebook.com/${API_VERSION}/act_${normalizedId}`;

    const response = await axios.get(url, {
      params: {
        fields: "default_dsa_beneficiary,promote_pages{id,name},dsa_recommendations{id,name}",
        access_token: accessToken,
      },
    });

    const data = response.data;
    const promotePages = data.promote_pages?.data || [];
    const dsaRecommendations = data.dsa_recommendations?.data || [];
    
    console.log(`📊 DSA Config for act_${normalizedId}:`, {
      beneficiary: data.default_dsa_beneficiary,
      promote_pages: promotePages.length,
      promote_pages_list: promotePages.map(p => `${p.name} (${p.id})`),
      recommendations: dsaRecommendations.length,
      recommendations_list: dsaRecommendations.map(r => `${r.name} (${r.id})`),
    });

    return {
      accountId: normalizedId,
      defaultBeneficiary: data.default_dsa_beneficiary,
      promotePages: promotePages,
      dsaRecommendations: dsaRecommendations,
    };
  } catch (err) {
    console.error(`Failed to fetch DSA config for ${accountId}:`, err.message);
    return {
      accountId: accountId.replace(/^act_/, ""),
      defaultBeneficiary: null,
      promotePages: [],
      dsaRecommendations: [],
    };
  }
}

/**
 * Find matching page in target account based on source page
 * Strategy: 
 * 1. Try DSA recommendations first
 * 2. Try exact ID match
 * 3. Try name match
 * 4. Try to find ANY common page between source and target promote_pages
 * @param {Object} sourcePage - Source page object {id, name}
 * @param {Array} targetPages - Array of target pages to search
 * @param {Array} targetDSARecommendations - Array of DSA recommendations from target account
 * @param {Array} sourcePromotePages - Array of all source promote pages (for fallback)
 * @returns {Object|null} Matching page or null
 */
export function findMatchingPage(sourcePage, targetPages, targetDSARecommendations = [], sourcePromotePages = []) {
  if (!sourcePage || !targetPages || targetPages.length === 0) {
    return null;
  }

  // Strategy 1: Check if source page ID is in target's DSA recommendations
  if (sourcePage.id && targetDSARecommendations && targetDSARecommendations.length > 0) {
    const recommendedMatch = targetDSARecommendations.find((rec) => rec.id === sourcePage.id);
    if (recommendedMatch) {
      // Verify it's in target's promote_pages
      const pageInPromotePages = targetPages.find((p) => p.id === recommendedMatch.id);
      if (pageInPromotePages) {
        console.log(`✅ Found DSA recommended page match: ${recommendedMatch.id} (${recommendedMatch.name})`);
        return pageInPromotePages;
      }
    }
  }

  // Strategy 2: Try exact ID match in promote_pages
  const exactMatch = targetPages.find((p) => p.id === sourcePage.id);
  if (exactMatch) {
    console.log(`✅ Found exact ID match: ${sourcePage.id}`);
    return exactMatch;
  }

  // Strategy 3: Try name match if no ID match
  if (sourcePage.name) {
    const nameMatch = targetPages.find(
      (p) => p.name && p.name.toLowerCase() === sourcePage.name.toLowerCase()
    );
    if (nameMatch) {
      console.log(`✅ Found name match: "${sourcePage.name}" → ${nameMatch.id}`);
      return nameMatch;
    }
  }

  // Strategy 4: Find ANY common page between source and target promote_pages by ID
  // This is a fallback when beneficiary doesn't match but pages are available
  if (sourcePromotePages && sourcePromotePages.length > 0) {
    const commonPage = sourcePromotePages.find((sourcePg) => {
      const match = targetPages.find((targetPg) => targetPg.id === sourcePg.id);
      return match !== undefined;
    });
    
    if (commonPage) {
      const matchedTargetPage = targetPages.find((p) => p.id === commonPage.id);
      if (matchedTargetPage) {
        console.log(`✅ Found common promote page: "${commonPage.name}" (${commonPage.id}) exists in both accounts`);
        return matchedTargetPage;
      }
    }
  }

  console.warn(`⚠️ No matching page found for: ${sourcePage.name} (${sourcePage.id})`);
  return null;
}

/**
 * Detect DSA mismatch between source and target accounts
 * @param {Object} sourceDSA - Source account DSA config
 * @param {Object} targetDSA - Target account DSA config
 * @returns {Object} Detection result with matched page info
 */
export function detectDSAMismatch(sourceDSA, targetDSA) {
  const result = {
    hasMismatch: false,
    sourcePageId: sourceDSA.defaultBeneficiary,
    targetPageId: targetDSA.defaultBeneficiary,
    matchedPageId: null,
    matchedPage: null,
    availablePages: targetDSA.promotePages,
    error: null,
  };

  // If source has no DSA, no mismatch
  if (!sourceDSA.defaultBeneficiary) {
    console.log("✅ Source account has no DSA beneficiary");
    return result;
  }

  // If same account (IDs match), no mismatch
  if (sourceDSA.defaultBeneficiary === targetDSA.defaultBeneficiary) {
    console.log("✅ Source and target have same DSA beneficiary");
    return result;
  }

  // Mismatch detected
  result.hasMismatch = true;
  console.warn(`⚠️ DSA Mismatch detected:`);
  console.warn(`   Source beneficiary: ${sourceDSA.defaultBeneficiary}`);
  console.warn(`   Target beneficiary: ${targetDSA.defaultBeneficiary}`);

  // Try to find matching page
  const sourcePage = {
    id: sourceDSA.defaultBeneficiary,
    name: sourceDSA.promotePages?.find((p) => p.id === sourceDSA.defaultBeneficiary)?.name,
  };

  // Pass target's DSA recommendations and source's promote pages for intelligent matching
  const matchedPage = findMatchingPage(sourcePage, targetDSA.promotePages, targetDSA.dsaRecommendations, sourceDSA.promotePages);

  if (matchedPage) {
    result.matchedPageId = matchedPage.id;
    result.matchedPage = matchedPage;
    console.log(`✅ Auto-matched to target page: ${matchedPage.name} (${matchedPage.id})`);
  } else {
    result.error = `No matching DSA beneficiary page found in target account. Available pages: ${targetDSA.promotePages
      .map((p) => `${p.name} (${p.id})`)
      .join(", ") || "None"}`;
    console.error(result.error);
  }

  return result;
}

export default {
  createBatchOperation,
  executeBatchRequest,
  executeChunkedBatchRequest,
  batchCreateAds,
  batchCreateAdCreatives,
  batchCreateCreativesAndAds,
  batchUpdateCampaignStatus,
  batchUploadImages,
  batchFetchAccountData,
  retryFailedOperations,
  fetchDSAConfiguration,
  findMatchingPage,
  detectDSAMismatch,
  BATCH_SIZE_LIMIT,
};
