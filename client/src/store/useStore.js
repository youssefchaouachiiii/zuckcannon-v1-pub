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
      // ============= Account & Campaign Selection =============
      selectedAccount: null,
      selectedCampaign: null,
      campaignBidStrategy: null,
      campaignDailyBudget: null,

      setSelectedAccount: (account) => set({ selectedAccount: account }, false, "setSelectedAccount"),

      setSelectedCampaign: (campaign, bidStrategy, dailyBudget) =>
        set(
          {
            selectedCampaign: campaign,
            campaignBidStrategy: bidStrategy,
            campaignDailyBudget: dailyBudget,
          },
          false,
          "setSelectedCampaign"
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
            selectedAccount: null,
            selectedCampaign: null,
            campaignBidStrategy: null,
            campaignDailyBudget: null,
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
