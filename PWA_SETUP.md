# PWA Setup Guide

Your Leadify CRM is now configured as a Progressive Web App (PWA)! Users can add it to their mobile home screen and use it like a native app.

## What's Been Configured

✅ **Web App Manifest** (`/public/manifest.json`)

- App name, description, theme colors
- Icon definitions for all required sizes
- Display mode set to "standalone" (full screen, no browser UI)

✅ **Service Worker** (`/public/sw.js`)

- Caches essential files for offline access
- Handles network requests with cache-first strategy
- Auto-updates when new versions are deployed

✅ **HTML Meta Tags** (`/index.html`)

- Manifest link
- Apple-specific meta tags for iOS
- Theme color configuration

✅ **Service Worker Registration** (`/src/main.tsx`)

- Automatically registers on app load
- Checks for updates every minute
- Auto-reloads when new version is available

✅ **PWA Icons** (`/public/icon-*.png`)

- All required sizes generated (72x72 to 512x512)
- Currently using placeholder icons (copies of logo)

## Testing the PWA

### On Android (Chrome)

1. Open your deployed app in Chrome
2. Tap the menu (three dots) → **"Add to Home screen"** or **"Install app"**
3. Confirm the installation
4. The app will appear on your home screen
5. Tap it to open in full-screen mode (no browser UI)

### On iOS (Safari)

1. Open your deployed app in Safari
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **"Add to Home Screen"**
4. Edit the name if needed, then tap **"Add"**
5. The app icon will appear on your home screen
6. Tap it to open in full-screen mode

### Desktop (Chrome/Edge)

1. Open your app in Chrome or Edge
2. Look for the install icon in the address bar (or menu)
3. Click **"Install"** or **"Add to Home Screen"**
4. The app will open in its own window

## Verifying PWA Status

### Browser DevTools

1. Open DevTools (F12)
2. Go to **Application** tab (Chrome) or **Application** tab (Firefox)
3. Check **Manifest** section - should show your manifest.json
4. Check **Service Workers** section - should show "activated and running"
5. Check **Storage** → **Cache Storage** - should show cached files

### Lighthouse Audit

1. Open DevTools → **Lighthouse** tab
2. Select **Progressive Web App** category
3. Run audit
4. Should score 90+ for PWA requirements

## Improving Icons (Optional but Recommended)

The current icons are placeholders (copies of your logo). For best results:

1. **Use PWA Builder** (Easiest):

   - Visit: https://www.pwabuilder.com/imageGenerator
   - Upload `public/Leadify12.png`
   - Download generated icons
   - Replace files in `/public` folder

2. **Use Image Editor**:

   - Open your logo in Photoshop/GIMP/Figma
   - Create square canvas (512x512)
   - Center logo with padding
   - Export at each required size
   - Replace files in `/public` folder

3. **Regenerate with Script**:
   ```bash
   node scripts/generate-pwa-icons.js
   ```

## Service Worker Updates

The service worker automatically:

- Caches essential files on first visit
- Serves cached content when offline
- Checks for updates every minute
- Reloads the page when a new version is detected

### Manual Update Check

Users can manually check for updates by:

- Closing and reopening the app
- Refreshing the page (Ctrl+R / Cmd+R)

## Troubleshooting

### Service Worker Not Registering

- Ensure you're serving over HTTPS (required for PWA)
- Check browser console for errors
- Verify `/sw.js` is accessible at the root

### Icons Not Showing

- Clear browser cache
- Verify icon files exist in `/public`
- Check manifest.json paths are correct
- Ensure icons are PNG format

### "Add to Home Screen" Not Appearing

- Ensure HTTPS is enabled
- Check manifest.json is valid (use DevTools → Application → Manifest)
- Verify service worker is registered
- Some browsers require user interaction before showing install prompt

### App Not Opening Full Screen

- Check `display: "standalone"` in manifest.json
- Verify meta tags in index.html
- Clear browser cache and reinstall

## Production Checklist

Before deploying to production:

- [ ] Replace placeholder icons with properly sized versions
- [ ] Test on Android device
- [ ] Test on iOS device
- [ ] Verify service worker caching works
- [ ] Test offline functionality
- [ ] Run Lighthouse PWA audit
- [ ] Update manifest.json with production URL if needed

## Additional Features (Future)

You can enhance the PWA with:

- **Push Notifications**: Already configured in service worker
- **Background Sync**: For offline form submissions
- **App Shortcuts**: Quick actions from home screen
- **Share Target**: Receive shared content from other apps

## Resources

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest)
- [PWA Builder](https://www.pwabuilder.com/)
