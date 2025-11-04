# Facebook OAuth Integration Guide

## Overview

This system now uses **Facebook OAuth** instead of the System User ID method for connecting business portfolios, ad accounts, and Facebook pages. This makes it much simpler for media buyers to manage their own Facebook assets.

## Features

✅ **User-Specific Access**: Each user connects their own Facebook account
✅ **Multi-Account Support**: Manage multiple ad accounts, pages, and businesses
✅ **Automatic Sync**: Fetch and store all accessible resources
✅ **Fallback Support**: System still works with old System User ID method if configured
✅ **Real-time Updates**: Sync button to refresh Facebook data on demand

## Setup Instructions

### 1. Facebook App Configuration

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Navigate to your app settings
3. Add **Valid OAuth Redirect URIs**:

   - Development: `http://localhost:6969/auth/facebook/callback`
   - Production: `https://productiondomain.com/auth/facebook/callback`

4. Ensure your app has the following **permissions** approved:
   - `pages_show_list`
   - `pages_read_engagement`
   - `ads_management`
   - `ads_read`
   - `business_management`
   - `pages_manage_ads`
   - `pages_manage_metadata`
   - `pages_read_user_content`
   - `leads_retrieval`

### 2. Environment Configuration

Update your `.env` file:

```env
# Meta/Facebook Configuration
META_APP_ID=your_app_id
META_APP_SECRET=your_app_secret
META_OAUTH_CALLBACK_URL=http://localhost:6969/auth/facebook/callback

# Optional: System User fallback (legacy)
META_ACCESS_TOKEN=your_system_token
META_SYSTEM_USER_ID=your_system_user_id
```

### 3. Database Schema

The system automatically creates these tables in `facebook-auth.db`:

- **facebook_tokens**: Stores user access tokens
- **facebook_businesses**: Business portfolios
- **facebook_ad_accounts**: Ad accounts with metadata
- **facebook_pages**: Facebook pages with page tokens

## Usage

### For End Users

1. **Login** to Bulk Uploader
2. Click the **"Connect Facebook"** button in the header
3. Review the connection modal
4. Click **"Connect Facebook"** to authorize
5. Complete Facebook OAuth flow
6. Click **"Sync Data"** to fetch all accessible resources

### For Developers

#### Check Connection Status

```javascript
const response = await fetch("/api/facebook/status");
const data = await response.json();
console.log(data.connected); // true or false
```

#### Get User's Facebook Data

```javascript
const response = await fetch("/api/facebook/data");
const data = await response.json();
// Returns: { connected, token, businesses, adAccounts, pages }
```

#### Sync Facebook Resources

```javascript
const response = await fetch("/api/facebook/sync", { method: "POST" });
const result = await response.json();
// Fetches and stores all accessible resources
```

#### Disconnect Facebook

```javascript
const response = await fetch("/api/facebook/disconnect", { method: "POST" });
```

## API Endpoints

### GET `/auth/facebook`

Initiates Facebook OAuth flow. Requires authenticated user.

### GET `/auth/facebook/callback`

OAuth callback endpoint. Handles token exchange and storage.

### GET `/api/facebook/status`

Returns connection status: `{ connected: boolean }`

### GET `/api/facebook/data`

Returns all user's Facebook data including businesses, ad accounts, and pages.

### POST `/api/facebook/sync`

Fetches latest data from Facebook and updates database.
Returns synced data with counts.

### POST `/api/facebook/disconnect`

Removes Facebook connection for current user.

## Token Flow

1. **User Authentication**: User logs into Bulk Uploader
2. **Facebook OAuth**: User clicks "Connect Facebook" → redirected to Facebook
3. **Authorization**: User grants permissions
4. **Token Storage**: Access token saved to `facebook_tokens` table
5. **Resource Sync**: System fetches businesses, ad accounts, pages
6. **API Calls**: All Facebook API calls use user's token (with system token fallback)

## Migration from System User

The system supports **both methods simultaneously**:

- **OAuth tokens** (preferred): User-specific access via `/me/` endpoints
- **System User** (fallback): Uses `META_ACCESS_TOKEN` and `META_SYSTEM_USER_ID`

### Token Priority

1. User's OAuth token (if connected)
2. System User token (if configured in `.env`)
3. Error if neither available

### Helper Function

```javascript
// Automatically selects appropriate token
const token = await getAccessToken(userId);
```

## Security Considerations

1. **Token Storage**: Tokens stored in SQLite with user isolation
2. **Session Management**: OAuth requires active user session
3. **Token Expiration**: Facebook user tokens don't expire by default (long-lived)
4. **Permissions**: Only requested permissions are granted

## Troubleshooting

### "Facebook not connected" Error

**Solution**: User needs to click "Connect Facebook" button and complete OAuth flow.

### OAuth Redirect Mismatch

**Solution**: Ensure `META_OAUTH_CALLBACK_URL` matches exactly with Facebook App settings.

### Missing Permissions

**Solution**: Request additional permissions in Facebook App Review or during development.

### Token Expired

**Solution**: User should disconnect and reconnect Facebook account.

### No Ad Accounts Showing

**Solution**:

1. Ensure user has access to ad accounts in Business Manager
2. Click "Sync Data" button to refresh
3. Check Business Manager permissions

## Database Queries

### Find User's Ad Accounts

```sql
SELECT * FROM facebook_ad_accounts WHERE user_id = ?
```

### Check Connection Status

```sql
SELECT * FROM facebook_tokens
WHERE user_id = ?
AND (expires_at IS NULL OR expires_at > datetime('now'))
```

### Get All User's Resources

```sql
SELECT
  (SELECT COUNT(*) FROM facebook_ad_accounts WHERE user_id = ?) as ad_accounts,
  (SELECT COUNT(*) FROM facebook_pages WHERE user_id = ?) as pages,
  (SELECT COUNT(*) FROM facebook_businesses WHERE user_id = ?) as businesses
```

## Development Tips

1. **Use development mode**: Set `NODE_ENV=development` to bypass auth checks
2. **Check console logs**: OAuth flow logs all steps
3. **Test with test users**: Use Facebook test users for development
4. **Clear cache**: Delete `facebook-auth.db` to reset connections

## Production Deployment

1. Update `META_OAUTH_CALLBACK_URL` to production domain
2. Add production URL to Facebook App's Valid OAuth Redirect URIs
3. Submit app for review if using advanced permissions
4. Test OAuth flow in production environment
5. Monitor token refresh and expiration

## Support

For issues or questions:

1. Check server logs for detailed error messages
2. Verify Facebook App configuration
3. Test with Facebook's Graph API Explorer
4. Review permissions in Business Manager
