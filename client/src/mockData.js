/**
 * Mock Data for UI Development
 * Set USE_MOCK_DATA=true in your environment or localStorage to use this data
 */

export const mockAdAccounts = [
  {
    account_id: "act_123456789",
    name: "Demo Ad Account 1",
    currency: "USD",
    account_status: 1,
  },
  {
    account_id: "act_987654321",
    name: "Demo Ad Account 2",
    currency: "USD",
    account_status: 1,
  },
  {
    account_id: "act_555444333",
    name: "Test Account - Marketing",
    currency: "USD",
    account_status: 1,
  },
];

export const mockCampaigns = [
  {
    id: "camp_001",
    account_id: "act_123456789",
    name: "Summer Sale Campaign",
    status: "ACTIVE",
    objective: "CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    daily_budget: "5000",
    created_time: "2024-01-15T10:30:00",
    insights: {
      data: [
        {
          spend: "1234.56",
          clicks: "450",
          impressions: "12500",
        },
      ],
    },
  },
  {
    id: "camp_002",
    account_id: "act_123456789",
    name: "Brand Awareness Q1",
    status: "ACTIVE",
    objective: "BRAND_AWARENESS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: "3000",
    created_time: "2024-01-10T09:00:00",
    insights: {
      data: [
        {
          spend: "789.12",
          clicks: "320",
          impressions: "8900",
        },
      ],
    },
  },
  {
    id: "camp_003",
    account_id: "act_123456789",
    name: "Product Launch - Old",
    status: "PAUSED",
    objective: "CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    daily_budget: "2000",
    created_time: "2023-12-05T14:20:00",
    insights: {
      data: [
        {
          spend: "456.78",
          clicks: "180",
          impressions: "5200",
        },
      ],
    },
  },
  {
    id: "camp_004",
    account_id: "act_987654321",
    name: "Holiday Special Offers",
    status: "ACTIVE",
    objective: "CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    daily_budget: "8000",
    created_time: "2024-01-20T11:45:00",
    insights: {
      data: [
        {
          spend: "2345.67",
          clicks: "890",
          impressions: "23400",
        },
      ],
    },
  },
  {
    id: "camp_005",
    account_id: "act_987654321",
    name: "Retargeting Campaign",
    status: "ACTIVE",
    objective: "CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    daily_budget: "1500",
    created_time: "2024-01-18T08:30:00",
    insights: {
      data: [
        {
          spend: "567.89",
          clicks: "234",
          impressions: "6700",
        },
      ],
    },
  },
];

export const mockAdSets = [
  // Campaign 1: Summer Sale Campaign (6 ad sets)
  {
    id: "adset_001",
    campaign_id: "camp_001",
    name: "Summer Sale - US - 18-35",
    status: "ACTIVE",
    daily_budget: "1000",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-15T10:35:00",
    insights: {
      data: [
        {
          spend: "456.78",
          clicks: "150",
          impressions: "4200",
        },
      ],
    },
  },
  {
    id: "adset_002",
    campaign_id: "camp_001",
    name: "Summer Sale - CA - 25-45",
    status: "ACTIVE",
    daily_budget: "800",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-15T10:40:00",
    insights: {
      data: [
        {
          spend: "345.67",
          clicks: "120",
          impressions: "3500",
        },
      ],
    },
  },
  {
    id: "adset_003",
    campaign_id: "camp_001",
    name: "Summer Sale - UK - 18-55",
    status: "ACTIVE",
    daily_budget: "900",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-15T11:00:00",
    insights: {
      data: [
        {
          spend: "523.45",
          clicks: "178",
          impressions: "5100",
        },
      ],
    },
  },
  {
    id: "adset_004",
    campaign_id: "camp_001",
    name: "Summer Sale - AU - 21-40",
    status: "ACTIVE",
    daily_budget: "750",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-15T11:20:00",
    insights: {
      data: [
        {
          spend: "398.23",
          clicks: "145",
          impressions: "3890",
        },
      ],
    },
  },
  {
    id: "adset_005",
    campaign_id: "camp_001",
    name: "Summer Sale - DE - 25-50",
    status: "ACTIVE",
    daily_budget: "850",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-15T11:45:00",
    insights: {
      data: [
        {
          spend: "467.89",
          clicks: "162",
          impressions: "4450",
        },
      ],
    },
  },
  {
    id: "adset_006",
    campaign_id: "camp_001",
    name: "Summer Sale - FR - 18-45",
    status: "PAUSED",
    daily_budget: "700",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-15T12:00:00",
    insights: {
      data: [
        {
          spend: "289.45",
          clicks: "98",
          impressions: "2780",
        },
      ],
    },
  },

  // Campaign 2: Brand Awareness Q1 (5 ad sets)
  {
    id: "adset_007",
    campaign_id: "camp_002",
    name: "Brand Awareness - Lookalike 1%",
    status: "ACTIVE",
    daily_budget: "1500",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "REACH",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-10T09:15:00",
    insights: {
      data: [
        {
          spend: "567.89",
          clicks: "210",
          impressions: "6700",
        },
      ],
    },
  },
  {
    id: "adset_008",
    campaign_id: "camp_002",
    name: "Brand Awareness - Lookalike 2-3%",
    status: "ACTIVE",
    daily_budget: "1200",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "REACH",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-10T09:30:00",
    insights: {
      data: [
        {
          spend: "489.34",
          clicks: "187",
          impressions: "5890",
        },
      ],
    },
  },
  {
    id: "adset_009",
    campaign_id: "camp_002",
    name: "Brand Awareness - Interest Targeting",
    status: "ACTIVE",
    daily_budget: "1100",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "REACH",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-10T09:45:00",
    insights: {
      data: [
        {
          spend: "512.67",
          clicks: "198",
          impressions: "6123",
        },
      ],
    },
  },
  {
    id: "adset_010",
    campaign_id: "camp_002",
    name: "Brand Awareness - Broad Targeting",
    status: "ACTIVE",
    daily_budget: "1000",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "REACH",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-10T10:00:00",
    insights: {
      data: [
        {
          spend: "478.92",
          clicks: "176",
          impressions: "5567",
        },
      ],
    },
  },
  {
    id: "adset_011",
    campaign_id: "camp_002",
    name: "Brand Awareness - Engaged Shoppers",
    status: "ACTIVE",
    daily_budget: "1300",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "REACH",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-10T10:15:00",
    insights: {
      data: [
        {
          spend: "623.45",
          clicks: "234",
          impressions: "7234",
        },
      ],
    },
  },

  // Campaign 3: Product Launch - Old (4 ad sets - all PAUSED)
  {
    id: "adset_012",
    campaign_id: "camp_003",
    name: "Product Launch - Cold Audience",
    status: "PAUSED",
    daily_budget: "600",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2023-12-05T14:25:00",
    insights: {
      data: [
        {
          spend: "234.56",
          clicks: "80",
          impressions: "2300",
        },
      ],
    },
  },
  {
    id: "adset_013",
    campaign_id: "camp_003",
    name: "Product Launch - Warm Audience",
    status: "PAUSED",
    daily_budget: "700",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2023-12-05T14:40:00",
    insights: {
      data: [
        {
          spend: "312.34",
          clicks: "105",
          impressions: "2890",
        },
      ],
    },
  },
  {
    id: "adset_014",
    campaign_id: "camp_003",
    name: "Product Launch - Website Visitors",
    status: "PAUSED",
    daily_budget: "550",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2023-12-05T15:00:00",
    insights: {
      data: [
        {
          spend: "198.67",
          clicks: "67",
          impressions: "1950",
        },
      ],
    },
  },
  {
    id: "adset_015",
    campaign_id: "camp_003",
    name: "Product Launch - Competitor Interest",
    status: "PAUSED",
    daily_budget: "650",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2023-12-05T15:20:00",
    insights: {
      data: [
        {
          spend: "267.89",
          clicks: "89",
          impressions: "2456",
        },
      ],
    },
  },

  // Campaign 4: Holiday Special Offers (7 ad sets)
  {
    id: "adset_016",
    campaign_id: "camp_004",
    name: "Holiday - Top Performers",
    status: "ACTIVE",
    daily_budget: "2000",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T11:50:00",
    insights: {
      data: [
        {
          spend: "890.12",
          clicks: "320",
          impressions: "8900",
        },
      ],
    },
  },
  {
    id: "adset_017",
    campaign_id: "camp_004",
    name: "Holiday - Best Sellers",
    status: "ACTIVE",
    daily_budget: "1800",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T12:00:00",
    insights: {
      data: [
        {
          spend: "756.34",
          clicks: "289",
          impressions: "7890",
        },
      ],
    },
  },
  {
    id: "adset_018",
    campaign_id: "camp_004",
    name: "Holiday - New Arrivals",
    status: "ACTIVE",
    daily_budget: "1500",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T12:15:00",
    insights: {
      data: [
        {
          spend: "623.78",
          clicks: "234",
          impressions: "6540",
        },
      ],
    },
  },
  {
    id: "adset_019",
    campaign_id: "camp_004",
    name: "Holiday - Limited Edition",
    status: "ACTIVE",
    daily_budget: "1600",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T12:30:00",
    insights: {
      data: [
        {
          spend: "689.45",
          clicks: "267",
          impressions: "7234",
        },
      ],
    },
  },
  {
    id: "adset_020",
    campaign_id: "camp_004",
    name: "Holiday - Gift Sets",
    status: "ACTIVE",
    daily_budget: "1400",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T12:45:00",
    insights: {
      data: [
        {
          spend: "578.90",
          clicks: "223",
          impressions: "6123",
        },
      ],
    },
  },
  {
    id: "adset_021",
    campaign_id: "camp_004",
    name: "Holiday - Flash Deals",
    status: "ACTIVE",
    daily_budget: "1700",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T13:00:00",
    insights: {
      data: [
        {
          spend: "712.56",
          clicks: "278",
          impressions: "7567",
        },
      ],
    },
  },
  {
    id: "adset_022",
    campaign_id: "camp_004",
    name: "Holiday - Bundle Offers",
    status: "ACTIVE",
    daily_budget: "1300",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-20T13:15:00",
    insights: {
      data: [
        {
          spend: "534.67",
          clicks: "212",
          impressions: "5890",
        },
      ],
    },
  },

  // Campaign 5: Retargeting Campaign (5 ad sets)
  {
    id: "adset_023",
    campaign_id: "camp_005",
    name: "Retargeting - Last 30 Days",
    status: "ACTIVE",
    daily_budget: "750",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-18T08:35:00",
    insights: {
      data: [
        {
          spend: "312.45",
          clicks: "145",
          impressions: "3800",
        },
      ],
    },
  },
  {
    id: "adset_024",
    campaign_id: "camp_005",
    name: "Retargeting - Cart Abandoners",
    status: "ACTIVE",
    daily_budget: "900",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-18T08:50:00",
    insights: {
      data: [
        {
          spend: "456.78",
          clicks: "198",
          impressions: "4890",
        },
      ],
    },
  },
  {
    id: "adset_025",
    campaign_id: "camp_005",
    name: "Retargeting - Product Viewers",
    status: "ACTIVE",
    daily_budget: "800",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-18T09:05:00",
    insights: {
      data: [
        {
          spend: "389.23",
          clicks: "167",
          impressions: "4234",
        },
      ],
    },
  },
  {
    id: "adset_026",
    campaign_id: "camp_005",
    name: "Retargeting - Add to Cart",
    status: "ACTIVE",
    daily_budget: "850",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-18T09:20:00",
    insights: {
      data: [
        {
          spend: "423.56",
          clicks: "189",
          impressions: "4567",
        },
      ],
    },
  },
  {
    id: "adset_027",
    campaign_id: "camp_005",
    name: "Retargeting - Past Purchasers",
    status: "ACTIVE",
    daily_budget: "700",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "CONVERSIONS",
    billing_event: "IMPRESSIONS",
    created_time: "2024-01-18T09:35:00",
    insights: {
      data: [
        {
          spend: "345.89",
          clicks: "156",
          impressions: "3678",
        },
      ],
    },
  },
];

export const mockUser = {
  id: "user_demo_001",
  username: "demo_user",
  email: "demo@example.com",
};

export const mockFacebookConnection = {
  connected: true,
  businesses: [
    {
      id: "biz_001",
      name: "Demo Business 1",
    },
    {
      id: "biz_002",
      name: "Demo Business 2",
    },
  ],
  adAccounts: mockAdAccounts,
  pages: [
    {
      id: "page_001",
      name: "Demo Page 1",
    },
    {
      id: "page_002",
      name: "Demo Page 2",
    },
  ],
};

// Helper function to check if we should use mock data
export const shouldUseMockData = () => {
  // Check localStorage first
  const localStorageSetting = localStorage.getItem("USE_MOCK_DATA");
  if (localStorageSetting !== null) {
    return localStorageSetting === "true";
  }

  // Check environment variable (for Vite)
  if (import.meta.env.VITE_USE_MOCK_DATA === "true") {
    return true;
  }

  // Default: use mock data in development if backend is not available
  return false;
};

// Helper to simulate API delay
export const mockApiDelay = (ms = 500) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
