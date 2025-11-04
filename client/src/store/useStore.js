import { create } from "zustand";
import { devtools } from "zustand/middleware";

/**
 * Bulk Uploader Global State Store
 *
 * Replaces the vanilla JS AppStateManager with proper React state management
 * using Zustand for simplicity and performance.
 */
const useStore = create(
  devtools(
    (set, get) => ({
      // ============= Workflow Selection =============
      workflow: "manage", // 'manage' or 'bulk_upload'
      manageMode: "select_existing", // 'select_existing' or 'create_new'

      setWorkflow: (workflow) =>
        set(
          (state) => {
            // Reset states when switching workflows to prevent conflicts
            if (workflow === "manage") {
              return { workflow, selectedCampaigns: [], selectedAccounts: [] };
            } else if (workflow === "bulk_upload") {
              return { workflow, selectedCampaign: null, selectedAction: null };
            }
            return { workflow };
          },
          false,
          "setWorkflow"
        ),

      setManageMode: (mode) => set({ manageMode: mode }, false, "setManageMode"),

      // ============= Single-Campaign Management State (for 'manage' workflow) =============
      selectedCampaign: null,
      campaignBidStrategy: null,
      campaignDailyBudget: null,
      selectedAction: null, // For the ActionColumn

      setSelectedCampaign: (campaign, bidStrategy, dailyBudget) =>
        set(
          {
            selectedCampaign: campaign,
            campaignBidStrategy: bidStrategy,
            campaignDailyBudget: dailyBudget,
            selectedAction: null, // Reset action when campaign changes
          },
          false,
          "setSelectedCampaign"
        ),

      setSelectedAction: (action) => set({ selectedAction: action }, false, "setSelectedAction"),

      // ============= Bulk Upload State (for 'bulk_upload' workflow) =============
      selectedCampaigns: [],
      selectedAccounts: [],

      toggleCampaignSelection: (campaignId) =>
        set(
          (state) => {
            const isSelected = state.selectedCampaigns.includes(campaignId);
            if (isSelected) {
              return { selectedCampaigns: state.selectedCampaigns.filter((id) => id !== campaignId) };
            } else {
              return { selectedCampaigns: [...state.selectedCampaigns, campaignId] };
            }
          },
          false,
          "toggleCampaignSelection"
        ),

      toggleAccountSelection: (accountId) =>
        set(
          (state) => {
            const isSelected = state.selectedAccounts.includes(accountId);
            if (isSelected) {
              return { selectedAccounts: state.selectedAccounts.filter((id) => id !== accountId) };
            } else {
              return { selectedAccounts: [...state.selectedAccounts, accountId] };
            }
          },
          false,
          "toggleAccountSelection"
        ),

      // ============= Ad Configuration =============
      adSetConfig: {},
      updateAdSetConfig: (config) => set((state) => ({ adSetConfig: { ...state.adSetConfig, ...config } }), false, "updateAdSetConfig"),

      // ============= Upload State =============
      uploadedAssets: [],
      uploadInProgress: false,

      addUploadedAsset: (asset) =>
        set(
          (state) => ({
            uploadedAssets: [...state.uploadedAssets, asset],
          }),
          false,
          "addUploadedAsset"
        ),

      setUploadedAssets: (assets) => set({ uploadedAssets: assets }, false, "setUploadedAssets"),

      setUploadInProgress: (inProgress) => set({ uploadInProgress: inProgress }, false, "setUploadInProgress"),

      // ============= Ad Copy Data =============
      adCopyData: {},
      updateAdCopyData: (data) => set((state) => ({ adCopyData: { ...state.adCopyData, ...data } }), false, "updateAdCopyData"),

      // ============= Ads to Create =============
      createAds: [],
      setCreateAds: (ads) => set({ createAds: ads }, false, "setCreateAds"),

      // ============= Location Targeting =============
      fbLocationsData: null,
      selectedCountries: [],
      selectedRegions: [],

      setFbLocationsData: (data) => set({ fbLocationsData: data }, false, "setFbLocationsData"),

      setSelectedCountries: (countries) => set({ selectedCountries: countries }, false, "setSelectedCountries"),

      setSelectedRegions: (regions) => set({ selectedRegions: regions }, false, "setSelectedRegions"),

      // ============= Meta Data Cache =============
      metaData: null,
      metaDataLoading: false,
      metaDataError: null,

      setMetaData: (data) => set({ metaData: data }, false, "setMetaData"),

      setMetaDataLoading: (loading) => set({ metaDataLoading: loading }, false, "setMetaDataLoading"),

      setMetaDataError: (error) => set({ metaDataError: error }, false, "setMetaDataError"),

      // ============= Upload Protection =============
      /**
       * Navigation guard that prompts user before leaving during upload
       * Returns true if navigation is allowed, false otherwise
       */
      navigationGuard: (targetName) => {
        const { uploadInProgress } = get();
        if (uploadInProgress) {
          return window.confirm(`Upload in progress. Navigating to "${targetName}" will cancel the upload.\n\nAre you sure you want to continue?`);
        }
        return true;
      },

      // ============= Reset Functions =============
      resetUploadState: () =>
        set(
          {
            uploadedAssets: [],
            uploadInProgress: false,
            adCopyData: {},
            createAds: [],
          },
          false,
          "resetUploadState"
        ),

      resetAll: () =>
        set(
          {
            workflow: "manage",
            manageMode: "select_existing",
            selectedCampaign: null,
            campaignBidStrategy: null,
            campaignDailyBudget: null,
            selectedAction: null,
            selectedCampaigns: [],
            selectedAccounts: [],
            adSetConfig: {},
            uploadedAssets: [],
            adCopyData: {},
            createAds: [],
            selectedCountries: [],
            selectedRegions: [],
            uploadInProgress: false,
          },
          false,
          "resetAll"
        ),
    }),
    { name: "Bulk Uploader Store" }
  )
);

export default useStore;
