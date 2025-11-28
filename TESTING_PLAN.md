# Testing Plan - Multi-Campaign/Multi-Account Features

## Overview
Testing untuk 2 fitur utama:
1. **Create Campaign for Multiple Ad Accounts** - Buat 1 campaign di multiple ad accounts
2. **Create Ad Set for Multiple Campaigns** - Buat 1 ad set di multiple campaigns (dengan optional ads)

---

## Feature 1: Create Campaign for Multiple Ad Accounts

### Flow:
1. Click button "📋 Create Campaign (Multi-Account)" di header
2. **Step 1**: Select Ad Accounts
   - Search ad accounts
   - Select All / Deselect All
   - Click Next
3. **Step 2**: Configure Campaign
   - Campaign Name*
   - Objective* (Traffic, Engagement, Leads, Sales, Awareness)
   - Status (ACTIVE/PAUSED)
   - Special Ad Categories (Credit, Employment, Housing)
   - Budget Type (Daily/Lifetime/None - CBO)
   - Budget Amount (if CBO enabled)
4. Click "Create Campaign"
5. Success/Partial/Failure notification
6. Auto refresh page

### Test Cases:

#### TC1: Success - All Campaigns Created
- **Input**:
  - Select 3 ad accounts
  - Campaign name: "Test Multi Account - Success"
  - Objective: OUTCOME_TRAFFIC
  - Status: PAUSED
  - No special ad categories
  - Budget: Daily $10
- **Expected**:
  - Alert: "Campaign created successfully in 3 account(s)"
  - Page reloads
  - 3 new campaigns visible in each account

#### TC2: Partial Success - Some Fail
- **Input**:
  - Select 5 ad accounts (mix of valid and potentially problematic)
  - Campaign name: "Test Partial Success"
  - Objective: OUTCOME_LEADS
  - Special Ad Categories: CREDIT
  - Budget: Lifetime $100
- **Expected**:
  - Alert: "Campaign created in X account(s), failed in Y account(s)"
  - Status 207 (Multi-Status)
  - Results show which succeeded/failed

#### TC3: Total Failure - All Fail
- **Input**:
  - Invalid/restricted ad accounts
  - OR missing required fields (should be caught by validation)
- **Expected**:
  - Alert: "Failed to create campaign in all accounts"
  - Status 500
  - Error details in console

#### TC4: Validation Errors
- **Input**:
  - Empty campaign name
  - No objective selected
  - Budget amount without budget type
- **Expected**:
  - Frontend validation alerts before API call
  - No API request made

---

## Feature 2: Create Ad Set for Multiple Campaigns

### Flow:
1. Click button "+ Create Ad Set for Multiple Campaigns" di campaign column
2. **Step 1**: Select Campaigns
   - Search campaigns
   - Select All / Deselect All
   - Click Next
3. **Step 2**: Configure Ad Set
   - Ad Set Name*
   - Status (ACTIVE/PAUSED)
   - Optimization Goal (optional but recommended)
   - Billing Event (optional)
   - Page (optional)
   - Pixel (optional)
   - Custom Event Type (if OFFSITE_CONVERSIONS)
   - Bid Strategy*
   - Bid Amount (if applicable)
   - Budget Type* (Daily/Lifetime)
   - Budget Amount*
   - Start Date & Time*
   - End Date & Time (required for Lifetime, optional for Daily)
   - Ad Scheduling (optional)
   - Age* (Min/Max)
   - Countries* (geo targeting)
4. Click "Create Ad Sets"
5. **Step 3**: Ad Creatives (Success Banner)
   - Show success count
   - Option: "Continue to Upload Creatives" or "Skip for Now"
6. **Step 4**: Upload Creatives (if Continue)
   - Drag & drop images/videos
   - OR browse files
   - OR paste Google Drive link
   - Click "Continue to Ad Copy"
7. **Step 5**: Ad Copy
   - Primary Text*
   - Headline*
   - Page*
   - Description (optional)
   - Call to Action (optional)
   - Website URL*
   - Display Link (optional)
8. Click "Publish Ads"
9. Success notification + option to view in Ads Manager

### Test Cases:

#### TC5: Success - Multiple Ad Sets + Ads Created
- **Input**:
  - Select 3 campaigns (from same account)
  - Ad Set Name: "Test AdSet Multi-Campaign Success"
  - Status: PAUSED
  - Optimization Goal: LINK_CLICKS
  - Billing Event: IMPRESSIONS
  - Bid Strategy: LOWEST_COST_WITHOUT_CAP
  - Budget: Daily $5
  - Start: Tomorrow 00:00
  - End: Empty (ongoing)
  - Age: 25-45
  - Countries: Indonesia, Malaysia
  - Upload 2 images
  - Primary Text: "Test ad copy"
  - Headline: "Test headline"
  - Page: Select page
  - CTA: LEARN_MORE
  - URL: https://example.com
- **Expected**:
  - Step 2: 3 ad sets created successfully
  - Step 3: Success banner shows "3 ad sets created successfully"
  - Step 4: Files uploaded successfully
  - Step 5: Ads published to all 3 ad sets
  - Final: Success message + "View in Ads Manager" button

#### TC6: Success - Ad Sets Only (Skip Ads)
- **Input**:
  - Same as TC5 but click "Skip for Now" at Step 3
- **Expected**:
  - 3 ad sets created successfully
  - Modal closes
  - Page reloads
  - Ad sets visible in UI

#### TC7: Partial Success - Some Ad Sets Fail
- **Input**:
  - Select 5 campaigns (mix of different accounts/types)
  - Potentially conflicting settings
  - OR campaigns with special ad categories requiring specific targeting
- **Expected**:
  - Some ad sets created, some failed
  - Step 3: Success banner shows "X ad sets created successfully"
  - Failed details in console
  - If continuing to ads, ads only created for successful ad sets

#### TC8: Total Failure - All Ad Sets Fail
- **Input**:
  - Invalid campaign selections
  - OR budget below minimum ($1)
  - OR end date before start date
- **Expected**:
  - Alert: Error message
  - No ad sets created
  - Modal stays open for correction

#### TC9: Special Ad Category - Age Restriction
- **Input**:
  - Select campaign with CREDIT/EMPLOYMENT/HOUSING special ad category
  - Age: 25-35 (invalid for special ad category)
- **Expected**:
  - Frontend auto-adjusts age to 18-65
  - Warning message shows
  - Age inputs disabled
  - Ad set creates successfully with corrected age

#### TC10: Lifetime Budget - End Date Required
- **Input**:
  - Budget Type: Lifetime
  - End Date: Empty
- **Expected**:
  - Validation error: "End date is required for lifetime budget"
  - No API call made

#### TC11: OFFSITE_CONVERSIONS - Pixel Required
- **Input**:
  - Optimization Goal: OFFSITE_CONVERSIONS
  - Pixel: Not selected
  - Custom Event Type: Not selected
- **Expected**:
  - Validation warning or API error
  - Ad set creation fails with appropriate message

#### TC12: Ad Scheduling
- **Input**:
  - Enable Ad Scheduling
  - Add 2 schedules: Mon-Fri 9AM-5PM, Sat-Sun 10AM-2PM
- **Expected**:
  - Ad sets created with correct adset_schedule parameter
  - Scheduling visible in Ads Manager

#### TC13: Multiple Images/Videos to Multiple Ad Sets
- **Input**:
  - 3 ad sets created successfully
  - Upload 4 images + 2 videos
  - Create ads
- **Expected**:
  - 6 ad creatives per ad set = 18 total ad creatives
  - Each ad set gets all 6 ads
  - All ads published successfully

#### TC14: Google Drive Upload
- **Input**:
  - Paste Google Drive folder link with 3 images
  - Fetch files
  - Continue to create ads
- **Expected**:
  - Files fetched from Google Drive
  - Images processed successfully
  - Ads created with Drive images

#### TC15: Mixed Success - Ads Partial Failure
- **Input**:
  - 4 ad sets created successfully
  - Upload 3 creatives
  - 1 creative has invalid URL or format
- **Expected**:
  - Some ads created successfully
  - Failed ads reported
  - Summary: "X ads created, Y failed"

---

## API Endpoints to Test

### 1. `/api/create-campaign-multiple` (POST)
**Request Body:**
```json
{
  "ad_account_ids": ["act_123", "act_456"],
  "campaign_name": "Test Campaign",
  "objective": "OUTCOME_TRAFFIC",
  "status": "PAUSED",
  "special_ad_categories": ["CREDIT"],
  "budget_type": "DAILY",
  "budget_amount": 1000
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Campaign created successfully in 2 account(s)",
  "results": [
    { "success": true, "ad_account_id": "act_123", "campaign_id": "123456" },
    { "success": true, "ad_account_id": "act_456", "campaign_id": "789012" }
  ],
  "total_created": 2,
  "total_failed": 0
}
```

**Partial Success Response (207):**
```json
{
  "success": true,
  "message": "Campaign created in 1 account(s), failed in 1 account(s)",
  "results": [
    { "success": true, "ad_account_id": "act_123", "campaign_id": "123456" },
    { "success": false, "ad_account_id": "act_456", "error": { "message": "..." } }
  ],
  "total_created": 1,
  "total_failed": 1
}
```

### 2. `/api/create-ad-set-multiple` (POST)
**Request Body:**
```json
{
  "account_id": "act_123",
  "campaign_ids": ["campaign_1", "campaign_2"],
  "name": "Test AdSet",
  "optimization_goal": "LINK_CLICKS",
  "billing_event": "IMPRESSIONS",
  "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
  "daily_budget": 500,
  "status": "PAUSED",
  "start_time": "2025-11-28T00:00:00",
  "targeting": {
    "age_min": 25,
    "age_max": 45,
    "geo_locations": { "countries": ["ID", "MY"] }
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "base_adset_id": "23851234567890",
  "created_adsets": [
    { "campaign_id": "campaign_1", "adset_id": "23851234567890", "status": "success" },
    { "campaign_id": "campaign_2", "adset_id": "23851234567891", "status": "success" }
  ],
  "failed_adsets": [],
  "total_created": 2,
  "total_failed": 0
}
```

---

## Environment Setup

### Prerequisites:
- Valid Facebook access token
- At least 2 ad accounts with proper permissions
- At least 3 campaigns per account
- Valid page ID
- Valid pixel ID (optional)
- Test budget available

### Test Data:
- Ad Account IDs: [List actual test account IDs]
- Campaign IDs: [List actual test campaign IDs]
- Page ID: [Actual page ID]
- Pixel ID: [Actual pixel ID]
- Test URLs: https://example.com

---

## Success Criteria

### Feature 1 (Multi-Account Campaign):
- ✅ Can select multiple ad accounts
- ✅ Form validation works correctly
- ✅ API creates campaigns in all selected accounts (success case)
- ✅ Partial failures handled gracefully (207 status)
- ✅ Total failures show appropriate error messages
- ✅ Page refreshes after success

### Feature 2 (Multi-Campaign Ad Set):
- ✅ Can select multiple campaigns
- ✅ All form fields properly validated
- ✅ Special ad category auto-adjusts age targeting
- ✅ Lifetime budget requires end date
- ✅ Ad sets created successfully (all)
- ✅ Partial failures handled (some ad sets succeed)
- ✅ Optional ad creation flow works
- ✅ Creative upload (local + Google Drive) works
- ✅ Ads published to all successful ad sets
- ✅ View in Ads Manager button redirects correctly

---

## Known Edge Cases to Test

1. **Campaign Budget Optimization (CBO)**:
   - If campaign has CBO enabled, ad set budget should be ignored
   - Test with CBO campaigns

2. **Special Ad Categories**:
   - Age must be 18-65
   - Test auto-correction

3. **Timezone Issues**:
   - Start/end times in user timezone vs UTC
   - Test with different timezone settings

4. **File Size Limits**:
   - Large video files (>4GB)
   - Many files (>50)

5. **Concurrent Operations**:
   - Creating multiple operations simultaneously
   - Rate limiting

6. **Network Failures**:
   - API timeout
   - Connection loss during creation

---

## Post-Testing Checklist

- [ ] All success cases pass
- [ ] All partial failure cases handled correctly
- [ ] All total failure cases show errors
- [ ] Console shows no errors (except expected validation)
- [ ] Data persists correctly
- [ ] UI updates properly
- [ ] No memory leaks (check with long sessions)
- [ ] Mobile responsive (if applicable)
- [ ] Error messages are user-friendly
- [ ] Loading states work correctly
- [ ] Button states (enabled/disabled) correct

---

## Automation Recommendations

For future CI/CD:
1. Unit tests for validators
2. Integration tests for API endpoints
3. E2E tests with Playwright/Cypress for UI flow
4. Load testing for batch operations
5. Regression tests for bug fixes

---

## Test Execution Log

| Test Case | Date | Tester | Status | Notes |
|-----------|------|--------|--------|-------|
| TC1 | | | | |
| TC2 | | | | |
| TC3 | | | | |
| TC4 | | | | |
| TC5 | | | | |
| TC6 | | | | |
| TC7 | | | | |
| TC8 | | | | |
| TC9 | | | | |
| TC10 | | | | |
| TC11 | | | | |
| TC12 | | | | |
| TC13 | | | | |
| TC14 | | | | |
| TC15 | | | | |
