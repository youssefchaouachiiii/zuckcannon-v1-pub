# Bulk Uploader React Migration

## 🎉 What's New

This directory contains the **modern React frontend** for Bulk Uploader, replacing the vanilla JavaScript implementation with proper state management and component architecture.

## ✨ Key Improvements

### 1. **Framework-Based Architecture**

- **React 19** with hooks for component logic
- **Zustand** for global state management (lightweight Redux alternative)
- **Vite** for lightning-fast development and builds
- **React Router** for navigation (ready for multi-page expansion)

### 2. **Proper State Management**

```javascript
// Before (Vanilla JS - public/script.js)
appState.updateState("uploadInProgress", true);

// After (React + Zustand)
const setUploadInProgress = useStore((state) => state.setUploadInProgress);
setUploadInProgress(true);
```

### 3. **Upload Protection Built-In**

- ✅ Prevents browser navigation during uploads (`beforeunload`)
- ✅ Confirms before switching accounts/campaigns mid-upload
- ✅ Automatic state cleanup on upload completion/error
- ✅ Visual indicators when upload is active

### 4. **Component Structure**

```
src/
├── components/
│   ├── columns/          # 4-column layout components
│   │   ├── AccountColumn.jsx
│   │   ├── CampaignColumn.jsx
│   │   ├── ActionColumn.jsx
│   │   └── WorkflowColumn.jsx
│   └── workflows/        # Action-specific workflows
│       └── UploadWorkflow.jsx
├── hooks/               # Custom React hooks
│   └── useUploadProtection.js
├── store/              # Global state (Zustand)
│   └── useStore.js
└── utils/              # Helper functions
```

## 🚀 Getting Started

### Development Mode

```bash
cd client
npm run dev
```

This starts Vite dev server on `http://localhost:3000` with:

- Hot Module Replacement (HMR)
- API proxy to backend (`http://localhost:6969`)
- Fast refresh on file changes

### Production Build

```bash
cd client
npm run build
```

Outputs to `../public-react/` directory. Configure your server to serve from this location for production.

## 🔧 Configuration

### Vite Proxy (vite.config.js)

```javascript
server: {
  proxy: {
    '/api': 'http://localhost:6969',  // Backend API
    '/data': 'http://localhost:6969', // Static data files
  }
}
```

### Environment Variables (Optional)

Create `.env` file in `client/` directory:

```env
VITE_API_URL=http://localhost:6969
VITE_DEV_MODE=true
```

## 📦 State Management

### Zustand Store (`src/store/useStore.js`)

Replaces `AppStateManager` class with proper React state:

```javascript
// Usage in components
import useStore from "../store/useStore";

function MyComponent() {
  // Subscribe to specific state (only re-renders when this changes)
  const selectedAccount = useStore((state) => state.selectedAccount);
  const setSelectedAccount = useStore((state) => state.setSelectedAccount);

  // Subscribe to upload state
  const uploadInProgress = useStore((state) => state.uploadInProgress);

  return <div>{uploadInProgress && <p>Upload in progress...</p>}</div>;
}
```

### Key State Slices

| Slice              | Description                          |
| ------------------ | ------------------------------------ |
| `selectedAccount`  | Currently selected Meta ad account   |
| `selectedCampaign` | Currently selected campaign ID       |
| `uploadInProgress` | Boolean flag for active uploads      |
| `uploadedAssets`   | Array of successfully uploaded files |
| `metaData`         | Cached Facebook API data             |

## 🛡️ Upload Protection

### How It Works

**1. Global Hook (`useUploadProtection`)**

```javascript
// In App.jsx - protects entire application
function App() {
  useUploadProtection(); // Enables beforeunload protection
  return <YourApp />;
}
```

**2. Navigation Guard**

```javascript
// In any column component
const { shouldBlock, checkNavigation } = useNavigationGuard();

const handleClick = (item) => {
  if (shouldBlock && !checkNavigation(item.name)) {
    return; // User cancelled navigation
  }
  // Proceed with navigation
};
```

**3. Automatic Cleanup**

- Upload state cleared on completion
- SSE connections closed properly
- Progress trackers reset

## 🎨 Styling

CSS is modular and component-scoped:

- `App.css` - Main layout and header
- `Column.css` - Shared column styles
- `UploadWorkflow.css` - Upload-specific styles

Uses CSS custom properties for theming:

```css
/* Main gradient */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
```

## 🔄 Migration Path

### Phase 1: ✅ Complete

- [x] React scaffold with Vite
- [x] Zustand state management
- [x] Upload protection hooks
- [x] 4-column layout components
- [x] Basic upload workflow

### Phase 2: In Progress

- [ ] Migrate remaining workflows (duplicate, library selection)
- [ ] Ad copy form with validation
- [ ] Ad set configuration
- [ ] Batch ad creation
- [ ] Google Drive integration

### Phase 3: Future

- [ ] Testing (Vitest + React Testing Library)
- [ ] Error boundaries
- [ ] Loading states with suspense
- [ ] Optimistic UI updates
- [ ] Offline support (PWA)

## 📝 API Integration

All API calls remain the same:

```javascript
// Fetch Meta data
const response = await fetch("/api/fetch-meta-data");
const data = await response.json();

// Upload files
const formData = new FormData();
formData.append("file", file);
formData.append("account_id", accountId);

const response = await fetch("/api/upload-videos", {
  method: "POST",
  body: formData,
});
```

## 🐛 Debugging

### Redux DevTools

Zustand integrates with Redux DevTools:

1. Install browser extension
2. Open DevTools
3. Navigate to "Redux" tab
4. See all state changes in real-time

### React DevTools

1. Install React DevTools extension
2. Inspect component hierarchy
3. View props and state
4. Trace renders and performance

## 🚢 Deployment

### Development Server

```bash
# Terminal 1: Backend
npm run dev

# Terminal 2: Frontend
cd client && npm run dev
```

### Production

```bash
# Build React app
cd client && npm run build

# Serve from backend (update server.js)
app.use(express.static('public-react'));
```

## 📚 Resources

- [React Docs](https://react.dev)
- [Zustand Docs](https://docs.pmnd.rs/zustand)
- [Vite Docs](https://vitejs.dev)
- [React Router](https://reactrouter.com)

## 🎯 Next Steps

1. **Test the dev server**: `npm run dev` in `client/` directory
2. **Migrate next workflow**: Start with ad copy form
3. **Add error boundaries**: Catch component errors gracefully
4. **Write tests**: Set up Vitest for unit/integration tests
5. **Optimize builds**: Code splitting and lazy loading

---

**Made with ⚛️ React & 💜 by the Bulk Uploader team**
