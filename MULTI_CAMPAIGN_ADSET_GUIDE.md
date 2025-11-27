# Multi-Campaign Ad Set Creation Feature

## Overview
Create identical ad sets across multiple campaigns in a single API call.

## New Endpoint
```
POST /api/create-ad-set-multiple
```

### Request Body
```json
{
  "account_id": "123456789",
  "campaign_ids": ["campaign1", "campaign2", "campaign3"],
  "name": "Multi-Campaign Ad Set",
  "optimization_goal": "OFFSITE_CONVERSIONS",
  "billing_event": "IMPRESSIONS",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "status": "PAUSED",
  "daily_budget": 50,
  "targeting": {
    "geo_locations": { "countries": ["US"] }
  }
  // ... standard ad set fields
}
```

### Response
```json
{
  "success": true,
  "base_adset_id": "120123456789",
  "created_adsets": [
    { "campaign_id": "c1", "adset_id": "120123456789", "status": "success" },
    { "campaign_id": "c2", "adset_id": "120123456790", "status": "success" },
    { "campaign_id": "c3", "adset_id": "120123456791", "status": "success" }
  ],
  "failed": [],
  "total_created": 3
}
```

## Implementation Steps

### 1. Validation (`backend/middleware/validation.js`)
- Add `multiCampaignCreateAdSet` validator
- Required: `campaign_ids` array (min 1 item)
- Validate standard ad set fields
- Check budget type (daily OR lifetime, not both)

### 2. Endpoint Logic (`server.js`)
```javascript
app.post('/api/create-ad-set-multiple', ensureAuthenticatedAPI, validateRequest.multiCampaignCreateAdSet, async (req, res) => {
  // 1. Extract campaign_ids from body
  // 2. Validate all campaigns exist & belong to account
  // 3. Create ad set in first campaign (use existing logic)
  // 4. Duplicate to remaining campaigns using Promise.all()
  // 5. Return aggregated results
});
```

### 3. Creation Flow
1. **Create base ad set** - Use first campaign_id, standard ad set creation
2. **Duplicate to other campaigns** - Reuse duplicate-ad-set logic in parallel
3. **Handle failures gracefully** - Continue on error, report partial success
4. **Cache results** - Use FacebookCacheDB for new ad sets

### 4. Key Considerations
- **Parallel execution** - Use `Promise.allSettled()` for concurrent duplication
- **Campaign validation** - Verify `special_ad_category_country` compatibility
- **Error handling** - Return both successes and failures
- **Telegram notifications** - Alert on critical errors only

## Usage Example
```javascript
// Create ad set across 10 campaigns
const response = await fetch('/api/create-ad-set-multiple', {
  method: 'POST',
  body: JSON.stringify({
    account_id: '123456789',
    campaign_ids: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'],
    name: 'Shared Ad Set',
    optimization_goal: 'LINK_CLICKS',
    daily_budget: 100,
    // ... other fields
  })
});

// Returns array of created ad sets
console.log(response.created_adsets); // 10 ad sets across 10 campaigns
```

## Files to Modify
1. `backend/middleware/validation.js` - Add validator
2. `server.js` - Add endpoint and logic
3. `public/script.js` - Add UI if needed

## Testing Checklist
- [ ] Create ad set across 2 campaigns
- [ ] Create ad set across 10+ campaigns
- [ ] Handle invalid campaign ID
- [ ] Handle cross-account rejection
- [ ] Handle partial failures (5/10 succeed)
- [ ] Verify cache updates
