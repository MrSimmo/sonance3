# Deployment Guide — Sonance on Samsung Q90R

Deploy Sonance to your Samsung Q90R (2019, Tizen 5.0) via Jellyfin2Samsung sideloading.

## Prerequisites

- **Samsung Q90R** (or compatible 2019+ Tizen 5.0 TV) with **Developer Mode** enabled
- **Jellyfin2Samsung** installed on your PC or Mac ([GitHub](https://github.com/nichill/jellyfin2samsung))
- **Navidrome** server running and accessible on the same LAN as the TV
- The built `Sonance.wgt` file (run `./build.sh` to generate it)

## Step 1: Enable Developer Mode on Your TV

1. Open **Apps** on your Samsung TV
2. Press **1, 2, 3, 4, 5** on the remote in sequence — a dialog will appear
3. Toggle **Developer Mode** to **ON**
4. Enter the **IP address of your PC/Mac** (the machine running Jellyfin2Samsung)
5. **Reboot** the TV

Developer Mode disables itself after a period — you may need to re-enable it for updates.

## Step 2: Find Your TV's IP Address

1. On the TV, go to **Settings → General → Network → Network Status**
2. Note the **IP Address** (e.g. `192.168.0.10`)
3. Ensure the TV and your PC are on the **same network/subnet**

## Step 3: Install via Jellyfin2Samsung

1. Open **Jellyfin2Samsung** on your PC/Mac
2. Enter your **TV's IP address**
3. Go to **Settings** or use the custom widget install option
4. Select **Sonance.wgt** from your filesystem
5. Click **Install**
6. Wait for the installation to complete — the app will appear in your TV's app list

## Step 4: Launch and Configure

1. Open **Sonance** from your TV's app list
2. On the login screen, enter:
   - **Server URL**: Your Navidrome server address (e.g. `http://192.168.0.2`)
   - **Port**: Your Navidrome port (e.g. `4534`)
   - **Username**: Your Navidrome username
   - **Password**: Your Navidrome password
3. Press **Connect** — the app will verify the connection and log you in
4. Your credentials are saved — you won't need to log in again unless you log out

## Updating the App

1. Rebuild the `.wgt` file: `./build.sh`
2. Re-install via Jellyfin2Samsung (same steps as above — it will overwrite the existing installation)

## Navidrome CORS Configuration

If you encounter connection issues, you may need to configure CORS on your Navidrome server.

Add the following to your Navidrome environment/config:

```
ND_CORSORGINS=*
```

Or more restrictively, set it to the app origin:

```
ND_CORSORGINS=app://
```

For Docker deployments, add to your `docker-compose.yml`:

```yaml
environment:
  ND_CORSORGINS: "*"
```

Restart Navidrome after changing the configuration.

## Network Requirements

- TV and Navidrome server must be on the **same local network**
- The Navidrome server must be reachable from the TV's IP address
- No VPN, firewall, or VLAN isolation between the TV and server
- The Subsonic API endpoint (`/rest/`) must be accessible (Navidrome enables this by default)

## Troubleshooting

### "Connection failed" on login
- Verify the server URL and port are correct
- Check that Navidrome is running and accessible from another device on the same network
- Try pinging the Navidrome server from a device on the same subnet as the TV
- Check Navidrome logs for incoming requests

### Developer Mode keeps disabling
- This is normal Samsung behavior — Developer Mode times out
- Re-enable it following Step 1 when you need to reinstall

### App doesn't appear after install
- Reboot the TV
- Check Jellyfin2Samsung output for errors
- Verify the TV's IP address is correct and the TV is in Developer Mode

### No audio playback on TV
- Sonance uses the **Tizen AVPlay API** for audio — this requires the `tv.audio` privilege (already included in config.xml)
- Verify your music files are in a supported codec (FLAC, MP3, AAC, OGG)
- Check that the Navidrome transcoding settings aren't set to an unsupported format

### Album art not loading
- Album art is loaded from Navidrome's `/rest/getCoverArt.view` endpoint
- Verify cover art displays correctly in the Navidrome web UI
- Large cover art files may take a moment to load over the network

### TV remote navigation
- Use **Arrow keys** to navigate between elements
- **Enter/OK** to select/activate
- **Back** button to go back or move focus to sidebar
- **Play/Pause** button works globally from any screen
- **Rewind/Fast Forward** for previous/next track
