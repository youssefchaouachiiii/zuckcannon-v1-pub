# ZuckCannon v1.0

ZuckCannon is a powerful web application for managing and deploying Meta (Facebook) advertising campaigns. It provides an intuitive interface for browsing ad accounts, campaigns, ad sets, and creative assets while integrating with Facebook's Marketing API and Google Drive for media storage.

## Features

- **Facebook Integration**: Browse and manage ad accounts, campaigns, ad sets, and ads
- **Creative Library**: Upload, organize, and manage creative assets (images/videos)
- **Batch Operations**: Create multiple ads at once with different creative combinations
- **Google Drive Integration**: Automatic backup of creative assets to Google Drive
- **Multi-user Support**: Secure authentication system with session management
- **Real-time Updates**: Pull latest data from Facebook Marketing API
- **Media Processing**: Automatic video thumbnail generation using FFmpeg

## Prerequisites

Before setting up ZuckCannon, ensure you have:

- Node.js (v14 or higher)
- npm (Node Package Manager)
- FFmpeg installed on your system
- A Facebook Business account with access to the Marketing API
- A Google Cloud project with Drive API enabled
- SQLite3 (comes bundled with most systems)

## Environment Variables

Create a `.env` file in the root directory with the following required keys:

```env
# Meta/Facebook Configuration
META_ACCESS_TOKEN=your_meta_access_token
META_SYSTEM_USER_ID=your_meta_system_user_id

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_google_redirect_uri
GOOGLE_REFRESH_TOKEN=your_google_refresh_token

# Telegram Bot (Optional)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Application Configuration
SESSION_SECRET=your_session_secret_here
NODE_ENV=development
PORT=6969
FRONTEND_URL=http://localhost:6969

# FFmpeg Path (optional, defaults to 'ffmpeg' if in PATH)
FFMPEG_PATH=/path/to/ffmpeg
```

## Installation

1. **Clone the repository**

   ```bash
   git clone [repository-url]
   cd MetaMass
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Initialize directories**
   The application will automatically create necessary directories when you run it for the first time:
   - `data/db` - SQLite databases
   - `data/uploads` - Temporary upload storage
   - `data/creative-library` - Creative assets storage
     - `videos/`
     - `images/`
     - `thumbnails/`

## Setting Up the Application

### 1. Create Initial User

Before running the application, you need to create at least one user account:

```bash
npm run create-user
```

Follow the prompts to enter:

- Username (required)
- Password (required)
- Email (optional)

The script will confirm the user creation and display all existing users.

### 2. Running the Application

**Development mode** (with auto-restart on file changes):

```bash
npm run dev
# or
npm run s
```

**Production mode**:

```bash
npm start
```

The application will be available at `http://localhost:6969` (or the port specified in your `.env` file).

## Database Structure

ZuckCannon uses SQLite databases for data storage:

- **users.db** - User authentication and sessions
- **creative-library.db** - Creative assets metadata
- **facebook-cache.db** - Cached Facebook API data for performance

## Directory Structure

```
MetaMass/
├── backend/
│   ├── auth/              # Authentication logic
│   ├── db/               # Database files
│   ├── middleware/       # Express middleware
│   └── utils/            # Utility functions
├── data/                 # Application data (created automatically)
│   ├── creative-library/ # Creative assets storage
│   ├── db/              # SQLite databases
│   └── uploads/         # Temporary uploads
├── public/              # Frontend static files
│   ├── index.html       # Main application page
│   ├── login.html       # Login page
│   ├── script.js        # Frontend JavaScript
│   └── app.css          # Styles
├── create-user.js       # User creation script
├── init-directories.js  # Directory initialization
└── server.js           # Main Express server
```

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production` in your `.env` file
2. Update `FRONTEND_URL` to your production domain
3. Ensure proper CORS configuration for your domain
4. Set up a reverse proxy (nginx configuration examples are included)
5. In production, the app expects a `/data` directory for persistent storage

## Security Considerations

- All passwords are hashed using bcrypt
- Sessions are secured with express-session
- CORS is configured to allow only specified origins
- Rate limiting is implemented for login attempts and API calls
- Helmet.js is used for security headers
- File upload size is limited to 4GB per file

## API Endpoints

The application provides various REST API endpoints:

- **Auth**: `/login`, `/logout`, `/auth/check`
- **Facebook Data**: `/api/ad-accounts`, `/api/campaigns`, `/api/adsets`, `/api/ads`
- **Creative Management**: `/api/creatives`, `/api/creatives/upload`, `/api/creative/:id`
- **Batch Operations**: `/api/create-ads`

## Troubleshooting

1. **FFmpeg not found**: Ensure FFmpeg is installed and accessible in your PATH, or specify the full path in `FFMPEG_PATH`

2. **Database errors**: Check that the `data/db` directory exists and has proper write permissions

3. **Authentication issues**: Ensure `SESSION_SECRET` is set and consistent across server restarts

4. **Upload failures**: Verify that upload directories exist and have proper permissions

5. **Facebook API errors**: Check that your Meta access token is valid and has the necessary permissions

## Support

For issues, bugs, or feature requests, please open an issue in the project repository.
