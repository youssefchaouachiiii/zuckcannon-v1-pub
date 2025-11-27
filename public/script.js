let campaignList;
let pixelList;
let campaignAdSets = {};
let campaignSelectGroup = null; // Store the SingleSelectGroup instance for campaigns

// ============================================
// CAMPAIGN OBJECTIVE TO OPTIMIZATION GOAL MAPPING
// ============================================

/**
 * Map campaign objective to appropriate optimization goal for ad sets
 * Based on Meta's campaign objectives and compatible optimization goals
 */
function getOptimizationGoalFromObjective(objective) {
  const objectiveMapping = {
    // Awareness objectives
    OUTCOME_AWARENESS: "REACH",
    BRAND_AWARENESS: "REACH",
    REACH: "REACH",

    // Traffic objectives
    OUTCOME_TRAFFIC: "LINK_CLICKS",
    LINK_CLICKS: "LINK_CLICKS",

    // Engagement objectives
    OUTCOME_ENGAGEMENT: "POST_ENGAGEMENT",
    POST_ENGAGEMENT: "POST_ENGAGEMENT",
    VIDEO_VIEWS: "VIDEO_VIEWS",

    // Leads objectives
    OUTCOME_LEADS: "LEAD_GENERATION",
    LEAD_GENERATION: "LEAD_GENERATION",

    // Sales/Conversion objectives
    OUTCOME_SALES: "OFFSITE_CONVERSIONS",
    CONVERSIONS: "OFFSITE_CONVERSIONS",

    // App promotion objectives
    OUTCOME_APP_PROMOTION: "APP_INSTALLS",
    APP_INSTALLS: "APP_INSTALLS",
    MOBILE_APP_ENGAGEMENT: "APP_INSTALLS",

    // Store traffic
    STORE_VISITS: "VISIT_INSTAGRAM_PROFILE",
  };

  // Return mapped optimization goal or default to LINK_CLICKS as a safe fallback
  return objectiveMapping[objective] || "LINK_CLICKS";
}

/**
 * Update the visibility and requirement of pixel/event type fields based on optimization goal
 * Only OFFSITE_CONVERSIONS requires pixel_id + custom_event_type
 */
function updateConversionFieldsVisibility(optimizationGoal) {
  const pixelDropdownContainer = document.querySelector('.dropdown-container .custom-dropdown .dropdown-selected[data-dropdown="pixel"]');
  const eventTypeContainer = document.querySelector(".event-type-container");
  const pixelDisplay = pixelDropdownContainer ? pixelDropdownContainer.querySelector(".dropdown-display") : null;
  const eventTypeInput = document.querySelector(".config-event-type");

  const requiresPixelAndEvent = optimizationGoal === "OFFSITE_CONVERSIONS";

  // Update placeholder text to indicate if required
  if (pixelDisplay) {
    pixelDisplay.textContent = requiresPixelAndEvent ? "Pixel*" : "Pixel";
  }

  if (eventTypeInput) {
    eventTypeInput.placeholder = requiresPixelAndEvent ? "Custom Event Type*" : "Custom Event Type";
  }

  // Show/hide conversion fields based on requirement
  // For now, always show them but mark as optional unless required
  if (pixelDropdownContainer) {
    pixelDropdownContainer.parentElement.style.opacity = requiresPixelAndEvent ? "1" : "1";
  }

  if (eventTypeContainer) {
    eventTypeContainer.style.opacity = requiresPixelAndEvent ? "1" : "1";
  }

  // console.log(`Conversion fields ${requiresPixelAndEvent ? 'required' : 'optional'} for optimization goal: ${optimizationGoal}`);

  // Don't trigger checkRequiredFields here to avoid infinite recursion
  // checkRequiredFields will call this function if needed
}

// ============================================
// ERROR HANDLING UTILITIES
// ============================================

/**
 * Extract user-friendly error message from response or error object
 * Priority: error_user_msg > message > error > default
 */
async function extractErrorMessage(responseOrError) {
  try {
    // If it's an error object
    if (responseOrError instanceof Error) {
      return responseOrError.message || "An error occurred. Please try again.";
    }

    // If it's a Response object
    if (responseOrError instanceof Response) {
      const cloned = responseOrError.clone();
      const data = await cloned.json().catch(() => ({}));
      return data.error_user_msg || data.message || data.error || "An error occurred. Please try again.";
    }

    // If it's already a parsed object
    if (typeof responseOrError === "object") {
      return responseOrError.error_user_msg || responseOrError.message || responseOrError.error || "An error occurred. Please try again.";
    }

    // Fallback
    return String(responseOrError) || "An error occurred. Please try again.";
  } catch (err) {
    return "An error occurred. Please try again.";
  }
}

// Check authentication status on page load
async function checkAuthStatus() {
  try {
    const response = await fetch("/api/auth/status");

    if (!response.ok) {
      throw new Error("Failed to check authentication status");
    }

    const data = await response.json();

    const authMessage = document.getElementById("auth-message");
    const mainContainer = document.getElementById("main-container");
    const headerControls = document.querySelector(".header-controls");

    if (data.authenticated && data.user) {
      // User is authenticated
      document.getElementById("username-display").textContent = data.user.username;
      authMessage.style.display = "none";
      mainContainer.style.display = "grid";
      headerControls.style.display = "flex";

      // Load the app data
      init();
    } else {
      // User is not authenticated
      authMessage.style.display = "block";
      mainContainer.style.display = "none";
      headerControls.style.display = "none";
    }
  } catch (error) {
    console.error("Error checking auth status:", error);
    showError("Failed to verify authentication. Please refresh the page.");
  }
}

// Setup logout functionality
function setupLogout() {
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        const response = await fetch("/logout", { method: "POST" });
        if (response.ok || response.redirected) {
          window.location.href = "/login.html";
        }
      } catch (error) {
        console.error("Logout error:", error);
      }
    });
  }
}

// Setup refresh button functionality
function setupRefreshButton() {
  const refreshBtn = document.querySelector(".refresh-data-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      await refreshMetaDataManually();
    });
  }
}

// Initialize auth on page load
document.addEventListener("DOMContentLoaded", () => {
  checkAuthStatus();
  setupLogout();
  setupRefreshButton();
});

class AppStateManager {
  constructor() {
    this.state = {
      selectedAccount: null,
      selectedCampaign: null,
      campaignBidStrategy: null,
      campaignDailyBudget: null,
      campaignLifetimeBudget: null,
      adSetConfig: {},
      uploadedAssets: [],
      adCopyData: {},
      createAds: [],
      fbLocationsData: null,
      selectedCountries: [],
      selectedRegions: [],
    };
  }

  updateState(key, value) {
    this.state[key] = value;
  }

  addUploadedAsset(asset) {
    this.state.uploadedAssets.push(asset);
  }

  getState() {
    return this.state;
  }
}

const appState = new AppStateManager();

// Function to show Facebook connect prompt
function showFacebookConnectPrompt() {
  const mainContainer = document.getElementById("main-container");
  mainContainer.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh; text-align: center; padding: 20px;">
      <svg viewBox="0 0 24 24" fill="#1877f2" style="width: 80px; height: 80px; margin-bottom: 20px;">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
      </svg>
      <h2 style="font-size: 24px; margin-bottom: 10px; color: #333;">Connect Your Facebook Account</h2>
      <p style="font-size: 14px; color: #666; margin-bottom: 30px; max-width: 400px;">
        To access your ad accounts, campaigns, and create ads, you need to connect your Facebook account with the necessary permissions.
      </p>
      <a href="/auth/facebook" style="display: inline-block; padding: 12px 24px; background: #1877f2; color: white; text-decoration: none; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s;">
        Connect with Facebook
      </a>
    </div>
  `;
}

async function fetchMetaData(forceRefresh = false) {
  try {
    const url = forceRefresh ? "/api/fetch-meta-data?refresh=true" : "/api/fetch-meta-data";
    const response = await fetch(url);

    if (response.status === 403) {
      const data = await response.json();
      if (data.needsAuth) {
        // User needs to connect Facebook account
        showFacebookConnectPrompt();
        return null;
      }
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch Meta data: ${response.status}`);
    }

    const data = await response.json();

    if (data.fromCache && !forceRefresh) {
      showCacheNotification(data.cacheAge);
    }

    return data;
  } catch (err) {
    console.error("Error fetching meta data:", err);
    showError("Failed to load Meta data. Please refresh the page or contact admin.");
    throw err;
  }
}

// Fetch FB Locations Data
async function fetchFBLocationsData() {
  try {
    const response = await fetch("/data/fb-locations.json");
    if (!response.ok) {
      console.error("Failed to fetch FB locations data");
      return null;
    }
    const data = await response.json();
    appState.updateState("fbLocationsData", data);
    return data;
  } catch (err) {
    console.error("Error fetching FB locations data:", err);
    return null;
  }
}

function populateAdAccounts(ad_accounts) {
  const adAccList = document.querySelector("#ad-acc-list");

  for (ad_account of ad_accounts) {
    adAccList.innerHTML += `<li><a href="#" class="account" data-next-column=".campaign-column" data-campaign-id="${ad_account.account_id}"
            data-col-id="1">${ad_account.name}</a></li>`;
  }
  new SingleSelectGroup(".account");
}

function populateCampaigns(campaigns) {
  const campaignColumn = document.querySelector(".campaign-column");
  campaignColumn.innerHTML += `<div class="campaign-selection"></div>`;
  const campaignSelection = document.querySelector(".campaign-selection");

  // Sort campaigns: ACTIVE first, then by created_time (most recent first)
  const sortedCampaigns = campaigns.sort((a, b) => {
    // Sort by status (ACTIVE comes before other statuses)
    if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
    if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;

    // If same status, sort by created_time (most recent first)
    const dateA = new Date(a.created_time);
    const dateB = new Date(b.created_time);
    return dateB - dateA;
  });

  for (const campaign of sortedCampaigns) {
    let classlist;
    if (campaign.status === "ACTIVE") {
      classlist = "campaign active";
    } else {
      classlist = "campaign";
    }

    if (campaign.adsets && campaign.adsets.data) {
      campaignAdSets[campaign.id] = campaign.adsets.data;
    }

    if (campaign.insights) {
      campaignSelection.innerHTML += `<div class="${classlist}" data-next-column=".action-column" style="display:none" data-col-id="2"
          data-acc-campaign-id="${campaign.account_id}" data-daily-budget="${campaign.daily_budget || ""}" data-lifetime-budget="${campaign.lifetime_budget || ""}" data-bid-strategy="${
        campaign.bid_strategy || "LOWEST_COST_WITHOUT_CAP"
      }" data-campaign-id="${campaign.id}" data-objective="${campaign.objective || ""}" data-special-ad-categories='${JSON.stringify(campaign.special_ad_categories)}'>
          <input type="checkbox" class="campaign-checkbox" style="display: none;">
          <label>
            <h3>${campaign.name}</h3>
            <ul>
              <li>${campaign.status}</li>
              <li>Spend: ${campaign.insights.data[0].spend}</li>
              <li>Clicks: ${campaign.insights.data[0].clicks}</li>
            </ul>
          </label>
        </div>`;
    } else {
      campaignSelection.innerHTML += `<div class="${classlist}" data-next-column=".action-column" style="display:none" data-col-id="2"
        data-acc-campaign-id="${campaign.account_id}" data-campaign-id="${campaign.id}" data-daily-budget="${campaign.daily_budget || ""}" data-lifetime-budget="${campaign.lifetime_budget || ""}" data-bid-strategy="${
        campaign.bid_strategy || "LOWEST_COST_WITHOUT_CAP"
      }" data-objective="${campaign.objective || ""}" data-special-ad-categories='${JSON.stringify(campaign.special_ad_categories)}'>
        <input type="checkbox" class="campaign-checkbox" style="display: none;">
        <label>
          <h3>${campaign.name}</h3>
          <ul>
            <li>${campaign.status}</li>
            <li>Spend: N/A</li>
            <li>Clicks: N/A</li>
          </ul>
        </label>
      </div>`;
    }

    // Clean up existing campaign select group before creating new one
    if (campaignSelectGroup) {
      campaignSelectGroup.cleanup();
    }
    campaignSelectGroup = new SingleSelectGroup(".campaign");
    campaignList = document.querySelectorAll(".campaign");
  }
}

function populatePixels(pixels) {
  const pixelDropdownOptions = document.querySelector(".dropdown-options.pixel");

  if (pixelDropdownOptions) {
    pixelDropdownOptions.innerHTML = "";

    if (!pixels || pixels.length === 0) {
      pixelDropdownOptions.innerHTML = '<li style="opacity: 0.6; cursor: default;">No pixels available</li>';
      return;
    }

    for (const pixel of pixels) {
      if (!pixel.adspixels || !pixel.adspixels.data) {
        continue;
      }

      const pixelData = {
        acc_id: pixel.account_id,
        data: pixel.adspixels.data,
      };

      for (const data of pixelData.data) {
        // Skip invalid pixels (e.g., account IDs mistakenly included)
        if (!data || !data.id || !data.name || data.id.startsWith("act_")) {
          continue;
        }

        // Determine pixel status
        const isUnavailable = data.is_unavailable === true;

        // Parse last_fired_time (can be ISO string or null)
        let lastFiredDate = null;
        let hasRecentActivity = false;

        if (data.last_fired_time) {
          // Parse ISO 8601 string to Date object
          lastFiredDate = new Date(data.last_fired_time);

          // Check if it's a valid date
          if (!isNaN(lastFiredDate.getTime())) {
            hasRecentActivity = true;
          }
        }

        // Determine status class and tooltip (no emoji icons)
        let statusClass = "";
        let tooltipText = "";

        if (isUnavailable) {
          statusClass = "pixel-unavailable";
          tooltipText = "Pixel unavailable";
        } else if (hasRecentActivity) {
          statusClass = "pixel-active";
          tooltipText = `Active - Last fired: ${lastFiredDate.toLocaleDateString()}`;
        } else {
          statusClass = "pixel-inactive";
          tooltipText = "No recent activity";
        }

        pixelDropdownOptions.innerHTML += `
              <li class="pixel-option ${statusClass}"
                  data-pixel-id="${data.id}"
                  data-pixel-account-id="${pixelData.acc_id}"
                  title="${tooltipText}">
                ${data.name}
              </li>
        `;
      }
    }

    if (pixelDropdownOptions.innerHTML === "") {
      pixelDropdownOptions.innerHTML = '<li style="opacity: 0.6; cursor: default;">No pixels available for your accounts</li>';
    }

    const pixelDropdownElement = pixelDropdownOptions.closest(".custom-dropdown");
    if (pixelDropdownElement && pixelDropdownElement.customDropdownInstance) {
      attachDropdownOptionListeners(pixelDropdownElement);
    }
  }
  pixelList = document.querySelectorAll(".pixel-option");
}

function populatePages(pages) {
  const pagesDropdownOptions = document.querySelectorAll(".dropdown-options.pages");

  pagesDropdownOptions.forEach((dropdown) => {
    dropdown.innerHTML = "";
    for (const page of pages) {
      dropdown.innerHTML += `
                <li data-page-id="${page.id}">${page.name}</li>
        `;
    }

    // Re-attach event listeners to the newly added options
    const parentDropdown = dropdown.closest(".custom-dropdown");
    if (parentDropdown) {
      attachDropdownOptionListeners(parentDropdown);
    }
  });
}

// Populate campaign special ad category country dropdowns from fb-locations.json
function populateSpecialAdCountries() {
  const fbData = appState.getState().fbLocationsData;

  if (!fbData || !fbData.countries) {
    console.warn("FB locations data not available for country population");
    return;
  }

  // Find all campaign special country dropdown lists
  const countryDropdowns = document.querySelectorAll(".dropdown-options.campaign-special-country");

  countryDropdowns.forEach((dropdown) => {
    // Keep the "None" option and add all countries
    const noneOption = dropdown.querySelector('[data-value=""]');

    // Clear all options except "None"
    dropdown.innerHTML = "";
    if (noneOption) {
      dropdown.appendChild(noneOption);
    } else {
      const newNoneOption = document.createElement("li");
      newNoneOption.setAttribute("data-value", "");
      newNoneOption.textContent = "None";
      dropdown.appendChild(newNoneOption);
    }

    // Add all countries sorted alphabetically
    const sortedCountries = [...fbData.countries].sort((a, b) => a.name.localeCompare(b.name));

    sortedCountries.forEach((country) => {
      const li = document.createElement("li");
      li.setAttribute("data-value", country.country_code);
      li.textContent = country.name;
      dropdown.appendChild(li);
    });
  });

  // console.log("Populated special ad category country dropdowns with", fbData.countries.length, "countries");
}

// Main app initialization
async function init() {
  try {
    const [metaResponse, locationsData] = await Promise.all([fetchMetaData(), fetchFBLocationsData()]);

    // If metaResponse is null, user needs to connect Facebook account
    if (!metaResponse) {
      console.log("Facebook account not connected. Showing connect prompt.");
      return;
    }

    populateAdAccounts(metaResponse.adAccounts);
    populateCampaigns(metaResponse.campaigns);
    populatePixels(metaResponse.pixels);
    populatePages(metaResponse.pages);
    populateSpecialAdCountries();

        initializeCampaignSearch();

        initializeGeoSelection();

        initializeEventTypeSelection();

        initializeCreateCampaignDialog();

        initializeCampaignMultiSelect(); // Add this call

    

        setupMetaDataUpdates();

    

        // Setup ad set form validation AFTER app is initialized

        setupAdSetFormValidation();

      } catch (err) {

        console.log("There was an error initializing the app:", err);

      }

    }

    

    function initializeCampaignMultiSelect() {

      const toggle = document.getElementById("campaign-multi-select-toggle");

      const campaignColumn = document.querySelector(".campaign-column");

    

      if (toggle && campaignColumn) {

        toggle.addEventListener("change", () => {

          const isMultiSelect = toggle.checked;

          campaignColumn.classList.toggle("multi-select-mode", isMultiSelect);

    

          // Hide downstream columns when toggling multi-select

          const actionColumn = document.getElementById("col-3");

          const uploadColumn = document.getElementById("col-4");

          if (actionColumn) actionColumn.style.display = "none";

          if (uploadColumn) uploadColumn.style.display = "none";

    

    

          const campaigns = document.querySelectorAll(".campaign");

          campaigns.forEach(campaign => {

            const checkbox = campaign.querySelector(".campaign-checkbox");

            if (checkbox) {

              checkbox.style.display = isMultiSelect ? "inline-block" : "none";

              checkbox.checked = false; // Uncheck all when mode changes

            }

            campaign.classList.remove("selected"); // Deselect all visually

          });

    

          // In multi-select mode, the next step should always be the action column

          if (isMultiSelect) {

              // Add a shared event listener for the whole selection container

              const campaignSelection = document.querySelector('.campaign-selection');

              if (campaignSelection && !campaignSelection.multiSelectListenerAttached) {

                  campaignSelection.addEventListener('click', (e) => {

                      const campaignItem = e.target.closest('.campaign');

                      if (campaignItem && toggle.checked) {

                          const checkbox = campaignItem.querySelector('.campaign-checkbox');

                          if (checkbox) {

                              checkbox.checked = !checkbox.checked;

                              campaignItem.classList.toggle('selected', checkbox.checked);

                               // After a selection is made in multi-select mode, show the action column

                              const actionColumn = document.getElementById("col-3");

                              if (actionColumn) {

                                actionColumn.style.display = "block";

                              }

                          }

                      }

                  });

                  campaignSelection.multiSelectListenerAttached = true;

              }

          }

        });

      }

    }

    

    function clearAdSetForm() {

      const adsetNameInput = document.querySelector(".config-adset-name");

      if (adsetNameInput) {

        adsetNameInput.value = "";

      }

    }

    class SingleSelectGroup {

      constructor(selector) {

        this.selector = selector;

        this.items = document.querySelectorAll(this.selector);

        this.attachEventListeners();

      }

    

      attachEventListeners() {

        // Store bound event handler for cleanup

        this.clickHandler = async (e) => {

          const multiSelectToggle = document.getElementById('campaign-multi-select-toggle');

          const isMultiSelectActive = multiSelectToggle && multiSelectToggle.checked;

    

          if (isMultiSelectActive && e.currentTarget.classList.contains('campaign')) {

            // In multi-select mode, just toggle the checkbox and selection class

            const checkbox = e.currentTarget.querySelector('.campaign-checkbox');

            if (checkbox) {

              checkbox.checked = !checkbox.checked;

              e.currentTarget.classList.toggle('selected', checkbox.checked);

            }

             // Prevent single-select logic and column hiding/showing

            return;

          }

    

          const clickedItem = e.currentTarget;

          const nextColumnSelector = clickedItem.dataset.nextColumn;

          const nextColumn = nextColumnSelector ? document.querySelector(nextColumnSelector) : null;

    

      // 1. Check if currentTarget is already selected.
      for (const i of this.items) {
        if (i.classList.contains("selected") && i != clickedItem) {
          i.classList.remove("selected");
        }
      }

      // 2. Toggle 'selected'
      if (clickedItem.classList.contains("selected")) {
        clickedItem.classList.remove("selected");
        if (nextColumnSelector) {
          this.hideAndClearDownstreamColumns(clickedItem.dataset.colId);
        }
      } else {
        clickedItem.classList.add("selected");

        // Display nextColumn if nextColumn data attribute exists
        if (nextColumnSelector || clickedItem.dataset.actionType === "duplicate-campaign" || clickedItem.dataset.actionType === "duplicate-campaign-multi" || clickedItem.dataset.actionType === "duplicate-adset-multi") {
          // Campaign dataset filtering logic for account column
          if (clickedItem.classList.contains("account")) {
            this.displayNextColumn(nextColumn);
            this.filterCampaigns(clickedItem, campaignList);
            this.filterPixels(clickedItem, pixelList);

            appState.updateState("selectedAccount", clickedItem.dataset.campaignId);
          } else if (clickedItem.classList.contains("campaign")) {
            this.displayNextColumn(nextColumn);

            // Hide create campaign column when selecting an existing campaign
            const campaignCreationColumn = document.getElementById("col-2-5");
            if (campaignCreationColumn) {
              campaignCreationColumn.style.display = "none";
            }

            appState.updateState("selectedCampaign", clickedItem.dataset.campaignId);
            appState.updateState("campaignBidStrategy", clickedItem.dataset.bidStrategy || "LOWEST_COST_WITHOUT_CAP");
            appState.updateState("campaignDailyBudget", clickedItem.dataset.dailyBudget);
            appState.updateState("campaignLifetimeBudget", clickedItem.dataset.lifetimeBudget);

            // update campaign id in ad set config
            const configCampaignId = document.querySelector(".config-campaign-id");
            if (configCampaignId) {
              configCampaignId.value = appState.getState().selectedCampaign;
            }

            // Set optimization goal based on campaign objective
            const campaignObjective = clickedItem.dataset.objective;
            if (campaignObjective) {
              const optimizationGoal = getOptimizationGoalFromObjective(campaignObjective);
              const configOptimizationGoal = document.querySelector(".config-optimization-goal");
              if (configOptimizationGoal) {
                configOptimizationGoal.value = optimizationGoal;
                console.log(`Set optimization goal to ${optimizationGoal} based on campaign objective ${campaignObjective}`);

                // Update pixel/event type UI based on optimization goal
                updateConversionFieldsVisibility(optimizationGoal);
              }
            }

            this.adjustConfigSettings(appState.getState().campaignBidStrategy, appState.getState().campaignDailyBudget, appState.getState().campaignLifetimeBudget);

            // Show/hide age and geo fields based on special_ad_categories
            const specialAdCategories = JSON.parse(clickedItem.dataset.specialAdCategories || "[]");
            const ageContainer = document.querySelector(".targeting-age");
            const minAgeInput = document.querySelector(".min-age");
            const maxAgeInput = document.querySelector(".max-age");
            const geoContainers = document.querySelectorAll(".geo-selection-container");

            if (minAgeInput && maxAgeInput) {
              if (specialAdCategories.length > 0) {
                ageContainer.style.display = "none";
                minAgeInput.required = false;
                maxAgeInput.required = false;
              } else {
                ageContainer.style.display = "flex";
                minAgeInput.required = true;
                maxAgeInput.required = true;
              }
            }

            // Show/hide geo location fields
            geoContainers.forEach((container) => {
              if (specialAdCategories.length > 0) {
                container.style.display = "none";
              } else {
                container.style.display = "block";
              }
            });

            // Clear geo selections when switching campaigns
            appState.updateState("selectedCountries", []);
            appState.updateState("selectedRegions", []);

            // Update the UI to reflect cleared selections
            const selectedCountriesContainer = document.querySelector("#selected-countries");
            if (selectedCountriesContainer) {
              selectedCountriesContainer.innerHTML = "";
            }

            // Check if ad set list is currently visible and update it
            const adsetListContainer = document.querySelector(".adset-list-container");
            if (adsetListContainer && adsetListContainer.style.display !== "none") {
              this.populateAdSetList();
            }

            // Force a re-initialization of the form validation after visibility changes
            if (typeof setupAdSetFormValidation === "function") {
              setupAdSetFormValidation();
            }

            // Trigger validation check IMMEDIATELY after changing visibility
            if (typeof checkRequiredFields === "function") {
              checkRequiredFields();
            }
          } else if (clickedItem.classList.contains("action")) {
            // Handle different action types
            const actionType = clickedItem.dataset.actionType;

            if (actionType === "upload-existing") {
              this.displayNextColumn(nextColumn);
              this.showAdSetList();
            } else if (actionType === "duplicate-existing") {
              this.displayNextColumn(nextColumn);
              this.showAdSetListForDuplication();
            } else if (actionType === "duplicate-campaign") {
              // Show campaign duplication dialog
              const selectedCampaign = appState.getState().selectedCampaign;
              const selectedAccount = appState.getState().selectedAccount;
              if (selectedCampaign) {
                const campaignElement = document.querySelector(`.campaign[data-campaign-id="${selectedCampaign}"]`);
                if (campaignElement) {
                  const campaignData = {
                    id: selectedCampaign,
                    name: campaignElement.querySelector("h3").textContent,
                    account_id: selectedAccount,
                  };
                  this.showDuplicateCampaignDialog(campaignData);
                }
              }
            } else if (actionType === "duplicate-campaign-multi") {
              // Show bulk campaign duplication modal
              console.log("duplicate-campaign-multi action triggered");
              e.preventDefault();
              e.stopPropagation();
              const selectedCampaign = appState.getState().selectedCampaign;
              const selectedAccount = appState.getState().selectedAccount;
              console.log("Selected campaign:", selectedCampaign, "Selected account:", selectedAccount);
              if (selectedCampaign) {
                const campaignElement = document.querySelector(`.campaign[data-campaign-id="${selectedCampaign}"]`);
                console.log("Campaign element:", campaignElement);
                if (campaignElement) {
                  const campaignData = {
                    id: selectedCampaign,
                    name: campaignElement.querySelector("h3").textContent,
                    account_id: selectedAccount,
                  };
                  console.log("Opening bulk campaign modal with data:", campaignData);
                  await openBulkDuplicateCampaignModal(campaignData);
                }
              } else {
                alert("Please select a campaign first");
              }
              return; // Stop further processing
            } else if (actionType === "duplicate-adset-multi") {
              // Show bulk ad set duplication modal
              console.log("duplicate-adset-multi action triggered");
              e.preventDefault();
              e.stopPropagation();
              const selectedCampaign = appState.getState().selectedCampaign;
              console.log("Selected campaign:", selectedCampaign, "AdSets:", campaignAdSets[selectedCampaign]);
              if (selectedCampaign && campaignAdSets[selectedCampaign] && campaignAdSets[selectedCampaign].length > 0) {
                console.log("Opening bulk adset modal");
                await openBulkDuplicateAdSetModal();
              } else {
                alert("Please select a campaign with ad sets first");
              }
              return; // Stop further processing
            } else {
              this.displayNextColumn(nextColumn);
              this.showAdSetConfig();
            }
          } else {
            // Display other columns
            this.displayNextColumn(nextColumn);
          }
        }
      }
    };

    // Add the event handler to each item
    for (const item of this.items) {
      item.addEventListener("click", this.clickHandler);
    }
  }

  // Add cleanup method to remove event listeners
  cleanup() {
    if (this.clickHandler) {
      for (const item of this.items) {
        item.removeEventListener("click", this.clickHandler);
      }
    }
  }

  adjustConfigSettings(bidStrategy, campaignDailyBudget, campaignLifetimeBudget) {
    // Budget and bid strategy are now set at ad set level
    // This function is kept for compatibility but no longer modifies UI
    // Bid strategy fields are hidden since they're campaign-level read-only values

    console.log("Campaign settings (informational only):", {
      bidStrategy: bidStrategy || "LOWEST_COST_WITHOUT_CAP",
      note: "Budget and bid strategy handled at ad set level",
    });

    // Trigger validation check after adjusting settings
    if (typeof checkRequiredFields === "function") {
      checkRequiredFields();
    }
  }

  hideAndClearDownstreamColumns(currentColId) {
    const currentColNum = parseInt(currentColId);

    for (let colId = currentColNum + 1; colId <= 4; colId++) {
      const colElement = document.querySelector(`#col-${colId}`);

      if (colElement) {
        colElement.style.display = "none";

        colElement.querySelectorAll(".selected").forEach((item) => {
          item.classList.remove("selected");
        });

        // If we're hiding column 4 (upload column), clear all its sections
        if (colId === 4) {
          this.clearUploadColumn();
        }
      }
    }
  }

  displayNextColumn(nextColumn) {
    if (nextColumn) {
      nextColumn.style.display = "block";
    }
  }

  filterCampaigns(adAccount, campaignList) {
    for (const camp of campaignList) {
      const accCampId = adAccount.dataset.campaignId;
      const campId = camp.dataset.accCampaignId;

      if (accCampId === campId) {
        camp.style.display = "block";
      } else {
        camp.style.display = "none";
      }
    }
  }

  filterPixels(adAccount, pixelList) {
    if (!pixelList || pixelList.length === 0) return;

    for (const pixel of pixelList) {
      const accCampId = adAccount.dataset.campaignId;
      const pixelId = pixel.dataset.pixelAccountId;

      if (accCampId === pixelId) {
        pixel.style.display = "block";
      } else {
        pixel.style.display = "none";
      }
    }
  }

  clearUploadColumn() {
    const sections = [".adset-config", ".adset-list-container", ".creative-upload", ".ad-copy-container", ".create-ads-container", ".success-wrapper"];

    sections.forEach((selector) => {
      const element = document.querySelector(selector);
      if (element) element.style.display = "none";
    });

    // Also reset the file upload sections
    const uploadSteps = document.querySelectorAll(".upload-step");
    uploadSteps.forEach((step) => {
      step.style.display = "none";
    });

    // Show step 2 by default for next upload
    const step2 = document.querySelector('[data-step="2"]');
    if (step2) step2.style.display = "block";
  }

  showAdSetList() {
    // Clear all sections first
    this.clearUploadColumn();

    // Show ad set list
    const adsetListContainer = document.querySelector(".adset-list-container");
    if (adsetListContainer) {
      adsetListContainer.style.display = "block";
      this.populateAdSetList();
    }
  }

  showAdSetConfig() {
    this.clearUploadColumn();

    // Always clear the form when showing ad set config
    clearAdSetForm();

    // Reset the Create Ad Set button state
    const createButton = document.querySelector(".create-adset-btn");
    if (createButton) {
      createButton.classList.remove("active");
      // Ensure button is not disabled
      createButton.disabled = false;
    }

    const existingConfig = appState.getState().adSetConfig;
    if (existingConfig && existingConfig.id) {
      const dropdowns = document.querySelectorAll(".adset-config .custom-dropdown");

      dropdowns.forEach((dropdown) => {
        const clonedDropdown = dropdown.cloneNode(true);

        // Clear listenerAttached flags from cloned options since listeners aren't cloned
        const clonedOptions = clonedDropdown.querySelectorAll("li");
        clonedOptions.forEach((option) => {
          delete option.listenerAttached;
        });

        // Clear customDropdownInstance from cloned dropdown
        delete clonedDropdown.customDropdownInstance;

        dropdown.parentNode.replaceChild(clonedDropdown, dropdown);
      });
    }

    const adsetConfig = document.querySelector(".adset-config");
    if (adsetConfig) {
      adsetConfig.style.display = "block";

      console.log("Initializing dropdowns for ad set config");
      new CustomDropdown(".adset-config .custom-dropdown");

      // Re-attach event listeners to pixel dropdown options after reinitialization
      const pixelDropdown = document.querySelector(".adset-config .custom-dropdown .dropdown-options.pixel");
      if (pixelDropdown) {
        const pixelDropdownElement = pixelDropdown.closest(".custom-dropdown");
        if (pixelDropdownElement && pixelDropdownElement.customDropdownInstance) {
          console.log("Re-attaching listeners for pixel dropdown after initialization");
          attachDropdownOptionListeners(pixelDropdownElement);
        }
      }

      // Apply the current campaign's special ad category settings
      const selectedCampaign = document.querySelector(".campaign.selected");
      const ageContainer = document.querySelector(".targeting-age");
      const minAgeInput = document.querySelector(".min-age");
      const maxAgeInput = document.querySelector(".max-age");
      const geoContainers = document.querySelectorAll(".geo-selection-container");

      if (selectedCampaign) {
        const specialAdCategories = JSON.parse(selectedCampaign.dataset.specialAdCategories || "[]");

        if (specialAdCategories.length > 0) {
          if (ageContainer) ageContainer.style.display = "none";
          if (minAgeInput) minAgeInput.required = false;
          if (maxAgeInput) maxAgeInput.required = false;
          geoContainers.forEach((container) => (container.style.display = "none"));
        } else {
          if (ageContainer) ageContainer.style.display = "flex";
          if (minAgeInput) minAgeInput.required = true;
          if (maxAgeInput) maxAgeInput.required = true;
          geoContainers.forEach((container) => (container.style.display = "block"));
        }
      } else {
        // No campaign selected yet - show all fields by default
        if (ageContainer) ageContainer.style.display = "flex";
        if (minAgeInput) minAgeInput.required = true;
        if (maxAgeInput) maxAgeInput.required = true;
        geoContainers.forEach((container) => (container.style.display = "block"));
      }

      // Force validation to run multiple times to catch any timing issues
      // Run immediately
      if (typeof checkRequiredFields === "function") {
        checkRequiredFields();
      }

      // Run after a short delay
      setTimeout(() => {
        if (typeof checkRequiredFields === "function") {
          checkRequiredFields();
        }
      }, 50);

      // Run after a longer delay to catch any late DOM updates
      setTimeout(() => {
        if (typeof checkRequiredFields === "function") {
          checkRequiredFields();
        }
      }, 200);
    }
  }

  populateAdSetList() {
    const selectedCampaignId = appState.getState().selectedCampaign;
    const adSetList = document.querySelector(".adset-list");

    if (!selectedCampaignId || !campaignAdSets[selectedCampaignId]) {
      adSetList.innerHTML = '<p style="color: #666; padding: 16px;">No ad sets found for this campaign.</p>';
      return;
    }

    const adSets = campaignAdSets[selectedCampaignId];
    adSetList.innerHTML = "";

    adSets.forEach((adSet) => {
      const adSetElement = document.createElement("div");
      adSetElement.className = "adset-item";
      adSetElement.dataset.adsetId = adSet.id;
      adSetElement.dataset.adsetName = adSet.name;
      adSetElement.innerHTML = `
        <h4>${adSet.name}</h4>
        <p>ID: ${adSet.id}</p>
      `;

      adSetElement.addEventListener("click", () => {
        this.selectExistingAdSet(adSet);
      });

      adSetList.appendChild(adSetElement);
    });
  }

  selectExistingAdSet(adSet) {
    this.clearUploadColumn();

    const creativeUpload = document.querySelector(".creative-upload");
    const creativeUploadTitle = document.querySelector(".creative-upload h2");

    if (creativeUpload && creativeUploadTitle) {
      creativeUploadTitle.textContent = `Creative Upload for Ad Set ${adSet.name}`;
      creativeUpload.dataset.adsetId = adSet.id;
      creativeUpload.style.display = "block";

      appState.updateState("adSetConfig", {
        id: adSet.id,
        adset_name: adSet.name,
        account_id: appState.getState().selectedAccount,
        campaign_id: appState.getState().selectedCampaign,
      });

      window.fileUploadHandler.showStep(2);
    }
  }

  showAdSetListForDuplication() {
    this.clearUploadColumn();

    const adsetListContainer = document.querySelector(".adset-list-container");
    if (adsetListContainer) {
      adsetListContainer.style.display = "block";
      this.populateAdSetListForDuplication();
    }
  }

  populateAdSetListForDuplication() {
    const selectedCampaignId = appState.getState().selectedCampaign;
    const adSetList = document.querySelector(".adset-list");

    if (!selectedCampaignId || !campaignAdSets[selectedCampaignId]) {
      adSetList.innerHTML = '<p style="color: #666; padding: 16px;">No ad sets found for this campaign.</p>';
      return;
    }

    const adSets = campaignAdSets[selectedCampaignId];
    adSetList.innerHTML = "";

    adSets.forEach((adSet) => {
      const adSetElement = document.createElement("div");
      adSetElement.className = "adset-item";
      adSetElement.dataset.adsetId = adSet.id;
      adSetElement.dataset.adsetName = adSet.name;
      adSetElement.innerHTML = `
        <h4>${adSet.name}</h4>
        <p>ID: ${adSet.id}</p>
      `;

      adSetElement.addEventListener("click", () => {
        this.showDuplicateDialog(adSet);
      });

      adSetList.appendChild(adSetElement);
    });
  }

  showDuplicateDialog(adSet) {
    const dialog = document.querySelector(".duplicate-adset-dialog");
    const step1 = dialog.querySelector('[data-step="1"]');
    const step2 = dialog.querySelector('[data-step="2"]');
    const nameInput = dialog.querySelector("#duplicate-adset-name");
    const proceedBtn = dialog.querySelector(".duplicate-proceed");

    // Store ad set info
    dialog.dataset.adsetId = adSet.id;
    dialog.dataset.adsetName = adSet.name;

    // Reset dialog
    step1.style.display = "block";
    step2.style.display = "none";
    nameInput.value = adSet.name + " - Copy";
    proceedBtn.disabled = false;

    // Show dialog
    dialog.style.display = "flex";

    // Setup event handlers
    const deepCopyButtons = dialog.querySelectorAll("[data-deep-copy]");
    deepCopyButtons.forEach((btn) => {
      btn.onclick = () => {
        const deepCopy = btn.dataset.deepCopy === "true";
        dialog.dataset.deepCopy = deepCopy;

        // Move to step 2
        step1.style.display = "none";
        step2.style.display = "block";
        nameInput.focus();
      };
    });

    // Back button
    const backBtn = dialog.querySelector(".duplicate-back");
    backBtn.onclick = () => {
      step2.style.display = "none";
      step1.style.display = "block";
    };

    // Name input validation
    nameInput.oninput = () => {
      proceedBtn.disabled = !nameInput.value.trim();
    };

    // Proceed button
    proceedBtn.onclick = () => {
      this.duplicateAdSet(adSet.id, nameInput.value.trim(), dialog.dataset.deepCopy === "true");
    };

    // Close dialog on background click or close button click
    dialog.onclick = (e) => {
      if (e.target === dialog) {
        dialog.style.display = "none";
      }
    };

    // Close button functionality
    const closeBtn = dialog.querySelector(".dialog-close-btn");
    closeBtn.onclick = () => {
      dialog.style.display = "none";
    };
  }

  async duplicateAdSet(adSetId, newName, deepCopy) {
    const dialog = document.querySelector(".duplicate-adset-dialog");
    const proceedBtn = dialog.querySelector(".duplicate-proceed");

    // Show loading state
    proceedBtn.disabled = true;
    proceedBtn.textContent = "Duplicating...";

    try {
      const response = await fetch("/api/duplicate-ad-set", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ad_set_id: adSetId,
          deep_copy: deepCopy,
          status_option: "INHERITED_FROM_SOURCE",
          name: newName,
          campaign_id: appState.getState().selectedCampaign,
          account_id: appState.getState().selectedAccount,
        }),
      });

      if (response.ok) {
        window.showSuccess(`Ad set has been successfully duplicated, check at Meta Ads Manager after 1–5 minutes`, 4000);
      }

      if (!response.ok) {
        let errorMessage = "Failed to duplicate ad set";

        try {
          const errorData = await response.json();

          // Priority: error_user_msg > error > details > generic
          if (errorData.error_user_msg) {
            errorMessage = errorData.error_user_msg;
          } else if (response.status === 403 && errorData.needsAuth) {
            errorMessage = "Please reconnect your Facebook account to continue";
          } else if (response.status === 403) {
            errorMessage = "Authentication failed. Please log in again.";
          } else if (response.status === 401) {
            errorMessage = "Your session has expired. Please refresh the page.";
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else if (errorData.details) {
            errorMessage = `Ad set duplication failed: ${errorData.details}`;
          }

          // Log full error details for debugging
          console.error("Ad set duplication error details:", {
            status: response.status,
            statusText: response.statusText,
            errorData: errorData,
          });
        } catch (parseError) {
          // If response isn't JSON, use generic message
          console.error("Failed to parse error response:", parseError);
          errorMessage = `Ad set duplication failed (HTTP ${response.status})`;
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Hide dialog
      dialog.style.display = "none";

      // Add the new ad set to the campaign ad sets
      const selectedCampaignId = appState.getState().selectedCampaign;
      if (!campaignAdSets[selectedCampaignId]) {
        campaignAdSets[selectedCampaignId] = [];
      }
      campaignAdSets[selectedCampaignId].push({
        id: data.id,
        name: newName,
        account_id: appState.getState().selectedAccount,
        campaign_id: selectedCampaignId,
      });

      // Update ad set state
      appState.updateState("adSetConfig", {
        id: data.id,
        adset_name: newName,
        account_id: appState.getState().selectedAccount,
        campaign_id: selectedCampaignId,
      });

      // Show success screen instead of creative upload
      this.clearUploadColumn();
      const successSection = document.querySelector(".success-wrapper");
      if (successSection) {
        const successMessage = successSection.querySelector("h2");
        if (successMessage) {
          successMessage.textContent = "Ad Set Duplicated Successfully";
        }
        const createMoreBtn = successSection.querySelector("h3");
        if (createMoreBtn) {
          createMoreBtn.onclick = () => {
            location.reload();
          };
        }
        const viewAdsBtn = successSection.querySelector("button");
        if (viewAdsBtn) {
          viewAdsBtn.style.display = "none";
        }
        successSection.style.display = "block";
        successSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      // Trigger background refresh to update cache without disrupting UI
      fetch("/api/refresh-meta-cache", { method: "POST" })
        .then((response) => {
          if (!response.ok) {
            console.warn(`Refresh returned status ${response.status}`);
            return null;
          }
          return response.json();
        })
        .then((result) => {
          if (result) {
            console.log("Background refresh triggered after ad set duplication:", result);
          }
        })
        .catch((err) => console.error("Failed to trigger refresh:", err));
    } catch (error) {
      console.error("Error duplicating ad set:", error);

      // Display user-friendly error message (extract from error_user_msg if available)
      const errorMessage = await extractErrorMessage(error);

      if (window.showError) {
        window.showError(errorMessage, 5000);
      } else {
        alert(errorMessage);
      }

      // Reset button
      proceedBtn.disabled = false;
      proceedBtn.textContent = "Proceed";
    }
  }
}

// This function will be called to attach listeners to dropdown options
function attachDropdownOptionListeners(dropdown) {
  const selected = dropdown.querySelector(".dropdown-selected");
  const options = dropdown.querySelector(".dropdown-options");
  const display = selected.querySelector(".dropdown-display");
  const optionItems = options.querySelectorAll("li");
  const dropdownType = selected.dataset.dropdown;

  // The CustomDropdown instance, to call its methods
  const dropdownInstance = dropdown.customDropdownInstance;

  // If there's no instance, we can't attach listeners that depend on it.
  if (!dropdownInstance) {
    console.warn("Cannot attach listeners: CustomDropdown instance not found on element.", dropdown);
    return;
  }

  optionItems.forEach((option) => {
    // Check for a flag to prevent adding duplicate listeners
    if (option.listenerAttached) {
      return;
    }

    option.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = option.textContent;

      // Re-query display element to ensure we have the correct reference after cloning
      const currentSelected = dropdown.querySelector(".dropdown-selected");
      const currentDisplay = currentSelected ? currentSelected.querySelector(".dropdown-display") : display;

      // Update selected display
      console.log(`[Dropdown ${dropdownType}] Updating display to:`, text);
      console.log(`[Dropdown ${dropdownType}] Display element:`, currentDisplay);
      console.log(`[Dropdown ${dropdownType}] Is display in DOM?`, document.contains(currentDisplay));
      currentDisplay.textContent = text;
      currentDisplay.classList.remove("placeholder");
      console.log(`[Dropdown ${dropdownType}] Display text after update:`, currentDisplay.textContent);
      dropdownInstance.setDropdownData(currentDisplay, option, dropdownType);

      // Re-query here to handle dynamically added/removed items
      const currentOptions = options.querySelectorAll("li");
      currentOptions.forEach((opt) => opt.classList.remove("selected"));
      option.classList.add("selected");

      dropdownInstance.closeDropdown(dropdown);

      currentDisplay.parentElement.classList.remove("empty-input");
      console.log(`Selected ${dropdownType}:`, text);

      // Bid strategy dropdown is hidden, no special handling needed

      if (typeof checkRequiredFields === "function") {
        checkRequiredFields();
      }
    });
    // Set the flag
    option.listenerAttached = true;
  });
}

class CustomDropdown {
  constructor(selector) {
    // console.log("CustomDropdown constructor called with selector:", selector);
    this.dropdowns = document.querySelectorAll(selector);
    // console.log("Found dropdowns:", this.dropdowns.length);
    this.init();
  }

  init() {
    this.dropdowns.forEach((dropdown) => {
      // Store a reference to the instance on the element itself
      dropdown.customDropdownInstance = this;

      const selected = dropdown.querySelector(".dropdown-selected");
      const options = dropdown.querySelector(".dropdown-options");

      // Check for preselected option
      const preselectedOption = options.querySelector("li.selected");
      if (preselectedOption) {
        const display = selected.querySelector(".dropdown-display");
        display.textContent = preselectedOption.textContent;
        this.setDropdownData(display, preselectedOption, selected.dataset.dropdown);
      } else {
        // Set initial placeholder state only if no option is preselected
        const display = selected.querySelector(".dropdown-display");
        if (display) {
          display.classList.add("placeholder");
        }
      }

      // Toggle dropdown
      selected.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = options.classList.contains("show");

        this.closeAllDropdowns();

        if (!isOpen) {
          this.openDropdown(dropdown);
        }
      });

      // Attach option listeners
      attachDropdownOptionListeners(dropdown);

      // Handle keyboard navigation
      selected.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const isOpen = options.classList.contains("show");
          if (isOpen) {
            this.closeDropdown(dropdown);
          } else {
            this.closeAllDropdowns();
            this.openDropdown(dropdown);
          }
        }
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".custom-dropdown")) {
        this.closeAllDropdowns();
      }
    });
  }

  setDropdownData(display, option, dropdownType) {
    display.textContent = option.textContent;
    switch (dropdownType) {
      case "pixel":
        const pixelId = option.dataset.pixelId || option.getAttribute("data-pixel-id") || "";
        const pixelAccountId = option.dataset.pixelAccountId || option.getAttribute("data-pixel-account-id") || "";
        display.dataset.pixelid = pixelId;
        display.dataset.pixelAccountId = pixelAccountId;
        break;
      case "pages":
      case "page":
        const pageId = option.dataset.pageId || option.getAttribute("data-page-id") || "";
        display.dataset.value = pageId;
        break;
      case "status":
        display.dataset.value = option.dataset.value || option.textContent;
        break;
      case "cta":
        display.dataset.value = option.dataset.value || "";
        break;
      default:
        // Generic fallback
        if (option.dataset.value) {
          display.dataset.value = option.dataset.value;
        }
    }
  }

  openDropdown(dropdown) {
    const selected = dropdown.querySelector(".dropdown-selected");
    const options = dropdown.querySelector(".dropdown-options");

    options.classList.add("show");
    selected.classList.add("open", "focused");
    selected.setAttribute("tabindex", "0");
    dropdown.classList.add("dropdown-is-open");
  }

  closeDropdown(dropdown) {
    const selected = dropdown.querySelector(".dropdown-selected");
    const options = dropdown.querySelector(".dropdown-options");

    options.classList.remove("show");
    selected.classList.remove("open", "focused");
    dropdown.classList.remove("dropdown-is-open");
  }

  closeAllDropdowns() {
    this.dropdowns.forEach((dropdown) => {
      this.closeDropdown(dropdown);
    });
  }
}

class UploadForm {
  constructor(selector) {
    this.selector = selector;
    this.element = document.querySelector(this.selector);
    this.currentStep = 1;
    this.uploadedFiles = [];
    this.selectedUploadType = null;
  }

  handleSubmit() {
    this.element.addEventListener("click", (e) => {
      if (e.target.type === "submit" || e.target.classList.contains("continue-btn")) {
        e.preventDefault();

        if (e.target.textContent === "Create Ad Set") {
          console.log("Create Ad Set button clicked. Classes:", e.target.classList.toString());
          console.log("Has 'active' class:", e.target.classList.contains("active"));

          // Only proceed if button is active
          if (e.target.classList.contains("active")) {
            this.validateAndCreateAdSet();
          } else {
            console.log("Create Ad Set button clicked but not active. Check validation.");
            // Call checkRequiredFields to log current validation state
            if (typeof checkRequiredFields === "function") {
              checkRequiredFields();
            }
          }
        }
      }
    });
  }

  async validateAndCreateAdSet() {
    const multiSelectToggle = document.getElementById('campaign-multi-select-toggle');
    const isMultiSelectActive = multiSelectToggle && multiSelectToggle.checked;

    if (isMultiSelectActive) {
      const selectedCampaigns = document.querySelectorAll('.campaign-checkbox:checked');
      const campaignIds = Array.from(selectedCampaigns).map(cb => cb.closest('.campaign').dataset.campaignId);

      if (campaignIds.length === 0) {
        if (window.showError) {
          window.showError("Please select at least one campaign in multi-select mode.", 4000);
        }
        return;
      }
      // Use the logic for multiple campaigns
      await this.validateAndCreateMultipleAdSets(campaignIds);

    } else {
      // Use the original logic for a single campaign
      await this.validateAndCreateSingleAdSet();
    }
  }

  async validateAndCreateMultipleAdSets(campaignIds) {
    if (this.checkIfInputsAreValid()) {
      this.showLoadingState();
      const payload = this.buildAdSetPayload();
      payload.campaign_ids = campaignIds;
       // campaign_id is not needed for multi-create
      delete payload.campaign_id;


      try {
        const response = await fetch("/api/create-ad-set-multiple", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        this.hideLoadingState();

        if (!response.ok && response.status !== 207) { // 207 is partial success
          throw new Error(data.details?.error_user_msg || data.error || "Failed to create ad sets.");
        }

        // Show a summary of the results
        const { total_created, total_failed, failed_adsets } = data;
        if (total_failed > 0) {
           const failedCampaignsText = failed_adsets.map(f => `Campaign ID: ${f.campaign_id}`).join(', ');
           window.showError(`Partially complete: ${total_created} ad sets created, ${total_failed} failed. Failed on campaigns: ${failedCampaignsText}`, 8000);
        } else {
           window.showSuccess(`${total_created} ad sets created successfully!`, 5000);
        }

        // Hide config and show success or next step
        const adsetConfig = document.querySelector(".adset-config");
        adsetConfig.style.display = "none";
        this.showNextSection("success-wrapper"); // Or another appropriate section
        const successMessage = document.querySelector(".success-wrapper h2");
        if (successMessage) successMessage.textContent = "Batch Creation Processed";
        const successP = document.querySelector(".success-wrapper p");
        if (successP) successP.textContent = `${total_created} ad sets created, ${total_failed} failed.`;


      } catch (err) {
        console.error("Error creating multiple ad sets:", err);
        this.hideLoadingState(true);
        if (window.showError) {
          window.showError(`Error: ${err.message}`, 6000);
        }
      }
    } else {
      console.error("Validation failed. Ad sets not created.");
      if (window.showError) {
        window.showError("Please fill in all required fields marked with * before creating.", 4000);
      }
    }
  }

  buildAdSetPayload() {
      const pixelDropdown = document.querySelector('.dropdown-selected[data-dropdown="pixel"] .dropdown-display');
      const statusDropdown = document.querySelector('.dropdown-selected[data-dropdown="status"] .dropdown-display');
      const geoFieldsVisible = window.getComputedStyle(document.querySelector(".geo-selection-container")).display !== "none";
      const optimizationGoal = document.querySelector(".config-optimization-goal").value;
      const pixelId = pixelDropdown ? pixelDropdown.dataset.pixelid : "";
      const eventType = document.querySelector(".config-event-type").dataset.value || document.querySelector(".config-event-type").value;
      const bidStrategyDisplay = document.querySelector('[data-dropdown="adset-bid-strategy"] .dropdown-display');
      let bidStrategy = bidStrategyDisplay ? bidStrategyDisplay.dataset.value : "LOWEST_COST_WITHOUT_CAP";
      if (!bidStrategy || bidStrategy === "undefined") {
        bidStrategy = "LOWEST_COST_WITHOUT_CAP";
      }

      const payload = {
        account_id: document.querySelector(".account.selected").dataset.campaignId,
        destination_type: document.querySelector(".config-destination-type").value,
        optimization_goal: optimizationGoal,
        billing_event: document.querySelector(".config-billing-event").value,
        bid_strategy: bidStrategy,
        name: document.querySelector(".config-adset-name").value,
        status: statusDropdown ? statusDropdown.dataset.value : "ACTIVE",
        targeting: {}
      };
      
      // Add page_id if selected (optional)
      const pageDropdown = document.querySelector('.dropdown-selected[data-dropdown="pages"] .dropdown-display');
      const pageId = pageDropdown ? pageDropdown.dataset.value : null;
      if (pageId) {
        payload.promoted_object = payload.promoted_object || {};
        payload.promoted_object.page_id = pageId;
      }
      
      if (pixelId) {
          payload.promoted_object = payload.promoted_object || {};
          payload.promoted_object.pixel_id = pixelId;
          if (eventType) {
              payload.promoted_object.custom_event_type = eventType;
          }
      }


      if (geoFieldsVisible) {
        const selectedCountries = appState.getState().selectedCountries;
        const selectedRegions = appState.getState().selectedRegions;
        const includedRegions = selectedRegions.filter((r) => !r.excluded);
        const excludedRegions = selectedRegions.filter((r) => r.excluded);

        payload.targeting.geo_locations = {
          countries: selectedCountries.map((c) => c.key),
          regions: includedRegions.map((r) => ({ key: r.key })),
        };
        if (excludedRegions.length > 0) {
          payload.targeting.excluded_geo_locations = {
            regions: excludedRegions.map((r) => ({ key: r.key })),
          };
        }
      }

      const budgetTypeDisplay = document.querySelector('[data-dropdown="adset-budget-type"] .dropdown-display');
      const budgetType = budgetTypeDisplay ? budgetTypeDisplay.dataset.value : null;
      const budgetAmount = document.querySelector(".config-adset-budget");
      const startDateTime = document.querySelector(".config-start-datetime");
      const endDateTime = document.querySelector(".config-end-datetime");
      if (budgetType === "daily") {
        payload.daily_budget = parseFloat(budgetAmount.value);
      } else if (budgetType === "lifetime") {
        payload.lifetime_budget = parseFloat(budgetAmount.value);
      }
      if (startDateTime && startDateTime.value) payload.start_time = new Date(startDateTime.value).toISOString();
      if (endDateTime && endDateTime.value) payload.end_time = new Date(endDateTime.value).toISOString();

      const bid_amount = document.querySelector(".config-cost-per-result-goal");
      if (bid_amount && bid_amount.value && bid_amount.value.trim() !== "") {
        payload.bid_amount = Math.round(parseFloat(bid_amount.value) * 100);
      }

      const minAgeInput = document.querySelector(".min-age");
      const maxAgeInput = document.querySelector(".max-age");
      const ageContainer = document.querySelector(".targeting-age");
      if (minAgeInput && maxAgeInput && ageContainer && window.getComputedStyle(ageContainer).display !== "none") {
        payload.targeting.age_min = parseInt(minAgeInput.value);
        payload.targeting.age_max = parseInt(maxAgeInput.value);
      }

      const adSchedule = getAdScheduleData();
      if (adSchedule) {
         payload.adset_schedule = adSchedule;
      }
      
      // Since this payload is used for both single and multiple, add campaign_id for single mode.
      // It will be removed by the multi-ad-set creator if necessary.
      const singleCampaignId = document.querySelector(".config-campaign-id").value;
      if (singleCampaignId) {
          payload.campaign_id = singleCampaignId;
      }


      return payload;
  }

  async validateAndCreateSingleAdSet() {
    if (this.checkIfInputsAreValid()) {
      const payload = this.buildAdSetPayload();

      // For single ad set, campaign_id is required and should be in the payload.
      if (!payload.campaign_id) {
          if (window.showError) {
              window.showError("Could not determine the selected campaign. Please re-select the campaign.", 4000);
          }
          return;
      }
      
      // The name field for single ad set payload is 'adset_name' in the old code
      payload.adset_name = payload.name;

      this.showLoadingState();

      try {
        const response = await fetch("/api/create-ad-set", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        // Read response body once
        const responseText = await response.text();
        let data;

        try {
          data = JSON.parse(responseText);
        } catch (e) {
          // If response is not JSON, use the text as is
          data = { error: responseText };
        }

        if (!response.ok) {
          console.log("Create ad set api response not ok.");
          throw new Error(data.error || data.message || `Failed to create ad set: ${responseText}`);
        }

        console.log("Successfully posted to create ad set api.");
        appState.updateState("adSetConfig", payload);
        this.hideLoadingState();

        const adsetConfig = document.querySelector(".adset-config");
        adsetConfig.style.display = "none";

        const creativeUploadTitle = document.querySelector(".creative-upload");
        creativeUploadTitle.children[0].textContent = `Creative Upload for Ad Set ${payload.adset_name}`;

        appState.updateState("adSetConfig", { ...payload, id: data.id });

        creativeUploadTitle.dataset.adsetId = data.id;

        // Add the newly created ad set to the existing ad sets list
        const selectedCampaignId = appState.getState().selectedCampaign;
        if (!campaignAdSets[selectedCampaignId]) {
          campaignAdSets[selectedCampaignId] = [];
        }
        campaignAdSets[selectedCampaignId].push({
          id: data.id,
          name: payload.adset_name,
          account_id: payload.account_id,
          campaign_id: payload.campaign_id,
        });

        this.showNextSection("creative-upload");

        window.fileUploadHandler.showStep(2);
      } catch (err) {
        console.log("There was an error posting to create ad set API", err);
        this.hideLoadingState(true); // Pass true for error

        // Show error message to user (extract from error_user_msg if available)
        if (window.showError) {
          extractErrorMessage(err).then((errorMessage) => {
            window.showError(`Failed to create ad set: ${errorMessage}`, 5000);
          });
        }
      }
    } else {
      console.error("Validation failed. Ad set not created.");
      if (window.showError) {
        window.showError("Please fill in all required fields marked with * before creating an ad set.", 4000);
      }
    }
  }

  checkIfInputsAreValid() {
    let isValid = true;
    const allInputs = document.querySelectorAll(".adset-form-container input[required]");
    const dropdownInputs = document.querySelectorAll(".adset-form-container .dropdown-display");

    // Validate required text inputs
    for (const input of allInputs) {
      // Check only for inputs inside the adset form that are currently visible
      if (input.offsetParent !== null && (input.value === "" || input.value === undefined)) {
        console.error("Validation failed on text input:", input.name || input.className);
        this.emptyInputError(input);
        isValid = false;
      }
    }

    // Validate dropdowns
    const optimizationGoal = document.querySelector(".config-optimization-goal")?.value || "";
    const requiresPixelAndEvent = optimizationGoal === "OFFSITE_CONVERSIONS";

    for (const dropdownInput of dropdownInputs) {
      // NEW CHECK: Only validate visible dropdowns
      if (dropdownInput.offsetParent === null) {
        continue;
      }

      const isPixelDropdown = dropdownInput.closest('[data-dropdown="pixel"]');
      const isRequired = !dropdownInput.parentElement.parentElement.classList.contains("optional");

      if (isPixelDropdown && !requiresPixelAndEvent) {
        dropdownInput.parentElement.classList.remove("empty-input");
        continue; // Skip validation if not required
      }

      if (dropdownInput.classList.contains("placeholder") && isRequired) {
        console.error("Validation failed on dropdown:", dropdownInput.dataset.dropdown);
        this.emptyDropdownError(dropdownInput);
        isValid = false;
      }
    }

    // Validate age inputs
    const minAgeInput = document.querySelector(".min-age");
    const maxAgeInput = document.querySelector(".max-age");
    const ageContainer = document.querySelector(".targeting-age");
    if (minAgeInput && maxAgeInput && ageContainer && window.getComputedStyle(ageContainer).display !== "none") {
      if (!this.validateAgeInputs(minAgeInput, maxAgeInput)) {
        isValid = false;
      }
    }

    // Validate budget input
    const budgetInput = document.querySelector(".config-adset-budget"); // Use the correct budget input selector
    if (budgetInput && budgetInput.required) {
      if (!this.validateBudgetInput(budgetInput)) {
        isValid = false;
      }
    }

    // Validate countries selection
    const geoContainers = document.querySelectorAll(".geo-selection-container");
    const geoFieldsVisible = geoContainers.length > 0 && window.getComputedStyle(geoContainers[0]).display !== "none";
    if (geoFieldsVisible) {
      const selectedCountries = appState.getState().selectedCountries;
      if (selectedCountries.length === 0) {
        console.error("Validation failed on: Geo location (countries)");
        const countryContainer = document.querySelector(".selected-countries-container");
        if (countryContainer) {
          countryContainer.classList.add("empty-input");
        }
        isValid = false;
      }
    }

    return isValid;
  }

  validateAgeInputs(minAge, maxAge) {
    let isValid = true;
    const minVal = parseInt(minAge.value);
    const maxVal = parseInt(maxAge.value);

    if (minAge.required && (isNaN(minVal) || minVal < 18 || minVal > 65)) {
      console.error("Validation failed on: Minimum Age (must be between 18-65)");
      this.emptyInputError(minAge);
      isValid = false;
    }
    if (maxAge.required && (isNaN(maxVal) || maxVal < 18 || maxVal > 65)) {
      console.error("Validation failed on: Maximum Age (must be between 18-65)");
      this.emptyInputError(maxAge);
      isValid = false;
    }
    if (minAge.required && maxAge.required && !isNaN(minVal) && !isNaN(maxVal) && minVal >= maxVal) {
      console.error("Validation failed on: Age Range (min age must be less than max age)");
      this.emptyInputError(minAge);
      this.emptyInputError(maxAge);
      isValid = false;
    }
    return isValid;
  }

  validateBudgetInput(budgetInput) {
    const value = parseFloat(budgetInput.value);
    if (isNaN(value) || value <= 0) {
      console.error("Validation failed on: Budget (must be > 0)");
      this.emptyInputError(budgetInput);
      return false;
    }
    return true;
  }

  showLoadingState() {
    const button = document.querySelector(".create-adset-btn");
    button.disabled = true;
    button.style.opacity = "0.6";
    animatedEllipsis.start(button, "Creating Ad Set");
  }

  hideLoadingState() {
    const button = document.querySelector(".create-adset-btn");
    animatedEllipsis.stop(button);
    button.textContent = "Create Ad Set";
    button.disabled = false;
    button.style.opacity = "1";
  }

  showNextSection(sectionClass) {
    const nextSection = document.querySelector(`.${sectionClass}`);
    if (nextSection) {
      nextSection.style.display = "block";

      const uploadColumn = document.getElementById("col-4");
      const columnTop = uploadColumn.getBoundingClientRect().top + window.pageYOffset;

      window.scrollTo({
        top: columnTop,
        behavior: "smooth",
      });

      // Clear geo selections for next ad set creation
      appState.updateState("selectedCountries", []);
      appState.updateState("selectedRegions", []);
    }
  }

  emptyInputError(input) {
    // Check if input is inside a budget wrapper
    const wrapper = input.closest(".budget-input-wrapper");
    if (wrapper) {
      wrapper.classList.add("empty-input");
      input.addEventListener(
        "input",
        () => {
          wrapper.classList.remove("empty-input");
        },
        { once: true }
      );
    } else {
      input.classList.add("empty-input");
      input.addEventListener(
        "input",
        () => {
          input.classList.remove("empty-input");
        },
        { once: true }
      );
    }
  }

  emptyDropdownError(input) {
    input.parentElement.classList.add("empty-input");
  }
}

class UploadProgressTracker {
  constructor() {
    this.eventSource = null;
    this.sessionId = null;
    this.errors = [];
    this.fileProgressMap = new Map();
  }

  connectToSSE(sessionId) {
    this.sessionId = sessionId;
    this.eventSource = new EventSource(`/api/upload-progress/${sessionId}`);

    console.log("Connecting to SSE:", sessionId);

    // Debug: log all events
    this.eventSource.onmessage = (event) => {
      console.log("SSE message received:", event);
    };

    // Set up event listeners
    this.eventSource.addEventListener("connected", (event) => {
      console.log("Connected to upload progress:", JSON.parse(event.data));
    });

    this.eventSource.addEventListener("session-start", (event) => {
      const data = JSON.parse(event.data);
      console.log("Upload session started:", data.totalFiles, "files");
    });

    this.eventSource.addEventListener("file-start", (event) => {
      const data = JSON.parse(event.data);
      console.log("File start event:", data);
      this.startFileProgress(data.fileIndex, data.fileName);
    });

    this.eventSource.addEventListener("file-progress", (event) => {
      const data = JSON.parse(event.data);
      console.log("File progress event:", data);
      this.updateFileProgress(data.fileIndex, data.progress, data.stage);
    });

    this.eventSource.addEventListener("file-complete", (event) => {
      const data = JSON.parse(event.data);
      console.log("File complete event:", data);
      this.completeFileProgress(data.fileIndex, data.fileName);
    });

    this.eventSource.addEventListener("file-error", (event) => {
      const data = JSON.parse(event.data);
      console.log("File error event:", data);
      this.showFileError(data.fileIndex, data.fileName, data.error);
    });

    this.eventSource.addEventListener("session-complete", (event) => {
      console.log("Upload session completed", event);
      const data = JSON.parse(event.data);

      // Check if there are errors
      const hasErrors = this.errors.length > 0;

      this.disconnect();

      // Trigger completion callback if set
      if (this.onComplete) {
        this.onComplete(hasErrors, this.errors);
      }
    });

    this.eventSource.onerror = (error) => {
      console.error("SSE error:", error);
      this.disconnect();
    };
  }

  startFileProgress(fileIndex, fileName) {
    // Find the progress bar for this file
    const progressFill = document.querySelector(`.file-progress-fill[data-fileIndex="${fileIndex}"]`);
    if (progressFill) {
      progressFill.style.width = "0%";
      progressFill.classList.add("loading");
      this.fileProgressMap.set(fileIndex, { fileName, progress: 0 });
    }
  }

  updateFileProgress(fileIndex, progress, stage) {
    const progressFill = document.querySelector(`.file-progress-fill[data-fileIndex="${fileIndex}"]`);
    if (progressFill) {
      progressFill.style.width = `${progress}%`;
      progressFill.classList.remove("loading");

      // Update map
      const fileData = this.fileProgressMap.get(fileIndex) || {};
      fileData.progress = progress;
      fileData.stage = stage;
      this.fileProgressMap.set(fileIndex, fileData);
    }
  }

  completeFileProgress(fileIndex, fileName) {
    const progressFill = document.querySelector(`.file-progress-fill[data-fileIndex="${fileIndex}"]`);
    if (progressFill) {
      progressFill.style.width = "100%";
      progressFill.classList.remove("loading", "error");

      // Remove from map after a delay
      setTimeout(() => {
        this.fileProgressMap.delete(fileIndex);
      }, 1000);
    }
  }

  showFileError(fileIndex, fileName, error) {
    this.errors.push({ fileName, error });

    const progressFill = document.querySelector(`.file-progress-fill[data-fileIndex="${fileIndex}"]`);
    if (progressFill) {
      progressFill.style.width = "100%";
      progressFill.classList.remove("loading");
      progressFill.classList.add("error");
    }

    // Show error message
    alert(`Error uploading ${fileName}: ${error}`);
  }

  disconnect() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  reset() {
    this.disconnect();
    this.errors = [];
    this.fileProgressMap.clear();

    // Reset all progress bars
    document.querySelectorAll(".file-progress-fill").forEach((fill) => {
      fill.style.width = "0%";
      fill.classList.remove("loading", "error");
    });
  }
}

// Helper for animated ellipsis
class AnimatedEllipsis {
  constructor() {
    this.intervals = new Map();
  }

  start(button, baseText) {
    // Clear any existing animation for this button
    this.stop(button);

    let dots = 0;
    const interval = setInterval(() => {
      dots = (dots + 1) % 4;
      button.textContent = baseText + ".".repeat(dots);
    }, 500);

    this.intervals.set(button, interval);
  }

  stop(button) {
    const interval = this.intervals.get(button);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(button);
    }
  }

  stopAll() {
    this.intervals.forEach((interval) => clearInterval(interval));
    this.intervals.clear();
  }
}

const animatedEllipsis = new AnimatedEllipsis();

// Add campaign duplication methods to SingleSelectGroup prototype
SingleSelectGroup.prototype.showDuplicateCampaignDialog = function (campaign) {
  const dialog = document.querySelector(".duplicate-campaign-dialog");
  const step1 = dialog.querySelector('[data-step="1"]');
  const step2 = dialog.querySelector('[data-step="2"]');
  const nameInput = dialog.querySelector("#duplicate-campaign-name");
  const proceedBtn = dialog.querySelector(".duplicate-proceed");

  // Store campaign info
  dialog.dataset.campaignId = campaign.id;
  dialog.dataset.campaignName = campaign.name;
  dialog.dataset.accountId = campaign.account_id;

  // Reset dialog
  step1.style.display = "block";
  step2.style.display = "none";
  nameInput.value = `${campaign.name} - Copy`;
  proceedBtn.disabled = false;
  proceedBtn.textContent = "Proceed";
  dialog.dataset.deepCopy = "false";

  // Show dialog
  dialog.style.display = "flex";

  // Step 1 buttons
  const step1Buttons = step1.querySelectorAll("button[data-deep-copy]");
  step1Buttons.forEach((btn) => {
    btn.onclick = () => {
      dialog.dataset.deepCopy = btn.dataset.deepCopy;
      step1.style.display = "none";
      step2.style.display = "block";
      nameInput.focus();
      // Enable/disable proceed button based on name input
      proceedBtn.disabled = !nameInput.value.trim();
    };
  });

  // Name input validation
  nameInput.oninput = () => {
    proceedBtn.disabled = !nameInput.value.trim();
  };

  // Back button
  const backBtn = dialog.querySelector(".duplicate-back");
  backBtn.onclick = () => {
    step2.style.display = "none";
    step1.style.display = "block";
  };

  // Proceed button
  proceedBtn.onclick = () => {
    this.duplicateCampaign(campaign.id, nameInput.value.trim(), dialog.dataset.deepCopy === "true", campaign.account_id);
  };

  // Close dialog on background click or close button click
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      dialog.style.display = "none";
    }
  };
  const closeBtn = dialog.querySelector(".dialog-close-btn");
  closeBtn.onclick = () => {
    dialog.style.display = "none";
  };

  // Prevent clicks on dialog content from closing
  dialog.querySelector(".dialog-content").onclick = (e) => {
    e.stopPropagation();
  };
};

SingleSelectGroup.prototype.duplicateCampaign = async function (campaignId, newName, deepCopy, accountId) {
  const dialog = document.querySelector(".duplicate-campaign-dialog");
  const proceedBtn = dialog.querySelector(".duplicate-proceed");

  // Show loading state
  proceedBtn.disabled = true;
  proceedBtn.textContent = "Duplicating...";

  try {
    const response = await fetch("/api/duplicate-campaign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        campaign_id: campaignId,
        name: newName,
        deep_copy: deepCopy,
        status_option: "PAUSED",
        account_id: accountId,
      }),
    });

    if (!response.ok) {
      let errorMessage = "Failed to duplicate campaign";

      try {
        const errorData = await response.json();

        // Priority: error_user_msg > error > details > generic
        if (errorData.error_user_msg) {
          errorMessage = errorData.error_user_msg;
        } else if (response.status === 403 && errorData.needsAuth) {
          errorMessage = "Please reconnect your Facebook account to continue";
        } else if (response.status === 403) {
          errorMessage = "Authentication failed. Please log in again.";
        } else if (response.status === 401) {
          errorMessage = "Your session has expired. Please refresh the page.";
        } else if (errorData.error) {
          errorMessage = errorData.error;
        } else if (errorData.details) {
          errorMessage = `Campaign duplication failed: ${errorData.details}`;
        }

        // Log full error details for debugging
        console.error("Campaign duplication error details:", {
          status: response.status,
          statusText: response.statusText,
          errorData: errorData,
        });
      } catch (parseError) {
        // If response isn't JSON, use generic message
        console.error("Failed to parse error response:", parseError);
        errorMessage = `Campaign duplication failed (HTTP ${response.status})`;
      }

      throw new Error(errorMessage);
    }

    const data = await response.json();

    // Hide dialog
    dialog.style.display = "none";

    // Add the new campaign to the list
    const newCampaignId = data.id;

    // Create a new campaign element
    const campaignSelection = document.querySelector(".campaign-selection");
    if (!campaignSelection) {
      console.error("Campaign selection container not found");
      alert("Campaign duplicated successfully but could not update the display. Please refresh the page.");
      return;
    }

    const newCampaignElement = document.createElement("div");
    newCampaignElement.className = "campaign";
    newCampaignElement.setAttribute("data-next-column", ".action-column");
    newCampaignElement.setAttribute("data-col-id", "2");
    newCampaignElement.setAttribute("data-acc-campaign-id", accountId);
    newCampaignElement.setAttribute("data-campaign-id", newCampaignId);
    newCampaignElement.setAttribute("data-daily-budget", "");
    newCampaignElement.setAttribute("data-bid-strategy", "");
    newCampaignElement.setAttribute("data-objective", data.objective || "");
    newCampaignElement.setAttribute("data-special-ad-categories", "[]");
    newCampaignElement.style.display = "none"; // Match the display style of other campaigns

    newCampaignElement.innerHTML = `
      <h3>${newName}</h3>
      <ul>
        <li>PAUSED</li>
        <li>Spend: N/A</li>
        <li>Clicks: N/A</li>
      </ul>
    `;

    // Insert the new campaign at the top of the list
    const firstCampaign = campaignSelection.querySelector(".campaign");
    if (firstCampaign) {
      campaignSelection.insertBefore(newCampaignElement, firstCampaign);
    } else {
      campaignSelection.appendChild(newCampaignElement);
    }

    // Reinitialize the single select group to include the new campaign
    // Clean up existing campaign select group before creating new one
    if (campaignSelectGroup) {
      campaignSelectGroup.cleanup();
    }
    campaignSelectGroup = new SingleSelectGroup(".campaign");

    // Show success message
    if (window.showSuccess) {
      window.showSuccess(`Campaign "${newName}" has been successfully duplicated, check at Meta Ads Manager after 1–5 minutes`, 4000);
    }

    // Trigger background refresh to update cache without page reload
    fetch("/api/refresh-meta-cache", { method: "POST" })
      .then((response) => {
        if (!response.ok) {
          console.warn(`Refresh returned status ${response.status}`);
          return null;
        }
        return response.json();
      })
      .then((result) => {
        if (result) {
          console.log("Background refresh triggered:", result);
        }
      })
      .catch((err) => console.error("Failed to trigger refresh:", err));
  } catch (error) {
    console.error("Error duplicating campaign:", error);

    // Display user-friendly error message (extract from error_user_msg if available)
    const errorMessage = await extractErrorMessage(error);

    if (window.showError) {
      window.showError(errorMessage, 5000);
    } else {
      alert(errorMessage);
    }

    // Reset button
    proceedBtn.disabled = false;
    proceedBtn.textContent = "Proceed";
  }
};

// Campaign creation dialog is now initialized in initializeCreateCampaignDialog()

class FileUploadHandler {
  constructor() {
    this.uploadedFiles = [];
    this.selectedUploadType = null;
    this.initialUploadComplete = false;
    this.additionalFilesToUpload = [];
    this.googleDriveFiles = []; // Track Google Drive files separately
    this.progressTracker = new UploadProgressTracker();
    this.init();
  }

  init() {
    this.handleUploadTypeSelection();
    this.handleFileUpload();
    this.handleBackButton();
    this.handleGoogleDriveInput();
  }

  handleUploadTypeSelection() {
    this.showStep(2);

    const dropZoneText = document.querySelector(".drop-zone-text");
    if (dropZoneText) {
      dropZoneText.innerHTML = `Drag & drop <strong>images and videos</strong> here <br /><br />or`;
    }

    const fileInput = document.querySelector('.file-drop-zone input[type="file"]');
    if (fileInput) {
      fileInput.accept = "image/*,video/*";
    }
  }

  handleFileUpload() {
    const fileInput = document.querySelector('.file-drop-zone input[type="file"]');
    const dropZone = document.querySelector(".file-drop-zone");
    const browseBtn = document.querySelector(".file-drop-zone .continue-btn");

    // Browse button click
    browseBtn.addEventListener("click", () => {
      fileInput.click();
    });

    // File input change
    fileInput.addEventListener("change", (e) => {
      this.handleFiles(e.target.files);
    });

    // Drag and drop functionality
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.backgroundColor = "#e3f2fd";
      dropZone.style.borderColor = "#103dee";
    });

    dropZone.addEventListener("dragleave", () => {
      dropZone.style.backgroundColor = "#f8f9fa";
      dropZone.style.borderColor = "#d0d0d0";
    });

    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.style.backgroundColor = "#f8f9fa";
      dropZone.style.borderColor = "#d0d0d0";
      this.handleFiles(e.dataTransfer.files);
    });
  }

  handleBackButton() {
    const backBtns = document.querySelectorAll(".back-btn");
    backBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.selectedUploadType = null;
        this.uploadedFiles = [];

        // Reset progress tracker
        this.progressTracker.reset();

        const fileInput = document.querySelector('.file-drop-zone input[type="file"]');
        if (fileInput) {
          fileInput.value = "";
        }

        const filesList = document.querySelector(".uploaded-files-list");
        if (filesList) {
          filesList.innerHTML = "";
        }

        this.showStep(2);
      });
    });
  }

  handleFiles(files) {
    const validFiles = Array.from(files).filter((file) => {
      return file.type.startsWith("image/") || file.type.startsWith("video/");
    });

    // If we're already showing uploaded files, append instead of replace
    if (this.uploadedFiles.length > 0) {
      // Check for duplicates based on file name and size
      const newFiles = validFiles.filter((newFile) => {
        return !this.uploadedFiles.some((existingFile) => existingFile.name === newFile.name && existingFile.size === newFile.size);
      });
      this.uploadedFiles.push(...newFiles);

      // Track additional files if initial upload is complete
      if (this.initialUploadComplete && newFiles.length > 0) {
        this.additionalFilesToUpload.push(...newFiles);
        this.updateUploadButtonForAdditionalFiles();
      }
    } else {
      this.uploadedFiles = validFiles;
    }

    // Determine upload type based on all files
    const allImageFiles = this.uploadedFiles.filter((file) => file.type.startsWith("image/"));
    const allVideoFiles = this.uploadedFiles.filter((file) => file.type.startsWith("video/"));

    if (allImageFiles.length > 0 && allVideoFiles.length > 0) {
      this.selectedUploadType = "mixed";
    } else if (allImageFiles.length > 0) {
      this.selectedUploadType = "image";
    } else if (allVideoFiles.length > 0) {
      this.selectedUploadType = "video";
    }

    if (this.uploadedFiles.length > 0) {
      this.displayUploadedFiles();
      this.showStep(3);
    }
  }

  showLoadingState() {
    const button = document.querySelector('[data-step="3"] .continue-btn');
    button.disabled = true;
    button.style.opacity = "0.6";
    animatedEllipsis.start(button, "Uploading Creatives");
  }

  hideLoadingState(hasErrors = false) {
    const button = document.querySelector('[data-step="3"] .continue-btn');
    animatedEllipsis.stop(button);

    if (hasErrors) {
      // Reset button to allow retry
      button.textContent = "Upload Creatives";
      button.style.backgroundColor = "";
      button.style.cursor = "pointer";
      button.disabled = false;
      button.style.opacity = "1";
      button.classList.remove("upload-complete");
    } else {
      let fileTypeText;
      if (this.selectedUploadType === "mixed") {
        fileTypeText = "Files";
      } else if (this.selectedUploadType === "image") {
        fileTypeText = "Images";
      } else {
        fileTypeText = "Videos";
      }
      button.textContent = `✓ ${fileTypeText} Uploaded`;
      button.style.backgroundColor = "#28a745";
      button.style.cursor = "default";
      button.disabled = true;
      button.style.opacity = "1";

      button.classList.add("upload-complete");
      this.initialUploadComplete = true;
    }

    // Show additional upload options
    const additionalOptions = document.querySelector(".additional-upload-options");
    if (additionalOptions) {
      additionalOptions.style.display = "block";
    }
  }

  displayUploadedFiles() {
    const filesList = document.querySelector(".uploaded-files-list");
    const isCollapsed = this.uploadedFiles.length > 3;

    if (isCollapsed) {
      filesList.classList.add("collapsed");
    } else {
      filesList.classList.remove("collapsed");
    }

    filesList.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
        <h4 style="color: #333; margin: 0;">Uploaded Files (${this.uploadedFiles.length})</h4>
        <button type="button" class="toggle-files-btn" style="background: none; border: none; color: #103dee; cursor: pointer; font-size: 14px; padding: 4px 8px;">
          ${isCollapsed ? "Show All ▼" : "Collapse ▲"}
        </button>
      </div>
      <div class="files-wrapper" style="position: relative;">
        <div class="files-container" style="${isCollapsed ? "max-height: 250px; overflow-y: auto;" : ""}">
        </div>
      </div>
      <button type="button" class="browse-more-btn" style="width: 100%; margin-top: 10px; padding: 8px 16px; background: #f8f9fa; border: 1px solid #d0d0d0; color: #333; cursor: pointer; font-size: 14px;">
        + Browse More Files
      </button>
      <div class="additional-upload-options" style="display: none; margin-top: 10px;">
        <p style="margin: 0 0 10px 0; color: #666; font-size: 14px; text-align: center;">or</p>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="text" class="gdrive-link-input-additional" placeholder="Add more from Google Drive..."
            style="flex: 1; padding: 8px 12px; font-size: 14px;">
          <button class="gdrive-fetch-btn-additional"
            style="padding: 8px 12px; background: #103dee; color: white; border: none; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 14px;">
            <img src="icons/drive-icon.svg" alt="Drive" style="width: 16px; height: 16px;">
            Add
          </button>
        </div>
      </div>
    `;

    const filesContainer = filesList.querySelector(".files-container");
    const toggleBtn = filesList.querySelector(".toggle-files-btn");
    const browseMoreBtn = filesList.querySelector(".browse-more-btn");

    this.uploadedFiles.forEach((file, index) => {
      const fileDiv = document.createElement("div");
      fileDiv.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 8px; background: white; border: 1px solid #e5e5e5; margin-bottom: 8px; margin-right: 5px; min-width: 0; position: relative; overflow: hidden;";
      fileDiv.dataset.fileIndex = index;
      fileDiv.dataset.fileName = file.name;

      // Handle file preview based on source
      if (file.source === "gdrive") {
        // Google Drive files - show placeholder
        if (file.type.startsWith("image/")) {
          const imgPlaceholder = document.createElement("div");
          imgPlaceholder.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
          imgPlaceholder.textContent = "IMG";
          fileDiv.appendChild(imgPlaceholder);
        } else if (file.type.startsWith("video/")) {
          const videoIcon = document.createElement("div");
          videoIcon.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
          videoIcon.textContent = "VID";
          fileDiv.appendChild(videoIcon);
        }
      } else if (file.isFromLibrary) {
        // Library files - use thumbnailUrl or fileUrl
        if (file.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.style.cssText = "width: 40px; height: 40px; object-fit: cover; flex-shrink: 0;";
          img.src = file.thumbnailUrl || file.fileUrl;
          fileDiv.appendChild(img);
        } else if (file.type.startsWith("video/")) {
          if (file.thumbnailUrl) {
            const img = document.createElement("img");
            img.style.cssText = "width: 40px; height: 40px; object-fit: cover; flex-shrink: 0;";
            img.src = file.thumbnailUrl;
            fileDiv.appendChild(img);
          } else {
            const videoIcon = document.createElement("div");
            videoIcon.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
            videoIcon.textContent = "VID";
            fileDiv.appendChild(videoIcon);
          }
        }
      } else {
        // Local files - show actual preview
        if (file.type.startsWith("image/")) {
          const img = document.createElement("img");
          img.style.cssText = "width: 40px; height: 40px; object-fit: cover; flex-shrink: 0;";
          img.src = URL.createObjectURL(file);
          fileDiv.appendChild(img);
        } else if (file.type.startsWith("video/")) {
          const videoIcon = document.createElement("div");
          videoIcon.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
          videoIcon.textContent = "VID";
          fileDiv.appendChild(videoIcon);
        }
      }

      const fileName = document.createElement("p");
      fileName.style.cssText = "font-size: 12px; color: #666; margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;";
      fileName.textContent = file.name;

      const fileSize = document.createElement("span");
      fileSize.style.cssText = "font-size: 11px; color: #999; flex-shrink: 0; margin-left: 8px;";
      fileSize.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;

      // Add Google Drive icon if from Drive
      if (file.source === "gdrive") {
        const driveIcon = document.createElement("img");
        driveIcon.src = "icons/drive-icon.svg";
        driveIcon.style.cssText = "width: 16px; height: 16px; margin-left: 4px; flex-shrink: 0;";
        driveIcon.title = "Google Drive file";
        fileDiv.appendChild(fileName);
        fileDiv.appendChild(fileSize);
        fileDiv.appendChild(driveIcon);
      } else {
        fileDiv.appendChild(fileName);
        fileDiv.appendChild(fileSize);
      }

      const removeBtn = document.createElement("button");
      removeBtn.style.cssText = "border: none; background: none; color: #666; cursor: pointer; font-size: 18px; font-weight: 400; padding: 0 4px; margin-left: 8px; flex-shrink: 0; transition: color 0.2s;";
      removeBtn.textContent = "×";
      removeBtn.onmouseover = () => (removeBtn.style.color = "#333");
      removeBtn.onmouseout = () => (removeBtn.style.color = "#666");
      removeBtn.onclick = () => this.removeFile(index);

      fileDiv.appendChild(removeBtn);

      // Add progress bar
      const progressBar = document.createElement("div");
      progressBar.className = "file-progress-bar";
      const progressFill = document.createElement("div");
      progressFill.className = "file-progress-fill";
      progressFill.setAttribute("data-fileIndex", index);
      progressBar.appendChild(progressFill);
      fileDiv.appendChild(progressBar);

      filesContainer.appendChild(fileDiv);
    });

    // Add toggle functionality
    toggleBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isCurrentlyCollapsed = filesContainer.style.maxHeight === "250px";
      if (isCurrentlyCollapsed) {
        filesContainer.style.maxHeight = "none";
        filesContainer.style.overflowY = "visible";
        filesList.classList.remove("collapsed");
        toggleBtn.textContent = "Collapse ▲";
      } else {
        filesContainer.style.maxHeight = "250px";
        filesContainer.style.overflowY = "auto";
        filesList.classList.add("collapsed");
        toggleBtn.textContent = "Show All ▼";
      }
    });

    // Add browse more functionality
    browseMoreBtn.addEventListener("click", () => {
      const fileInput = document.querySelector('.file-drop-zone input[type="file"]');
      if (fileInput) {
        fileInput.click();
      }
    });

    // Re-add event listeners for additional Google Drive input
    const fetchBtnAdditional = filesList.querySelector(".gdrive-fetch-btn-additional");
    const gdriveInputAdditional = filesList.querySelector(".gdrive-link-input-additional");

    if (fetchBtnAdditional && gdriveInputAdditional) {
      fetchBtnAdditional.addEventListener("click", () => {
        const driveLink = gdriveInputAdditional.value.trim();
        if (driveLink) {
          this.fetchGoogleDriveFiles(driveLink, true);
          gdriveInputAdditional.value = "";
        }
      });

      gdriveInputAdditional.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const driveLink = gdriveInputAdditional.value.trim();
          if (driveLink) {
            this.fetchGoogleDriveFiles(driveLink, true);
            gdriveInputAdditional.value = "";
          }
        }
      });
    }

    const continueBtn = document.querySelector('[data-step="3"] .continue-btn');
    continueBtn.onclick = () => {
      // Get account_id at the time of upload, not when the page loads
      const selectedAccount = document.querySelector(".account.selected");
      if (!selectedAccount) {
        window.showError("Please select an ad account first");
        return;
      }
      const account_id = selectedAccount.dataset.campaignId;

      // Hide back button when upload starts
      const backBtn = document.querySelector('[data-step="3"] .back-btn');
      if (backBtn) {
        backBtn.style.display = "none";
      }

      // Handle additional files upload
      if (this.initialUploadComplete && this.additionalFilesToUpload.length > 0) {
        this.uploadAdditionalFiles(this.additionalFilesToUpload, account_id);
      } else {
        this.uploadFiles(this.uploadedFiles, account_id);
      }
    };

    // Add drag and drop to the files list area
    const uploadStep3 = document.querySelector('[data-step="3"]');
    if (uploadStep3) {
      uploadStep3.addEventListener("dragover", (e) => {
        e.preventDefault();
        filesList.style.backgroundColor = "#e3f2fd";
      });

      uploadStep3.addEventListener("dragleave", () => {
        filesList.style.backgroundColor = "transparent";
      });

      uploadStep3.addEventListener("drop", (e) => {
        e.preventDefault();
        filesList.style.backgroundColor = "transparent";
        this.handleFiles(e.dataTransfer.files);
      });
    }
  }

  removeFile(index) {
    const removedFile = this.uploadedFiles[index];
    this.uploadedFiles.splice(index, 1);

    // Also remove from additional files if it's there
    if (this.additionalFilesToUpload.length > 0) {
      const additionalIndex = this.additionalFilesToUpload.findIndex((file) => file.name === removedFile.name && file.size === removedFile.size);
      if (additionalIndex !== -1) {
        this.additionalFilesToUpload.splice(additionalIndex, 1);
      }
    }

    if (this.uploadedFiles.length === 0) {
      // If no files left, go back to file upload step
      this.showStep(2);
      this.initialUploadComplete = false;
      this.additionalFilesToUpload = [];
    } else {
      // Re-render the file list
      this.displayUploadedFiles();

      // Update button if we still have additional files to upload
      if (this.initialUploadComplete && this.additionalFilesToUpload.length > 0) {
        this.updateUploadButtonForAdditionalFiles();
      }
    }
  }

  updateUploadButtonForAdditionalFiles() {
    const button = document.querySelector('[data-step="3"] .continue-btn');
    const additionalCount = this.additionalFilesToUpload.length;

    button.textContent = `Upload ${additionalCount} More ${additionalCount === 1 ? "File" : "Files"}`;
    button.style.backgroundColor = "#103dee";
    button.style.cursor = "pointer";
    button.disabled = false;
    button.style.opacity = "1";
    button.classList.remove("upload-complete");

    // Show back button again
    const backBtn = document.querySelector('[data-step="3"] .back-btn');
    if (backBtn) {
      backBtn.style.display = "inline-block";
    }
  }

  async uploadFiles(files, account_id) {
    this.showLoadingState();

    // Separate files by type
    const gdriveFiles = files.filter((file) => file.source === "gdrive");
    const libraryFiles = files.filter((file) => file.isFromLibrary);
    const localFiles = files.filter((file) => !file.source && !file.isFromLibrary);

    // Initialize uploadPromises array early
    const uploadPromises = [];

    const button = document.querySelector('[data-step="3"] .continue-btn');

    // Update button text to show total files being processed
    const totalFiles = gdriveFiles.length + localFiles.length + libraryFiles.length;
    animatedEllipsis.start(button, `Processing ${totalFiles} file${totalFiles > 1 ? "s" : ""}`);

    // Reset progress tracker for new upload
    this.progressTracker.reset();

    // Create session first and connect to SSE
    let sessionId = null;

    // For video files, we need to create a session and connect to SSE first
    const hasVideos = localFiles.some((file) => file.type && file.type.startsWith("video/"));
    if (hasVideos || gdriveFiles.length > 0) {
      // Create a session by calling a simple endpoint first
      try {
        const sessionResponse = await fetch("/api/create-upload-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ totalFiles }),
        });

        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          sessionId = sessionData.sessionId;

          // Connect to SSE immediately
          this.progressTracker.connectToSSE(sessionId);

          // Give SSE more time to properly connect
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (err) {
        console.warn("Could not create upload session:", err);
      }
    }

    // Handle Google Drive files as a promise (non-blocking)
    if (gdriveFiles.length > 0) {
      const gdrivePromise = (async () => {
        try {
          // Extract file IDs from Google Drive files
          const fileIds = gdriveFiles.map((file) => file.gdrive_id);

          console.log("Processing Google Drive files:", fileIds);

          // Call the new combined download and upload endpoint
          const downloadResponse = await fetch("/api/download-and-upload-google-files", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fileIds, account_id, sessionId }),
          });

          if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json();
            console.error("Google Drive upload failed:", errorData);
            throw new Error(errorData.error || "Failed to process Google Drive files");
          }

          const gdriveResponse = await downloadResponse.json();
          console.log("Google Drive upload response:", gdriveResponse);

          const gdriveResults = gdriveResponse.results || gdriveResponse;

          // Process results and add to normalized assets
          const skippedFiles = [];
          const gdriveAssets = [];

          for (const result of gdriveResults) {
            if (result.status === "success") {
              // Format the result to match expected asset structure
              if (result.type === "image") {
                gdriveAssets.push({
                  type: "image",
                  file: result.file,
                  imageHash: result.imageHash,
                  status: "success",
                });
              } else if (result.type === "video") {
                gdriveAssets.push({
                  type: "video",
                  file: result.file,
                  data: result.data,
                  status: "success",
                });
              }
            } else if (result.status === "skipped") {
              skippedFiles.push(result);
            }
          }

          // Show warning if files were skipped
          if (skippedFiles.length > 0) {
            const skippedNames = skippedFiles
              .slice(0, 3)
              .map((f) => f.fileName || f.file)
              .join(", ");
            const moreText = skippedFiles.length > 3 ? ` and ${skippedFiles.length - 3} more` : "";
            alert(`Warning: Some files were skipped (only images and videos are supported): ${skippedNames}${moreText}`);
          }

          // Return formatted results
          if (gdriveAssets.length > 0) {
            return gdriveAssets.map((asset) => ({
              status: "fulfilled",
              value: asset,
            }));
          }
          return [];
        } catch (error) {
          console.error("Error processing Google Drive files:", error);
          alert("Failed to process Google Drive files. Please try again.");
          throw error;
        }
      })();

      uploadPromises.push(gdrivePromise);
    }
    const imageFiles = localFiles.filter((file) => file.type && file.type.startsWith("image/"));
    const videoFiles = localFiles.filter((file) => file.type && file.type.startsWith("video/"));

    if (imageFiles.length > 0) {
      const imageFormData = new FormData();
      imageFiles.forEach((file) => imageFormData.append("file", file));
      imageFormData.append("account_id", account_id);

      uploadPromises.push(
        fetch("/api/upload-images", {
          body: imageFormData,
          method: "POST",
        }).then((res) => res.json())
      );
    }

    if (videoFiles.length > 0) {
      const videoFormData = new FormData();
      videoFiles.forEach((file) => videoFormData.append("file", file));
      videoFormData.append("account_id", account_id);
      if (sessionId) {
        videoFormData.append("sessionId", sessionId);
      }

      uploadPromises.push(
        fetch("/api/upload-videos", {
          body: videoFormData,
          method: "POST",
        }).then((res) => res.json())
      );
    }

    try {
      const settledResults = await Promise.allSettled(uploadPromises);
      const normalizedAssets = [];
      const failedUploads = [];

      settledResults.forEach((result) => {
        if (result.status === "rejected") {
          failedUploads.push({
            file: "Unknown file",
            error: result.reason?.message || "Upload failed",
          });
          return;
        }

        // result.status is 'fulfilled', so result.value exists
        const items = result.value.results || result.value;

        if (Array.isArray(items)) {
          items.forEach((item) => {
            // This handles nested results from Promise.all inside the monkey-patch
            if (item.status === "fulfilled") {
              const subItem = item.value;
              if (subItem.status === "failed") {
                failedUploads.push({
                  file: subItem.file,
                  error: subItem.error || "Upload failed",
                });
              } else if (subItem.type === "image") {
                normalizedAssets.push(subItem);
              } else if (subItem.type === "video") {
                normalizedAssets.push({
                  type: "video",
                  file: subItem.file,
                  data: subItem.data,
                  status: "success",
                });
              }
            } else if (item.status === "rejected") {
              failedUploads.push({
                file: "Unknown file",
                error: item.reason?.message || "Upload failed",
              });
            } else {
              // This handles direct results from the API calls
              if (item.status === "failed") {
                failedUploads.push({
                  file: item.file,
                  error: item.error || "Upload failed",
                });
              } else if (item.type === "image") {
                normalizedAssets.push(item);
              } else if (item.type === "video") {
                normalizedAssets.push({
                  type: "video",
                  file: item.file,
                  data: item.data,
                  status: "success",
                });
              }
            }
          });
        }
      });

      // Check if all uploads failed
      if (normalizedAssets.length === 0 && failedUploads.length > 0) {
        if (this.progressTracker.eventSource) {
          this.progressTracker.eventSource.close();
        }
        this.hideLoadingState(true);

        const errorMsg = failedUploads.map((f) => `${f.file}: ${f.error}`).join("\n");
        alert(`All uploads failed:\n\n${errorMsg}\n\nPlease try again.`);
        return;
      } else if (failedUploads.length > 0) {
        const failedNames = failedUploads
          .slice(0, 3)
          .map((f) => f.file)
          .join(", ");
        const moreText = failedUploads.length > 3 ? ` and ${failedUploads.length - 3} more` : "";
        alert(`Warning: Some uploads failed: ${failedNames}${moreText}\n\nYou can continue with the successful uploads or go back and try again.`);
      }

      if (normalizedAssets.length > 0) {
        if (this.progressTracker.eventSource && (videoFiles.length > 0 || gdriveFiles.length > 0)) {
          this.progressTracker.onComplete = (hasErrors, errors) => {
            this.hideLoadingState(hasErrors);
            this.showAdCopySection();
          };
        } else {
          this.hideLoadingState(false);
          this.showAdCopySection();
        }

        const currentAssets = appState.getState().uploadedAssets || [];
        appState.updateState("uploadedAssets", [...currentAssets, ...normalizedAssets]);
      } else if (failedUploads.length === 0) {
        // No assets normalized but no failures either, could be an issue.
        this.hideLoadingState(true);
        alert("Upload complete, but no files were processed. Please check the file types and try again.");
      }
    } catch (err) {
      console.log("There was an error uploading files to meta.", err);
      this.hideLoadingState(true);
      alert("An unexpected error occurred during upload. Please check the console and try again.");
      return err;
    }
  }

  async uploadAdditionalFiles(files, account_id) {
    this.showLoadingState();

    // Separate Google Drive files from local files
    const gdriveFiles = files.filter((file) => file.source === "gdrive");
    const localFiles = files.filter((file) => !file.source || file.source !== "gdrive");

    // Initialize uploadPromises array
    const uploadPromises = [];

    const button = document.querySelector('[data-step="3"] .continue-btn');

    // Update button text to show total files being processed
    const totalFiles = gdriveFiles.length + localFiles.length;
    animatedEllipsis.start(button, `Processing ${totalFiles} file${totalFiles > 1 ? "s" : ""}`);

    // Handle Google Drive files as a promise (non-blocking)
    if (gdriveFiles.length > 0) {
      const gdrivePromise = (async () => {
        try {
          // Extract file IDs from Google Drive files
          const fileIds = gdriveFiles.map((file) => file.gdrive_id);

          console.log("Processing Google Drive files:", fileIds);

          // Call the new combined download and upload endpoint
          const downloadResponse = await fetch("/api/download-and-upload-google-files", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ fileIds, account_id }),
          });

          if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json();
            console.error("Google Drive upload failed:", errorData);
            throw new Error(errorData.error || "Failed to process Google Drive files");
          }

          const gdriveResponse = await downloadResponse.json();
          console.log("Google Drive upload response:", gdriveResponse);

          const gdriveResults = gdriveResponse.results || gdriveResponse;

          // Process results and add to normalized assets
          const skippedFiles = [];
          const gdriveAssets = [];

          for (const result of gdriveResults) {
            if (result.status === "success") {
              // Format the result to match expected asset structure
              if (result.type === "image") {
                gdriveAssets.push({
                  type: "image",
                  file: result.file,
                  imageHash: result.imageHash,
                  status: "success",
                });
              } else if (result.type === "video") {
                gdriveAssets.push({
                  type: "video",
                  file: result.file,
                  data: result.data,
                  status: "success",
                });
              }
            } else if (result.status === "skipped") {
              skippedFiles.push(result);
            }
          }

          // Show warning if files were skipped
          if (skippedFiles.length > 0) {
            const skippedNames = skippedFiles
              .slice(0, 3)
              .map((f) => f.fileName || f.file)
              .join(", ");
            const moreText = skippedFiles.length > 3 ? ` and ${skippedFiles.length - 3} more` : "";
            alert(`Warning: Some files were skipped (only images and videos are supported): ${skippedNames}${moreText}`);
          }

          // Return formatted results
          if (gdriveAssets.length > 0) {
            return gdriveAssets.map((asset) => ({
              status: "fulfilled",
              value: asset,
            }));
          }
          return [];
        } catch (error) {
          console.error("Error processing Google Drive files:", error);
          alert("Failed to process Google Drive files. Please try again.");
          throw error;
        }
      })();

      uploadPromises.push(gdrivePromise);
    }
    const imageFiles = localFiles.filter((file) => file.type && file.type.startsWith("image/"));
    const videoFiles = localFiles.filter((file) => file.type && file.type.startsWith("video/"));

    if (imageFiles.length > 0) {
      const imageFormData = new FormData();
      imageFiles.forEach((file) => imageFormData.append("file", file));
      imageFormData.append("account_id", account_id);

      uploadPromises.push(
        fetch("/api/upload-images", {
          body: imageFormData,
          method: "POST",
        }).then((res) => res.json())
      );
    }

    if (videoFiles.length > 0) {
      const videoFormData = new FormData();
      videoFiles.forEach((file) => videoFormData.append("file", file));
      videoFormData.append("account_id", account_id);
      if (sessionId) {
        videoFormData.append("sessionId", sessionId);
      }

      uploadPromises.push(
        fetch("/api/upload-videos", {
          body: videoFormData,
          method: "POST",
        }).then((res) => res.json())
      );
    }

    try {
      const settledResults = await Promise.allSettled(uploadPromises);
      const normalizedAssets = [];
      const failedUploads = [];

      settledResults.forEach((result) => {
        if (result.status === "rejected") {
          failedUploads.push({
            file: "Unknown file",
            error: result.reason?.message || "Upload failed",
          });
          return;
        }

        const items = result.value.results || result.value;

        if (Array.isArray(items)) {
          items.forEach((item) => {
            if (item.status === "fulfilled") {
              const subItem = item.value;
              if (subItem.status === "failed") {
                failedUploads.push({ file: subItem.file, error: subItem.error || "Upload failed" });
              } else if (subItem.type === "image") {
                normalizedAssets.push(subItem);
              } else if (subItem.type === "video") {
                normalizedAssets.push({ type: "video", file: subItem.file, data: subItem.data, status: "success" });
              }
            } else if (item.status === "rejected") {
              failedUploads.push({ file: "Unknown file", error: item.reason?.message || "Upload failed" });
            } else {
              if (item.status === "failed") {
                failedUploads.push({ file: item.file, error: item.error || "Upload failed" });
              } else if (item.type === "image") {
                normalizedAssets.push(item);
              } else if (item.type === "video") {
                normalizedAssets.push({ type: "video", file: item.file, data: item.data, status: "success" });
              }
            }
          });
        }
      });

      if (failedUploads.length > 0) {
        const failedNames = failedUploads
          .slice(0, 3)
          .map((f) => f.file)
          .join(", ");
        const moreText = failedUploads.length > 3 ? ` and ${failedUploads.length - 3} more` : "";
        alert(`Warning: Some additional uploads failed: ${failedNames}${moreText}`);
      }

      if (normalizedAssets.length > 0) {
        const currentAssets = appState.getState().uploadedAssets;
        appState.updateState("uploadedAssets", [...currentAssets, ...normalizedAssets]);
        this.additionalFilesToUpload = [];
        this.hideLoadingState();
        this.updateAdCopySectionTitle();
      } else {
        this.hideLoadingState(true); // Show error state if no new assets were added
        if (failedUploads.length > 0) {
          alert("All additional file uploads failed. Please try again.");
        }
      }
    } catch (err) {
      console.log("There was an error uploading additional files to meta.", err);
      this.hideLoadingState(true);
      alert("An unexpected error occurred while uploading additional files. Please try again.");
      return err;
    }
  }

  updateAdCopySectionTitle() {
    const adCopySection = document.querySelector(".ad-copy-container");
    if (adCopySection.style.display === "block") {
      const title = adCopySection.querySelector("h2");
      let fileTypeText;
      if (this.selectedUploadType === "mixed") {
        fileTypeText = "Files";
      } else if (this.selectedUploadType === "image") {
        fileTypeText = "Images";
      } else {
        fileTypeText = "Videos";
      }
      title.textContent = `Editing Ad Copy for All ${this.uploadedFiles.length} ${fileTypeText}`;
    }
  }

  showAdCopySection() {
    const adCopySection = document.querySelector(".ad-copy-container");
    adCopySection.style.display = "block";

    const title = adCopySection.querySelector("h2");
    let fileTypeText;
    if (this.selectedUploadType === "mixed") {
      fileTypeText = "Files";
    } else if (this.selectedUploadType === "image") {
      fileTypeText = "Images";
    } else {
      fileTypeText = "Videos";
    }
    title.textContent = `Editing Ad Copy for All ${this.uploadedFiles.length} ${fileTypeText}`;

    // Populate page dropdown if we have pages data
    const dropdowns = adCopySection.querySelectorAll(".custom-dropdown");
    if (dropdowns.length > 0) {
      // Check if dropdowns already have customDropdownInstance to avoid re-initialization
      const needsInit = Array.from(dropdowns).some((d) => !d.customDropdownInstance);
      if (needsInit) {
        new CustomDropdown(".ad-copy-container .custom-dropdown");
      } else {
        // Re-attach listeners for existing dropdowns
        dropdowns.forEach((dropdown) => {
          attachDropdownOptionListeners(dropdown);
        });
      }
    }

    adCopySection.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    const continueBtn = adCopySection.querySelector("button");
    continueBtn.onclick = (e) => {
      e.preventDefault();
      if (this.validateAdCopyForm()) {
        this.showReviewSection();
      }
    };
  }

  validateAdCopyForm() {
    const inputs = document.querySelectorAll(".ad-copy-container input[required], .ad-copy-container textarea[required]");
    let isValid = true;

    inputs.forEach((input) => {
      if (!input.value.trim()) {
        input.classList.add("empty-input");
        isValid = false;

        input.addEventListener(
          "input",
          () => {
            input.classList.remove("empty-input");
          },
          { once: true }
        );
      } else {
        input.classList.remove("empty-input");
      }
    });

    // Validate URL format
    const destinationUrlInput = document.querySelector('.ad-copy-container input[placeholder="Destination URL*"]');
    if (destinationUrlInput && destinationUrlInput.value) {
      try {
        // Just check if it starts with http:// or https://
        const urlValue = destinationUrlInput.value.trim();
        if (!urlValue.startsWith("http://") && !urlValue.startsWith("https://")) {
          destinationUrlInput.classList.add("empty-input");
          isValid = false;
          alert("URL must start with http:// or https://");
        }
      } catch (error) {
        console.error("Error validating URL:", error);
        destinationUrlInput.classList.add("empty-input");
        isValid = false;
      }
    }

    // Validate Page dropdown
    const pageDropdownDisplay = document.querySelector('.ad-copy-container .dropdown-selected[data-dropdown="page"] .dropdown-display');
    if (!pageDropdownDisplay || pageDropdownDisplay.classList.contains("placeholder")) {
      pageDropdownDisplay.parentElement.classList.add("empty-input");
      isValid = false;
    } else {
      pageDropdownDisplay.parentElement.classList.remove("empty-input");
    }

    // Validate CTA dropdown
    const ctaSelectedOption = document.querySelector(".ad-copy-container .dropdown-options.cta li.selected");
    const ctaDropdownDisplay = document.querySelector('.ad-copy-container .dropdown-selected[data-dropdown="cta"] .dropdown-display');

    // Check if there's a selected option OR if the dropdown has a data-value set (from initialization)
    if (!ctaSelectedOption && (!ctaDropdownDisplay || !ctaDropdownDisplay.dataset.value)) {
      ctaDropdownDisplay.parentElement.classList.add("empty-input");
      isValid = false;
    } else {
      ctaDropdownDisplay.parentElement.classList.remove("empty-input");
    }

    // Validate destination URL
    const urlInput = document.querySelector('.ad-copy-container input[type="url"]');
    if (urlInput) {
      const urlValue = urlInput.value.trim();

      if (!urlValue) {
        urlInput.classList.add("empty-input");
        isValid = false;
      } else {
        // Use browser's built-in URL validation instead of regex
        try {
          new URL(urlValue);
          urlInput.classList.remove("empty-input");
        } catch (e) {
          // If URL constructor fails, check if it at least starts with http/https
          if (!urlValue.startsWith("http://") && !urlValue.startsWith("https://")) {
            urlInput.classList.add("empty-input");
            isValid = false;
            alert("URL must start with http:// or https://");
          }
        }
      }

      urlInput.addEventListener(
        "input",
        () => {
          urlInput.classList.remove("empty-input");
        },
        { once: true }
      );
    }

    return isValid;
  }

  showReviewSection() {
    const reviewSection = document.querySelector(".create-ads-container");
    reviewSection.style.display = "block";

    // Ensure the create ads button is in a clean state before showing
    const existingBtn = reviewSection.querySelector(".create-ads-button");
    if (existingBtn) {
      animatedEllipsis.stop(existingBtn);
      existingBtn.textContent = "Create Ads";
      existingBtn.disabled = false;
      existingBtn.style.opacity = "1";
      console.log("[showReviewSection] Button reset to clean state");
    }

    // Update review content
    this.populateReviewData();

    // Scroll to position review section at top of viewport
    reviewSection.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    // Handle final submission
    const createBtn = reviewSection.querySelector(".create-ads-button");
    console.log("[showReviewSection] Create button found:", !!createBtn);

    if (!createBtn) {
      console.error("[showReviewSection] Create button not found!");
      return;
    }

    // Remove any existing click handlers to prevent duplicates
    const newBtn = createBtn.cloneNode(true);
    createBtn.parentNode.replaceChild(newBtn, createBtn);
    console.log("[showReviewSection] Button cloned and replaced");

    // Add fresh click handler
    newBtn.onclick = (e) => {
      console.log("[showReviewSection] Button clicked!");
      e.preventDefault();
      this.createAds();
    };
    console.log("[showReviewSection] Click handler attached");
  }

  populateReviewData() {
    // Update ad set name in review
    const reviewTitle = document.querySelector(".review-container h3");

    const adset_name = document.querySelector(".config-adset-name").value;
    reviewTitle.textContent = `Ad Set: ${adset_name}`;

    // Update image previews
    const dataContainer = document.querySelector(".data-container-creatives");
    const imagesContainer = document.querySelector(".data-container-creatives .images");
    if (imagesContainer) {
      const isCollapsed = this.uploadedFiles.length > 3;

      // Add toggle button and count header
      const containerHeader = document.createElement("div");
      containerHeader.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding: 0;";
      containerHeader.innerHTML = `
        <h4 style="font-size: 14px; font-weight: 600; color: #333; margin: 0;">
          Creatives (${this.uploadedFiles.length} ${this.selectedUploadType === "image" ? "images" : "videos"})
        </h4>
        <button type="button" class="toggle-review-btn" style="background: none; border: none; color: #103dee; cursor: pointer; font-size: 13px; padding: 4px 8px; text-align: right;">
          ${isCollapsed ? "Show All ▼" : "Collapse ▲"}
        </button>
      `;

      // Clear and rebuild the container structure
      imagesContainer.innerHTML = "";
      imagesContainer.appendChild(containerHeader);

      // Add wrapper for overflow control
      const imagesWrapper = document.createElement("div");
      imagesWrapper.className = "images-wrapper";
      imagesWrapper.style.cssText = isCollapsed ? "max-height: 200px; overflow-y: auto;" : "";

      // Add collapsed class to container if needed
      if (isCollapsed) {
        dataContainer.classList.add("collapsed");
      } else {
        dataContainer.classList.remove("collapsed");
      }

      this.uploadedFiles.forEach((file) => {
        const creativeRow = document.createElement("div");
        creativeRow.className = "creative-data-row";

        if (file.type.startsWith("image/")) {
          if (file.source === "gdrive") {
            // Google Drive files - show placeholder
            const imgPlaceholder = document.createElement("div");
            imgPlaceholder.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
            imgPlaceholder.textContent = "IMG";
            creativeRow.appendChild(imgPlaceholder);
          } else {
            // Local files - create object URL only if it's a valid File object
            const img = document.createElement("img");
            img.style.cssText = "width: 40px; height: 40px; object-fit: cover; flex-shrink: 0;";
            try {
              img.src = URL.createObjectURL(file);
            } catch (error) {
              // If createObjectURL fails, show placeholder
              const imgPlaceholder = document.createElement("div");
              imgPlaceholder.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
              imgPlaceholder.textContent = "IMG";
              creativeRow.appendChild(imgPlaceholder);
              console.log("Error creating object URL for preview:", error);
            }
            if (img.src) {
              creativeRow.appendChild(img);
            }
          }
        } else {
          const videoIcon = document.createElement("div");
          videoIcon.style.cssText = "width: 40px; height: 40px; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #666; flex-shrink: 0;";
          videoIcon.textContent = "VID";
          creativeRow.appendChild(videoIcon);
        }

        const fileName = document.createElement("p");
        fileName.textContent = file.name;
        fileName.style.cssText = "overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin: 0; font-size: 12px; color: #666; min-width: 0;";

        creativeRow.appendChild(fileName);
        imagesWrapper.appendChild(creativeRow);
      });

      imagesContainer.appendChild(imagesWrapper);

      // Add toggle functionality for review
      const toggleReviewBtn = dataContainer.querySelector(".toggle-review-btn");
      toggleReviewBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isCurrentlyCollapsed = imagesWrapper.style.maxHeight === "200px";
        if (isCurrentlyCollapsed) {
          imagesWrapper.style.maxHeight = "none";
          imagesWrapper.style.overflowY = "visible";
          dataContainer.classList.remove("collapsed");
          toggleReviewBtn.textContent = "Collapse ▲";
        } else {
          imagesWrapper.style.maxHeight = "200px";
          imagesWrapper.style.overflowY = "auto";
          dataContainer.classList.add("collapsed");
          toggleReviewBtn.textContent = "Show All ▼";
        }
      });
    }

    // Update ad copy review
    const primaryTextRaw = document.querySelector('.ad-copy-container textarea[placeholder="Primary Text*"]').value;
    // For display: preserve original formatting
    const primaryTextDisplay = primaryTextRaw;
    // For Facebook API: use double line breaks
    const primaryText = primaryTextRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line)
      .join("\n\n");
    const headline = document.querySelector('.ad-copy-container input[placeholder="Headline*"]').value;
    const destinationUrl = document.querySelector('.ad-copy-container input[placeholder="Destination URL*"]').value;
    const description = document.querySelector(".adcopy-description").value;
    const ctaSelectedOption = document.querySelector(".ad-copy-container .dropdown-options.cta li.selected");
    const cta = ctaSelectedOption ? ctaSelectedOption.dataset.value : "";
    const ctaDisplayText = ctaSelectedOption ? ctaSelectedOption.textContent : "";
    const pageDropdownDisplay = document.querySelector('.ad-copy-container .dropdown-selected[data-dropdown="page"] .dropdown-display');
    const pageText = pageDropdownDisplay ? pageDropdownDisplay.textContent : "";
    const pageId = pageDropdownDisplay ? pageDropdownDisplay.dataset.pageid : "";

    // Debug logging
    console.log("[populateReviewData] CTA Selected:", cta, ctaDisplayText);
    console.log("[populateReviewData] Page Selected:", pageText, pageId);
    console.log("[populateReviewData] Primary Text:", primaryText?.substring(0, 50));
    console.log("[populateReviewData] Headline:", headline);
    const primaryTextEl = document.querySelector(".primary-text-review-container p");
    const headlineEl = document.querySelector(".headline-review-container p");
    const pageEl = document.querySelector(".cta-text-review-container.page p");
    const ctaEl = document.querySelector(".cta-text-review-container.cta p");
    const linkEl = document.querySelector(".cta-text-review-container.link p");
    const descriptionEl = document.querySelector(".cta-text-review-container.description p");

    if (primaryTextEl) primaryTextEl.textContent = primaryTextDisplay;
    if (headlineEl) headlineEl.textContent = headline;
    if (pageEl) pageEl.textContent = pageText;
    if (ctaEl) ctaEl.textContent = ctaDisplayText || cta;
    if (linkEl) {
      try {
        // Safely set the URL text content
        linkEl.textContent = destinationUrl;
      } catch (error) {
        console.error("Error setting destination URL:", error);
        linkEl.textContent = "Invalid URL";
      }
    }
    if (descriptionEl) descriptionEl.textContent = description || "No description provided";

    try {
      appState.updateState("adCopyData", { primaryText, headline, cta, destinationUrl, description, pageId });
    } catch (error) {
      console.error("Error updating app state with ad copy data:", error);
    }
  }

  createAds() {
    console.log("[createAds] Method called!");

    // show loading state
    const button = document.querySelector(".create-ads-button");
    if (!button) {
      console.error("[createAds] Button not found!");
      return;
    }
    console.log("[createAds] Button found, starting animation");
    animatedEllipsis.start(button, "Creating Ads");
    button.disabled = true;
    button.style.opacity = "0.6";

    // Add file names to each asset for ad naming
    const assetsWithNames = appState.getState().uploadedAssets.map((asset) => {
      // Extract file name without extension
      const fileName = asset.file;
      const nameWithoutExtension = fileName.substring(0, fileName.lastIndexOf(".")) || fileName;

      return {
        value: asset,
        adName: nameWithoutExtension,
      };
    });

    const payload = {
      name: appState.getState().adSetConfig.adset_name,
      page_id: appState.getState().adCopyData.pageId,
      message: appState.getState().adCopyData.primaryText,
      headline: appState.getState().adCopyData.headline,
      type: appState.getState().adCopyData.cta,
      link: appState.getState().adCopyData.destinationUrl,
      description: appState.getState().adCopyData.description,
      account_id: appState.getState().adSetConfig.account_id,
      adset_id: appState.getState().adSetConfig.id,
      format: "mixed",
      assets: assetsWithNames,
    };

    try {
      fetch("/api/create-ad-creative", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then((data) => {
          // Check the response to see if any ads failed
          const successful = data.filter((result) => result.status === "fulfilled");
          const failed = data.filter((result) => result.status === "rejected");

          if (successful.length === 0) {
            // All ads failed - extract error messages
            const errorMessages = failed.map((f) => {
              // Extract error message from various possible formats
              if (f.reason?.message) return f.reason.message;
              if (typeof f.reason === "string") return f.reason;
              if (f.reason instanceof Error) return f.reason.message;
              // Fallback to string representation
              if (f.reason && typeof f.reason === "object") {
                const reasonStr = f.reason.toString();
                if (reasonStr !== "[object Object]") return reasonStr;
              }
              return "Unknown error";
            });
            const uniqueErrors = [...new Set(errorMessages)];
            const errorDetail = uniqueErrors.join("\n\n");
            console.error(`All ad creations failed:`, failed);

            // Reset button state
            animatedEllipsis.stop(button);
            button.disabled = false;
            button.style.opacity = "1";
            button.textContent = "Create Ads";

            // Show error to user
            if (window.showError) {
              window.showError(`Failed to create ads:\n\n${uniqueErrors.slice(0, 3).join("\n\n")}${uniqueErrors.length > 3 ? `\n\n...and ${uniqueErrors.length - 3} more errors` : ""}`, 10000);
            } else {
              alert(`❌ All Ads Failed to Create\n\n${errorDetail}`);
            }
            return;
          } else if (failed.length > 0) {
            // Some ads failed
            const successCount = successful.length;
            const failCount = failed.length;
            const totalCount = data.length;

            // Extract error messages
            const errorMessages = failed.map((f) => {
              // Extract error message from various possible formats
              if (f.reason?.message) return f.reason.message;
              if (typeof f.reason === "string") return f.reason;
              if (f.reason instanceof Error) return f.reason.message;
              // Try to extract from toString or any string representation
              if (f.reason && typeof f.reason === "object") {
                const reasonStr = f.reason.toString();
                if (reasonStr !== "[object Object]") return reasonStr;
              }
              return "Unknown error";
            });

            // Show partial success screen with warning
            this.showSuccessScreen(successCount, failCount, errorMessages);
            console.warn(`Created ${successCount} ads successfully, but ${failCount} failed:`, data);
          } else {
            // All ads succeeded
            this.showSuccessScreen();
            console.log("Successfully created all facebook ads!", data);
          }
        })
        .catch((err) => {
          console.error("Error creating ads:", err);
          animatedEllipsis.stop(button);
          button.disabled = false;
          button.style.opacity = "1";
          button.textContent = "Create Ads";

          // Extract user-friendly error message from error_user_msg if available
          extractErrorMessage(err).then((errorMessage) => {
            alert(`❌ Failed to Create Ads\n\n${errorMessage}\n\nPlease check the requirements and try again.`);
          });
        });
    } catch (err) {
      console.error("Error posting to /api/create-ad-creative.", err);
      animatedEllipsis.stop(button);
      button.disabled = false;
      button.style.opacity = "1";
      button.textContent = "Create Ads";
    }
  }

  showSuccessScreen(successCount = null, failCount = 0, errorMessages = []) {
    // Stop the create ads button animation
    const createButton = document.querySelector(".create-ads-button");
    if (createButton) {
      animatedEllipsis.stop(createButton);
    }

    // Hide all other divs in column 4
    const uploadColumn = document.getElementById("col-4");
    const allDivs = uploadColumn.querySelectorAll(":scope > div");
    allDivs.forEach((div) => {
      if (!div.classList.contains("success-wrapper")) {
        div.style.display = "none";
      }
    });

    const successSection = document.querySelector(".success-wrapper");
    successSection.style.display = "block";

    // Update success message
    const successMessage = successSection.querySelector("p");
    const actualSuccessCount = successCount !== null ? successCount : this.uploadedFiles.length;

    if (failCount > 0) {
      // Extract and format error messages
      const errorMap = new Map();
      errorMessages.forEach((msg) => {
        // Extract the main error message (remove the "Ad name:" prefix if present)
        const mainError = msg.includes(":") ? msg.split(":").slice(1).join(":").trim() : msg;
        errorMap.set(mainError, (errorMap.get(mainError) || 0) + 1);
      });

      // Format errors with counts
      const formattedErrors = Array.from(errorMap.entries()).map(([error, count]) => {
        return count > 1 ? `${error} (${count} ads)` : error;
      });

      const errorSummary = formattedErrors.length > 5 ? formattedErrors.slice(0, 5).join("<br>") + `<br><em>...and ${formattedErrors.length - 5} more error types</em>` : formattedErrors.join("<br>");

      successMessage.innerHTML = `
        <div style="text-align: center;">
          <span style="color: #4CAF50; font-size: 18px; font-weight: bold;">${actualSuccessCount} Ads Successfully Created</span><br>
          <span style="color: #f44336; font-size: 16px;">${failCount} Ads Failed</span>
        </div>
        <div style="margin-top: 15px; padding: 15px; background-color: #ffebee; border: 1px solid #ffcdd2; border-radius: 8px; text-align: left; max-height: 200px; overflow-y: auto;">
          <div style="color: #c62828; font-weight: bold; margin-bottom: 8px;">Failed Ad Details:</div>
          <div style="color: #424242; font-size: 14px; line-height: 1.5;">${errorSummary}</div>
        </div>
      `;
    } else {
      successMessage.textContent = `${actualSuccessCount} Ads Successfully Created`;
    }

    // Update View in Ads Manager button with correct link
    const viewAdsBtn = successSection.querySelector("button");
    const accountId = appState.getState().adSetConfig.account_id;
    const campaignId = appState.getState().adSetConfig.campaign_id;
    const businessId = "964913537226100"; // IZAK - grab from api

    const adsManagerUrl = `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${accountId}&business_id=${businessId}&selected_campaign_ids=${campaignId}`;

    viewAdsBtn.onclick = () => {
      window.open(adsManagerUrl, "_blank");
    };

    // Scroll to position success section at top of viewport
    successSection.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });

    // Handle "Create More Ads" click
    const createMoreBtn = successSection.querySelector("h3");
    createMoreBtn.onclick = () => {
      location.reload();
    };
  }
  showStep(stepNumber) {
    // Hide all steps
    document.querySelectorAll(".upload-step").forEach((step) => {
      step.style.display = "none";
    });

    // Show target step
    const targetStep = document.querySelector(`[data-step="${stepNumber}"]`);
    if (targetStep) {
      targetStep.style.display = "block";
    }
  }

  handleGoogleDriveInput() {
    // Handle initial Google Drive input
    const fetchBtn = document.querySelector(".gdrive-fetch-btn");
    const gdriveInput = document.querySelector(".gdrive-link-input");

    if (fetchBtn && gdriveInput) {
      fetchBtn.addEventListener("click", () => {
        const driveLink = gdriveInput.value.trim();
        if (driveLink) {
          this.fetchGoogleDriveFiles(driveLink);
        }
      });

      // Allow Enter key to fetch
      gdriveInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const driveLink = gdriveInput.value.trim();
          if (driveLink) {
            this.fetchGoogleDriveFiles(driveLink);
          }
        }
      });
    }
  }

  async fetchGoogleDriveFiles(driveLink, isAdditional = false) {
    // Extract file/folder ID from Google Drive link
    // Matches both file links (/d/) and folder links (/folders/)
    const fileIdMatch = driveLink.match(/\/(?:d|folders)\/([a-zA-Z0-9-_]+)/);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;

    if (!fileId) {
      alert("Invalid Google Drive link. Please paste a valid Google Drive file or folder link.");
      return;
    }

    // If this is a fresh upload (not additional) and initial upload was completed, clear old files
    if (!isAdditional && this.initialUploadComplete) {
      this.uploadedFiles = [];
    }

    // Show loading state on the fetch button
    const fetchBtn = isAdditional ? document.querySelector(".gdrive-fetch-btn-additional") : document.querySelector(".gdrive-fetch-btn");
    const originalBtnText = fetchBtn.innerHTML;
    animatedEllipsis.start(fetchBtn, "Fetching");
    fetchBtn.disabled = true;
    fetchBtn.style.opacity = "0.7";

    try {
      // Call the API to fetch files from Google Drive
      const response = await fetch(`/api/fetch-google-data?folderId=${fileId}`);

      if (!response.ok) {
        throw new Error("Failed to fetch Google Drive files");
      }

      const data = await response.json();

      // Process the files returned from the API
      if (data.files && data.files.length > 0) {
        const mediaFiles = [];
        const skippedFiles = [];

        data.files.forEach((file) => {
          const isImage = file.mimeType && file.mimeType.startsWith("image/");
          const isVideo = file.mimeType && file.mimeType.startsWith("video/");

          if (isImage || isVideo) {
            const processedFile = {
              name: file.name,
              size: file.size || 0,
              type: file.mimeType || "unknown",
              source: "gdrive",
              gdrive_id: file.id,
              gdrive_link: driveLink,
              status: "pending",
            };

            mediaFiles.push(processedFile);
            this.uploadedFiles.push(processedFile);

            // If it's an additional file after initial upload
            if (isAdditional && this.initialUploadComplete) {
              this.additionalFilesToUpload.push(processedFile);
            }
          } else {
            skippedFiles.push(file);
          }
        });

        // Show warning if files were skipped
        if (skippedFiles.length > 0) {
          const skippedNames = skippedFiles
            .slice(0, 3)
            .map((f) => f.name)
            .join(", ");
          const moreText = skippedFiles.length > 3 ? ` and ${skippedFiles.length - 3} more` : "";
          alert(`Warning: Only images and videos are supported. Skipped: ${skippedNames}${moreText}`);
        }

        if (mediaFiles.length === 0) {
          alert("No supported media files (images or videos) found in the provided Google Drive link.");
        } else if (isAdditional && this.initialUploadComplete) {
          this.updateUploadButtonForAdditionalFiles();
        }
      } else {
        alert("No files found in the provided Google Drive link.");
      }
    } catch (error) {
      console.error("Error fetching Google Drive files:", error);
      alert("Failed to fetch files from Google Drive. Please check your credentials and try again.");
    } finally {
      // Restore button state
      animatedEllipsis.stop(fetchBtn);
      fetchBtn.innerHTML = originalBtnText;
      fetchBtn.disabled = false;
      fetchBtn.style.opacity = "1";
    }

    // Update upload type
    this.updateUploadType();

    // Clear input
    const gdriveInput = isAdditional ? document.querySelector(".gdrive-link-input-additional") : document.querySelector(".gdrive-link-input");
    if (gdriveInput) {
      gdriveInput.value = "";
    }

    // Display files
    if (this.uploadedFiles.length > 0) {
      this.displayUploadedFiles();
      this.showStep(3);

      // If this is a new upload after initial upload was complete, reset the button
      if (this.initialUploadComplete && !isAdditional) {
        const button = document.querySelector('[data-step="3"] .continue-btn');
        if (button && button.classList.contains("upload-complete")) {
          // Reset button to allow new upload
          button.textContent = "Upload Creatives";
          button.style.backgroundColor = "";
          button.style.cursor = "pointer";
          button.disabled = false;
          button.style.opacity = "1";
          button.classList.remove("upload-complete");
          this.initialUploadComplete = false;

          // Clear ad copy section since we're starting fresh
          const adCopySection = document.querySelector(".ad-copy-container");
          if (adCopySection) {
            adCopySection.style.display = "none";
          }

          // Clear and reset review section (create ads container)
          const reviewSection = document.querySelector(".create-ads-container");
          if (reviewSection) {
            reviewSection.style.display = "none";

            // Reset create ads button
            const createAdsBtn = reviewSection.querySelector(".create-ads-button");
            if (createAdsBtn) {
              animatedEllipsis.stop(createAdsBtn);
              createAdsBtn.textContent = "Create Ads";
              createAdsBtn.disabled = false;
              createAdsBtn.style.opacity = "1";
              console.log("[Reset] Create Ads button reset");
            }
          }

          // Reset uploaded assets in app state
          appState.updateState("uploadedAssets", []);

          // Reset ad copy data
          appState.updateState("adCopyData", {});

          // Reset progress tracker
          this.progressTracker.reset();

          // Clear additional files to upload array
          this.additionalFilesToUpload = [];
        }
      }
    }
  }

  updateUploadType() {
    const imageFiles = this.uploadedFiles.filter((file) => file.type && file.type.startsWith("image/"));
    const videoFiles = this.uploadedFiles.filter((file) => file.type && file.type.startsWith("video/"));

    if (imageFiles.length > 0 && videoFiles.length > 0) {
      this.selectedUploadType = "mixed";
    } else if (imageFiles.length > 0) {
      this.selectedUploadType = "image";
    } else if (videoFiles.length > 0) {
      this.selectedUploadType = "video";
    }
  }
}

// Input Validation for Age and Budget
class InputValidator {
  constructor() {
    this.init();
  }

  init() {
    this.setupAgeValidation();
    this.setupBudgetValidation();
  }

  setupAgeValidation() {
    const ageInputs = document.querySelectorAll(".min-age, .max-age");

    ageInputs.forEach((input) => {
      input.addEventListener("input", (e) => {
        // Remove non-numeric characters
        e.target.value = e.target.value.replace(/[^0-9]/g, "");

        // Validate range
        const value = parseInt(e.target.value);
        if (value && (value < 18 || value > 65)) {
          e.target.classList.add("empty-input");
        } else {
          e.target.classList.remove("empty-input");
        }
      });
    });
  }

  setupBudgetValidation() {
    const budgetInputs = document.querySelectorAll(".config-daily-budget, .config-cost-per-result-goal");

    budgetInputs.forEach((input) => {
      input.addEventListener("input", (e) => {
        // Allow only numbers and decimal point
        e.target.value = e.target.value.replace(/[^0-9.]/g, "");

        // Prevent multiple decimal points
        const parts = e.target.value.split(".");
        if (parts.length > 2) {
          e.target.value = parts[0] + "." + parts.slice(1).join("");
        }

        // Limit to 2 decimal places
        if (parts[1] && parts[1].length > 2) {
          e.target.value = parts[0] + "." + parts[1].substring(0, 2);
        }
      });
    });
  }
}

const actions = new SingleSelectGroup(".action");

// Initialize upload form with enhanced functionality
const adSetForm = new UploadForm(".adset-form-container");
adSetForm.handleSubmit();

// Initialize file upload handler
window.fileUploadHandler = new FileUploadHandler();
window.fileUploadHandler.handleUploadTypeSelection();

// Initialize input validation
const inputValidator = new InputValidator();

// Campaign Search Functionality
function initializeCampaignSearch() {
  const searchIcon = document.querySelector(".search-icon-btn");
  const searchWrapper = document.querySelector(".campaign-search-wrapper");
  const searchInput = document.querySelector(".campaign-search-input");
  const searchCloseBtn = document.querySelector(".search-close-btn");
  const campaignTitleWrapper = document.querySelector(".campaign-title-wrapper");

  if (!searchIcon || !searchWrapper || !searchInput) return;

  // Toggle search input visibility
  searchIcon.addEventListener("click", (e) => {
    e.preventDefault();
    searchWrapper.style.display = "flex";
    campaignTitleWrapper.style.display = "none";
    searchInput.focus();
  });

  // Close search
  searchCloseBtn.addEventListener("click", () => {
    searchWrapper.style.display = "none";
    campaignTitleWrapper.style.display = "flex";
    searchInput.value = "";
    // Reset campaign visibility
    filterCampaigns("");
  });

  // Handle search input
  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    filterCampaigns(searchTerm);
  });

  // Handle escape key
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchCloseBtn.click();
    }
  });
}

function filterCampaigns(searchTerm) {
  const campaigns = document.querySelectorAll(".campaign");
  const selectedAccount = document.querySelector(".account.selected");

  if (!selectedAccount) return;

  const selectedAccountId = selectedAccount.dataset.campaignId;

  campaigns.forEach((campaign) => {
    const campaignName = campaign.querySelector("h3").textContent.toLowerCase();
    const campaignAccountId = campaign.dataset.accCampaignId;

    // Check if campaign matches search term and belongs to selected account
    const matchesSearch = searchTerm === "" || campaignName.includes(searchTerm);
    const matchesAccount = campaignAccountId === selectedAccountId;

    if (matchesSearch && matchesAccount) {
      campaign.style.display = "block";
    } else {
      campaign.style.display = "none";
    }
  });
}

// Initialize Geo Selection
function initializeGeoSelection() {
  const countryInput = document.querySelector(".country-search-input");
  const regionInput = document.querySelector(".region-search-input");
  const countrySuggestions = document.querySelector(".country-suggestions");
  const regionSuggestions = document.querySelector(".region-suggestions");
  const selectedCountriesContainer = document.getElementById("selected-countries");
  const selectedRegionsContainer = document.getElementById("selected-regions");

  if (!countryInput || !regionInput) return;

  let highlightedCountryIndex = -1;
  let highlightedRegionIndex = -1;

  // Make entire container clickable for countries
  const countryContainer = document.querySelector(".selected-countries-container");
  if (countryContainer) {
    countryContainer.addEventListener("click", (e) => {
      // Don't focus if clicking on a tag or remove button
      if (!e.target.closest(".geo-tag")) {
        countryInput.focus();
      }
    });
  }

  // Make entire container clickable for regions
  const regionContainer = document.querySelector(".selected-regions-container");
  if (regionContainer) {
    regionContainer.addEventListener("click", (e) => {
      // Don't focus if clicking on a tag or remove button
      if (!e.target.closest(".geo-tag")) {
        regionInput.focus();
      }
    });
  }

  // Country search functionality
  countryInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const fbData = appState.getState().fbLocationsData;

    if (!fbData || searchTerm.length < 1) {
      countrySuggestions.style.display = "none";
      return;
    }

    const filteredCountries = fbData.countries.filter((country) => country.name.toLowerCase().includes(searchTerm) && !appState.getState().selectedCountries.find((c) => c.key === country.key));

    displayCountrySuggestions(filteredCountries);
  });

  // Region search functionality
  regionInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const fbData = appState.getState().fbLocationsData;
    const selectedCountries = appState.getState().selectedCountries;

    if (!fbData || searchTerm.length < 1 || selectedCountries.length === 0) {
      regionSuggestions.style.display = "none";
      return;
    }

    const allRegions = [];
    selectedCountries.forEach((country) => {
      const countryRegions = fbData.regions[country.key];
      if (countryRegions && countryRegions.regions) {
        countryRegions.regions.forEach((region) => {
          if (region.name.toLowerCase().includes(searchTerm) && !appState.getState().selectedRegions.find((r) => r.key === region.key)) {
            allRegions.push({
              ...region,
              countryName: country.name,
              countryKey: country.key,
            });
          }
        });
      }
    });

    displayRegionSuggestions(allRegions);
  });

  // Country selection
  function selectCountry(country) {
    const currentCountries = [...appState.getState().selectedCountries];

    // Check if country is already selected
    if (currentCountries.find((c) => c.key === country.key)) {
      return; // Country already selected, do nothing
    }

    currentCountries.push(country);
    appState.updateState("selectedCountries", currentCountries);

    countryInput.value = "";
    countrySuggestions.style.display = "none";
    renderSelectedCountries();

    // Clear selected regions if needed
    checkAndUpdateRegions();
  }

  // Region selection
  function selectRegion(region) {
    const currentRegions = [...appState.getState().selectedRegions];

    // Check if region is already selected
    if (currentRegions.find((r) => r.key === region.key)) {
      return; // Region already selected, do nothing
    }

    // Add region with default excluded state (red)
    currentRegions.push({
      ...region,
      excluded: true,
    });
    appState.updateState("selectedRegions", currentRegions);

    regionInput.value = "";
    regionSuggestions.style.display = "none";
    renderSelectedRegions();
  }

  // Display country suggestions
  function displayCountrySuggestions(countries) {
    countrySuggestions.innerHTML = "";
    highlightedCountryIndex = -1;

    if (countries.length === 0) {
      countrySuggestions.innerHTML = '<li class="geo-no-results">No countries found</li>';
    } else {
      countries.forEach((country, index) => {
        const li = document.createElement("li");
        li.textContent = country.name;
        li.dataset.index = index;
        li.addEventListener("click", () => selectCountry(country));
        countrySuggestions.appendChild(li);
      });
    }

    countrySuggestions.style.display = "block";
  }

  // Display region suggestions
  function displayRegionSuggestions(regions) {
    regionSuggestions.innerHTML = "";
    highlightedRegionIndex = -1;

    if (regions.length === 0) {
      regionSuggestions.innerHTML = '<li class="geo-no-results">No regions found</li>';
    } else {
      regions.forEach((region, index) => {
        const li = document.createElement("li");
        li.textContent = `${region.name}, ${region.countryName}`;
        li.dataset.index = index;
        li.addEventListener("click", () => selectRegion(region));
        regionSuggestions.appendChild(li);
      });
    }

    regionSuggestions.style.display = "block";
  }

  // Render selected countries
  function renderSelectedCountries() {
    const countries = appState.getState().selectedCountries;
    selectedCountriesContainer.innerHTML = "";

    countries.forEach((country, index) => {
      const tag = document.createElement("div");
      tag.className = "geo-tag";
      tag.innerHTML = `
        ${country.name}
        <span class="remove-tag" data-index="${index}">×</span>
      `;
      selectedCountriesContainer.appendChild(tag);
    });

    // Add remove handlers
    selectedCountriesContainer.querySelectorAll(".remove-tag").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const index = parseInt(e.target.dataset.index);
        removeCountry(index);
      });
    });
  }

  // Render selected regions
  function renderSelectedRegions() {
    const regions = appState.getState().selectedRegions;
    selectedRegionsContainer.innerHTML = "";

    regions.forEach((region, index) => {
      const tag = document.createElement("div");
      tag.className = `geo-tag ${region.excluded ? "excluded" : "included"}`;
      tag.dataset.index = index;
      tag.innerHTML = `
        <span class="region-name">${region.name}</span>
        <span class="remove-tag" data-index="${index}">×</span>
      `;
      selectedRegionsContainer.appendChild(tag);
    });

    // Add click handlers for toggling include/exclude
    selectedRegionsContainer.querySelectorAll(".geo-tag").forEach((tag) => {
      const regionName = tag.querySelector(".region-name");
      if (regionName) {
        regionName.addEventListener("click", (e) => {
          e.stopPropagation();
          const index = parseInt(tag.dataset.index);
          toggleRegionExclusion(index);
        });
      }
    });

    // Add remove handlers
    selectedRegionsContainer.querySelectorAll(".remove-tag").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = parseInt(e.target.dataset.index);
        removeRegion(index);
      });
    });
  }

  // Remove country
  function removeCountry(index) {
    const currentCountries = [...appState.getState().selectedCountries];
    const removedCountry = currentCountries.splice(index, 1)[0];
    appState.updateState("selectedCountries", currentCountries);
    renderSelectedCountries();

    // Remove regions from the removed country
    checkAndUpdateRegions();
  }

  // Remove region
  function removeRegion(index) {
    const currentRegions = [...appState.getState().selectedRegions];
    currentRegions.splice(index, 1);
    appState.updateState("selectedRegions", currentRegions);
    renderSelectedRegions();
  }

  // Toggle region inclusion/exclusion
  function toggleRegionExclusion(index) {
    const currentRegions = [...appState.getState().selectedRegions];
    currentRegions[index].excluded = !currentRegions[index].excluded;
    appState.updateState("selectedRegions", currentRegions);
    renderSelectedRegions();
  }

  // Check and update regions when countries change
  function checkAndUpdateRegions() {
    const selectedCountries = appState.getState().selectedCountries;
    const selectedRegions = appState.getState().selectedRegions;

    // Filter out regions that don't belong to selected countries
    const validRegions = selectedRegions.filter((region) => selectedCountries.find((country) => country.key === region.countryKey));

    if (validRegions.length !== selectedRegions.length) {
      appState.updateState("selectedRegions", validRegions);
      renderSelectedRegions();
    }
  }

  // Handle keyboard navigation for countries
  countryInput.addEventListener("keydown", (e) => {
    const items = countrySuggestions.querySelectorAll("li:not(.geo-no-results)");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedCountryIndex = Math.min(highlightedCountryIndex + 1, items.length - 1);
      updateHighlight(items, highlightedCountryIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedCountryIndex = Math.max(highlightedCountryIndex - 1, -1);
      updateHighlight(items, highlightedCountryIndex);
    } else if (e.key === "Enter") {
      e.preventDefault(); // Always prevent Enter key default behavior
      if (highlightedCountryIndex >= 0 && items[highlightedCountryIndex]) {
        items[highlightedCountryIndex].click();
      }
    } else if (e.key === "Escape") {
      countrySuggestions.style.display = "none";
    }
  });

  // Handle keyboard navigation for regions
  regionInput.addEventListener("keydown", (e) => {
    const items = regionSuggestions.querySelectorAll("li:not(.geo-no-results)");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedRegionIndex = Math.min(highlightedRegionIndex + 1, items.length - 1);
      updateHighlight(items, highlightedRegionIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedRegionIndex = Math.max(highlightedRegionIndex - 1, -1);
      updateHighlight(items, highlightedRegionIndex);
    } else if (e.key === "Enter") {
      e.preventDefault(); // Always prevent Enter key default behavior
      if (highlightedRegionIndex >= 0 && items[highlightedRegionIndex]) {
        items[highlightedRegionIndex].click();
      }
    } else if (e.key === "Escape") {
      regionSuggestions.style.display = "none";
    }
  });

  // Update highlight
  function updateHighlight(items, index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add("highlighted");
      } else {
        item.classList.remove("highlighted");
      }
    });
  }

  // Hide suggestions on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".country-selection")) {
      countrySuggestions.style.display = "none";
    }
    if (!e.target.closest(".region-selection")) {
      regionSuggestions.style.display = "none";
    }
  });
}

// Initialize Event Type Selection
function initializeEventTypeSelection() {
  const eventTypes = [
    { value: "AD_IMPRESSION", name: "Ad Impression", description: "Track when ads are shown" },
    { value: "RATE", name: "Rate", description: "Track rating actions" },
    { value: "TUTORIAL_COMPLETION", name: "Tutorial Completion", description: "Track tutorial completions" },
    { value: "CONTACT", name: "Contact", description: "Track contact form submissions" },
    { value: "CUSTOMIZE_PRODUCT", name: "Customize Product", description: "Track product customization" },
    { value: "DONATE", name: "Donate", description: "Track donation events" },
    { value: "FIND_LOCATION", name: "Find Location", description: "Track location searches" },
    { value: "SCHEDULE", name: "Schedule", description: "Track scheduling actions" },
    { value: "START_TRIAL", name: "Start Trial", description: "Track trial starts" },
    { value: "SUBMIT_APPLICATION", name: "Submit Application", description: "Track application submissions" },
    { value: "SUBSCRIBE", name: "Subscribe", description: "Track subscription events" },
    { value: "ADD_TO_CART", name: "Add to Cart", description: "Track cart additions" },
    { value: "ADD_TO_WISHLIST", name: "Add to Wishlist", description: "Track wishlist additions" },
    { value: "INITIATED_CHECKOUT", name: "Initiated Checkout", description: "Track checkout starts" },
    { value: "ADD_PAYMENT_INFO", name: "Add Payment Info", description: "Track payment info additions" },
    { value: "PURCHASE", name: "Purchase", description: "Track completed purchases" },
    { value: "LEAD", name: "Lead", description: "Track lead generation" },
    { value: "COMPLETE_REGISTRATION", name: "Complete Registration", description: "Track registration completions" },
    { value: "CONTENT_VIEW", name: "Content View", description: "Track content views" },
    { value: "SEARCH", name: "Search", description: "Track search events" },
    { value: "SERVICE_BOOKING_REQUEST", name: "Service Booking Request", description: "Track booking requests" },
    { value: "MESSAGING_CONVERSATION_STARTED_7D", name: "Messaging Conversation Started (7D)", description: "Track messaging starts within 7 days" },
    { value: "LEVEL_ACHIEVED", name: "Level Achieved", description: "Track level achievements" },
    { value: "ACHIEVEMENT_UNLOCKED", name: "Achievement Unlocked", description: "Track unlocked achievements" },
    { value: "SPENT_CREDITS", name: "Spent Credits", description: "Track credit spending" },
    { value: "LISTING_INTERACTION", name: "Listing Interaction", description: "Track listing interactions" },
    { value: "D2_RETENTION", name: "D2 Retention", description: "Track day 2 retention" },
    { value: "D7_RETENTION", name: "D7 Retention", description: "Track day 7 retention" },
    { value: "OTHER", name: "Other", description: "Other custom events" },
  ];

  const eventTypeInput = document.querySelector(".config-event-type");
  const eventTypeSearch = document.querySelector(".event-type-search");
  const eventTypeSuggestions = document.querySelector(".event-type-suggestions");

  if (!eventTypeInput || !eventTypeSearch || !eventTypeSuggestions) return;

  let highlightedIndex = -1;
  let selectedEventType = null;

  // Click on main input to show search
  eventTypeInput.addEventListener("click", (e) => {
    e.preventDefault();
    eventTypeInput.style.display = "none";
    eventTypeSearch.style.display = "block";
    eventTypeSearch.focus();
    displayAllEventTypes();
  });

  // Search functionality
  eventTypeSearch.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();

    if (searchTerm.length === 0) {
      displayAllEventTypes();
      return;
    }

    const filteredEvents = eventTypes.filter((event) => event.name.toLowerCase().includes(searchTerm) || event.value.toLowerCase().includes(searchTerm) || event.description.toLowerCase().includes(searchTerm));

    displayEventTypes(filteredEvents);
  });

  // Display all event types
  function displayAllEventTypes() {
    displayEventTypes(eventTypes);
  }

  // Display filtered event types
  function displayEventTypes(events) {
    eventTypeSuggestions.innerHTML = "";
    highlightedIndex = -1;

    events.forEach((event, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>${event.name}</div>
        <div class="event-description">${event.description}</div>
      `;
      li.dataset.index = index;
      li.dataset.value = event.value;
      li.dataset.name = event.name;
      li.addEventListener("click", () => selectEventType(event));
      eventTypeSuggestions.appendChild(li);
    });

    eventTypeSuggestions.style.display = "block";
  }

  // Select event type
  function selectEventType(event) {
    selectedEventType = event;
    eventTypeInput.value = event.name;
    eventTypeInput.dataset.value = event.value;
    eventTypeSearch.style.display = "none";
    eventTypeInput.style.display = "block";
    eventTypeSuggestions.style.display = "none";
    eventTypeSearch.value = "";

    // Remove error styling if present
    eventTypeInput.classList.remove("empty-input");

    // Trigger validation check after event type selection
    if (typeof checkRequiredFields === "function") {
      checkRequiredFields();
    }
  }

  // Keyboard navigation
  eventTypeSearch.addEventListener("keydown", (e) => {
    const items = eventTypeSuggestions.querySelectorAll("li");

    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items, highlightedIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, -1);
      updateHighlight(items, highlightedIndex);
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      const selectedItem = items[highlightedIndex];
      const event = eventTypes.find((et) => et.value === selectedItem.dataset.value);
      if (event) {
        selectEventType(event);
      }
    } else if (e.key === "Escape") {
      eventTypeSearch.style.display = "none";
      eventTypeInput.style.display = "block";
      eventTypeSuggestions.style.display = "none";
    }
  });

  // Update highlight
  function updateHighlight(items, index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add("highlighted");
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("highlighted");
      }
    });
  }

  // Hide suggestions on click outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".event-type-container")) {
      eventTypeSearch.style.display = "none";
      eventTypeInput.style.display = "block";
      eventTypeSuggestions.style.display = "none";
    }
  });
}

// Creative Library Functionality
class CreativeLibrary {
  constructor() {
    this.modal = document.querySelector(".creative-library-modal");
    this.selectedCreatives = new Set();
    this.allCreatives = [];
    this.filteredCreatives = [];
    this.currentAccountId = null;
    this.currentView = "creatives"; // 'creatives' or 'batches'
    this.allBatches = [];
    this.currentBatch = null;
    this.init();
  }

  init() {
    // Open library button
    const openLibraryBtn = document.querySelector(".open-library-btn");
    if (openLibraryBtn) {
      openLibraryBtn.addEventListener("click", () => this.openLibrary());
    }

    // Close modal
    const closeBtn = this.modal.querySelector(".modal-close-btn");
    closeBtn.addEventListener("click", () => this.closeLibrary());

    // Click outside modal to close
    this.modal.addEventListener("click", (e) => {
      if (e.target === this.modal) {
        this.closeLibrary();
      }
    });

    // Search functionality
    const searchInput = this.modal.querySelector(".library-search");
    searchInput.addEventListener("input", (e) => this.filterCreatives());

    // Filter checkboxes
    const filterCheckboxes = this.modal.querySelectorAll(".filter-checkbox input");
    filterCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener("change", () => this.filterCreatives());
    });

    // Add selected button
    const addSelectedBtn = this.modal.querySelector(".add-selected-btn");
    addSelectedBtn.addEventListener("click", () => this.addSelectedCreatives());

    // Clear all button
    const clearAllBtn = this.modal.querySelector(".clear-all-btn");
    if (clearAllBtn) {
      clearAllBtn.addEventListener("click", () => {
        console.log("Clear all button clicked");
        this.clearAllCreatives();
      });
    } else {
      console.error("Clear all button not found");
    }

    // View toggle buttons
    const viewToggleBtns = this.modal.querySelectorAll(".view-toggle-btn");
    viewToggleBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        this.switchView(view);
      });
    });

    // Create batch button
    const createBatchBtn = this.modal.querySelector(".create-batch-btn");
    if (createBatchBtn) {
      createBatchBtn.addEventListener("click", () => this.createNewBatch());
    }

    // Breadcrumb navigation
    const breadcrumbItem = this.modal.querySelector(".breadcrumb-item");
    if (breadcrumbItem) {
      breadcrumbItem.addEventListener("click", () => {
        this.currentBatch = null;
        this.loadBatches();
      });
    }
  }

  openLibrary() {
    this.currentAccountId = appState.state.selectedAccount;
    if (!this.currentAccountId) {
      alert("Please select an ad account first");
      return;
    }

    this.modal.style.display = "flex";
    this.loadCreatives();
  }

  closeLibrary() {
    this.modal.style.display = "none";
    this.selectedCreatives.clear();
    this.updateSelectedCount();
  }

  async loadCreatives() {
    const loadingDiv = this.modal.querySelector(".library-loading");
    const emptyDiv = this.modal.querySelector(".library-empty");
    const gridContainer = this.modal.querySelector(".library-grid");

    loadingDiv.style.display = "block";
    emptyDiv.style.display = "none";
    gridContainer.innerHTML = "";

    try {
      const response = await fetch("/api/creative-library");
      const data = await response.json();

      this.allCreatives = data.creatives || [];
      this.filteredCreatives = this.allCreatives; // Initialize filtered with all

      if (this.allCreatives.length === 0) {
        loadingDiv.style.display = "none";
        emptyDiv.style.display = "block";
      } else {
        loadingDiv.style.display = "none";
        this.filterCreatives(); // This will apply filters and render
      }
    } catch (error) {
      console.error("Error loading creatives:", error);
      loadingDiv.style.display = "none";
      emptyDiv.style.display = "block";
      emptyDiv.innerHTML = "<p>Error loading creatives</p>";
    }
  }

  renderCreatives(creatives) {
    const gridContainer = this.modal.querySelector(".library-grid");
    gridContainer.innerHTML = "";

    creatives.forEach((creative) => {
      const creativeItem = this.createCreativeElement(creative);
      gridContainer.appendChild(creativeItem);
    });
  }

  createCreativeElement(creative) {
    const div = document.createElement("div");
    div.className = "creative-item";
    div.dataset.creativeId = creative.id;

    const isInCurrentAccount = creative.uploaded_accounts && creative.uploaded_accounts.split(",").includes(this.currentAccountId);

    const isVideo = creative.file_type.startsWith("video/");
    const typeClass = isVideo ? "video" : "image";

    // Use thumbnail for videos, actual file for images
    const imageUrl = isVideo ? creative.thumbnailUrl : creative.fileUrl;

    div.innerHTML = `
      <div class="creative-thumbnail">
        ${imageUrl ? `<img src="${imageUrl}" alt="${creative.original_name}">` : `<div class="no-thumbnail">${isVideo ? "🎥 Video" : "🖼️ Image"}</div>`}
      </div>
      <div class="creative-info">
        <div class="creative-name" title="${creative.original_name}">${creative.original_name}</div>
        <div class="creative-meta">
          <span class="creative-type ${typeClass}">${typeClass}</span>
          <span class="creative-size">${this.formatFileSize(creative.file_size)}</span>
        </div>
      </div>
      ${isInCurrentAccount ? '<div class="upload-status">✓ In Account</div>' : ""}
      <div class="selection-checkbox"></div>
      <button class="delete-btn" title="Delete creative">×</button>
      <button class="add-to-batch-btn" title="Add to batch">📁</button>
    `;

    // Add click handler for selection
    div.addEventListener("click", (e) => {
      // Don't toggle selection if clicking delete button
      if (!e.target.closest(".delete-btn")) {
        this.toggleSelection(creative, div);
      }
    });

    // Add click handler for delete button
    const deleteBtn = div.querySelector(".delete-btn");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteCreative(creative.id);
    });

    // Add click handler for add to batch button
    const addToBatchBtn = div.querySelector(".add-to-batch-btn");
    addToBatchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.addCreativeToBatch(creative.id);
    });

    return div;
  }

  toggleSelection(creative, element) {
    if (this.selectedCreatives.has(creative.id)) {
      this.selectedCreatives.delete(creative.id);
      element.classList.remove("selected");
    } else {
      this.selectedCreatives.add(creative.id);
      element.classList.add("selected");
    }

    this.updateSelectedCount();
  }

  updateSelectedCount() {
    const countSpan = this.modal.querySelector(".selected-count");
    const addBtn = this.modal.querySelector(".add-selected-btn");

    const count = this.selectedCreatives.size;
    countSpan.textContent = `${count} selected`;
    addBtn.disabled = count === 0;
  }

  filterCreatives() {
    const searchTerm = this.modal.querySelector(".library-search").value.toLowerCase();
    const filterNew = this.modal.querySelector("#filter-new").checked;
    const filterUploaded = this.modal.querySelector("#filter-uploaded").checked;
    const filterVideos = this.modal.querySelector("#filter-videos").checked;
    const filterImages = this.modal.querySelector("#filter-images").checked;

    this.filteredCreatives = this.allCreatives.filter((creative) => {
      // Search filter
      if (searchTerm && !creative.original_name.toLowerCase().includes(searchTerm)) {
        return false;
      }

      // Upload status filter
      const isInCurrentAccount = creative.uploaded_accounts && creative.uploaded_accounts.split(",").includes(this.currentAccountId);

      if (!filterNew && !isInCurrentAccount) return false;
      if (!filterUploaded && isInCurrentAccount) return false;

      // Type filter
      const isVideo = creative.file_type.startsWith("video/");
      if (!filterVideos && isVideo) return false;
      if (!filterImages && !isVideo) return false;

      return true;
    });

    this.renderCreatives(this.filteredCreatives);
  }

  showLoading() {
    const loadingDiv = this.modal.querySelector(".library-loading");
    const gridContainer = this.modal.querySelector(".library-grid");
    const emptyDiv = this.modal.querySelector(".library-empty");

    loadingDiv.style.display = "block";
    gridContainer.style.display = "none";
    emptyDiv.style.display = "none";
  }

  hideLoading() {
    const loadingDiv = this.modal.querySelector(".library-loading");
    const gridContainer = this.modal.querySelector(".library-grid-container");

    loadingDiv.style.display = "none";
    gridContainer.style.display = "block";
  }

  showEmpty() {
    const loadingDiv = this.modal.querySelector(".library-loading");
    const emptyDiv = this.modal.querySelector(".library-empty");
    const gridContainer = this.modal.querySelector(".library-grid");

    loadingDiv.style.display = "none";
    emptyDiv.style.display = "block";
    gridContainer.innerHTML = "";
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  switchView(view) {
    this.currentView = view;

    // Update toggle buttons
    document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });

    // Update UI visibility
    const filtersSection = this.modal.querySelector(".library-filters");
    const batchActions = this.modal.querySelector(".batch-actions");

    if (view === "creatives") {
      filtersSection.style.display = "flex";
      batchActions.style.display = "none";
      this.loadCreatives();
    } else {
      filtersSection.style.display = "none";
      batchActions.style.display = "block";
      this.loadBatches();
    }
  }

  async loadBatches() {
    const loadingDiv = this.modal.querySelector(".library-loading");
    const emptyDiv = this.modal.querySelector(".library-empty");
    const gridContainer = this.modal.querySelector(".library-grid");
    const breadcrumb = this.modal.querySelector(".batch-breadcrumb");

    loadingDiv.style.display = "block";
    emptyDiv.style.display = "none";
    gridContainer.innerHTML = "";

    try {
      if (this.currentBatch) {
        // Load creatives in the batch
        breadcrumb.style.display = "block";
        breadcrumb.querySelector(".breadcrumb-current").textContent = this.currentBatch.name;

        const response = await fetch(`/api/creative-batches/${this.currentBatch.id}/creatives`);
        const data = await response.json();

        this.allCreatives = data.creatives || [];
        this.filteredCreatives = this.allCreatives;

        if (this.allCreatives.length === 0) {
          loadingDiv.style.display = "none";
          emptyDiv.style.display = "block";
          emptyDiv.innerHTML = "<p>No creatives in this batch</p>";
        } else {
          loadingDiv.style.display = "none";
          this.renderCreatives(this.allCreatives);
        }
      } else {
        // Load all batches
        breadcrumb.style.display = "none";

        const response = await fetch("/api/creative-batches");
        const data = await response.json();

        this.allBatches = data.batches || [];

        if (this.allBatches.length === 0) {
          loadingDiv.style.display = "none";
          emptyDiv.style.display = "block";
          emptyDiv.innerHTML = "<p>No batches created yet</p>";
        } else {
          loadingDiv.style.display = "none";
          this.renderBatches(this.allBatches);
        }
      }
    } catch (error) {
      console.error("Error loading batches:", error);
      loadingDiv.style.display = "none";
      emptyDiv.style.display = "block";
      emptyDiv.innerHTML = "<p>Error loading batches</p>";
    }
  }

  renderBatches(batches) {
    const gridContainer = this.modal.querySelector(".library-grid");
    gridContainer.innerHTML = "";

    batches.forEach((batch) => {
      const div = this.createBatchElement(batch);
      gridContainer.appendChild(div);
    });
  }

  createBatchElement(batch) {
    const div = document.createElement("div");
    div.className = "batch-item";
    div.dataset.batchId = batch.id;

    div.innerHTML = `
      <div class="batch-folder-icon">📁</div>
      <div class="batch-info">
        <div class="batch-name">${batch.name}</div>
        <div class="batch-stats">
          <span class="batch-count">
            <span>${batch.creative_count || 0}</span> files
          </span>
          <span class="batch-count">
            <span>🎥 ${batch.video_count || 0}</span>
            <span>🖼️ ${batch.image_count || 0}</span>
          </span>
        </div>
      </div>
      <div class="batch-actions-menu">
        <button class="batch-action-btn upload-batch-btn" title="Upload entire batch">⬆️</button>
        <button class="batch-action-btn edit-batch-btn" title="Edit batch">✏️</button>
        <button class="batch-action-btn delete-batch-btn" title="Delete batch">×</button>
      </div>
    `;

    // Click to open batch
    div.addEventListener("click", (e) => {
      if (!e.target.closest(".batch-action-btn")) {
        this.currentBatch = batch;
        this.loadBatches(); // Will load creatives in the batch
      }
    });

    // Upload batch button
    const uploadBtn = div.querySelector(".upload-batch-btn");
    uploadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.uploadEntireBatch(batch);
    });

    // Edit batch button
    const editBtn = div.querySelector(".edit-batch-btn");
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.editBatch(batch);
    });

    // Delete batch button
    const deleteBtn = div.querySelector(".delete-batch-btn");
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteBatch(batch.id);
    });

    return div;
  }

  async createNewBatch() {
    const name = prompt("Enter batch name (e.g., AT-VID35):");
    if (!name) return;

    const description = prompt("Enter batch description (optional):");

    try {
      const response = await fetch("/api/creative-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create batch");
      }

      const data = await response.json();
      this.loadBatches();
    } catch (error) {
      console.error("Error creating batch:", error);
      alert(`Failed to create batch: ${error.message}`);
    }
  }

  async editBatch(batch) {
    const name = prompt("Edit batch name:", batch.name);
    if (!name || name === batch.name) return;

    const description = prompt("Edit batch description:", batch.description || "");

    try {
      const response = await fetch(`/api/creative-batches/${batch.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });

      if (!response.ok) {
        throw new Error("Failed to update batch");
      }

      this.loadBatches();
    } catch (error) {
      console.error("Error updating batch:", error);
      alert("Failed to update batch. Please try again.");
    }
  }

  async deleteBatch(batchId) {
    if (!confirm("Are you sure you want to delete this batch? The creatives will not be deleted.")) {
      return;
    }

    try {
      const response = await fetch(`/api/creative-batches/${batchId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete batch");
      }

      this.loadBatches();
    } catch (error) {
      console.error("Error deleting batch:", error);
      alert("Failed to delete batch. Please try again.");
    }
  }

  async uploadEntireBatch(batch) {
    try {
      // Fetch all creatives in the batch
      const response = await fetch(`/api/creative-batches/${batch.id}/creatives`);
      const data = await response.json();

      const creatives = data.creatives || [];
      if (creatives.length === 0) {
        alert("No creatives in this batch to upload");
        return;
      }

      // Convert to file-like objects for the upload handler
      const filesToAdd = creatives.map((creative) => ({
        name: creative.original_name,
        originalname: creative.original_name,
        type: creative.file_type,
        size: creative.file_size,
        isFromLibrary: true,
        libraryId: creative.id,
        thumbnailUrl: creative.thumbnailUrl,
        fileUrl: creative.fileUrl,
      }));

      // Add to upload handler
      if (window.fileUploadHandler) {
        window.fileUploadHandler.addFilesFromLibrary(filesToAdd);
      }

      this.closeLibrary();
    } catch (error) {
      console.error("Error uploading batch:", error);
      alert("Failed to upload batch. Please try again.");
    }
  }

  async addSelectedCreatives() {
    const selectedArray = Array.from(this.selectedCreatives);
    const creativesToAdd = this.allCreatives.filter((c) => selectedArray.includes(c.id));

    // Convert to file-like objects for the upload handler
    const filesToAdd = creativesToAdd.map((creative) => ({
      name: creative.original_name,
      originalname: creative.original_name,
      type: creative.file_type,
      size: creative.file_size,
      isFromLibrary: true,
      libraryId: creative.id,
      thumbnailUrl: creative.thumbnailUrl,
      fileUrl: creative.fileUrl,
    }));

    // Add to upload handler
    if (window.fileUploadHandler) {
      window.fileUploadHandler.addFilesFromLibrary(filesToAdd);
    }

    this.closeLibrary();
  }

  async deleteCreative(creativeId) {
    if (!confirm("Are you sure you want to delete this creative? This action cannot be undone.")) {
      return;
    }

    try {
      const response = await fetch(`/api/creative-library/${creativeId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to delete creative");
      }

      const result = await response.json();
      console.log("Delete result:", result);

      // Remove from UI
      const element = document.querySelector(`[data-creative-id="${creativeId}"]`);
      if (element) {
        element.remove();
      }

      // Remove from local data
      this.allCreatives = this.allCreatives.filter((c) => c.id !== creativeId);
      this.filteredCreatives = this.filteredCreatives.filter((c) => c.id !== creativeId);
      this.selectedCreatives.delete(creativeId);

      // Update UI
      this.updateSelectedCount();

      // Show empty state if no creatives left
      if (this.allCreatives.length === 0) {
        this.showEmpty();
      }
    } catch (error) {
      console.error("Error deleting creative:", error);
      alert("Failed to delete creative. Please try again.");
    }
  }

  async clearAllCreatives() {
    console.log("clearAllCreatives called");

    if (!confirm("Are you sure you want to delete ALL creatives from the library? This action cannot be undone.")) {
      return;
    }

    this.showLoading();

    try {
      const response = await fetch("/api/creative-library", {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to delete all creatives");
      }

      const result = await response.json();
      console.log("Clear all result:", result);

      // Clear UI
      this.allCreatives = [];
      this.filteredCreatives = [];
      this.selectedCreatives.clear();
      this.updateSelectedCount();
      this.showEmpty();

      alert(`Successfully deleted ${result.deletedCount} creative(s) from the library.`);
    } catch (error) {
      console.error("Error clearing all creatives:", error);
      alert("Failed to clear all creatives. Please try again.");
    } finally {
      this.hideLoading();
    }
  }

  async addCreativeToBatch(creativeId) {
    try {
      // First, fetch available batches
      const response = await fetch("/api/creative-batches");
      const data = await response.json();
      const batches = data.batches || [];

      if (batches.length === 0) {
        if (confirm("No batches exist. Would you like to create one?")) {
          await this.createNewBatch();
        }
        return;
      }

      // Show batch selection
      const batchNames = batches.map((b) => `${b.name} (${b.creative_count} files)`).join("\n");
      const selectedBatchName = prompt(`Select a batch:\n\n${batchNames}\n\nEnter batch name:`);

      if (!selectedBatchName) return;

      const selectedBatch = batches.find((b) => b.name === selectedBatchName.split(" (")[0]);
      if (!selectedBatch) {
        alert("Batch not found");
        return;
      }

      // Add creative to batch
      const addResponse = await fetch(`/api/creative-batches/${selectedBatch.id}/creatives`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creativeIds: [creativeId] }),
      });

      if (!addResponse.ok) {
        throw new Error("Failed to add creative to batch");
      }

      alert(`Creative added to batch "${selectedBatch.name}"`);

      // Refresh the view if we're in batch view
      if (this.currentView === "batches" && this.currentBatch) {
        this.loadBatches();
      }
    } catch (error) {
      console.error("Error adding creative to batch:", error);
      alert("Failed to add creative to batch. Please try again.");
    }
  }
}

FileUploadHandler.prototype.addFilesFromLibrary = function (files) {
  this.uploadedFiles.push(...files);
  this.displayUploadedFiles();
  this.showStep(3);
};

// Override uploadFiles to handle library files
const originalUploadFiles = FileUploadHandler.prototype.uploadFiles;
FileUploadHandler.prototype.uploadFiles = async function (files, account_id) {
  // Separate library files from other files
  const libraryFiles = files.filter((file) => file.isFromLibrary);
  const otherFiles = files.filter((file) => !file.isFromLibrary);

  // If we have library files, we need to handle them separately
  if (libraryFiles.length > 0) {
    this.showLoadingState();

    const button = document.querySelector('[data-step="3"] .continue-btn');
    const totalFiles = files.length;
    animatedEllipsis.start(button, `Processing ${totalFiles} file${totalFiles > 1 ? "s" : ""}`);

    // Reset progress tracker for new upload
    this.progressTracker.reset();

    try {
      const settledResults = await Promise.allSettled(uploadPromises);

      // Combine results
      const allResults = settledResults.flat();

      // Process results similar to original method
      const normalizedAssets = [];
      const failedUploads = [];

      allResults.forEach((result) => {
        if (result.status === "rejected") {
          failedUploads.push({
            file: result.reason?.creativeId || "Unknown file",
            error: result.reason?.message || result.reason || "Upload failed",
          });
          return;
        }

        // This handles the nested array of results from the library upload call
        if (Array.isArray(result.value)) {
          result.value.forEach((item) => {
            if (item.status === "fulfilled") {
              if (item.value.status === "failed") {
                failedUploads.push({ file: item.value.file, error: item.value.error || "Upload failed" });
              } else {
                normalizedAssets.push(item.value);
              }
            } else if (item.status === "rejected") {
              failedUploads.push({ file: item.creativeId || "Unknown file", error: item.reason || "Upload failed" });
            }
          });
        }
      });

      this.hideLoadingState(failedUploads.length > 0);

      if (failedUploads.length > 0) {
        console.error("Failed uploads:", failedUploads);
        const errorMessages = failedUploads.map((f) => `${f.file}: ${f.error}`).join("\n");
        alert(`Some files failed to upload:\n${errorMessages}`);
      }

      if (normalizedAssets.length > 0) {
        const currentAssets = appState.getState().uploadedAssets || [];
        appState.updateState("uploadedAssets", [...currentAssets, ...normalizedAssets]);
        this.showAdCopySection();
      }

      return normalizedAssets;
    } catch (error) {
      this.hideLoadingState(true);
      throw error;
    }
  } else {
    // No library files, use original method
    return originalUploadFiles.call(this, files, account_id);
  }
};

// Initialize creative library
document.addEventListener("DOMContentLoaded", () => {
  window.creativeLibrary = new CreativeLibrary();
});

// Ad set form validation
let checkRequiredFields; // Declare globally

function setupAdSetFormValidation() {
  const adsetForm = document.querySelector(".adset-form-container");
  if (!adsetForm) return;

  const createButton = adsetForm.querySelector(".create-adset-btn");
  const requiredFields = {
    adsetName: adsetForm.querySelector(".config-adset-name"),
    eventType: adsetForm.querySelector(".config-event-type"),
    minAge: adsetForm.querySelector(".min-age"),
    maxAge: adsetForm.querySelector(".max-age"),
  };

  checkRequiredFields = function () {
    // First, make sure we have fresh references to the elements
    const ageContainer = document.querySelector(".targeting-age");
    const geoContainers = document.querySelectorAll(".geo-selection-container");

    // Get fresh references to form fields
    const adsetNameField = document.querySelector(".config-adset-name");
    const eventTypeField = document.querySelector(".config-event-type");
    const optimizationGoalField = document.querySelector(".config-optimization-goal");

    // Check if all required fields have values
    const hasAdsetName = adsetNameField && adsetNameField.value.trim() !== "";

    // Event type is only required for OFFSITE_CONVERSIONS optimization goal
    const optimizationGoal = optimizationGoalField ? optimizationGoalField.value : "";
    const requiresPixelAndEvent = ["OFFSITE_CONVERSIONS"].includes(optimizationGoal);

    // Update UI to reflect whether pixel/event are required
    if (optimizationGoal) {
      updateConversionFieldsVisibility(optimizationGoal);
    }

    let hasEventType = true; // Default to true (not required)
    if (requiresPixelAndEvent) {
      hasEventType = eventTypeField && (eventTypeField.value.trim() !== "" || eventTypeField.dataset.value);

      // Debug event type specifically when it's required
      if (!hasEventType && eventTypeField) {
        console.log("", {
          optimizationGoal: optimizationGoal,
          element: eventTypeField,
          value: eventTypeField.value,
          datasetValue: eventTypeField.dataset.value,
          hasValue: eventTypeField.value.trim() !== "",
          hasDatasetValue: !!eventTypeField.dataset.value,
        });
      }
    } else {
      console.log("Event type not required for optimization goal:", optimizationGoal);
    }

    // Check if age fields are visible (not special ad category)
    // Force a fresh computation of styles
    const ageFieldsVisible = ageContainer && window.getComputedStyle(ageContainer).display !== "none";
    let hasValidAge = true;
    if (ageFieldsVisible) {
      const hasMinAge = requiredFields.minAge && requiredFields.minAge.value.trim() !== "";
      const hasMaxAge = requiredFields.maxAge && requiredFields.maxAge.value.trim() !== "";
      hasValidAge = hasMinAge && hasMaxAge;
    }

    // Check if geo fields are visible (not special ad category)
    // Force a fresh computation of styles
    const geoFieldsVisible = geoContainers.length > 0 && window.getComputedStyle(geoContainers[0]).display !== "none";
    let hasValidGeo = true;
    if (geoFieldsVisible) {
      hasValidGeo = document.querySelector("#selected-countries").children.length > 0;
    }

    // Check if budget field is required and valid
    const budgetInput = document.querySelector(".config-daily-budget");
    let hasValidBudget = true;
    if (budgetInput && budgetInput.required) {
      hasValidBudget = budgetInput.value.trim() !== "";
    }

    // Debug logging
    const selectedCampaign = document.querySelector(".campaign.selected");
    if (selectedCampaign) {
      const specialAdCategories = JSON.parse(selectedCampaign.dataset.specialAdCategories || "[]");
      console.log("Validation check:", {
        campaign: selectedCampaign.querySelector("h3").textContent,
        specialAdCategories: specialAdCategories.length > 0,
        ageFieldsVisible,
        geoFieldsVisible,
        hasAdsetName,
        hasEventType,
        hasValidAge,
        hasValidGeo,
        hasValidBudget,
        shouldActivate: hasAdsetName && hasEventType && hasValidAge && hasValidGeo && hasValidBudget,
      });
    }

    // Enable button only if all required fields are filled
    // Get fresh button reference to avoid stale references
    const currentButton = document.querySelector(".create-adset-btn");

    if (hasAdsetName && hasEventType && hasValidAge && hasValidGeo && hasValidBudget) {
      if (currentButton) {
        const hadActiveClass = currentButton.classList.contains("active");
        currentButton.classList.add("active");
        console.log(`✓ Button activated - active class ${hadActiveClass ? "already present" : "ADDED"}`);
        console.log("  Button classes after activation:", currentButton.classList.toString());
      } else {
        console.error("createButton not found!");
      }
    } else {
      if (currentButton) {
        currentButton.classList.remove("active");
        console.log("", {
          hasAdsetName,
          hasEventType,
          hasValidAge,
          hasValidGeo,
          hasValidBudget,
        });
      }
    }
  };

  // Add event listeners to all required fields
  Object.values(requiredFields).forEach((field) => {
    if (field) {
      field.addEventListener("input", checkRequiredFields);
    }
  });

  // Monitor country selection changes
  const observer = new MutationObserver(checkRequiredFields);
  const selectedCountries = document.querySelector("#selected-countries");
  if (selectedCountries) {
    observer.observe(selectedCountries, { childList: true });
  }

  // Add listener to budget field
  const budgetInput = document.querySelector(".config-daily-budget");
  if (budgetInput) {
    budgetInput.addEventListener("input", checkRequiredFields);
  }

  // Monitor for visibility changes on age and geo containers
  const ageContainer = document.querySelector(".targeting-age");
  const geoContainers = document.querySelectorAll(".geo-selection-container");

  // Create a debounced version of checkRequiredFields
  let validationTimeout;
  const debouncedCheckRequiredFields = () => {
    clearTimeout(validationTimeout);
    validationTimeout = setTimeout(() => {
      checkRequiredFields();
    }, 50);
  };

  if (ageContainer) {
    const ageObserver = new MutationObserver(() => {
      debouncedCheckRequiredFields();
    });
    ageObserver.observe(ageContainer, { attributes: true, attributeFilter: ["style"] });
  }

  geoContainers.forEach((container) => {
    const geoObserver = new MutationObserver(() => {
      debouncedCheckRequiredFields();
    });
    geoObserver.observe(container, { attributes: true, attributeFilter: ["style"] });
  });

  // Initial check
  checkRequiredFields();
}
// Cache notification and real-time update functions
function showCacheNotification(cacheAgeMinutes) {
  const notification = document.createElement("div");
  notification.className = "cache-notification";
  notification.style = "position: fixed; bottom: 10px; right: 10px; color: #999; font-size: 12px; z-index: 10;";
  notification.textContent = `Cached data${cacheAgeMinutes ? " (" + cacheAgeMinutes + "m old)" : ""}`;

  document.body.appendChild(notification);

  setTimeout(() => notification.remove(), 1000);
}

// Manual refresh function
async function refreshMetaDataManually() {
  const refreshBtn = document.querySelector(".refresh-data-btn");

  try {
    // Add spinning animation
    if (refreshBtn) {
      refreshBtn.classList.add("refreshing");
      refreshBtn.disabled = true;
    }

    // Show a notification that refresh has started
    if (window.showSuccess) {
      window.showSuccess("Refreshing data from Facebook...", 2000);
    }

    // Directly fetch the fresh data, forcing a refresh from the source
    const freshData = await fetchMetaData(true);

    if (freshData) {
      // Once data is fetched, update the UI using the existing function
      updateUIWithFreshData(freshData);

      // Show a completion notification, similar to the SSE one
      const indicator = document.createElement("div");
      indicator.style = "position: fixed; bottom: 10px; right: 10px; color: #28a745; font-size: 12px; z-index: 10;";
      indicator.textContent = "Data updated";
      document.body.appendChild(indicator);
      setTimeout(() => indicator.remove(), 1000);

      const zuck = document.createElement("img");
      zuck.style = "position: fixed; bottom: 35px; right: 10px; width: 54px; z-index: 10;";
      zuck.src = "icons/favi.png";
      document.body.appendChild(zuck);
      setTimeout(() => zuck.remove(), 1000);
    } else {
      // Throw an error if no data is returned
      throw new Error("Refresh completed but returned no data.");
    }
  } catch (error) {
    console.error("Manual refresh failed:", error);
    if (window.showError) {
      window.showError("Failed to refresh data", 3000);
    }
  } finally {
    // Remove spinning animation after a short delay
    setTimeout(() => {
      if (refreshBtn) {
        refreshBtn.classList.remove("refreshing");
        refreshBtn.disabled = false;
      }
    }, 1000);
  }
}

// Set up SSE for real-time updates
function setupMetaDataUpdates() {
  const eventSource = new EventSource("/api/meta-data-updates");

  eventSource.addEventListener("connected", (event) => {
    // console.log("Connected to Meta data updates:", JSON.parse(event.data));
  });

  eventSource.addEventListener("refresh-started", (event) => {
    const data = JSON.parse(event.data);
    console.log("Meta data refresh started:", data);
  });

  eventSource.addEventListener("refresh-completed", (event) => {
    const data = JSON.parse(event.data);
    console.log("Meta data refresh completed:", data);

    // Update the UI with fresh data without disrupting the user
    if (data.data) {
      updateUIWithFreshData(data.data);
    }

    if (data.source === "background") {
      const indicator = document.createElement("div");
      indicator.style = "position: fixed; bottom: 10px; right: 10px; color: #28a745; font-size: 12px; z-index: 10;";
      indicator.textContent = "Data updated";
      document.body.appendChild(indicator);
      setTimeout(() => indicator.remove(), 1000);

      const zuck = document.createElement("img");
      zuck.style = "position: fixed; bottom: 35px; right: 10px; width: 54px; z-index: 10;";
      zuck.src = "icons/favi.png";
      document.body.appendChild(zuck);
      setTimeout(() => zuck.remove(), 1000);
    }
  });

  eventSource.addEventListener("refresh-failed", (event) => {
    const data = JSON.parse(event.data);
    console.error("Meta data refresh failed:", data);
    // No visual indicator for failures - just log it
  });

  eventSource.onerror = (error) => {
    console.error("SSE connection error:", error);
    eventSource.close();

    // Reconnect after 5 seconds
    setTimeout(() => setupMetaDataUpdates(), 5000);
  };

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    eventSource.close();
  });
}

// Initialize SSE when data is loaded - call this after populating data
window.initializeMetaDataUpdates = setupMetaDataUpdates;
// Expose refresh function to window for onclick handler
window.refreshMetaDataManually = refreshMetaDataManually;

// Helper function to force cache refresh on next page load
function forceMetaDataRefreshOnNextLoad() {
  sessionStorage.setItem("forceMetaDataRefresh", "true");
}

// Update UI with fresh data without disrupting the user
function updateUIWithFreshData(freshData) {
  // Store the current selections
  const currentState = appState.getState();
  const selectedAccountId = currentState.selectedAccount;
  const selectedCampaignId = currentState.selectedCampaign;

  // --- 1. Clear existing lists ---
  const adAccList = document.querySelector("#ad-acc-list");
  if (adAccList) adAccList.innerHTML = "";

  const campaignColumn = document.querySelector(".campaign-column");
  const campaignSelection = campaignColumn.querySelector(".campaign-selection");
  if (campaignSelection) {
    // Instead of removing, just clear the content to preserve event listeners on parent
    campaignSelection.innerHTML = "";
  }

  const pixelDropdownOptions = document.querySelector(".dropdown-options.pixel");
  if (pixelDropdownOptions) pixelDropdownOptions.innerHTML = "";

  const pagesDropdownOptions = document.querySelectorAll(".dropdown-options.pages");
  pagesDropdownOptions.forEach((dropdown) => (dropdown.innerHTML = ""));

  // --- 2. Repopulate with fresh data ---
  if (freshData.adAccounts) {
    populateAdAccounts(freshData.adAccounts);
    window.adAccountsData = freshData.adAccounts;
  }
  if (freshData.campaigns) {
    populateCampaigns(freshData.campaigns);
    window.campaignsData = freshData.campaigns;
  }
  if (freshData.pixels) {
    populatePixels(freshData.pixels);
    window.pixelsData = freshData.pixels;
  }
  if (freshData.pages) {
    populatePages(freshData.pages);
    window.pagesData = freshData.pages;
  }

  // --- 3. Re-select previous items to restore state ---
  if (selectedAccountId) {
    const accountElement = document.querySelector(`.account[data-campaign-id="${selectedAccountId}"]`);
    if (accountElement) {
      // Simulate a click to trigger all the downstream filtering and UI updates
      accountElement.click();

      // If a campaign was also selected, find and click it after a short delay
      // This allows the campaign list to be populated by the account click first
      if (selectedCampaignId) {
        setTimeout(() => {
          const campaignElement = document.querySelector(`.campaign[data-campaign-id="${selectedCampaignId}"]`);
          if (campaignElement) {
            campaignElement.click();
          }
        }, 100); // 100ms delay should be enough for the DOM to update
      }
    }
  }
}

// Helper function to add a campaign to the UI
function addCampaignToUI(campaign) {
  const campaignSelection = document.querySelector(".campaign-selection");
  if (!campaignSelection) return;

  const newCampaignElement = document.createElement("div");
  newCampaignElement.className = "campaign";
  newCampaignElement.setAttribute("data-next-column", ".action-column");
  newCampaignElement.setAttribute("data-col-id", "2");
  newCampaignElement.setAttribute("data-acc-campaign-id", campaign.account_id);
  newCampaignElement.setAttribute("data-campaign-id", campaign.id);
  newCampaignElement.setAttribute("data-daily-budget", campaign.daily_budget || "");
  newCampaignElement.setAttribute("data-lifetime-budget", campaign.lifetime_budget || "");
  newCampaignElement.setAttribute("data-bid-strategy", campaign.bid_strategy || "LOWEST_COST_WITHOUT_CAP");
  newCampaignElement.setAttribute("data-objective", campaign.objective || "");
  newCampaignElement.setAttribute("data-special-ad-categories", JSON.stringify(campaign.special_ad_categories || []));
  newCampaignElement.style.display = ""; // Make it visible if it matches current filter

  newCampaignElement.innerHTML = `
    <h3>${campaign.name}</h3>
    <ul>
      <li>${campaign.status || "UNKNOWN"}</li>
      <li>Spend: ${campaign.insights?.spend || "N/A"}</li>
      <li>Clicks: ${campaign.insights?.clicks || "N/A"}</li>
    </ul>
  `;

  // Insert at the top of the list
  const firstCampaign = campaignSelection.querySelector(".campaign");
  if (firstCampaign) {
    campaignSelection.insertBefore(newCampaignElement, firstCampaign);
  } else {
    campaignSelection.appendChild(newCampaignElement);
  }

  // Reinitialize the single select group
  // Clean up existing campaign select group before creating new one
  if (campaignSelectGroup) {
    campaignSelectGroup.cleanup();
  }
  campaignSelectGroup = new SingleSelectGroup(".campaign");
}

// Initialize Create Campaign Dialog
function initializeCreateCampaignDialog() {
  console.log("Initializing Create Campaign Dialog");

  // Initialize dropdowns for the campaign creation column
  new CustomDropdown(".campaign-creation-column .custom-dropdown");

  // Delay to ensure DOM is fully ready
  setTimeout(() => {
    // Add event listener to the create campaign button using direct event delegation
    const handleCreateCampaignClick = (e) => {
      // console.log("Button click intercepted - target:", e.target);
      if (e.target.classList.contains("create-new-campaign-btn") || e.target.closest(".create-new-campaign-btn")) {
        e.preventDefault();
        e.stopPropagation();

        const campaignCreationColumn = document.getElementById("col-2-5");
        if (campaignCreationColumn) {
          campaignCreationColumn.style.display = "block";

          // Make create button active and enabled
          const createBtn = document.querySelector(".campaign-create-btn");
          if (createBtn) {
            createBtn.classList.add("active");
            createBtn.disabled = false;
          }

          resetCampaignCreationForm();
        } else {
          console.error("col-2-5 not found");
        }
      }
    };

    // Use document listener for maximum reliability
    document.addEventListener("click", handleCreateCampaignClick, true);

    // Setup cancel button
    const setupCancelButton = () => {
      const cancelBtn = document.querySelector(".campaign-cancel-btn");
      if (cancelBtn) {
        cancelBtn.onclick = (e) => {
          e.preventDefault();
          console.log("Cancel clicked - hiding column");
          const col = document.getElementById("col-2-5");
          if (col) {
            col.style.display = "none";
            console.log("✓ Column hidden");

            // Remove active class and disable create button
            const createBtn = document.querySelector(".campaign-create-btn");
            if (createBtn) {
              createBtn.classList.remove("active");
              createBtn.disabled = true;
              console.log("✓ Create button deactivated and disabled");
            }
          }
        };
      } else {
        console.warn("Cancel button not found");
      }
    };
    setupCancelButton();

    // Setup create button
    const setupCreateButton = () => {
      const createBtn = document.querySelector(".campaign-create-btn");
      if (createBtn) {
        createBtn.onclick = (e) => {
          e.preventDefault();
          console.log("Create form button clicked");
          handleCampaignCreation();
        };
      } else {
        console.warn("Create form button not found");
      }
    };
    setupCreateButton();
  }, 500); // Wait for DOM to settle
}

// Reset campaign creation form
function resetCampaignCreationForm() {
  const column = document.querySelector(".campaign-creation-column");
  if (!column) return;

  // Reset text inputs
  const nameInput = column.querySelector(".config-campaign-name");
  if (nameInput) nameInput.value = "";

  // Budget fields - MOVED TO AD SET LEVEL
  // const dailyBudgetInput = column.querySelector(".config-campaign-daily-budget");
  // if (dailyBudgetInput) dailyBudgetInput.value = "";

  // const lifetimeBudgetInput = column.querySelector(".config-campaign-lifetime-budget");
  // if (lifetimeBudgetInput) lifetimeBudgetInput.value = "";

  // Reset all dropdowns
  const displayElements = column.querySelectorAll(".dropdown-display");
  displayElements.forEach((display) => {
    display.textContent = display.getAttribute("placeholder") || "Select an option";
    display.classList.add("placeholder");
    delete display.dataset.value;
  });

  // Reset all selected options
  const allOptions = column.querySelectorAll(".dropdown-options li");
  allOptions.forEach((opt) => opt.classList.remove("selected"));

  // Keep create button active and enabled when column is displayed
  const createBtn = column.querySelector(".campaign-create-btn");
  if (createBtn && column.style.display === "block") {
    createBtn.classList.add("active");
    createBtn.disabled = false;
  }
}

// Handle campaign creation
async function handleCampaignCreation() {
  const selectedAccount = appState.getState().selectedAccount;
  if (!selectedAccount) {
    if (window.showError) {
      window.showError("Please select an ad account first", 3000);
    }
    return;
  }

  const column = document.querySelector(".campaign-creation-column");
  if (!column) return;

  const nameInput = column.querySelector(".config-campaign-name");
  // Budget fields - MOVED TO AD SET LEVEL
  // const dailyBudgetInput = column.querySelector(".config-campaign-daily-budget");
  // const lifetimeBudgetInput = column.querySelector(".config-campaign-lifetime-budget");
  const createBtn = column.querySelector(".campaign-create-btn");

  if (!createBtn) {
    console.error("Create button not found in campaign creation column");
    return;
  }

  const name = nameInput?.value.trim();
  const objectiveDisplay = column.querySelector('[data-dropdown="campaign-objective"] .dropdown-display');
  const statusDisplay = column.querySelector('[data-dropdown="campaign-status"] .dropdown-display');
  // Bid strategy - MOVED TO AD SET LEVEL
  // const bidStrategyDisplay = column.querySelector('[data-dropdown="campaign-bid-strategy"] .dropdown-display');

  const objective = objectiveDisplay?.dataset.value;
  const status = statusDisplay?.dataset.value;
  // const bidStrategy = bidStrategyDisplay?.dataset.value;

  // Get special categories
  const specialCategoriesOptions = column.querySelectorAll(".dropdown-options.campaign-special-categories li.selected");
  const specialCategories = Array.from(specialCategoriesOptions)
    .map((opt) => opt.dataset.value)
    .filter((val) => val !== "");

  // Get special countries
  const specialCountryOptions = column.querySelectorAll(".dropdown-options.campaign-special-country li.selected");
  const specialCountries = Array.from(specialCountryOptions)
    .map((opt) => opt.dataset.value)
    .filter((val) => val !== "");

  // Budget fields - MOVED TO AD SET LEVEL
  // const dailyBudget = dailyBudgetInput?.value;
  // const lifetimeBudget = lifetimeBudgetInput?.value;

  if (!name || !objective || !status) {
    if (window.showError) {
      window.showError("Please fill in all required fields", 3000);
    }
    // Reset button state on validation error
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.textContent = "Create Campaign";
    }
    return;
  }

  // Budget validation - MOVED TO AD SET LEVEL
  // if (dailyBudget && lifetimeBudget) {
  //   if (window.showError) {
  //     window.showError("Cannot specify both daily budget and lifetime budget. Please choose one.", 3000);
  //   }
  //   // Reset button state on validation error
  //   if (createBtn) {
  //     createBtn.disabled = false;
  //     createBtn.textContent = "Create Campaign";
  //   }
  //   return;
  // }

  // Show loading state
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.textContent = "Creating...";
  }

  try {
    // Build request body
    const requestBody = {
      account_id: selectedAccount,
      name: name,
      objective: objective,
      status: status,
    };

    if (specialCategories.length > 0) {
      requestBody.special_ad_categories = specialCategories;
    }

    if (specialCountries.length > 0) {
      requestBody.special_ad_category_country = specialCountries;
    }

    // Bid strategy - MOVED TO AD SET LEVEL
    // if (bidStrategy) {
    //   requestBody.bid_strategy = bidStrategy;
    // }

    // Budget fields - MOVED TO AD SET LEVEL
    // if (dailyBudget && parseFloat(dailyBudget) > 0) {
    //   requestBody.daily_budget = parseFloat(dailyBudget);
    // }

    // if (lifetimeBudget && parseFloat(lifetimeBudget) > 0) {
    //   requestBody.lifetime_budget = parseFloat(lifetimeBudget);
    // }

    console.log("Creating campaign with payload:", requestBody);

    const response = await fetch("/api/create-campaign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || "Failed to create campaign");
    }

    const data = await response.json();
    console.log("Campaign created successfully:", data);

    // Hide campaign creation column
    column.style.display = "none";

    // Deactivate and disable create button when hiding column
    const createBtn = column.querySelector(".campaign-create-btn");
    if (createBtn) {
      createBtn.classList.remove("active");
      createBtn.disabled = true;
      console.log("✓ Create button deactivated and disabled");
    }

    // Reset form for next use
    resetCampaignCreationForm();

    // Add the new campaign to the list
    const newCampaignId = data.campaign_id;
    const campaignSelection = document.querySelector(".campaign-selection");

    if (campaignSelection) {
      const newCampaignElement = document.createElement("div");
      newCampaignElement.className = "campaign";
      newCampaignElement.setAttribute("data-next-column", ".action-column");
      newCampaignElement.setAttribute("data-col-id", "2");
      newCampaignElement.setAttribute("data-acc-campaign-id", selectedAccount);
      newCampaignElement.setAttribute("data-campaign-id", newCampaignId);
      newCampaignElement.setAttribute("data-daily-budget", data.campaign.daily_budget || "");
      newCampaignElement.setAttribute("data-bid-strategy", data.campaign.bid_strategy || "");
      newCampaignElement.setAttribute("data-special-ad-categories", JSON.stringify(specialCategories));

      newCampaignElement.innerHTML = `
        <h3>${name}</h3>
        <ul>
          <li>${status}</li>
          <li>Spend: $0.00</li>
          <li>Clicks: 0</li>
        </ul>
      `;

      const firstCampaign = campaignSelection.querySelector(".campaign");
      if (firstCampaign) {
        campaignSelection.insertBefore(newCampaignElement, firstCampaign);
      } else {
        campaignSelection.appendChild(newCampaignElement);
      }

      if (campaignSelectGroup) {
        campaignSelectGroup.cleanup();
      }
      campaignSelectGroup = new SingleSelectGroup(".campaign");
    }

    if (window.showSuccess) {
      window.showSuccess(`Campaign "${name}" has been successfully created!`, 4000);
    }

    // Trigger background refresh
    fetch("/api/refresh-meta-cache", { method: "POST" })
      .then((response) => {
        if (!response.ok) {
          console.warn(`Refresh returned status ${response.status}`);
          return null;
        }
        return response.json();
      })
      .then((result) => {
        if (result) {
          console.log("Background refresh triggered:", result);
        }
      })
      .catch((err) => console.error("Failed to trigger refresh:", err));
  } catch (error) {
    console.error("Error creating campaign:", error);
    if (window.showError) {
      window.showError(error.message || "Failed to create campaign. Please try again.", 5000);
    }

    // Reset button state on error
    if (createBtn) {
      createBtn.disabled = false;
      createBtn.textContent = "Create Campaign";
    }
  }
}

// Open the create campaign dialog (deprecated - keeping for reference)
function openCreateCampaignDialog() {
  const selectedAccount = appState.getState().selectedAccount;
  if (!selectedAccount) {
    if (window.showError) {
      window.showError("Please select an ad account first", 3000);
    } else {
      alert("Please select an ad account first");
    }
    return;
  }

  const dialog = document.querySelector(".create-campaign-dialog");
  if (!dialog) {
    console.error("Create campaign dialog not found");
    return;
  }

  const nameInput = dialog.querySelector("#create-campaign-name");
  // Budget fields - MOVED TO AD SET LEVEL
  // const dailyBudgetInput = dialog.querySelector("#create-campaign-daily-budget");
  // const lifetimeBudgetInput = dialog.querySelector("#create-campaign-lifetime-budget");
  const createBtn = dialog.querySelector(".campaign-create");
  const cancelBtn = dialog.querySelector(".campaign-cancel");
  const closeBtn = dialog.querySelector(".dialog-close-btn");

  // Reset form
  if (nameInput) nameInput.value = "";
  // if (dailyBudgetInput) dailyBudgetInput.value = "";
  // if (lifetimeBudgetInput) lifetimeBudgetInput.value = "";
  if (createBtn) {
    createBtn.disabled = true;
    createBtn.textContent = "Create Campaign";
  }

  // Reset dropdowns
  const objectiveDisplay = dialog.querySelector('[data-dropdown="campaign-objective"] .dropdown-display');
  const statusDisplay = dialog.querySelector('[data-dropdown="campaign-status"] .dropdown-display');
  // Bid strategy - MOVED TO AD SET LEVEL
  // const bidStrategyDisplay = dialog.querySelector('[data-dropdown="campaign-bid-strategy"] .dropdown-display');
  const specialCategoriesDisplay = dialog.querySelector('[data-dropdown="campaign-special-categories"] .dropdown-display');
  const specialCountryDisplay = dialog.querySelector('[data-dropdown="campaign-special-country"] .dropdown-display');

  if (objectiveDisplay) {
    objectiveDisplay.textContent = "Campaign Objective*";
    objectiveDisplay.classList.add("placeholder");
  }
  if (statusDisplay) {
    statusDisplay.textContent = "Status*";
    statusDisplay.classList.add("placeholder");
  }
  // if (bidStrategyDisplay) {
  //   bidStrategyDisplay.textContent = "Bid Strategy (Optional)";
  //   bidStrategyDisplay.classList.add("placeholder");
  // }
  if (specialCategoriesDisplay) {
    specialCategoriesDisplay.textContent = "Special Ad Categories (Optional)";
    specialCategoriesDisplay.classList.add("placeholder");
  }
  if (specialCountryDisplay) {
    specialCountryDisplay.textContent = "Special Ad Category Country (Optional)";
    specialCountryDisplay.classList.add("placeholder");
  }

  // Clear all selected options
  const allOptions = dialog.querySelectorAll(".dropdown-options li");
  allOptions.forEach((opt) => opt.classList.remove("selected"));

  // Show dialog
  dialog.style.display = "flex";
  console.log("Dialog display set to flex");

  setTimeout(() => {
    if (nameInput) nameInput.focus();
  }, 100);

  // Name input validation
  if (nameInput) {
    nameInput.oninput = () => {
      if (createBtn) {
        const objective = dialog.querySelector('[data-dropdown="campaign-objective"] .dropdown-display').dataset.value;
        const status = dialog.querySelector('[data-dropdown="campaign-status"] .dropdown-display').dataset.value;
        createBtn.disabled = !nameInput.value.trim() || !objective || !status;
      }
    };
  }

  // Helper function to hide campaign creation column and close dialog
  const hideCampaignCreationColumn = () => {
    const campaignCreationColumn = document.getElementById("col-2-5");
    if (campaignCreationColumn) {
      campaignCreationColumn.style.display = "none";
    }
    dialog.style.display = "none";
  };

  // Cancel button
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      hideCampaignCreationColumn();
    };
  }

  // Close button
  if (closeBtn) {
    closeBtn.onclick = () => {
      hideCampaignCreationColumn();
    };
  }

  // Close dialog on background click
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      hideCampaignCreationColumn();
    }
  };

  // Prevent clicks on dialog content from closing
  const dialogContent = dialog.querySelector(".dialog-content");
  if (dialogContent) {
    dialogContent.onclick = (e) => {
      e.stopPropagation();
    };
  }

  // Setup dropdown listeners to enable/disable create button
  const allOptionsForValidation = dialog.querySelectorAll(".dropdown-options li");
  allOptionsForValidation.forEach((option) => {
    option.addEventListener("click", () => {
      setTimeout(() => {
        if (createBtn && nameInput) {
          const objective = dialog.querySelector('[data-dropdown="campaign-objective"] .dropdown-display').dataset.value;
          const status = dialog.querySelector('[data-dropdown="campaign-status"] .dropdown-display').dataset.value;
          createBtn.disabled = !nameInput.value.trim() || !objective || !status;
          console.log("Validation check - objective:", objective, "status:", status, "disabled:", createBtn.disabled);
        }
      }, 50);
    });
  });

  // Create button
  if (createBtn) {
    createBtn.onclick = async () => {
      const name = nameInput?.value.trim();
      const objectiveDisplay = dialog.querySelector('[data-dropdown="campaign-objective"] .dropdown-display');
      const statusDisplay = dialog.querySelector('[data-dropdown="campaign-status"] .dropdown-display');
      // Bid strategy - MOVED TO AD SET LEVEL
      // const bidStrategyDisplay = dialog.querySelector('[data-dropdown="campaign-bid-strategy"] .dropdown-display');

      const objective = objectiveDisplay?.dataset.value;
      const status = statusDisplay?.dataset.value;
      // const bidStrategy = bidStrategyDisplay?.dataset.value;

      // Get special categories
      const specialCategoriesOptions = dialog.querySelectorAll(".dropdown-options.campaign-special-categories li.selected");
      const specialCategories = Array.from(specialCategoriesOptions)
        .map((opt) => opt.dataset.value)
        .filter((val) => val !== "");

      // Get special countries
      const specialCountryOptions = dialog.querySelectorAll(".dropdown-options.campaign-special-country li.selected");
      const specialCountries = Array.from(specialCountryOptions)
        .map((opt) => opt.dataset.value)
        .filter((val) => val !== "");

      // Budget fields removed - now handled at ad set level
      // const dailyBudget = dailyBudgetInput?.value;
      // const lifetimeBudget = lifetimeBudgetInput?.value;

      if (!name || !objective || !status) {
        if (window.showError) {
          window.showError("Please fill in all required fields", 3000);
        }
        return;
      }

      // Budget validation removed - now handled at ad set level
      // if (dailyBudget && lifetimeBudget) {
      //   if (window.showError) {
      //     window.showError("Cannot specify both daily budget and lifetime budget. Please choose one.", 3000);
      //   }
      //   return;
      // }

      // Show loading state
      createBtn.disabled = true;
      createBtn.textContent = "Creating...";

      try {
        // Build request body
        const requestBody = {
          account_id: selectedAccount,
          name: name,
          objective: objective,
          status: status,
        };

        // Add optional fields only if they have values
        if (specialCategories.length > 0) {
          requestBody.special_ad_categories = specialCategories;
        }

        if (specialCountries.length > 0) {
          requestBody.special_ad_category_country = specialCountries;
        }

        if (bidStrategy) {
          requestBody.bid_strategy = bidStrategy;
        }

        // Budget fields removed - now handled at ad set level
        // if (dailyBudget && parseFloat(dailyBudget) > 0) {
        //   requestBody.daily_budget = parseFloat(dailyBudget);
        // }

        // if (lifetimeBudget && parseFloat(lifetimeBudget) > 0) {
        //   requestBody.lifetime_budget = parseFloat(lifetimeBudget);
        // }

        console.log("Creating campaign with payload:", requestBody);

        const response = await fetch("/api/create-campaign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || errorData.details || "Failed to create campaign");
        }

        const data = await response.json();
        console.log("Campaign created successfully:", data);

        // Hide dialog and campaign creation column
        dialog.style.display = "none";
        const campaignCreationColumn = document.getElementById("col-2-5");
        if (campaignCreationColumn) {
          campaignCreationColumn.style.display = "none";
        }

        // Add the new campaign to the list
        const newCampaignId = data.campaign_id;
        const campaignSelection = document.querySelector(".campaign-selection");

        if (campaignSelection) {
          const newCampaignElement = document.createElement("div");
          newCampaignElement.className = "campaign";
          newCampaignElement.setAttribute("data-next-column", ".action-column");
          newCampaignElement.setAttribute("data-col-id", "2");
          newCampaignElement.setAttribute("data-acc-campaign-id", selectedAccount);
          newCampaignElement.setAttribute("data-campaign-id", newCampaignId);
          newCampaignElement.setAttribute("data-daily-budget", data.campaign.daily_budget || "");
          newCampaignElement.setAttribute("data-bid-strategy", data.campaign.bid_strategy || "");
          newCampaignElement.setAttribute("data-special-ad-categories", JSON.stringify(specialCategories));
          newCampaignElement.style.display = "none";

          newCampaignElement.innerHTML = `
            <h3>${name}</h3>
            <ul>
              <li>${status}</li>
              <li>Spend: $0.00</li>
              <li>Clicks: 0</li>
            </ul>
          `;

          // Insert at the top of the list
          const firstCampaign = campaignSelection.querySelector(".campaign");
          if (firstCampaign) {
            campaignSelection.insertBefore(newCampaignElement, firstCampaign);
          } else {
            campaignSelection.appendChild(newCampaignElement);
          }

          // Reinitialize campaign select group
          if (campaignSelectGroup) {
            campaignSelectGroup.cleanup();
          }
          campaignSelectGroup = new SingleSelectGroup(".campaign");
        }

        // Show success message
        if (window.showSuccess) {
          window.showSuccess(`Campaign "${name}" has been successfully created!`, 4000);
        }

        // Trigger background refresh
        fetch("/api/refresh-meta-cache", { method: "POST" })
          .then((response) => {
            if (!response.ok) {
              console.warn(`Refresh returned status ${response.status}`);
              return null;
            }
            return response.json();
          })
          .then((result) => {
            if (result) {
              console.log("Background refresh triggered:", result);
            }
          })
          .catch((err) => console.error("Failed to trigger refresh:", err));
      } catch (error) {
        console.error("Error creating campaign:", error);
        if (window.showError) {
          window.showError(error.message || "Failed to create campaign. Please try again.", 5000);
        }

        // Reset button
        createBtn.disabled = false;
        createBtn.textContent = "Create Campaign";
      }
    };
  }
}

// ============================================
// BULK UPLOAD ADS FUNCTIONALITY
// ============================================

let bulkUploadData = {
  selectedAccounts: [],
  currentAd: null, // The ad data to use (from review screen)
};

// Initialize bulk upload button
function initBulkUploadButton() {
  const bulkUploadBtn = document.querySelector(".bulk-upload-ads-button");
  if (!bulkUploadBtn) return;

  bulkUploadBtn.addEventListener("click", async () => {
    // Get current ad data from the review screen
    const currentAdData = getCurrentAdData();
    if (!currentAdData) {
      alert("Please complete the ad creation process first before using bulk upload.");
      return;
    }

    bulkUploadData.currentAd = currentAdData;
    await openBulkUploadModal();
  });
}

// Get current ad data from the review screen
function getCurrentAdData() {
  try {
    const reviewSection = document.querySelector(".create-ads-container");
    if (!reviewSection) {
      console.log("Review section not found");
      return null;
    }

    // Get ad copy data from review section
    const primaryText = reviewSection.querySelector(".primary-text-review-container p")?.textContent || "";
    const headline = reviewSection.querySelector(".headline-review-container p")?.textContent || "";
    const callToAction = reviewSection.querySelector(".cta-text-review-container.cta p")?.textContent || "";
    const destinationUrl = reviewSection.querySelector(".cta-text-review-container.link p")?.textContent || "";
    const description = reviewSection.querySelector(".cta-text-review-container.description p")?.textContent || "";

    // Get page ID from the ad copy container (it's stored in dataset)
    const pageDropdownDisplay = document.querySelector('.ad-copy-container .dropdown-selected[data-dropdown="page"] .dropdown-display');
    const pageId = pageDropdownDisplay ? pageDropdownDisplay.dataset.pageid : "";

    // Get uploaded assets from appState
    const assets = appState.getState().uploadedAssets || [];

    // Get selected adset
    const adsetId = appState.getState().adSetConfig?.id || "";

    // Log current state for debugging
    console.log("Current ad data state:", {
      primaryText: primaryText ? "✓" : "✗",
      headline: headline ? "✓" : "✗",
      pageId: pageId ? "✓" : "✗",
      destinationUrl: destinationUrl ? "✓" : "✗",
      assetsCount: assets.length,
      adsetId: adsetId ? "✓" : "✗",
    });

    // Validate required fields
    if (!primaryText || !headline || !destinationUrl || assets.length === 0 || !pageId || !adsetId) {
      console.log("Missing required fields:", { primaryText, headline, destinationUrl, assetsCount: assets.length, pageId, adsetId });
      const missingFields = [];
      if (!primaryText) missingFields.push("- Primary Text");
      if (!headline) missingFields.push("- Headline");
      if (!destinationUrl) missingFields.push("- Destination URL");
      if (assets.length === 0) missingFields.push("- At least one asset (image/video)");
      if (!pageId) missingFields.push("- Page (select a page in the ad copy section)");
      if (!adsetId) missingFields.push("- Ad Set (you need to select or create an ad set first)");

      alert(`Missing required fields:\n${missingFields.join("\n")}\n\nFor bulk upload, please complete the ad creation form first, including selecting a Page and Ad Set. These will be used for all accounts.`);
      return null;
    }

    return {
      message: primaryText,
      headline: headline,
      page_id: pageId,
      call_to_action_type: callToAction,
      link: destinationUrl,
      description: description,
      assets: assets,
      adset_id: adsetId,
    };
  } catch (error) {
    console.error("Error getting current ad data:", error);
    return null;
  }
}

// Open bulk upload modal
async function openBulkUploadModal() {
  const modal = document.querySelector(".bulk-upload-modal");
  if (!modal) return;

  // Reset modal
  showBulkStep(1);
  bulkUploadData.selectedAccounts = [];

  // Load accounts
  await loadAccountsForBulkUpload();

  modal.style.display = "flex";
}

// Load accounts into the modal
async function loadAccountsForBulkUpload() {
  const accountList = document.querySelector(".bulk-upload-modal .account-list");
  if (!accountList) return;

  accountList.innerHTML = '<p style="padding: 20px; text-align: center;">Loading accounts...</p>';

  try {
    // Get accounts from the global adAccountsData or fetch from sidebar
    let accounts = window.adAccountsData;

    // If not available, try to get from the sidebar list
    if (!accounts || accounts.length === 0) {
      const adAccList = document.querySelector("#ad-acc-list");
      if (adAccList) {
        const accountItems = adAccList.querySelectorAll("li");
        accounts = Array.from(accountItems)
          .map((item) => ({
            account_id: item.dataset.accountId,
            name: item.textContent.trim(),
          }))
          .filter((acc) => acc.account_id);
      }
    }

    // If still no accounts, fetch from API
    if (!accounts || accounts.length === 0) {
      accountList.innerHTML = '<p style="padding: 20px; text-align: center;">Loading accounts from server...</p>';

      const response = await fetch("/api/fetch-meta-data");
      if (!response.ok) {
        throw new Error("Failed to fetch account data from server");
      }

      const data = await response.json();
      accounts = data.adAccounts || [];
      window.adAccountsData = accounts; // Cache for future use
    }

    if (!accounts || accounts.length === 0) {
      throw new Error("No ad accounts data available");
    }

    if (accounts.length === 0) {
      accountList.innerHTML = '<p style="padding: 20px; text-align: center;">No ad accounts available</p>';
      return;
    }

    accountList.innerHTML = "";

    accounts.forEach((account) => {
      const accountItem = document.createElement("div");
      accountItem.className = "account-item";
      accountItem.dataset.accountId = account.account_id;
      accountItem.dataset.accountName = account.name;

      accountItem.innerHTML = `
        <input type="checkbox" class="account-checkbox" data-account-id="${account.account_id}">
        <div class="account-info">
          <div class="account-name">${account.name}</div>
          <div class="account-id">ID: ${account.account_id}</div>
        </div>
      `;

      accountItem.addEventListener("click", (e) => {
        if (e.target.classList.contains("account-checkbox")) return;
        const checkbox = accountItem.querySelector(".account-checkbox");
        checkbox.checked = !checkbox.checked;
        toggleAccountSelection(account.account_id, account.name, checkbox.checked);
      });

      const checkbox = accountItem.querySelector(".account-checkbox");
      checkbox.addEventListener("change", (e) => {
        toggleAccountSelection(account.account_id, account.name, e.target.checked);
      });

      accountList.appendChild(accountItem);
    });

    // Setup search
    setupAccountSearch();
  } catch (error) {
    console.error("Error loading accounts:", error);
    accountList.innerHTML = '<p style="padding: 20px; text-align: center; color: red;">Failed to load accounts</p>';
  }
}

// Setup account search functionality
function setupAccountSearch() {
  const searchInput = document.querySelector(".bulk-upload-modal .account-search");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const accountItems = document.querySelectorAll(".bulk-upload-modal .account-item");

    accountItems.forEach((item) => {
      const name = item.dataset.accountName.toLowerCase();
      const id = item.dataset.accountId.toLowerCase();

      if (name.includes(searchTerm) || id.includes(searchTerm)) {
        item.style.display = "flex";
      } else {
        item.style.display = "none";
      }
    });
  });
}

// Toggle account selection
function toggleAccountSelection(accountId, accountName, selected) {
  const accountItem = document.querySelector(`.bulk-upload-modal .account-item[data-account-id="${accountId}"]`);
  if (!accountItem) return;

  if (selected) {
    accountItem.classList.add("selected");
    if (!bulkUploadData.selectedAccounts.find((a) => a.id === accountId)) {
      bulkUploadData.selectedAccounts.push({ id: accountId, name: accountName });
    }
  } else {
    accountItem.classList.remove("selected");
    bulkUploadData.selectedAccounts = bulkUploadData.selectedAccounts.filter((a) => a.id !== accountId);
  }

  updateBulkSelectionUI();
}

// Update selection UI
function updateBulkSelectionUI() {
  const count = bulkUploadData.selectedAccounts.length;
  const startBtn = document.querySelector(".bulk-start-upload");

  if (startBtn) {
    startBtn.disabled = count === 0;
    const creativesCount = bulkUploadData.currentAd?.assets?.length || 0;
    startBtn.textContent = `Start Bulk Upload (${count} account${count !== 1 ? "s" : ""}, ${creativesCount} ad${creativesCount !== 1 ? "s" : ""} each)`;
  }
}

// Show bulk upload step
function showBulkStep(stepNumber) {
  document.querySelectorAll(".bulk-step").forEach((step) => {
    step.style.display = "none";
  });

  const currentStep = document.querySelector(`.bulk-step[data-step="${stepNumber}"]`);
  if (currentStep) {
    currentStep.style.display = "block";
  }
}

// Setup bulk upload event listeners
function setupBulkUploadListeners() {
  // Close modal
  const closeBtn = document.querySelector(".bulk-upload-close");
  const modal = document.querySelector(".bulk-upload-modal");

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      if (modal) modal.style.display = "none";
    });
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  // Select/Deselect all
  const selectAllBtn = document.querySelector(".bulk-select-all");
  const deselectAllBtn = document.querySelector(".bulk-deselect-all");

  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".bulk-upload-modal .account-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = true;
        const accountId = cb.dataset.accountId;
        const accountItem = cb.closest(".account-item");
        const accountName = accountItem.dataset.accountName;
        toggleAccountSelection(accountId, accountName, true);
      });
    });
  }

  if (deselectAllBtn) {
    deselectAllBtn.addEventListener("click", () => {
      const checkboxes = document.querySelectorAll(".bulk-upload-modal .account-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = false;
        const accountId = cb.dataset.accountId;
        const accountItem = cb.closest(".account-item");
        const accountName = accountItem.dataset.accountName;
        toggleAccountSelection(accountId, accountName, false);
      });
    });
  }

  // Start upload
  const startBtn = document.querySelector(".bulk-start-upload");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startBulkUpload();
    });
  }

  // Close buttons
  const closeModalBtns = document.querySelectorAll(".bulk-close-modal");
  closeModalBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (modal) modal.style.display = "none";
    });
  });
}

// Start bulk upload
async function startBulkUpload() {
  showBulkStep(2);

  const adData = bulkUploadData.currentAd;
  const creativesCount = adData.assets.length;

  // Initialize progress UI
  const progressContainer = document.querySelector(".account-progress-list");
  progressContainer.innerHTML = "";

  bulkUploadData.selectedAccounts.forEach((account) => {
    const item = document.createElement("div");
    item.className = "account-progress-item";
    item.dataset.accountId = account.id;

    item.innerHTML = `
      <div class="account-progress-header">
        <span class="account-progress-name">${account.name}</span>
        <span class="account-progress-status pending">Pending</span>
      </div>
      <div class="account-progress-bar">
        <div class="account-progress-fill" style="width: 0%"></div>
      </div>
      <div class="account-progress-details">0 of ${creativesCount} ads created</div>
    `;

    progressContainer.appendChild(item);
  });

  // Process accounts
  let completedAccounts = 0;
  const totalAccounts = bulkUploadData.selectedAccounts.length;

  const results = [];

  for (const account of bulkUploadData.selectedAccounts) {
    const result = await processBulkAccount(account);
    results.push(result);
    completedAccounts++;

    // Update overall progress
    updateOverallProgress(completedAccounts, totalAccounts);
  }

  // Show results
  showBulkResults(results);
}

// Process single account
async function processBulkAccount(account) {
  const accountId = account.id;
  const adData = bulkUploadData.currentAd;
  const creativesCount = adData.assets.length;
  const progressItem = document.querySelector(`.account-progress-item[data-account-id="${accountId}"]`);

  const statusSpan = progressItem.querySelector(".account-progress-status");
  statusSpan.textContent = "Processing";
  statusSpan.className = "account-progress-status processing";

  try {
    // Prepare ads data - one ad per creative
    const ads = [];

    console.log("Processing assets for account:", accountId);
    console.log("Assets data:", adData.assets);

    adData.assets.forEach((asset, i) => {
      const ad = {
        name: `${adData.headline} - ${asset.name || `Creative ${i + 1}`}`,
        creativeName: asset.name || `Creative ${i + 1}`,
        message: adData.message,
        headline: adData.headline,
        description: adData.description,
        link: adData.link,
        call_to_action_type: adData.call_to_action_type,
        status: "PAUSED",
      };

      // Add asset data - handle different structures
      if (asset.type === "video") {
        // Video asset
        ad.video_id = asset.data?.uploadVideo || asset.video_id;
        if (asset.data?.getImageHash) {
          ad.thumbnailHash = asset.data.getImageHash;
        }
      } else if (asset.type === "image") {
        // Image asset - try different possible locations
        ad.imageHash = asset.imageHash || asset.data?.imageHash || asset.hash;
      }

      // Validate the ad has required asset
      if (!ad.imageHash && !ad.video_id) {
        console.error(`Ad ${i} missing asset data:`, asset);
        throw new Error(`Creative ${i + 1} is missing image or video data`);
      }

      console.log(`Ad ${i} prepared:`, ad);
      ads.push(ad);
    });

    console.log("Prepared ads for bulk upload:", JSON.stringify(ads, null, 2));

    if (ads.length === 0) {
      throw new Error("No ads were prepared. Check asset data.");
    }

    // Call batch API
    const response = await fetch("/api/batch/create-ads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        adset_id: adData.adset_id,
        page_id: adData.page_id,
        ads: ads,
      }),
    });

    const data = await response.json();

    // Check if response was successful
    if (!response.ok) {
      throw new Error(data.error || data.message || `API returned ${response.status}`);
    }

    // Validate response structure
    if (!data.stats) {
      throw new Error("Invalid API response: missing stats");
    }

    // Update progress
    const fillBar = progressItem.querySelector(".account-progress-fill");
    const detailsText = progressItem.querySelector(".account-progress-details");

    fillBar.style.width = "100%";

    if (data.stats.failed === 0) {
      statusSpan.textContent = "Success";
      statusSpan.className = "account-progress-status success";
      detailsText.textContent = `✓ ${data.stats.succeeded} ads created successfully`;
    } else {
      statusSpan.textContent = "Partial";
      statusSpan.className = "account-progress-status failed";
      detailsText.textContent = `${data.stats.succeeded} succeeded, ${data.stats.failed} failed`;

      // Show errors
      const errorDiv = document.createElement("div");
      errorDiv.className = "account-error-message";
      errorDiv.textContent = `Some ads failed. Check console for details.`;
      progressItem.appendChild(errorDiv);
    }

    return {
      account: account,
      success: data.stats.failed === 0,
      succeeded: data.stats.succeeded,
      failed: data.stats.failed,
      total: creativesCount,
      data: data,
    };
  } catch (error) {
    console.error(`Error processing account ${accountId}:`, error);

    statusSpan.textContent = "Failed";
    statusSpan.className = "account-progress-status failed";

    const errorDiv = document.createElement("div");
    errorDiv.className = "account-error-message";
    errorDiv.textContent = error.message;
    progressItem.appendChild(errorDiv);

    return {
      account: account,
      success: false,
      succeeded: 0,
      failed: creativesCount,
      total: creativesCount,
      error: error.message,
    };
  }
}

// Update overall progress
function updateOverallProgress(completed, total) {
  const progressFill = document.querySelector(".overall-progress .progress-fill");
  const progressText = document.querySelector(".overall-progress .progress-text");

  const percentage = Math.round((completed / total) * 100);

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
    progressFill.textContent = `${percentage}%`;
  }

  if (progressText) {
    progressText.textContent = `${completed} of ${total} accounts completed`;
  }
}

// Show bulk results
function showBulkResults(results) {
  showBulkStep(3);

  let totalAds = 0;
  let totalFailed = 0;
  const accountCount = results.length;

  results.forEach((result) => {
    totalAds += result.succeeded;
    totalFailed += result.failed;
  });

  // Update summary stats
  const successStat = document.querySelector(".result-stat.success .stat-number");
  const failedStat = document.querySelector(".result-stat.failed .stat-number");
  const accountsStat = document.querySelector(".result-stat.accounts .stat-number");

  if (successStat) successStat.textContent = totalAds;
  if (failedStat) failedStat.textContent = totalFailed;
  if (accountsStat) accountsStat.textContent = accountCount;

  // Populate results list
  const resultsList = document.querySelector(".results-list");
  if (resultsList) {
    resultsList.innerHTML = "";

    results.forEach((result) => {
      const item = document.createElement("div");
      item.className = "result-item";

      const statusClass = result.failed === 0 ? "success" : result.succeeded > 0 ? "partial" : "failed";
      const statusText = result.failed === 0 ? "Success" : result.succeeded > 0 ? "Partial Success" : "Failed";

      item.innerHTML = `
        <div class="result-item-header">
          <span class="result-account-name">${result.account.name}</span>
          <span class="result-status ${statusClass}">${statusText}</span>
        </div>
        <div class="result-stats">
          <div class="result-stat-item">
            <strong>${result.succeeded}</strong> <span>Created</span>
          </div>
          <div class="result-stat-item">
            <strong>${result.failed}</strong> <span>Failed</span>
          </div>
          <div class="result-stat-item">
            <strong>${result.total}</strong> <span>Total</span>
          </div>
        </div>
        ${
          result.error
            ? `<div class="result-errors">
          <div class="result-errors-title">Error:</div>
          <div>${result.error}</div>
        </div>`
            : ""
        }
      `;

      resultsList.appendChild(item);
    });
  }
}

// ============================================
// BUDGET TYPE DROPDOWN FUNCTIONALITY
// ============================================

function setupBudgetTypeDropdown() {
  // Set default start datetime to now
  const startDateInput = document.querySelector(".config-start-datetime");
  if (startDateInput) {
    const now = new Date();
    // Format to YYYY-MM-DDTHH:MM for datetime-local input
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    startDateInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  const budgetTypeOptions = document.querySelectorAll(".dropdown-options.adset-budget-type li");

  budgetTypeOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const budgetType = option.dataset.value;
      const budgetWrapper = document.querySelector(".budget-schedule-section .budget-input-wrapper");
      const budgetInput = document.querySelector(".config-adset-budget");
      const budgetSuffix = document.querySelector(".budget-type-suffix");
      const endDateLabel = document.querySelector(".end-date-required-indicator");
      const endDateOptional = document.querySelector(".end-date-optional-indicator");
      const endDateInput = document.querySelector(".config-end-datetime");

      if (budgetWrapper && budgetInput && budgetSuffix) {
        // Show budget input
        budgetWrapper.style.display = "flex";

        // Update placeholder and suffix based on budget type
        if (budgetType === "daily") {
          budgetInput.placeholder = "Enter daily budget (e.g., 50 for $50/day)";
          budgetSuffix.textContent = "/day";

          // End date is optional for daily budget
          if (endDateLabel) endDateLabel.style.display = "none";
          if (endDateOptional) endDateOptional.style.display = "inline";
          if (endDateInput) endDateInput.required = false;
        } else if (budgetType === "lifetime") {
          budgetInput.placeholder = "Enter lifetime budget (e.g., 1000 for $1000)";
          budgetSuffix.textContent = " total";

          // End date is required for lifetime budget
          if (endDateLabel) endDateLabel.style.display = "inline";
          if (endDateOptional) endDateOptional.style.display = "none";
          if (endDateInput) endDateInput.required = true;
        }
      }
    });
  });
}

// Initialize bulk upload on page load
document.addEventListener("DOMContentLoaded", () => {
  initBulkUploadButton();
  setupBulkUploadListeners();
  setupAdScheduling();
  setupBudgetTypeDropdown();
});

// ============================================
// AD SCHEDULING FUNCTIONALITY
// ============================================

let scheduleCounter = 0;

function setupAdScheduling() {
  const enableSchedulingCheckbox = document.querySelector(".enable-scheduling-checkbox");
  const schedulingControls = document.querySelector(".scheduling-controls");
  const addScheduleBtn = document.querySelector(".add-schedule-btn");

  // Toggle scheduling controls
  if (enableSchedulingCheckbox) {
    enableSchedulingCheckbox.addEventListener("change", (e) => {
      if (schedulingControls) {
        schedulingControls.style.display = e.target.checked ? "block" : "none";

        // If enabling and no schedules exist, add one
        if (e.target.checked && document.querySelectorAll(".schedule-list .schedule-item").length === 0) {
          addScheduleItem();
        }
      }
    });
  }

  // Add schedule button
  if (addScheduleBtn) {
    addScheduleBtn.addEventListener("click", () => {
      addScheduleItem();
    });
  }
}

function addScheduleItem() {
  scheduleCounter++;
  const scheduleList = document.querySelector(".schedule-list");
  const template = document.querySelector(".schedule-form-template");

  if (!scheduleList || !template) return;

  // Clone the template
  const scheduleItem = template.querySelector(".schedule-item").cloneNode(true);

  // Update schedule number
  const scheduleNumber = scheduleItem.querySelector(".schedule-number");
  if (scheduleNumber) {
    scheduleNumber.textContent = scheduleCounter;
  }

  // Set up remove button
  const removeBtn = scheduleItem.querySelector(".remove-schedule-btn");
  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      scheduleItem.remove();
    });
  }

  // Append to schedule list
  scheduleList.appendChild(scheduleItem);
}

function getAdScheduleData() {
  const enableSchedulingCheckbox = document.querySelector(".enable-scheduling-checkbox");

  // Return null if scheduling is not enabled
  if (!enableSchedulingCheckbox || !enableSchedulingCheckbox.checked) {
    return null;
  }

  const scheduleItems = document.querySelectorAll(".schedule-list .schedule-item");

  if (scheduleItems.length === 0) {
    return null;
  }

  const schedules = [];

  scheduleItems.forEach((item) => {
    const startTime = item.querySelector(".schedule-start-time").value;
    const endTime = item.querySelector(".schedule-end-time").value;
    const timezoneType = item.querySelector(".schedule-timezone-type").value;

    // Get selected days
    const dayCheckboxes = item.querySelectorAll('.days-selector input[type="checkbox"]:checked');
    const days = Array.from(dayCheckboxes).map((cb) => parseInt(cb.value));

    // Validate time inputs
    if (!startTime || !endTime) {
      return; // Skip invalid schedules
    }

    // Convert time (HH:MM) to minutes since midnight
    const startMinute = timeToMinutes(startTime);
    const endMinute = timeToMinutes(endTime);

    // Only add if we have at least one day selected
    if (days.length > 0) {
      const schedule = {
        start_minute: startMinute,
        end_minute: endMinute,
        days: days,
      };

      // Add timezone_type if not default
      if (timezoneType && timezoneType !== "USER") {
        schedule.timezone_type = timezoneType;
      }

      schedules.push(schedule);
    }
  });

  return schedules.length > 0 ? schedules : null;
}

function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(":").map(Number);
  let totalMinutes = hours * 60 + (minutes || 0);

  // Round to nearest hour (multiple of 60) to meet Meta API requirements
  totalMinutes = Math.round(totalMinutes / 60) * 60;

  return totalMinutes;
}

function validateAdSchedule(schedules) {
  if (!schedules || schedules.length === 0) {
    return { valid: true };
  }

  for (let i = 0; i < schedules.length; i++) {
    const schedule = schedules[i];

    // Check duration (minimum 1 hour = 60 minutes)
    const duration = schedule.end_minute - schedule.start_minute;
    if (duration < 60) {
      return {
        valid: false,
        error: `Schedule #${i + 1}: Start and end time must be at least 1 hour apart`,
      };
    }

    // Check if days are selected
    if (!schedule.days || schedule.days.length === 0) {
      return {
        valid: false,
        error: `Schedule #${i + 1}: Please select at least one day`,
      };
    }
  }

  return { valid: true };
}

// ========================================
// Automated Rules Manager
// ========================================

class AutomatedRulesManager {
  constructor() {
    this.rulesModal = document.querySelector(".automated-rules-modal");
    this.editorModal = document.querySelector(".rule-editor-modal");
    this.accountSelectorModal = document.querySelector(".account-selector-modal");
    this.batchProgressModal = document.querySelector(".batch-progress-modal");
    this.batchResultsModal = document.querySelector(".batch-results-modal");
    this.currentAccountId = null;
    this.currentRuleId = null;
    this.conditions = [];
    this.selectedAccounts = []; // For multi-account creation
    this.isMultiAccountMode = false;
    this.allAdAccounts = []; // Store all available accounts
    this.ruleToDuplicate = null;

    this.init();
  }

  init() {
    // Create the duplicate choice modal dynamically and append to body
    const choiceModal = document.createElement("div");
    choiceModal.className = "modal dialog duplicate-choice-modal"; // Match other dialogs
    choiceModal.style.display = "none";
    choiceModal.innerHTML = `
      <div class="dialog-content" style="max-width: 400px;">
        <div class="dialog-header">
          <h2>Duplicate Rule</h2>
          <button type="button" class="dialog-close-btn">&times;</button>
        </div>
        <div class="dialog-body" style="padding: 24px;">
          <p style="text-align: center; margin-bottom: 24px;">Where would you like to duplicate this rule?</p>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button class="btn btn-primary duplicate-same-account">In This Ad Account</button>
            <button class="btn btn-secondary duplicate-other-accounts">To Other Ad Accounts</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(choiceModal);
    this.choiceModal = choiceModal;

    // --- Duplicate Choice Modal Logic ---
    const closeChoiceModal = () => {
      this.choiceModal.style.display = "none";
      this.ruleToDuplicate = null;
    };

    this.choiceModal.addEventListener("click", (e) => {
      if (e.target === this.choiceModal) {
        closeChoiceModal();
      }
    });
    this.choiceModal.querySelector(".dialog-close-btn").addEventListener("click", closeChoiceModal);

    this.choiceModal.querySelector(".duplicate-same-account").addEventListener("click", () => {
      if (this.ruleToDuplicate) {
        this.openEditor(this.ruleToDuplicate.id, this.ruleToDuplicate.meta_rule_id, true);
      }
      closeChoiceModal();
    });

    this.choiceModal.querySelector(".duplicate-other-accounts").addEventListener("click", () => {
      if (this.ruleToDuplicate) {
        // Don't call closeChoiceModal() here - it will clear ruleToDuplicate
        // Just hide the modal but keep ruleToDuplicate for later use
        this.choiceModal.style.display = "none";
        this.openAccountSelector();
      }
    });

    // Bind modal close buttons
    this.rulesModal.querySelectorAll(".modal-close-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.closeModal());
    });

    this.editorModal.querySelectorAll(".modal-close-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.closeEditor());
    });

    // Click outside to close
    this.rulesModal.addEventListener("click", (e) => {
      if (e.target === this.rulesModal) this.closeModal();
    });

    this.editorModal.addEventListener("click", (e) => {
      if (e.target === this.editorModal) this.closeEditor();
    });

    // Create rule button (single account)
    this.rulesModal.querySelector(".create-rule-btn").addEventListener("click", () => {
      if (!this.currentAccountId) {
        showError("Please select an ad account first");
        return;
      }
      this.isMultiAccountMode = false;
      this.selectedAccounts = [];
      this.ruleToDuplicate = null; // Ensure this is cleared for normal flow
      this.openEditor();
    });

    // Create multi-account rule button
    const multiRuleBtn = this.rulesModal.querySelector(".create-multi-rule-btn");
    if (multiRuleBtn) {
      multiRuleBtn.addEventListener("click", () => {
        this.ruleToDuplicate = null; // Ensure this is cleared for normal flow
        this.openAccountSelector();
      });
    } else {
      console.error("Multi-account rule button not found");
    }

    // Account dropdown change
    this.rulesModal.querySelector(".rules-account-dropdown").addEventListener("change", (e) => {
      this.currentAccountId = e.target.value;
      // Don't auto-load, user must click "Load Rules" button
    });

    // Load Rules button
    this.rulesModal.querySelector(".load-rules-btn").addEventListener("click", () => {
      if (!this.currentAccountId) {
        showError("Please select an ad account first");
        return;
      }
      this.loadRules(this.currentAccountId);
    });

    // Editor form controls
    this.setupEditorControls();

    // Account Selector Modal controls
    this.setupAccountSelectorControls();

    // Load ad accounts
    this.loadAdAccounts();
  }

  setupEditorControls() {
    // Add condition button
    this.editorModal.querySelector(".add-condition-btn").addEventListener("click", () => {
      this.addCondition();
    });

    // Entity type change - update available actions
    const entityTypeSelect = this.editorModal.querySelector("#rule-entity-type");
    entityTypeSelect.addEventListener("change", (e) => {
      this.updateAvailableActions(e.target.value);
    });

    // Action type change
    const actionSelect = this.editorModal.querySelector("#rule-action-type");
    actionSelect.addEventListener("change", (e) => {
      const budgetOptions = this.editorModal.querySelector(".budget-change-options");
      const bidOptions = this.editorModal.querySelector(".bid-change-options");
      budgetOptions.style.display = e.target.value === "CHANGE_BUDGET" ? "block" : "none";
      bidOptions.style.display = e.target.value === "CHANGE_BID" ? "block" : "none";
      this.updateJSONPreview();
    });

    // Schedule frequency change
    const scheduleSelect = this.editorModal.querySelector("#rule-schedule-frequency");
    scheduleSelect.addEventListener("change", (e) => {
      const customOptions = this.editorModal.querySelector(".custom-schedule-options");
      customOptions.style.display = e.target.value === "CUSTOM" ? "block" : "none";
      this.updateJSONPreview();
    });

    // Form field changes update JSON preview
    const formInputs = this.editorModal.querySelectorAll("input, select");
    formInputs.forEach((input) => {
      input.addEventListener("change", () => this.updateJSONPreview());
      input.addEventListener("input", () => this.updateJSONPreview());
    });

    // Save button
    this.editorModal.querySelector(".save-rule-btn").addEventListener("click", () => {
      this.saveRule();
    });

    // Cancel button
    this.editorModal.querySelector(".cancel-rule-btn").addEventListener("click", () => {
      this.closeEditor();
    });
  }

  updateAvailableActions(entityType) {
    const actionSelect = this.editorModal.querySelector("#rule-action-type");
    const currentValue = actionSelect.value;

    // Clear and rebuild options based on entity type
    actionSelect.innerHTML = '<option value="">Select action...</option>';

    // Always available actions
    actionSelect.innerHTML += '<option value="PAUSE">Turn off (Pause)</option>';
    actionSelect.innerHTML += '<option value="UNPAUSE">Turn on (Unpause)</option>';
    actionSelect.innerHTML += '<option value="SEND_NOTIFICATION">Send notification only</option>';

    // Conditional actions based on entity type
    // Adjust budget: NOT available for Ads
    if (entityType !== "AD") {
      actionSelect.innerHTML += '<option value="CHANGE_BUDGET">Adjust budget</option>';
    }

    // Adjust manual bid: Only available for Ad Sets
    if (entityType === "ADSET") {
      actionSelect.innerHTML += '<option value="CHANGE_BID">Adjust manual bid</option>';
    }

    // Try to restore previous selection if still valid
    const newOptions = Array.from(actionSelect.options).map((opt) => opt.value);
    if (newOptions.includes(currentValue)) {
      actionSelect.value = currentValue;
    } else {
      actionSelect.value = "";
      // Hide option panels if selection was reset
      this.editorModal.querySelector(".budget-change-options").style.display = "none";
      this.editorModal.querySelector(".bid-change-options").style.display = "none";
    }

    this.updateJSONPreview();
  }

  async loadAdAccounts() {
    try {
      const accountsList = document.getElementById("ad-acc-list");
      const accounts = Array.from(accountsList.querySelectorAll("li")).map((li) => {
        const accountLink = li.querySelector("a.account");
        return {
          id: accountLink?.dataset.campaignId || accountLink?.getAttribute("data-campaign-id"),
          name: accountLink?.textContent?.trim() || li.textContent.trim(),
        };
      });

      const dropdown = this.rulesModal.querySelector(".rules-account-dropdown");
      dropdown.innerHTML = '<option value="">Select an account...</option>';

      accounts.forEach((account) => {
        if (account.id) {
          const option = document.createElement("option");
          option.value = account.id;
          option.textContent = account.name;
          dropdown.appendChild(option);
        }
      });
    } catch (error) {
      console.error("Error loading ad accounts:", error);
    }
  }

  // DOM to load Ad Rule Subscriber
  // Skip ad rule subscriber for now
  async loadUsers() {
    try {
      const subscriberDropdown = this.editorModal.querySelector("#rule-subscribers");

      // If subscriber dropdown doesn't exist (commented out in HTML), skip loading users
      if (!subscriberDropdown) {
        console.info("Subscriber dropdown not found in modal, skipping user load");
        return;
      }

      // Reset dropdown
      subscriberDropdown.innerHTML = '<option value="">Select subscriber (optional)...</option>';

      // First, try to get users from cached ad account data
      let users = [];
      if (window.adAccountsData && window.adAccountsData.length > 0) {
        const account = window.adAccountsData.find((acc) => acc.id === this.currentAccountId || acc.account_id === this.currentAccountId || acc.id === `act_${this.currentAccountId}`);

        if (account && account.users && account.users.length > 0) {
          users = account.users;
          console.info("Using cached users from ad account data:", users.length);
        }
      }

      // If no cached users, try to fetch from API
      if (users.length === 0) {
        try {
          const response = await fetch(`/api/account/${this.currentAccountId}/users`);
          if (response.ok) {
            const data = await response.json();
            users = data.users || [];
          }
        } catch (fetchError) {
          console.warn("Could not fetch users from API:", fetchError);
        }
      }

      // Populate with users
      if (users.length > 0) {
        users.forEach((user) => {
          const option = document.createElement("option");
          option.value = user.id || user.user_id;
          option.textContent = user.name + (user.email ? ` (${user.email})` : "");
          subscriberDropdown.appendChild(option);
        });
      } else {
        // If no users available, show a note but don't prevent rule creation
        subscriberDropdown.innerHTML = '<option value="">No users found (optional)</option>';
        console.info("No users found for account:", this.currentAccountId);
      }
    } catch (error) {
      console.error("Error loading subscribers:", error);
      const subscriberDropdown = this.editorModal.querySelector("#rule-subscribers");
      if (subscriberDropdown) {
        subscriberDropdown.innerHTML = '<option value="">Error loading users (optional)</option>';
      }
    }
  }

  async loadRules(accountId) {
    try {
      const response = await fetch(`/api/rules?account_id=${accountId}`);

      if (!response.ok) {
        throw new Error("Failed to load rules");
      }

      const data = await response.json();
      this.cachedRules = data.rules; // Cache rules for edit function
      this.renderRulesList(data.rules);
    } catch (error) {
      console.error("Error loading rules:", error);
      showError("Failed to load automated rules");
    }
  }

  renderRulesList(rules) {
    const tbody = this.rulesModal.querySelector(".rules-list");

    if (!rules || rules.length === 0) {
      tbody.innerHTML = '<tr class="empty-state"><td colspan="5">No rules found. Create a rule to get started.</td></tr>';
      return;
    }

    tbody.innerHTML = rules
      .map((rule) => {
        const scheduleText = this.getScheduleText(rule.schedule_spec);
        const statusBadge = rule.status === "ACTIVE" ? '<span class="status-badge status-active">Active</span>' : '<span class="status-badge status-paused">Paused</span>';

        return `
        <tr data-rule-id="${rule.id}" data-meta-rule-id="${rule.meta_rule_id}">
          <td>${rule.name}</td>
          <td>${rule.entity_type}</td>
          <td>${statusBadge}</td>
          <td>${scheduleText}</td>
          <td class="rule-actions">
            <button class="btn-icon toggle-rule-btn" title="${rule.status === "ACTIVE" ? "Disable" : "Enable"}" data-rule-id="${rule.id}" data-meta-rule-id="${rule.meta_rule_id}" data-status="${rule.status}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${
                  rule.status === "ACTIVE"
                    ? '<path d="M18 6L6 18M6 6l12 12"></path>' // X icon for disable
                    : '<path d="M5 12l5 5 9-9"></path>'
                }  // Check icon for enable
              </svg>
            </button>
            <button class="btn-icon duplicate-rule-btn" title="Duplicate" data-rule-id="${rule.id}" data-meta-rule-id="${rule.meta_rule_id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="btn-icon edit-rule-btn" title="Edit" data-rule-id="${rule.id}" data-meta-rule-id="${rule.meta_rule_id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="btn-icon delete-rule-btn" title="Delete" data-rule-id="${rule.id}" data-meta-rule-id="${rule.meta_rule_id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </td>
        </tr>
      `;
      })
      .join("");

    // Bind action buttons
    tbody.querySelectorAll(".toggle-rule-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.toggleRuleStatus(btn.dataset.ruleId, btn.dataset.metaRuleId, btn.dataset.status));
    });

    tbody.querySelectorAll(".duplicate-rule-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.duplicateRule(btn.dataset.ruleId, btn.dataset.metaRuleId));
    });

    tbody.querySelectorAll(".edit-rule-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.editRule(btn.dataset.ruleId, btn.dataset.metaRuleId));
    });

    tbody.querySelectorAll(".delete-rule-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteRule(btn.dataset.ruleId, btn.dataset.metaRuleId));
    });
  }

  getScheduleText(scheduleSpec) {
    if (!scheduleSpec) return "Trigger";

    const scheduleType = scheduleSpec.schedule_type || scheduleSpec.scheduleType;

    if (scheduleType === "HOURLY") return "Continuously (Run every ~60 minutes)";
    if (scheduleType === "SEMI_HOURLY") return "Continuously (Run every 30-60 minutes)";
    if (scheduleType === "DAILY") return "Daily (12:00 AM)";
    if (scheduleType === "CUSTOM") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      // Meta API returns nested schedule array format
      const schedule = scheduleSpec.schedule?.[0] || scheduleSpec;
      const daysList = schedule.days || [];
      const dayNames = daysList.map((d) => days[d]).join(", ");
      return `Custom: ${dayNames}`;
    }

    return scheduleType || "Unknown";
  }

  openModal() {
    this.rulesModal.style.display = "block";
    this.loadAdAccounts();
  }

  closeModal() {
    this.rulesModal.style.display = "none";
  }

  async duplicateRule(ruleId, metaRuleId) {
    const ruleData = this.cachedRules.find((r) => (ruleId && r.id == ruleId) || (metaRuleId && r.meta_rule_id === metaRuleId));
    if (!ruleData) {
      showError("Could not find the rule to duplicate.");
      return;
    }
    this.ruleToDuplicate = ruleData;
    this.choiceModal.style.display = "flex";
  }

  async editRule(ruleId, metaRuleId) {
    this.openEditor(ruleId, metaRuleId, false); // Pass false for isDuplicate
  }

  async openEditor(ruleId = null, metaRuleId = null, isDuplicate = false) {
    this.currentRuleId = isDuplicate ? null : ruleId; // Clear ID if duplicating
    this.currentMetaRuleId = metaRuleId;
    this.conditions = [];
    this.originalConditions = null; // Reset original conditions

    const title = this.editorModal.querySelector(".rule-editor-title");
    const saveBtn = this.editorModal.querySelector(".save-rule-btn");

    if (ruleId || metaRuleId) {
      // Load data for both edit and duplicate
      await this.loadRuleData(ruleId, metaRuleId);

      if (isDuplicate) {
        title.textContent = "Duplicate Automated Rule";
        saveBtn.textContent = "Create Duplicate";
        const nameInput = this.editorModal.querySelector("#rule-name");
        nameInput.value = `[Copy] ${nameInput.value}`;
      } else {
        title.textContent = "Edit Automated Rule";
        saveBtn.textContent = "Update Rule";
      }
    } else {
      // Standard create flow
      title.textContent = "Create Automated Rule";
      saveBtn.textContent = "Create Rule";
      this.resetForm();
      this.addCondition(); // Add one default condition
    }

    // Load subscribers for the selected account
    if (this.currentAccountId) {
      await this.loadUsers();
    }

    this.editorModal.style.display = "block";
    this.updateJSONPreview();
  }

  closeEditor() {
    this.editorModal.style.display = "none";
    this.currentRuleId = null;
  }

  resetForm() {
    this.editorModal.querySelector("#rule-name").value = "";
    this.editorModal.querySelector('input[name="rule-type"][value="SCHEDULE"]').checked = true;
    this.editorModal.querySelector("#rule-entity-type").value = "";
    this.editorModal.querySelector("#rule-action-type").value = "";
    this.editorModal.querySelector("#rule-schedule-frequency").value = "CONTINUOUSLY";
    this.editorModal.querySelector(".budget-change-options").style.display = "none";
    this.editorModal.querySelector(".custom-schedule-options").style.display = "none";
    this.editorModal.querySelector(".conditions-container").innerHTML = "";
    this.conditions = [];
  }

  addCondition() {
    // This function now only handles adding a NEW, blank condition
    const newCondition = { field: "", operator: "GREATER_THAN", value: 0 };
    this.conditions.push(newCondition);
    this._renderConditionRow(this.conditions.length - 1);
  }

  _renderConditionRow(index) {
    // This new private method handles rendering the UI for a condition at a given index
    const condition = this.conditions[index];
    if (!condition) return;

    // DEBUG: Log when this function is called
    console.log(`[DEBUG] _renderConditionRow called for index: ${index}`);

    const conditionHTML = `
      <div class="condition-row" data-condition-index="${index}">
        <select class="form-select condition-field" data-index="${index}">
          <option value="">Select metric...</option>
          <optgroup label="Cost & Budget">
            <option value="spent">Spent ($)</option>
            <option value="cpc">Cost Per Click ($)</option>
            <option value="cpm">Cost Per 1,000 Impressions ($)</option>
            <option value="cpp">Cost Per Purchase ($)</option>
            <option value="cost_per_unique_click">Cost Per Unique Click ($)</option>
          </optgroup>
          <optgroup label="ROAS">
            <option value="website_purchase_roas">Website Purchase ROAS</option>
            <option value="mobile_app_purchase_roas">In-App Purchase ROAS</option>
          </optgroup>
          <optgroup label="Traffic & Engagement">
            <option value="impressions">Impressions</option>
            <option value="unique_impressions">Unique Impressions</option>
            <option value="reach">Reach</option>
            <option value="clicks">Clicks</option>
            <option value="unique_clicks">Unique Clicks</option>
            <option value="ctr">Click-Through Rate (%)</option>
            <option value="frequency">Frequency</option>
          </optgroup>
          <optgroup label="Conversions & Results">
            <option value="result_rate">Result Rate (%)</option>
          </optgroup>
        </select>

        <select class="form-select condition-operator" data-index="${index}">
          <option value="GREATER_THAN">is greater than (>)</option>
          <option value="LESS_THAN">is less than (<)</option>
          <option value="EQUAL">is equal to (=)</option>
          <option value="IN_RANGE">is in range</option>
          <option value="NOT_IN_RANGE">is not in range</option>
        </select>

        <div class="condition-value-container" data-index="${index}">
          <input type="number" class="form-input condition-value condition-single-value" placeholder="Value" step="0.01" data-index="${index}" />
          <input type="number" class="form-input condition-value condition-min-value" placeholder="Min" step="0.01" data-index="${index}" style="display: none;" />
          <input type="number" class="form-input condition-value condition-max-value" placeholder="Max" step="0.01" data-index="${index}" style="display: none;" />
        </div>

        <button type="button" class="btn-icon remove-condition-btn" data-index="${index}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    const container = this.editorModal.querySelector(".conditions-container");
    container.insertAdjacentHTML("beforeend", conditionHTML);

    // Bind remove button
    const row = container.querySelector(`[data-condition-index="${index}"]`);
    const removeBtn = row.querySelector(".remove-condition-btn");
    removeBtn.addEventListener("click", () => this.removeCondition(index));

    // Bind change events
    const field = row.querySelector(".condition-field");
    const operator = row.querySelector(".condition-operator");
    const singleValue = row.querySelector(".condition-single-value");
    const minValue = row.querySelector(".condition-min-value");
    const maxValue = row.querySelector(".condition-max-value");

    // Pre-populate values from the condition data
    field.value = condition.field;
    operator.value = condition.operator;

    const isRangeOperator = condition.operator === "IN_RANGE" || condition.operator === "NOT_IN_RANGE";
    if (isRangeOperator && Array.isArray(condition.value)) {
      singleValue.style.display = "none";
      minValue.style.display = "block";
      maxValue.style.display = "block";
      minValue.value = condition.value[0] || 0;
      maxValue.value = condition.value[1] || 0;
    } else {
      singleValue.style.display = "block";
      minValue.style.display = "none";
      maxValue.style.display = "none";
      singleValue.value = condition.value;
    }

    // Add event listeners for changes
    field.addEventListener("change", (e) => {
      this.conditions[index].field = e.target.value;
      this.updateJSONPreview();
    });

    operator.addEventListener("change", (e) => {
      this.conditions[index].operator = e.target.value;
      const isRange = e.target.value === "IN_RANGE" || e.target.value === "NOT_IN_RANGE";
      if (isRange) {
        singleValue.style.display = "none";
        minValue.style.display = "block";
        maxValue.style.display = "block";
        if (!Array.isArray(this.conditions[index].value)) {
          this.conditions[index].value = [0, 0];
        }
      } else {
        singleValue.style.display = "block";
        minValue.style.display = "none";
        maxValue.style.display = "none";
        if (Array.isArray(this.conditions[index].value)) {
          this.conditions[index].value = 0;
        }
      }
      this.updateJSONPreview();
    });

    singleValue.addEventListener("input", (e) => {
      this.conditions[index].value = parseFloat(e.target.value) || 0;
      this.updateJSONPreview();
    });

    minValue.addEventListener("input", (e) => {
      const minVal = parseFloat(e.target.value) || 0;
      if (!Array.isArray(this.conditions[index].value)) {
        this.conditions[index].value = [minVal, 0];
      } else {
        this.conditions[index].value[0] = minVal;
      }
      this.updateJSONPreview();
    });

    maxValue.addEventListener("input", (e) => {
      const maxVal = parseFloat(e.target.value) || 0;
      if (!Array.isArray(this.conditions[index].value)) {
        this.conditions[index].value = [0, maxVal];
      } else {
        this.conditions[index].value[1] = maxVal;
      }
      this.updateJSONPreview();
    });
  }

  removeCondition(index) {
    const container = this.editorModal.querySelector(".conditions-container");
    const row = container.querySelector(`[data-condition-index="${index}"]`);
    if (row) {
      row.remove();
      this.conditions[index] = null; // Mark as deleted
      this.updateJSONPreview();
    }
  }

  updateJSONPreview() {
    // JSON preview is commented out in HTML, so skip this
    const preview = this.editorModal.querySelector(".json-preview code");
    if (preview) {
      const ruleData = this.collectFormData();
      preview.textContent = JSON.stringify(ruleData, null, 2);
    }
  }

  haveConditionsChanged() {
    // If no original conditions (new rule), conditions have changed
    if (!this.originalConditions) return true;

    // Filter current conditions (same logic as collectFormData)
    const currentConditions = this.conditions.filter((c) => {
      if (c === null || !c.field) return false;
      if (Array.isArray(c.value)) {
        return c.value.length === 2 && c.value[0] !== null && c.value[1] !== null;
      }
      return c.value !== null && c.value !== undefined && c.value !== "";
    });

    // Compare with original
    return JSON.stringify(currentConditions) !== JSON.stringify(this.originalConditions);
  }

  collectFormData() {
    const name = this.editorModal.querySelector("#rule-name").value;
    const ruleType = this.editorModal.querySelector('input[name="rule-type"]:checked').value;
    const entityType = this.editorModal.querySelector("#rule-entity-type").value;
    const actionType = this.editorModal.querySelector("#rule-action-type").value;
    const scheduleFrequency = this.editorModal.querySelector("#rule-schedule-frequency").value;
    const timeRange = this.editorModal.querySelector("#rule-time-range").value;

    // Collect conditions (filter out null/deleted ones)
    // Note: c.value can be 0, so check for null/undefined explicitly
    // For range operators, c.value is an array [min, max]
    const conditions = this.conditions.filter((c) => {
      if (c === null || !c.field) return false;

      // Handle array values for range operators
      if (Array.isArray(c.value)) {
        return c.value.length === 2 && c.value[0] !== null && c.value[1] !== null;
      }

      // Handle single values
      return c.value !== null && c.value !== undefined && c.value !== "";
    });

    // Build action object
    const action = { type: actionType };
    if (actionType === "CHANGE_BUDGET") {
      const budgetChangeType = this.editorModal.querySelector("#budget-change-type").value;
      action.budget_change_type = budgetChangeType.replace("_LIFETIME", ""); // INCREASE, DECREASE, SET
      action.budget_type = budgetChangeType.includes("LIFETIME") ? "lifetime_budget" : "daily_budget";
      // Map frontend unit to backend format (CURRENCY -> ACCOUNT_CURRENCY)
      const unitValue = this.editorModal.querySelector("#budget-unit").value;
      action.unit = unitValue === "CURRENCY" ? "ACCOUNT_CURRENCY" : unitValue;
      action.amount = parseFloat(this.editorModal.querySelector("#budget-amount").value) || 0;
    } else if (actionType === "CHANGE_BID") {
      action.bid_change_type = this.editorModal.querySelector("#bid-change-type").value;
      // Map frontend unit to backend format (CURRENCY -> ACCOUNT_CURRENCY)
      const unitValue = this.editorModal.querySelector("#bid-unit").value;
      action.unit = unitValue === "CURRENCY" ? "ACCOUNT_CURRENCY" : unitValue;
      action.amount = parseFloat(this.editorModal.querySelector("#bid-amount").value) || 0;
    }

    // Collect subscriber (now a dropdown, single selection)
    const subscriberDropdown = this.editorModal.querySelector("#rule-subscribers");
    const subscriberId = subscriberDropdown ? subscriberDropdown.value : "";
    const subscribers = subscriberId ? [subscriberId] : [];

    // Build schedule object
    const schedule = { frequency: scheduleFrequency };
    if (scheduleFrequency === "CUSTOM") {
      const dayCheckboxes = this.editorModal.querySelectorAll('.days-selector input[type="checkbox"]:checked');
      schedule.days = Array.from(dayCheckboxes).map((cb) => parseInt(cb.value));

      const startTime = this.editorModal.querySelector("#schedule-start-time").value;
      const endTime = this.editorModal.querySelector("#schedule-end-time").value;

      if (startTime) schedule.start_minute = timeToMinutes(startTime);
      if (endTime) schedule.end_minute = timeToMinutes(endTime);
    }

    const formData = {
      name,
      entity_type: entityType,
      rule_type: ruleType,
      time_preset: timeRange,
      conditions,
      action,
      schedule,
      subscribers,
    };

    // Only add ad_account_id for single account mode
    if (!this.isMultiAccountMode) {
      formData.ad_account_id = this.currentAccountId;
    }

    return formData;
  }

  async saveRule() {
    try {
      const ruleData = this.collectFormData();

      // Validation
      if (!ruleData.name) {
        showError("Please enter a rule name");
        return;
      }

      if (!ruleData.entity_type) {
        showError("Please select entity type");
        return;
      }

      if (ruleData.conditions.length === 0) {
        showError("Please add at least one condition");
        return;
      }

      if (!ruleData.action.type) {
        showError("Please select an action");
        return;
      }

      // Debug logging
      console.log("Save Rule - Multi-Account Mode:", this.isMultiAccountMode);
      console.log("Save Rule - Selected Accounts:", this.selectedAccounts);
      console.log("Save Rule - Selected Accounts Length:", this.selectedAccounts.length);

      // Check if multi-account mode
      if (this.isMultiAccountMode && this.selectedAccounts.length > 0) {
        console.log("Using multi-account save method");
        return await this.saveMultiAccountRule(ruleData);
      }

      // Single account mode validation
      if (!this.currentAccountId && !this.isMultiAccountMode) {
        showError("Please select an ad account first");
        return;
      }

      console.log("Using single-account save method for account:", this.currentAccountId);

      // CREATE logic (POST)

      // Validate against existing rule names + entity_type for the same account
      if (this.cachedRules && this.cachedRules.some((rule) => rule.name === ruleData.name && rule.entity_type === ruleData.entity_type)) {
        showError(`A rule with this name for the entity '${ruleData.entity_type}' already exists. Please choose a different name or entity type.`);
        return; // Stop execution
      }

      const url = "/api/rules";
      const method = "POST";

      // For UPDATE operations, only include conditions if they've changed
      let requestData = ruleData;
      if (this.currentRuleId && !this.haveConditionsChanged()) {
        // Remove conditions from request data if unchanged
        const { conditions, ...dataWithoutConditions } = ruleData;
        requestData = dataWithoutConditions;
        console.log("[UPDATE] Conditions unchanged, not sending to server");
      } else if (this.currentRuleId) {
        console.log("[UPDATE] Conditions changed, sending to server");
      }

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Failed to save rule");
      }

      const result = await response.json();
      showSuccess(this.currentRuleId ? "Rule updated successfully" : "Rule created successfully");

      this.closeEditor();
      this.loadRules(this.currentAccountId);
    } catch (error) {
      console.error("Error saving rule:", error);
      showError(error.message);
    }
  }

  async editRule(ruleId, metaRuleId) {
    this.openEditor(ruleId, metaRuleId);
  }

  async loadRuleData(ruleId, metaRuleId) {
    try {
      // DEBUG: Log the start of the function
      console.log(`[DEBUG] loadRuleData called for ruleId: ${ruleId}, metaRuleId: ${metaRuleId}`);

      // Try to get rule from cached rules first (more efficient)
      let rule = null;
      if (this.cachedRules) {
        rule = this.cachedRules.find((r) => (ruleId && r.id && r.id == ruleId) || (metaRuleId && r.meta_rule_id === metaRuleId));
      }

      // If not in cache, fetch from API (fallback)
      if (!rule) {
        // Use metaRuleId for API if available, otherwise use ruleId
        const apiId = metaRuleId || ruleId;
        const response = await fetch(`/api/rules/${apiId}`);

        if (!response.ok) {
          throw new Error("Failed to load rule");
        }

        const data = await response.json();
        rule = data.rule;
      }

      // Populate form
      this.editorModal.querySelector("#rule-name").value = rule.name;
      this.editorModal.querySelector(`input[name="rule-type"][value="${rule.rule_type}"]`).checked = true;
      this.editorModal.querySelector("#rule-entity-type").value = rule.entity_type;

      // Load conditions
      this.conditions = [];
      this.editorModal.querySelector(".conditions-container").innerHTML = "";

      const evalSpec = rule.evaluation_spec;
      if (evalSpec && evalSpec.filters) {
        // Filter out internal metadata filters:
        // - id, entity_type, time_preset, effective_status (standard metadata)
        // - Fields containing "budget_reset_period" (auto-added for CHANGE_BUDGET actions)
        const conditionFilters = evalSpec.filters.filter((f) => {
          const isMetadataField = ["id", "entity_type", "time_preset", "effective_status"].includes(f.field);
          const isBudgetResetPeriod = f.field && f.field.includes("budget_reset_period");
          return !isMetadataField && !isBudgetResetPeriod;
        });

        // DEBUG: Log the conditions that were found
        console.log(`[DEBUG] Found ${conditionFilters.length} user conditions to load (filtered out metadata):`, JSON.stringify(conditionFilters));

        if (conditionFilters.length > 0) {
          conditionFilters.forEach((filter) => {
            // Directly push the real data
            this.conditions.push({
              field: filter.field,
              operator: filter.operator,
              value: filter.value,
            });
            // Render the row for the condition we just added
            this._renderConditionRow(this.conditions.length - 1);
          });
        }
      }

      // Store original conditions for change detection (deep copy)
      this.originalConditions = JSON.parse(JSON.stringify(this.conditions));

      // Load action
      const execSpec = rule.execution_spec;
      if (execSpec) {
        // Map execution_type to dropdown values
        const actionTypeMap = {
          CHANGE_CAMPAIGN_BUDGET: "CHANGE_BUDGET",
          CHANGE_BUDGET: "CHANGE_BUDGET",
          CHANGE_BID: "CHANGE_BID",
          PAUSE: "PAUSE",
          UNPAUSE: "UNPAUSE",
          SEND_NOTIFICATION: "SEND_NOTIFICATION",
        };
        const mappedActionType = actionTypeMap[execSpec.execution_type] || execSpec.execution_type;
        this.editorModal.querySelector("#rule-action-type").value = mappedActionType;

        // Handle CHANGE_BUDGET or CHANGE_CAMPAIGN_BUDGET
        if (execSpec.execution_type === "CHANGE_BUDGET" || execSpec.execution_type === "CHANGE_CAMPAIGN_BUDGET") {
          this.editorModal.querySelector(".budget-change-options").style.display = "block";

          let changeSpec = null;
          // Check execution_options first (SCHEDULE rules), then change_spec (TRIGGER rules)
          if (execSpec.execution_options && execSpec.execution_options.length > 0) {
            changeSpec = execSpec.execution_options[0].value;
          } else if (execSpec.change_spec) {
            changeSpec = execSpec.change_spec;
          }

          if (changeSpec) {
            // Determine change type from amount sign
            const changeType = changeSpec.amount < 0 ? "DECREASE" : "INCREASE";
            this.editorModal.querySelector("#budget-change-type").value = changeType;
            // Map backend unit to frontend dropdown value
            const unitMap = { ACCOUNT_CURRENCY: "CURRENCY", PERCENTAGE: "PERCENTAGE" };
            this.editorModal.querySelector("#budget-unit").value = unitMap[changeSpec.unit] || "CURRENCY";
            // Convert amount to absolute value and handle currency conversion
            const absoluteAmount = Math.abs(changeSpec.amount);
            const displayAmount = changeSpec.unit === "ACCOUNT_CURRENCY" ? absoluteAmount / 100 : absoluteAmount;
            this.editorModal.querySelector("#budget-amount").value = displayAmount;
          }
        }

        // Handle CHANGE_BID
        if (execSpec.execution_type === "CHANGE_BID") {
          this.editorModal.querySelector(".bid-change-options").style.display = "block";

          let changeSpec = null;
          if (execSpec.execution_options && execSpec.execution_options.length > 0) {
            changeSpec = execSpec.execution_options[0].value;
          } else if (execSpec.change_spec) {
            changeSpec = execSpec.change_spec;
          }

          if (changeSpec) {
            const changeType = changeSpec.amount < 0 ? "DECREASE" : "INCREASE";
            this.editorModal.querySelector("#bid-change-type").value = changeType;
            // Map backend unit to frontend dropdown value
            const unitMap = { ACCOUNT_CURRENCY: "CURRENCY", PERCENTAGE: "PERCENTAGE" };
            this.editorModal.querySelector("#bid-unit").value = unitMap[changeSpec.unit] || "CURRENCY";
            const absoluteAmount = Math.abs(changeSpec.amount);
            const displayAmount = changeSpec.unit === "ACCOUNT_CURRENCY" ? absoluteAmount / 100 : absoluteAmount;
            this.editorModal.querySelector("#bid-amount").value = displayAmount;
          }
        }
      }

      // Load schedule
      const scheduleSpec = rule.schedule_spec;
      if (scheduleSpec) {
        const freq = scheduleSpec.schedule_type === "SEMI_HOURLY" ? "CONTINUOUSLY" : scheduleSpec.schedule_type === "DAILY" ? "DAILY" : "CUSTOM";
        this.editorModal.querySelector("#rule-schedule-frequency").value = freq;

        if (freq === "CUSTOM") {
          this.editorModal.querySelector(".custom-schedule-options").style.display = "block";

          // Meta API returns nested schedule array format
          const schedule = scheduleSpec.schedule?.[0] || scheduleSpec;

          // Set days
          if (schedule.days) {
            schedule.days.forEach((day) => {
              const checkbox = this.editorModal.querySelector(`.days-selector input[value="${day}"]`);
              if (checkbox) checkbox.checked = true;
            });
          }

          // Set times
          if (schedule.start_minute !== undefined) {
            const hours = Math.floor(schedule.start_minute / 60);
            const minutes = schedule.start_minute % 60;
            this.editorModal.querySelector("#schedule-start-time").value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
          }

          if (schedule.end_minute !== undefined) {
            const hours = Math.floor(schedule.end_minute / 60);
            const minutes = schedule.end_minute % 60;
            this.editorModal.querySelector("#schedule-end-time").value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
          }
        }
      }

      // Load subscriber - wait for dropdown to be populated first
      if (rule.subscriber_id) {
        // Wait a bit for loadUsers to complete
        setTimeout(() => {
          const subscriberDropdown = this.editorModal.querySelector("#rule-subscribers");
          if (subscriberDropdown) {
            subscriberDropdown.value = rule.subscriber_id;
          }
        }, 500);
      }

      this.updateJSONPreview();
    } catch (error) {
      console.error("Error loading rule data:", error);
      showError("Failed to load rule data");
    }
  }

  async toggleRuleStatus(ruleId, metaRuleId, currentStatus) {
    const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const frontendStatus = newStatus;

    console.log("Toggle status clicked:", { ruleId, metaRuleId, currentStatus });

    // Convert to Meta API format for the backend
    const metaStatus = newStatus === "ACTIVE" ? "ENABLED" : "DISABLED";
    const action = metaStatus === "ENABLED" ? "enable" : "disable";

    try {
      console.log("Sending request to:", `/api/rules/${metaRuleId}/status`, { status: metaStatus, local_rule_id: ruleId });

      const response = await fetch(`/api/rules/${metaRuleId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: metaStatus, local_rule_id: ruleId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to ${action} rule`);
      }

      const data = await response.json();
      console.log("Toggle response:", data);

      showSuccess(`Rule ${frontendStatus === "ACTIVE" ? "enabled" : "disabled"} successfully`);

      // Reload rules to refresh UI
      // We'll optimistically update the UI for now, but a full reload is safer
      // To avoid race conditions, let's wait a bit before reloading
      setTimeout(async () => {
        if (this.currentAccountId) {
          console.log("Reloading rules for account:", this.currentAccountId);
          await this.loadRules(this.currentAccountId);
          console.log("Rules reloaded");
        } else {
          console.warn("No account ID available to reload rules");
        }
      }, 500);
    } catch (error) {
      console.error("Error toggling rule status:", error);
      showError(error.message || "Failed to toggle rule status");
    }
  }

  async deleteRule(ruleId, metaRuleId) {
    if (!confirm("Are you sure you want to delete this rule?")) {
      return;
    }

    try {
      const response = await fetch(`/api/rules/${metaRuleId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ local_rule_id: ruleId }),
      });

      if (!response.ok) {
        throw new Error("Failed to delete rule");
      }

      showSuccess("Rule deleted successfully");

      // Get account ID from dropdown if currentAccountId not set
      if (!this.currentAccountId) {
        this.currentAccountId = this.rulesModal.querySelector(".rules-account-dropdown").value;
      }

      if (this.currentAccountId) {
        await this.loadRules(this.currentAccountId);
      }
    } catch (error) {
      console.error("Error deleting rule:", error);
      showError("Failed to delete rule");
    }
  }

  // ===== Multi-Account Rule Creation Methods =====

  setupAccountSelectorControls() {
    // Skip setup if modals don't exist
    if (!this.accountSelectorModal || !this.batchProgressModal || !this.batchResultsModal) {
      console.warn("Skipping account selector controls setup - modals not found");
      return;
    }

    // Close button
    this.accountSelectorModal.querySelector(".modal-close-btn")?.addEventListener("click", () => {
      this.closeAccountSelector();
    });

    // Cancel button
    this.accountSelectorModal.querySelector(".cancel-account-selector")?.addEventListener("click", () => {
      this.closeAccountSelector();
    });

    // Next button - proceed to rule editor
    this.accountSelectorModal.querySelector(".next-to-rule-editor")?.addEventListener("click", () => {
      // Update selected accounts array before validation
      this.updateSelectedAccountsCount();

      // For creating a new multi-account rule, must select at least 2 accounts.
      // For duplicating, must select at least 1.
      if (!this.ruleToDuplicate && this.selectedAccounts.length < 2) {
        showError("Please select at least 2 accounts for multi-account rule creation");
        return;
      }
      if (this.ruleToDuplicate && this.selectedAccounts.length < 1) {
        showError("Please select at least 1 account to duplicate the rule to");
        return;
      }

      this.closeAccountSelector(false);
      this.isMultiAccountMode = true;

      if (this.ruleToDuplicate) {
        // If duplicating, open editor with pre-filled data in duplicate mode
        const ruleId = this.ruleToDuplicate.id;
        const metaRuleId = this.ruleToDuplicate.meta_rule_id;
        // Clear ruleToDuplicate after we saved the IDs
        this.ruleToDuplicate = null;
        this.openEditor(ruleId, metaRuleId, true);
      } else {
        // Otherwise, open a blank editor for a new multi-account rule
        this.openEditor();
      }
    });

    // Select All / Deselect All
    this.accountSelectorModal.querySelector(".select-all-accounts")?.addEventListener("click", () => {
      const checkboxes = this.accountSelectorModal.querySelectorAll(".account-checklist input[type='checkbox']");
      checkboxes.forEach((checkbox) => {
        checkbox.checked = true;
      });
      this.updateSelectedAccountsCount();
    });

    this.accountSelectorModal.querySelector(".deselect-all-accounts")?.addEventListener("click", () => {
      const checkboxes = this.accountSelectorModal.querySelectorAll(".account-checklist input[type='checkbox']");
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
      this.updateSelectedAccountsCount();
    });

    // Close batch progress modal
    this.batchProgressModal.querySelector(".close-progress")?.addEventListener("click", () => {
      this.closeBatchProgress();
    });

    // Close batch results modal
    this.batchResultsModal.querySelector(".modal-close-btn")?.addEventListener("click", () => {
      this.closeBatchResults();
    });

    this.batchResultsModal.querySelector(".close-results")?.addEventListener("click", () => {
      this.closeBatchResults();
    });
  }

  openAccountSelector() {
    console.log("openAccountSelector called");

    if (!this.accountSelectorModal) {
      console.error("Account selector modal not found!");
      showError("Multi-account feature is not available. Please refresh the page.");
      return;
    }

    console.log("Loading accounts into checklist...");
    // Load accounts into checklist
    this.populateAccountChecklist();

    console.log("Opening account selector modal...");
    this.accountSelectorModal.style.display = "flex";
    this.accountSelectorModal.style.position = "fixed";
    this.accountSelectorModal.style.top = "0";
    this.accountSelectorModal.style.left = "0";
    this.accountSelectorModal.style.width = "100%";
    this.accountSelectorModal.style.height = "100%";
    this.accountSelectorModal.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    this.accountSelectorModal.style.zIndex = "10000";
    this.accountSelectorModal.style.justifyContent = "center";
    this.accountSelectorModal.style.alignItems = "center";
    console.log("Modal should be visible now. Check if you can see it!");
  }

  closeAccountSelector(resetSelection = true) {
    this.accountSelectorModal.style.display = "none";
    if (resetSelection) {
      this.selectedAccounts = [];
      this.isMultiAccountMode = false;

      // Clear any existing selections from the checklist
      const checkboxes = this.accountSelectorModal.querySelectorAll(".account-checklist input[type='checkbox']");
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });

      const selectedCount = this.accountSelectorModal.querySelector(".selected-count");
      if (selectedCount) {
        selectedCount.textContent = "0";
      }
    }
  }

  async populateAccountChecklist() {
    try {
      console.log("Populating account checklist...");
      const accountsList = document.getElementById("ad-acc-list");
      console.log("Account list element:", accountsList);

      if (!accountsList) {
        console.error("ad-acc-list not found!");
        showError("Ad accounts list not found. Please refresh the page.");
        return;
      }

      const accounts = Array.from(accountsList.querySelectorAll("li")).map((li) => {
        const accountLink = li.querySelector("a.account");
        return {
          id: accountLink?.dataset.campaignId || accountLink?.getAttribute("data-campaign-id"),
          name: accountLink?.textContent?.trim() || li.textContent.trim(),
        };
      });

      console.log("Found accounts:", accounts);

      // Store for later use
      this.allAdAccounts = accounts.filter((acc) => acc.id);
      console.log("Filtered accounts with ID:", this.allAdAccounts);

      if (this.allAdAccounts.length === 0) {
        showError("No ad accounts found. Please add ad accounts first.");
        return;
      }

      const checklist = this.accountSelectorModal.querySelector(".account-checklist");
      checklist.innerHTML = "";

      this.allAdAccounts.forEach((account) => {
        const label = document.createElement("label");
        label.className = "account-checkbox-label";
        label.innerHTML = `
          <input type="checkbox" value="${account.id}" class="account-checkbox" />
          <span>${account.name}</span>
        `;

        const checkbox = label.querySelector("input");
        checkbox.addEventListener("change", () => {
          this.updateSelectedAccountsCount();
        });

        checklist.appendChild(label);
      });

      console.log("Account checklist populated with", this.allAdAccounts.length, "accounts");
      this.updateSelectedAccountsCount();
    } catch (error) {
      console.error("Error populating account checklist:", error);
      showError("Failed to load ad accounts");
    }
  }

  updateSelectedAccountsCount() {
    const checkboxes = this.accountSelectorModal.querySelectorAll(".account-checklist input[type='checkbox']:checked");
    this.selectedAccounts = Array.from(checkboxes).map((cb) => cb.value);
    this.accountSelectorModal.querySelector(".selected-count").textContent = this.selectedAccounts.length;
  }

  async saveMultiAccountRule(ruleData) {
    try {
      this.closeEditor();

      const payload = {
        ad_account_ids: this.selectedAccounts,
        ...ruleData,
      };

      const response = await fetch("/api/rules/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || error.error || "Failed to create batch rules");
      }

      const result = await response.json();

      // Show simple status (no progress modal)
      if (result.completed === result.total_accounts) {
        showSuccess(`Rule created successfully on all ${result.total_accounts} accounts`);
      } else {
        showWarning(`Rule created on ${result.completed} out of ${result.total_accounts} accounts`);
      }

      // Reset multi-account mode
      this.isMultiAccountMode = false;
      this.selectedAccounts = [];
    } catch (error) {
      console.error("Error creating batch rules:", error);
      showError(error.message);
    }
  }

  showBatchProgress() {
    this.batchProgressModal.style.display = "flex";
    this.batchProgressModal.querySelector(".progress-fill").style.width = "0%";
    this.batchProgressModal.querySelector(".completed-count").textContent = "0";
    this.batchProgressModal.querySelector(".total-count").textContent = this.selectedAccounts.length;
    this.batchProgressModal.querySelector(".batch-results-list").innerHTML = "";
    this.batchProgressModal.querySelector(".close-progress").disabled = true;

    // Add initial placeholders for each account
    this.selectedAccounts.forEach((accountId) => {
      const accountName = this.allAdAccounts.find((acc) => acc.id === accountId)?.name || accountId;
      const resultItem = document.createElement("div");
      resultItem.className = "batch-result-item pending";
      resultItem.innerHTML = `
        <span class="result-icon">⏳</span>
        <span class="result-text">${accountName}</span>
      `;
      resultItem.dataset.accountId = accountId;
      this.batchProgressModal.querySelector(".batch-results-list").appendChild(resultItem);
    });
  }

  updateBatchProgress(completed, total, results) {
    const percentage = (completed / total) * 100;
    this.batchProgressModal.querySelector(".progress-fill").style.width = `${percentage}%`;
    this.batchProgressModal.querySelector(".completed-count").textContent = completed;

    // Update each result item
    results.forEach((result) => {
      const item = this.batchProgressModal.querySelector(`.batch-result-item[data-account-id="${result.ad_account_id}"]`);
      if (item) {
        if (result.success) {
          item.className = "batch-result-item success";
          item.querySelector(".result-icon").textContent = "✓";
        } else {
          item.className = "batch-result-item failed";
          item.querySelector(".result-icon").textContent = "✗";
          item.querySelector(".result-text").innerHTML += `<br><small class="error-text">${result.error}</small>`;
        }
      }
    });
  }

  closeBatchProgress() {
    this.batchProgressModal.style.display = "none";
  }

  showBatchResults(results, successCount, failedCount) {
    this.batchResultsModal.style.display = "flex";
    this.batchResultsModal.querySelector(".success-count").textContent = successCount;
    this.batchResultsModal.querySelector(".failed-count").textContent = failedCount;

    const resultsList = this.batchResultsModal.querySelector(".results-list");
    resultsList.innerHTML = "";

    results.forEach((result) => {
      const accountName = this.allAdAccounts.find((acc) => acc.id === result.ad_account_id)?.name || result.ad_account_id;
      const resultItem = document.createElement("div");
      resultItem.className = `result-item ${result.success ? "success" : "failed"}`;
      resultItem.innerHTML = `
        <span class="result-icon">${result.success ? "✓" : "✗"}</span>
        <span class="result-account">${accountName}</span>
        ${result.error ? `<span class="result-error">${result.error}</span>` : ""}
      `;
      resultsList.appendChild(resultItem);
    });
  }

  closeBatchResults() {
    this.batchResultsModal.style.display = "none";
  }
}

// Initialize Automated Rules Manager
const automatedRulesManager = new AutomatedRulesManager();

// Bind rules button click
document.querySelector(".rules-btn").addEventListener("click", () => {
  automatedRulesManager.openModal();
});

// ============================================
// BULK DUPLICATE CAMPAIGN FUNCTIONALITY
// ============================================

let bulkCampaignDuplicateData = {
  selectedAccounts: [],
  campaignData: null,
  campaignName: "",
  deepCopy: false,
};

async function openBulkDuplicateCampaignModal(campaignData) {
  console.log("openBulkDuplicateCampaignModal called with:", campaignData);

  bulkCampaignDuplicateData.campaignData = campaignData;
  bulkCampaignDuplicateData.selectedAccounts = [];

  const modal = document.querySelector(".bulk-duplicate-campaign-modal");
  console.log("Modal element found:", modal);

  if (!modal) {
    console.error("Bulk duplicate campaign modal not found in DOM");
    alert("Modal not found. Please refresh the page.");
    return;
  }

  // Reset modal to step 1
  showBulkDuplicateCampaignStep(1);

  // Show source campaign name
  const sourceNameEl = modal.querySelector(".bulk-campaign-source-name");
  if (sourceNameEl) {
    sourceNameEl.textContent = campaignData.name;
  }

  // Set default campaign name
  const nameInput = modal.querySelector(".bulk-campaign-name");
  if (nameInput) {
    nameInput.value = `${campaignData.name} (Copy)`;
    bulkCampaignDuplicateData.campaignName = nameInput.value;
  }

  // Load accounts immediately
  await loadAccountsForBulkCampaign();

  modal.style.display = "flex";
  console.log("Modal display set to flex");
}

function showBulkDuplicateCampaignStep(stepNumber) {
  const steps = document.querySelectorAll(".bulk-duplicate-campaign-modal .bulk-duplicate-step");
  steps.forEach((step) => (step.style.display = "none"));

  const currentStep = document.querySelector(`.bulk-duplicate-campaign-modal .bulk-duplicate-step[data-step="${stepNumber}"]`);
  if (currentStep) {
    currentStep.style.display = "block";
  }
}

async function loadAccountsForBulkCampaign() {
  const accountList = document.querySelector(".bulk-campaign-account-list");
  if (!accountList) return;

  accountList.innerHTML = '<p style="padding: 20px; text-align: center;">Loading accounts...</p>';

  try {
    let accounts = window.adAccountsData;

    if (!accounts || accounts.length === 0) {
      const response = await fetch("/api/fetch-meta-data");
      if (!response.ok) throw new Error("Failed to fetch account data");
      const data = await response.json();
      accounts = data.adAccounts || [];
      window.adAccountsData = accounts;
    }

    if (accounts.length === 0) {
      accountList.innerHTML = '<p style="padding: 20px; text-align: center;">No ad accounts available</p>';
      return;
    }

    // Filter out the source account
    const sourceAccountId = bulkCampaignDuplicateData.campaignData.account_id;
    const targetAccounts = accounts.filter((acc) => acc.account_id !== sourceAccountId);

    accountList.innerHTML = "";

    targetAccounts.forEach((account) => {
      const accountItem = document.createElement("div");
      accountItem.className = "account-item";
      accountItem.dataset.accountId = account.account_id;
      accountItem.dataset.accountName = account.name;

      accountItem.innerHTML = `
        <input type="checkbox" class="account-checkbox" data-account-id="${account.account_id}">
        <div class="account-info">
          <div class="account-name">${account.name}</div>
          <div class="account-id">ID: ${account.account_id}</div>
        </div>
      `;

      accountItem.addEventListener("click", (e) => {
        if (e.target.classList.contains("account-checkbox")) return;
        const checkbox = accountItem.querySelector(".account-checkbox");
        checkbox.checked = !checkbox.checked;
        toggleBulkCampaignAccountSelection(account.account_id, account.name, checkbox.checked);
      });

      const checkbox = accountItem.querySelector(".account-checkbox");
      checkbox.addEventListener("change", (e) => {
        toggleBulkCampaignAccountSelection(account.account_id, account.name, e.target.checked);
      });

      accountList.appendChild(accountItem);
    });

    setupBulkCampaignAccountSearch();
  } catch (error) {
    console.error("Error loading accounts:", error);
    accountList.innerHTML = '<p style="padding: 20px; text-align: center; color: red;">Failed to load accounts</p>';
  }
}

function setupBulkCampaignAccountSearch() {
  const searchInput = document.querySelector(".bulk-campaign-account-search");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const accountItems = document.querySelectorAll(".bulk-campaign-account-list .account-item");

    accountItems.forEach((item) => {
      const name = item.dataset.accountName.toLowerCase();
      const id = item.dataset.accountId.toLowerCase();

      if (name.includes(searchTerm) || id.includes(searchTerm)) {
        item.style.display = "flex";
      } else {
        item.style.display = "none";
      }
    });
  });
}

function toggleBulkCampaignAccountSelection(accountId, accountName, selected) {
  const accountItem = document.querySelector(`.bulk-campaign-account-list .account-item[data-account-id="${accountId}"]`);
  if (!accountItem) return;

  if (selected) {
    accountItem.classList.add("selected");
    if (!bulkCampaignDuplicateData.selectedAccounts.find((a) => a.id === accountId)) {
      bulkCampaignDuplicateData.selectedAccounts.push({ id: accountId, name: accountName });
    }
  } else {
    accountItem.classList.remove("selected");
    bulkCampaignDuplicateData.selectedAccounts = bulkCampaignDuplicateData.selectedAccounts.filter((a) => a.id !== accountId);
  }

  updateBulkCampaignSelectionUI();
}

function updateBulkCampaignSelectionUI() {
  const count = bulkCampaignDuplicateData.selectedAccounts.length;
  const startBtn = document.querySelector(".bulk-campaign-start");
  const countEl = document.querySelector(".bulk-campaign-selected-count");

  if (countEl) {
    countEl.textContent = count;
  }

  if (startBtn) {
    startBtn.disabled = count === 0;
    startBtn.textContent = `Start Duplication (${count} account${count !== 1 ? "s" : ""})`;
  }
}

async function startBulkCampaignDuplication() {
  showBulkDuplicateCampaignStep(2);

  const progressContainer = document.querySelector(".bulk-duplicate-campaign-modal .account-progress-list");
  progressContainer.innerHTML = "";

  bulkCampaignDuplicateData.selectedAccounts.forEach((account) => {
    const item = document.createElement("div");
    item.className = "account-progress-item";
    item.dataset.accountId = account.id;

    item.innerHTML = `
      <div class="account-progress-header">
        <span class="account-progress-name">${account.name}</span>
        <span class="account-progress-status pending">Pending</span>
      </div>
      <div class="account-progress-details"></div>
    `;

    progressContainer.appendChild(item);
  });

  let completedAccounts = 0;
  const totalAccounts = bulkCampaignDuplicateData.selectedAccounts.length;
  const results = [];

  for (const account of bulkCampaignDuplicateData.selectedAccounts) {
    const result = await processBulkCampaignDuplication(account);
    results.push(result);
    completedAccounts++;
    updateBulkCampaignOverallProgress(completedAccounts, totalAccounts);
  }

  showBulkCampaignResults(results);
}

async function processBulkCampaignDuplication(account) {
  const accountId = account.id;
  const progressItem = document.querySelector(`.bulk-duplicate-campaign-modal .account-progress-item[data-account-id="${accountId}"]`);
  const statusSpan = progressItem.querySelector(".account-progress-status");
  const detailsDiv = progressItem.querySelector(".account-progress-details");

  statusSpan.textContent = "Processing";
  statusSpan.className = "account-progress-status processing";

  try {
    const response = await fetch("/api/duplicate-campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign_id: bulkCampaignDuplicateData.campaignData.id,
        name: bulkCampaignDuplicateData.campaignName,
        deep_copy: bulkCampaignDuplicateData.deepCopy,
        status_option: "PAUSED",
        account_id: accountId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || `Failed with status ${response.status}`);
    }

    const data = await response.json();

    statusSpan.textContent = "Success";
    statusSpan.className = "account-progress-status success";

    let detailMessage = `✓ Campaign created: ${data.newCampaignId || data.id}`;
    if (data.mode === "async_double_batch") {
      detailMessage += `\n${data.structure?.adsets || 0} adsets and ${data.structure?.ads || 0} ads will be duplicated asynchronously.`;
    }
    detailsDiv.textContent = detailMessage;
    detailsDiv.style.whiteSpace = "pre-line";

    return {
      account,
      success: true,
      campaignId: data.newCampaignId || data.id,
      mode: data.mode,
      structure: data.structure,
    };
  } catch (error) {
    console.error(`Error duplicating campaign to account ${accountId}:`, error);

    statusSpan.textContent = "Failed";
    statusSpan.className = "account-progress-status failed";
    detailsDiv.textContent = `✗ ${error.message}`;

    return {
      account,
      success: false,
      error: error.message,
    };
  }
}

function updateBulkCampaignOverallProgress(completed, total) {
  const progressFill = document.querySelector(".bulk-duplicate-campaign-modal .overall-progress .progress-fill");
  const progressText = document.querySelector(".bulk-duplicate-campaign-modal .overall-progress .progress-text");

  const percentage = Math.round((completed / total) * 100);

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }

  if (progressText) {
    progressText.textContent = `${completed} of ${total} accounts completed`;
  }
}

function showBulkCampaignResults(results) {
  showBulkDuplicateCampaignStep(3);

  let successCount = 0;
  let failedCount = 0;

  results.forEach((result) => {
    if (result.success) successCount++;
    else failedCount++;
  });

  const successStat = document.querySelector(".bulk-duplicate-campaign-modal .result-stat.success .stat-number");
  const failedStat = document.querySelector(".bulk-duplicate-campaign-modal .result-stat.failed .stat-number");
  const accountsStat = document.querySelector(".bulk-duplicate-campaign-modal .result-stat.accounts .stat-number");

  if (successStat) successStat.textContent = successCount;
  if (failedStat) failedStat.textContent = failedCount;
  if (accountsStat) accountsStat.textContent = results.length;

  const resultsList = document.querySelector(".bulk-campaign-results-list");
  if (resultsList) {
    resultsList.innerHTML = "";

    results.forEach((result) => {
      const item = document.createElement("div");
      item.className = "result-item";

      const statusClass = result.success ? "success" : "failed";
      const statusText = result.success ? "Success" : "Failed";

      item.innerHTML = `
        <div class="result-item-header">
          <span class="result-account-name">${result.account.name}</span>
          <span class="result-status ${statusClass}">${statusText}</span>
        </div>
        ${result.success ? `<div class="result-details">Campaign ID: ${result.campaignId}</div>` : ""}
        ${
          result.success && result.mode === "async_double_batch"
            ? `<div class="result-details" style="color: #666; font-size: 13px;">⏱️ Duplicating ${result.structure?.adsets || 0} adsets and ${result.structure?.ads || 0} ads asynchronously. Check Meta Ads Manager in 1-5 minutes.</div>`
            : ""
        }
        ${result.error ? `<div class="result-errors"><div class="result-errors-title">Error:</div><div>${result.error}</div></div>` : ""}
      `;

      resultsList.appendChild(item);
    });
  }
}

// Setup bulk campaign duplication event listeners
function setupBulkCampaignDuplicateListeners() {
  const modal = document.querySelector(".bulk-duplicate-campaign-modal");
  if (!modal) return;

  // Close button
  const closeBtn = modal.querySelector(".bulk-duplicate-campaign-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // Click outside to close
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  // Campaign name input
  const nameInput = modal.querySelector(".bulk-campaign-name");
  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      bulkCampaignDuplicateData.campaignName = e.target.value.trim();
    });
  }

  // Deep copy radio buttons
  const deepCopyRadios = modal.querySelectorAll('input[name="bulk-campaign-deep-copy"]');
  deepCopyRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      bulkCampaignDuplicateData.deepCopy = e.target.value === "true";
    });
  });

  // Select/Deselect all
  const selectAllBtn = modal.querySelector(".bulk-campaign-select-all");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = modal.querySelectorAll(".bulk-campaign-account-list .account-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = true;
        const accountItem = cb.closest(".account-item");
        toggleBulkCampaignAccountSelection(accountItem.dataset.accountId, accountItem.dataset.accountName, true);
      });
    });
  }

  const deselectAllBtn = modal.querySelector(".bulk-campaign-deselect-all");
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener("click", () => {
      const checkboxes = modal.querySelectorAll(".bulk-campaign-account-list .account-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = false;
        const accountItem = cb.closest(".account-item");
        toggleBulkCampaignAccountSelection(accountItem.dataset.accountId, accountItem.dataset.accountName, false);
      });
    });
  }

  // Start duplication button
  const startBtn = modal.querySelector(".bulk-campaign-start");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startBulkCampaignDuplication();
    });
  }

  // Cancel buttons
  const cancelBtn = modal.querySelector(".bulk-duplicate-campaign-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // Close results button
  const closeResultsBtn = modal.querySelector(".bulk-duplicate-campaign-close-results");
  if (closeResultsBtn) {
    closeResultsBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }
}

// ============================================
// BULK DUPLICATE AD SET FUNCTIONALITY
// ============================================

let bulkAdSetDuplicateData = {
  selectedAccounts: [],
  adSetData: null,
  adSetName: "",
  deepCopy: false,
  campaignMapping: {}, // Maps accountId to selected campaignId
};

async function openBulkDuplicateAdSetModal() {
  console.log("openBulkDuplicateAdSetModal called");

  bulkAdSetDuplicateData.selectedAccounts = [];
  bulkAdSetDuplicateData.adSetData = null;
  bulkAdSetDuplicateData.campaignMapping = {};

  const modal = document.querySelector(".bulk-duplicate-adset-modal");
  console.log("Modal element found:", modal);

  if (!modal) {
    console.error("Bulk duplicate adset modal not found in DOM");
    alert("Modal not found. Please refresh the page.");
    return;
  }

  showBulkDuplicateAdSetStep(1);
  loadAdSetsForBulkDuplication();

  modal.style.display = "flex";
  console.log("Modal display set to flex");
}

function showBulkDuplicateAdSetStep(stepNumber) {
  const steps = document.querySelectorAll(".bulk-duplicate-adset-modal .bulk-duplicate-step");
  steps.forEach((step) => (step.style.display = "none"));

  const currentStep = document.querySelector(`.bulk-duplicate-adset-modal .bulk-duplicate-step[data-step="${stepNumber}"]`);
  if (currentStep) {
    currentStep.style.display = "block";
  }
}

function loadAdSetsForBulkDuplication() {
  const selectedCampaignId = appState.getState().selectedCampaign;
  const adSetList = document.querySelector(".bulk-adset-selection-list");

  if (!adSetList) return;

  if (!selectedCampaignId || !campaignAdSets[selectedCampaignId]) {
    adSetList.innerHTML = '<p style="color: #666; padding: 16px;">No ad sets found for this campaign.</p>';
    return;
  }

  const adSets = campaignAdSets[selectedCampaignId];
  adSetList.innerHTML = "";

  adSets.forEach((adSet) => {
    const adSetElement = document.createElement("div");
    adSetElement.className = "bulk-adset-item";
    adSetElement.dataset.adsetId = adSet.id;
    adSetElement.dataset.adsetName = adSet.name;
    adSetElement.innerHTML = `
      <h4>${adSet.name}</h4>
      <p>ID: ${adSet.id}</p>
    `;

    adSetElement.addEventListener("click", () => {
      bulkAdSetDuplicateData.adSetData = adSet;
      showBulkDuplicateAdSetStep(2);

      // Show source ad set name
      const sourceNameEl = document.querySelector(".bulk-adset-source-name");
      if (sourceNameEl) {
        sourceNameEl.textContent = adSet.name;
      }

      // Set default name
      const nameInput = document.querySelector(".bulk-adset-name");
      if (nameInput) {
        nameInput.value = `${adSet.name} (Copy)`;
        bulkAdSetDuplicateData.adSetName = nameInput.value;
      }

      // Load accounts
      loadAccountsForBulkAdSet();
    });

    adSetList.appendChild(adSetElement);
  });
}

async function loadAccountsForBulkAdSet() {
  const accountList = document.querySelector(".bulk-adset-account-list");
  if (!accountList) return;

  accountList.innerHTML = '<p style="padding: 20px; text-align: center;">Loading accounts...</p>';

  try {
    let accounts = window.adAccountsData;

    if (!accounts || accounts.length === 0) {
      const response = await fetch("/api/fetch-meta-data");
      if (!response.ok) throw new Error("Failed to fetch account data");
      const data = await response.json();
      accounts = data.adAccounts || [];
      window.adAccountsData = accounts;
    }

    if (accounts.length === 0) {
      accountList.innerHTML = '<p style="padding: 20px; text-align: center;">No ad accounts available</p>';
      return;
    }

    // Filter out the source account
    const sourceAccountId = appState.getState().selectedAccount;
    const targetAccounts = accounts.filter((acc) => acc.account_id !== sourceAccountId);

    accountList.innerHTML = "";

    targetAccounts.forEach((account) => {
      const accountItem = document.createElement("div");
      accountItem.className = "account-item";
      accountItem.dataset.accountId = account.account_id;
      accountItem.dataset.accountName = account.name;

      accountItem.innerHTML = `
        <input type="checkbox" class="account-checkbox" data-account-id="${account.account_id}">
        <div class="account-info">
          <div class="account-name">${account.name}</div>
          <div class="account-id">ID: ${account.account_id}</div>
        </div>
      `;

      accountItem.addEventListener("click", (e) => {
        if (e.target.classList.contains("account-checkbox")) return;
        const checkbox = accountItem.querySelector(".account-checkbox");
        checkbox.checked = !checkbox.checked;
        toggleBulkAdSetAccountSelection(account.account_id, account.name, checkbox.checked);
      });

      const checkbox = accountItem.querySelector(".account-checkbox");
      checkbox.addEventListener("change", (e) => {
        toggleBulkAdSetAccountSelection(account.account_id, account.name, e.target.checked);
      });

      accountList.appendChild(accountItem);
    });

    setupBulkAdSetAccountSearch();
  } catch (error) {
    console.error("Error loading accounts:", error);
    accountList.innerHTML = '<p style="padding: 20px; text-align: center; color: red;">Failed to load accounts</p>';
  }
}

function setupBulkAdSetAccountSearch() {
  const searchInput = document.querySelector(".bulk-adset-account-search");
  if (!searchInput) return;

  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const accountItems = document.querySelectorAll(".bulk-adset-account-list .account-item");

    accountItems.forEach((item) => {
      const name = item.dataset.accountName.toLowerCase();
      const id = item.dataset.accountId.toLowerCase();

      if (name.includes(searchTerm) || id.includes(searchTerm)) {
        item.style.display = "flex";
      } else {
        item.style.display = "none";
      }
    });
  });
}

function toggleBulkAdSetAccountSelection(accountId, accountName, selected) {
  const accountItem = document.querySelector(`.bulk-adset-account-list .account-item[data-account-id="${accountId}"]`);
  if (!accountItem) return;

  if (selected) {
    accountItem.classList.add("selected");
    if (!bulkAdSetDuplicateData.selectedAccounts.find((a) => a.id === accountId)) {
      bulkAdSetDuplicateData.selectedAccounts.push({ id: accountId, name: accountName });
    }
  } else {
    accountItem.classList.remove("selected");
    bulkAdSetDuplicateData.selectedAccounts = bulkAdSetDuplicateData.selectedAccounts.filter((a) => a.id !== accountId);
  }

  updateBulkAdSetSelectionUI();
}

function updateBulkAdSetSelectionUI() {
  const count = bulkAdSetDuplicateData.selectedAccounts.length;
  const nextBtn = document.querySelector(".bulk-adset-next-to-campaigns");
  const countEl = document.querySelector(".bulk-adset-selected-count");

  if (countEl) {
    countEl.textContent = count;
  }

  if (nextBtn) {
    nextBtn.disabled = count === 0;
    nextBtn.textContent = count > 0 ? `Next: Select Campaigns (${count} account${count !== 1 ? "s" : ""})` : "Next: Select Campaigns";
  }
}

async function loadCampaignsForSelectedAccounts() {
  const mappingsList = document.querySelector(".bulk-campaign-mappings-list");
  if (!mappingsList) return;

  mappingsList.innerHTML = '<p style="padding: 20px; text-align: center;">Loading campaigns...</p>';

  try {
    // Fetch all campaigns from Meta API if not cached
    let allCampaigns = window.allCampaignsCache;

    if (!allCampaigns) {
      const response = await fetch("/api/fetch-meta-data");
      if (!response.ok) throw new Error("Failed to fetch campaigns");
      const data = await response.json();
      allCampaigns = data.campaigns || [];
      window.allCampaignsCache = allCampaigns; // Cache for future use
    }

    console.log("All campaigns count:", allCampaigns.length);
    console.log("Selected accounts:", bulkAdSetDuplicateData.selectedAccounts);

    // Normalize account IDs for comparison (remove 'act_' prefix if present)
    const normalizeAccountId = (id) => id?.toString().replace(/^act_/, "");

    // Group campaigns by account_id
    const accountCampaigns = {};
    bulkAdSetDuplicateData.selectedAccounts.forEach((account) => {
      const normalizedAccountId = normalizeAccountId(account.id);
      accountCampaigns[account.id] = allCampaigns.filter((campaign) => {
        const normalizedCampaignAccountId = normalizeAccountId(campaign.account_id);
        return normalizedCampaignAccountId === normalizedAccountId;
      });
      console.log(`Account ${account.name} (${normalizedAccountId}): ${accountCampaigns[account.id].length} campaigns`);
    });

    // Build UI for campaign selection
    mappingsList.innerHTML = "";

    bulkAdSetDuplicateData.selectedAccounts.forEach((account) => {
      const campaigns = accountCampaigns[account.id] || [];
      const mappingItem = document.createElement("div");
      mappingItem.className = "campaign-mapping-item";
      mappingItem.dataset.accountId = account.id;

      let campaignOptions = '<option value="">Select a campaign...</option>';

      if (campaigns.length === 0) {
        campaignOptions += '<option value="" disabled>No campaigns available</option>';
      } else {
        campaigns.forEach((campaign) => {
          const statusLabel = campaign.status === "ACTIVE" ? "✓" : " ";
          campaignOptions += `<option value="${campaign.id}">${statusLabel} ${campaign.name}</option>`;
        });
      }

      mappingItem.innerHTML = `
        <div class="mapping-item-header">
          <strong>${account.name}</strong>
          <span class="mapping-item-id">ID: ${account.id}</span>
        </div>
        <select class="campaign-selector" data-account-id="${account.id}" ${campaigns.length === 0 ? "disabled" : ""}>
          ${campaignOptions}
        </select>
        ${campaigns.length === 0 ? '<p style="color: #dc3545; font-size: 13px; margin-top: 8px;">⚠ No campaigns found in this account. Create a campaign first.</p>' : ""}
      `;

      const selector = mappingItem.querySelector(".campaign-selector");
      selector.addEventListener("change", (e) => {
        if (e.target.value) {
          bulkAdSetDuplicateData.campaignMapping[account.id] = e.target.value;
        } else {
          delete bulkAdSetDuplicateData.campaignMapping[account.id];
        }
        validateCampaignSelection();
      });

      mappingsList.appendChild(mappingItem);
    });

    validateCampaignSelection();
  } catch (error) {
    console.error("Error loading campaigns:", error);
    mappingsList.innerHTML = `<p style="padding: 20px; text-align: center; color: red;">Failed to load campaigns: ${error.message}</p>`;
  }
}

function validateCampaignSelection() {
  const startBtn = document.querySelector(".bulk-duplicate-step[data-step='3'] .bulk-adset-start");
  if (!startBtn) return;

  const selectedCount = Object.keys(bulkAdSetDuplicateData.campaignMapping).length;
  const requiredCount = bulkAdSetDuplicateData.selectedAccounts.length;

  startBtn.disabled = selectedCount < requiredCount;
  startBtn.textContent = selectedCount < requiredCount ? `Select campaigns for all accounts (${selectedCount}/${requiredCount})` : `Start Duplication (${requiredCount} account${requiredCount !== 1 ? "s" : ""})`;
}

async function startBulkAdSetDuplication() {
  showBulkDuplicateAdSetStep(4);

  const progressContainer = document.querySelector(".bulk-duplicate-adset-modal .account-progress-list");
  progressContainer.innerHTML = "";

  bulkAdSetDuplicateData.selectedAccounts.forEach((account) => {
    const item = document.createElement("div");
    item.className = "account-progress-item";
    item.dataset.accountId = account.id;

    item.innerHTML = `
      <div class="account-progress-header">
        <span class="account-progress-name">${account.name}</span>
        <span class="account-progress-status pending">Pending</span>
      </div>
      <div class="account-progress-details"></div>
    `;

    progressContainer.appendChild(item);
  });

  let completedAccounts = 0;
  const totalAccounts = bulkAdSetDuplicateData.selectedAccounts.length;
  const results = [];

  for (const account of bulkAdSetDuplicateData.selectedAccounts) {
    const result = await processBulkAdSetDuplication(account);
    results.push(result);
    completedAccounts++;
    updateBulkAdSetOverallProgress(completedAccounts, totalAccounts);
  }

  showBulkAdSetResults(results);
}

async function processBulkAdSetDuplication(account) {
  const accountId = account.id;
  const progressItem = document.querySelector(`.bulk-duplicate-adset-modal .account-progress-item[data-account-id="${accountId}"]`);
  const statusSpan = progressItem.querySelector(".account-progress-status");
  const detailsDiv = progressItem.querySelector(".account-progress-details");

  statusSpan.textContent = "Processing";
  statusSpan.className = "account-progress-status processing";

  try {
    // Use the campaign selected for this specific account
    const campaignId = bulkAdSetDuplicateData.campaignMapping[accountId];

    if (!campaignId) {
      throw new Error("No campaign selected for this account");
    }

    const response = await fetch("/api/duplicate-ad-set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ad_set_id: bulkAdSetDuplicateData.adSetData.id,
        name: bulkAdSetDuplicateData.adSetName,
        deep_copy: bulkAdSetDuplicateData.deepCopy,
        status_option: "INHERITED_FROM_SOURCE",
        campaign_id: campaignId,
        account_id: accountId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || errorData.details || `Failed with status ${response.status}`);
    }

    const data = await response.json();

    statusSpan.textContent = "Success";
    statusSpan.className = "account-progress-status success";
    detailsDiv.textContent = `✓ Ad Set created: ${data.id}`;

    return {
      account,
      success: true,
      adSetId: data.id,
    };
  } catch (error) {
    console.error(`Error duplicating ad set to account ${accountId}:`, error);

    statusSpan.textContent = "Failed";
    statusSpan.className = "account-progress-status failed";
    detailsDiv.textContent = `✗ ${error.message}`;

    return {
      account,
      success: false,
      error: error.message,
    };
  }
}

function updateBulkAdSetOverallProgress(completed, total) {
  const progressFill = document.querySelector(".bulk-duplicate-adset-modal .overall-progress .progress-fill");
  const progressText = document.querySelector(".bulk-duplicate-adset-modal .overall-progress .progress-text");

  const percentage = Math.round((completed / total) * 100);

  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }

  if (progressText) {
    progressText.textContent = `${completed} of ${total} accounts completed`;
  }
}

function showBulkAdSetResults(results) {
  showBulkDuplicateAdSetStep(5);

  let successCount = 0;
  let failedCount = 0;

  results.forEach((result) => {
    if (result.success) successCount++;
    else failedCount++;
  });

  const successStat = document.querySelector(".bulk-duplicate-adset-modal .result-stat.success .stat-number");
  const failedStat = document.querySelector(".bulk-duplicate-adset-modal .result-stat.failed .stat-number");
  const accountsStat = document.querySelector(".bulk-duplicate-adset-modal .result-stat.accounts .stat-number");

  if (successStat) successStat.textContent = successCount;
  if (failedStat) failedStat.textContent = failedCount;
  if (accountsStat) accountsStat.textContent = results.length;

  const resultsList = document.querySelector(".bulk-adset-results-list");
  if (resultsList) {
    resultsList.innerHTML = "";

    results.forEach((result) => {
      const item = document.createElement("div");
      item.className = "result-item";

      const statusClass = result.success ? "success" : "failed";
      const statusText = result.success ? "Success" : "Failed";

      item.innerHTML = `
        <div class="result-item-header">
          <span class="result-account-name">${result.account.name}</span>
          <span class="result-status ${statusClass}">${statusText}</span>
        </div>
        ${result.success ? `<div class="result-details">Ad Set ID: ${result.adSetId}</div>` : ""}
        ${result.error ? `<div class="result-errors"><div class="result-errors-title">Error:</div><div>${result.error}</div></div>` : ""}
      `;

      resultsList.appendChild(item);
    });
  }
}

// Setup bulk ad set duplication event listeners
function setupBulkAdSetDuplicateListeners() {
  const modal = document.querySelector(".bulk-duplicate-adset-modal");
  if (!modal) return;

  // Close button
  const closeBtn = modal.querySelector(".bulk-duplicate-adset-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // Click outside to close
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  // Ad set name input
  const nameInput = modal.querySelector(".bulk-adset-name");
  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      bulkAdSetDuplicateData.adSetName = e.target.value.trim();
    });
  }

  // Deep copy radio buttons
  const deepCopyRadios = modal.querySelectorAll('input[name="bulk-adset-deep-copy"]');
  deepCopyRadios.forEach((radio) => {
    radio.addEventListener("change", (e) => {
      bulkAdSetDuplicateData.deepCopy = e.target.value === "true";
    });
  });

  // Back to list button
  const backToListBtn = modal.querySelector(".bulk-adset-back-to-list");
  if (backToListBtn) {
    backToListBtn.addEventListener("click", () => {
      showBulkDuplicateAdSetStep(1);
    });
  }

  // Next to campaigns button
  const nextToCampaignsBtn = modal.querySelector(".bulk-adset-next-to-campaigns");
  if (nextToCampaignsBtn) {
    nextToCampaignsBtn.addEventListener("click", async () => {
      showBulkDuplicateAdSetStep(3);
      await loadCampaignsForSelectedAccounts();
    });
  }

  // Back to accounts button
  const backToAccountsBtn = modal.querySelector(".bulk-adset-back-to-accounts");
  if (backToAccountsBtn) {
    backToAccountsBtn.addEventListener("click", () => {
      showBulkDuplicateAdSetStep(2);
    });
  }

  // Select/Deselect all
  const selectAllBtn = modal.querySelector(".bulk-adset-select-all");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const checkboxes = modal.querySelectorAll(".bulk-adset-account-list .account-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = true;
        const accountItem = cb.closest(".account-item");
        toggleBulkAdSetAccountSelection(accountItem.dataset.accountId, accountItem.dataset.accountName, true);
      });
    });
  }

  const deselectAllBtn = modal.querySelector(".bulk-adset-deselect-all");
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener("click", () => {
      const checkboxes = modal.querySelectorAll(".bulk-adset-account-list .account-checkbox");
      checkboxes.forEach((cb) => {
        cb.checked = false;
        const accountItem = cb.closest(".account-item");
        toggleBulkAdSetAccountSelection(accountItem.dataset.accountId, accountItem.dataset.accountName, false);
      });
    });
  }

  // Start duplication button
  const startBtn = modal.querySelector(".bulk-adset-start");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startBulkAdSetDuplication();
    });
  }

  // Cancel buttons
  const cancelBtn = modal.querySelector(".bulk-duplicate-adset-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }

  // Close results button
  const closeResultsBtn = modal.querySelector(".bulk-duplicate-adset-close-results");
  if (closeResultsBtn) {
    closeResultsBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }
}

// Initialize bulk duplication listeners when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setupBulkCampaignDuplicateListeners();
    setupBulkAdSetDuplicateListeners();
  });
} else {
  setupBulkCampaignDuplicateListeners();
  setupBulkAdSetDuplicateListeners();
}