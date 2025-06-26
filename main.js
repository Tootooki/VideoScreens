const { app, BrowserWindow, BrowserView, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const HEADER_H = 35;                       // slim bar
let win;
let headerView;                            // always on top
let views = [];                            // 16 site panes
let urls = [
  'https://sellercentral.amazon.com/home',
  'https://advertising.amazon.com/cm/campaigns?merchantId=A24MUP3TS893HW&locale=en_US&ref=RedirectedFromSellerCentralByRoutingService&entityId=ENTITY267R8T9ZUXH6L',
  'https://sellercentral.amazon.com/myinventory/unfulfillable/index.html?ref_=myi_ul_vl_myi',
  'https://sellercentral.amazon.com/fba/dashboard/?ref_=myi_dashboard_vl_unful',
  'https://sellercentral.amazon.com/inventoryplanning/manageinventoryhealth?ref=fba_dashboard_targeted_experience_banner&sort_column=est_overstock&sort_direction=desc&RECOMMENDATION=OUTLET_DEAL',
  'https://sellercentral.amazon.com/inventoryplanning/manageinventoryhealth?sort_column=inventory_overview&sort_direction=desc&sort_column_sub=onhand',
  'https://sellercentral.amazon.com/gp/ssof/shipping-queue.html?ref=fbacentral_nav_fba#fbashipment',
  'https://sellercentral.amazon.com/restockinventory/recommendations?ref=fbacentral_nav_fba',
  'https://sellercentral.amazon.com/fba/returns/',
  'https://sellercentral.amazon.com/fba-inventory/gim/inventory-list?ref=fbacentral_nav_fba',
  'https://sellercentral.amazon.com/inventory-reimbursement/overview?ref=fbacentral_nav_fba',
  'https://sellercentral.amazon.com/inventoryplanning/stranded-inventory?ref=fbacentral_nav_fba',
  'https://sellercentral.amazon.com/payments/past-settlements?ref_=xx_settle_ttab_disbmt',
  'https://sellercentral.amazon.com/payments/dashboard/index.html?ref_=xx_dash_ttab_trans',
  'https://sellercentral.amazon.com/voice-of-the-customer/ref=xx_voc_favb_xx',
  'https://sellercentral.amazon.com/feedback-manager/index.html#/'
];

const ZOOM_FILE = path.join(app.getPath('userData'), 'zooms.json');
let zooms = []; // Initialize as empty array, will be populated on first run or loaded

// Load zooms from file if it exists
try {
  if (fs.existsSync(ZOOM_FILE)) {
    zooms = JSON.parse(fs.readFileSync(ZOOM_FILE));
    console.log('Main: Loaded zooms from file:', zooms); // Debug log
  }
} catch (err) {
  console.error('Failed to load zooms from file:', err);
  // On error, start with empty zooms, buildTiles will set defaults
  zooms = [];
}

function saveZooms() {
  try {
    fs.writeFileSync(ZOOM_FILE, JSON.stringify(zooms));
    console.log('Main: Saved zooms to file:', zooms); // Debug log
  } catch (err) {
    console.error('Failed to save zooms to file:', err);
  }
}

let scrollTimers = []; // To store setInterval IDs for each view's scrolling
let manualScrollTimeouts = []; // To store setTimeout IDs for manual scroll overrides

function buildTiles(w, h) {
  const COLS = 4, ROWS = 4;
  const cw = Math.floor(w / COLS);
  const ch = Math.floor(h / ROWS);
  const base = 1280; // Reintroduce base for default scaling

  urls.forEach((u, i) => {
    const v = new BrowserView({
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    win.addBrowserView(v);

    const col = i % COLS, row = (i / COLS) | 0;
    const bounds = { x: col * cw, y: HEADER_H + row * ch, width: cw, height: ch };
    v.__orig = bounds;
    v.setBounds(bounds);
    v.setAutoResize({ width: true, height: true });

    // Set default zoom to 0.4 if not already defined (first run or new URL)
    if (zooms[i] === undefined || isNaN(zooms[i])) {
      zooms[i] = 0.4;
    }

    v.webContents.on('dom-ready', () => {
      v.webContents.setZoomFactor(zooms[i]); // Use the stored/calculated zoom
      v.webContents.insertCSS('::-webkit-scrollbar{width:0;height:0}html,body{scrollbar-width:none;-ms-overflow-style:none;overflow-x:hidden;}');
      // Inject JavaScript to listen for manual scroll events
      v.webContents.executeJavaScript(`
        window.addEventListener('scroll', () => {
          ipcRenderer.send('manual-scroll', ${i});
        });
        // Inject resize buttons
        const resizeContainer = document.createElement('div');
        resizeContainer.style.position = 'fixed';
        resizeContainer.style.bottom = '10px';
        resizeContainer.style.right = '10px';
        resizeContainer.style.zIndex = '9999';
        resizeContainer.style.display = 'flex';
        resizeContainer.style.gap = '5px';

        const shrinkBtn = document.createElement('button');
        shrinkBtn.textContent = '-';
        shrinkBtn.style.cssText = 'background:#555; color:white; border:none; border-radius:3px; padding:2px 5px; cursor:pointer; font-size:10px;';
        shrinkBtn.onclick = (e) => {
          e.stopPropagation(); // Prevent click from propagating to body
          ipcRenderer.send('resize-view', { idx: ${i}, action: 'shrink' });
        };
        resizeContainer.appendChild(shrinkBtn);

        const enlargeBtn = document.createElement('button');
        enlargeBtn.textContent = '+';
        enlargeBtn.style.cssText = 'background:#555; color:white; border:none; border-radius:3px; padding:2px 5px; cursor:pointer; font-size:10px;';
        enlargeBtn.onclick = (e) => {
          e.stopPropagation(); // Prevent click from propagating to body
          ipcRenderer.send('resize-view', { idx: ${i}, action: 'enlarge' });
        };
        resizeContainer.appendChild(enlargeBtn);

        // New Fullscreen button
        const fullscreenBtn = document.createElement('button');
        fullscreenBtn.textContent = '[]'; // A simple square icon for fullscreen
        fullscreenBtn.style.cssText = 'background:#555; color:white; border:none; border-radius:3px; padding:2px 5px; cursor:pointer; font-size:10px;';
        fullscreenBtn.onclick = (e) => {
          e.stopPropagation(); // Prevent click from propagating
          ipcRenderer.send('open-view-popup', ${i}); // Send index to main process
        };
        resizeContainer.appendChild(fullscreenBtn);

        document.body.appendChild(resizeContainer);
        // Clicking anywhere else on the page will toggle fullscreen for this view
        document.body.addEventListener('click', () => {
          ipcRenderer.send('open-view-popup', ${i});
        });
      `);
      // Initialize scrolling properties for each view
      v.__scrollDirection = 1; // 1 for down, -1 for up
      v.__scrollPos = 0; // Current scroll position
    });
    v.webContents.loadURL(u);
    views.push(v);
  });
  saveZooms(); // Save initial calculated zooms after building tiles
}

function showTiles(show) {
  views.forEach(v => v.setBounds(show ? v.__orig : { ...v.__orig, height: 0 }));
}

// Function to start or stop scrolling for all views
function toggleAutoScroll(enable) {
  views.forEach((v, i) => {
    // Clear any existing auto-scroll interval
    if (scrollTimers[i]) {
      clearInterval(scrollTimers[i]);
      scrollTimers[i] = null;
    }
    // Clear any existing manual scroll timeout
    if (manualScrollTimeouts[i]) {
      clearTimeout(manualScrollTimeouts[i]);
      manualScrollTimeouts[i] = null;
    }

    if (enable) {
      v.__scrollDirection = 1; // Reset direction to down when starting
      v.__scrollPos = 0; // Reset scroll position to top
      scrollTimers[i] = setInterval(async () => {
        const webContents = v.webContents;
        try {
          const scrollHeight = await webContents.executeJavaScript('document.body.scrollHeight');
          const innerHeight = await webContents.executeJavaScript('window.innerHeight');
          const maxScroll = scrollHeight - innerHeight;

          if (maxScroll <= 0) { // No need to scroll if content fits
            return;
          }

          v.__scrollPos += v.__scrollDirection * 5; // Scroll speed

          if (v.__scrollDirection === 1 && v.__scrollPos >= maxScroll) {
            v.__scrollPos = maxScroll; // Ensure it doesn't go past max
            v.__scrollDirection = -1; // Change direction to up
          } else if (v.__scrollDirection === -1 && v.__scrollPos <= 0) {
            v.__scrollPos = 0; // Ensure it doesn't go past top
            v.__scrollDirection = 1; // Change direction to down
          }
          webContents.executeJavaScript(`window.scrollTo(0, ${v.__scrollPos})`);
        } catch (error) {
          console.error(`Error scrolling view ${i}:`, error.message);
        }
      }, 50); // Adjust interval for smoothness
    }
  });
}

function create() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({ width, height, autoHideMenuBar: true });

  // slim header
  headerView = new BrowserView({ webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.addBrowserView(headerView);
  headerView.setBounds({ x: 0, y: 0, width, height: HEADER_H });
  headerView.setAutoResize({ width: true });
  headerView.webContents.loadFile('header.html');

  buildTiles(width, height - HEADER_H);
  toggleAutoScroll(true); // Start auto-scrolling automatically on app launch

  /* IPC */
  ipcMain.on('set-mode', (_, mode) => {
    if (mode === 'set') {                      // expand header to full page
      headerView.setBounds({ x: 0, y: 0, width, height });
      showTiles(false);
      toggleAutoScroll(false); // Stop scrolling when entering SET VIEW
      // Pass current zooms to header for display
      headerView.webContents.send('editor-show', urls, zooms);
    } else {
      headerView.setBounds({ x: 0, y: 0, width, height: HEADER_H });
      showTiles(true);
      toggleAutoScroll(true); // Resume scrolling when entering LIVE VIEW
      // Do NOT reload views when going live, only apply initial zooms on dom-ready or via set-zoom IPC
      // views.forEach((v, i) => {
      //   v.webContents.loadURL(urls[i] || 'about:blank');
      // });
    }
  });

  ipcMain.on('update-urls', (_, newUrls) => {
    urls = newUrls;
    // Resize zooms array and fill new entries with default 0.4 (40%)
    if (zooms.length < urls.length) {
      zooms = zooms.concat(Array(urls.length - zooms.length).fill(0.4));
    } else if (zooms.length > urls.length) {
      zooms = zooms.slice(0, urls.length);
    }
    saveZooms(); // Save updated URLs and potentially resized zooms
  });

  ipcMain.on('toggle-fullscreen', () => win.setFullScreen(!win.isFullScreen()));
  ipcMain.on('screenshot', async () => {
    const img = await win.capturePage();
    const screenshotsDir = 'C:\\AofFiles\\16screens\\SCREENSHOTS';
    // Ensure the directory exists
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    const file = path.join(screenshotsDir, `multi16_${Date.now()}.png`);
    fs.writeFileSync(file, img.toPNG());
  });

  let timer = null; // This timer is for auto-refresh, not scrolling
  ipcMain.on('refresh-toggle', () => {
    if (timer) { 
      clearInterval(timer);
      timer = null;
    } else {
      timer = setInterval(() => views.forEach(v => v.webContents.reload()), 420000); // 7 minutes
    }
  });

  ipcMain.on('set-zoom', (_, { idx, zoom }) => {
    zooms[idx] = zoom;
    saveZooms(); // Save zoom change immediately
    if (views[idx]) {
      views[idx].webContents.setZoomFactor(zoom);
    }
  });

  // IPC handler for manual scrolling
  ipcMain.on('manual-scroll', (_, idx) => {
    // Clear auto-scroll for this view
    if (scrollTimers[idx]) {
      clearInterval(scrollTimers[idx]);
      scrollTimers[idx] = null;
    }
    // Clear any existing timeout for this view
    if (manualScrollTimeouts[idx]) {
      clearTimeout(manualScrollTimeouts[idx]);
    }
    // Set a new timeout to resume auto-scroll after 5 seconds
    manualScrollTimeouts[idx] = setTimeout(() => {
      // Only resume if auto-scroll is currently enabled globally
      // This check assumes toggleAutoScroll(true) was the last state before pause
      // A more robust solution might store the last enabled state per view or globally
      if (views[idx]) {
        // Re-enable auto-scroll for this specific view
        // Re-calling toggleAutoScroll(true) will re-initialize all timers which is not desired
        // Instead, we need to restart only this specific view's timer.
        // Duplicate the logic from toggleAutoScroll(true) for a single view
        const v = views[idx];
        v.__scrollDirection = 1; // Reset direction to down when resuming
        v.__scrollPos = v.webContents.executeJavaScript('window.scrollY'); // Get current scroll position
        scrollTimers[idx] = setInterval(async () => {
          const webContents = v.webContents;
          try {
            const scrollHeight = await webContents.executeJavaScript('document.body.scrollHeight');
            const innerHeight = await webContents.executeJavaScript('window.innerHeight');
            const maxScroll = scrollHeight - innerHeight;

            if (maxScroll <= 0) { return; }

            v.__scrollPos += v.__scrollDirection * 5;

            if (v.__scrollDirection === 1 && v.__scrollPos >= maxScroll) {
              v.__scrollPos = maxScroll;
              v.__scrollDirection = -1;
            } else if (v.__scrollDirection === -1 && v.__scrollPos <= 0) {
              v.__scrollPos = 0;
              v.__scrollDirection = 1;
            }
            webContents.executeJavaScript(`window.scrollTo(0, ${v.__scrollPos})`);
          } catch (error) {
            console.error(`Error scrolling view ${idx}:`, error.message);
          }
        }, 50);
      }
    }, 5000); // 5 seconds
  });

  let currentViewSizes = {}; // To store the current size level of each view (0: original, 1: 50%, 2: 75%, 3: full screen window)

  // IPC handler for resizing individual views
  ipcMain.on('resize-view', (_, { idx, action }) => {
    const v = views[idx];
    if (!v) return;

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    // Initialize or get current size level
    let currentLevel = currentViewSizes[idx] !== undefined ? currentViewSizes[idx] : 0;

    if (action === 'enlarge') {
      currentLevel = Math.min(currentLevel + 1, 2); // Max level is 2 (75% screen)
    } else if (action === 'shrink') {
      currentLevel = Math.max(currentLevel - 1, 0); // Min level is 0 (original tile)
    }

    currentViewSizes[idx] = currentLevel;

    let newWidth, newHeight, newX, newY;

    if (currentLevel === 0) {
      // Original tile size
      const originalBounds = v.__orig;
      newWidth = originalBounds.width;
      newHeight = originalBounds.height;
      newX = originalBounds.x;
      newY = originalBounds.y;
      // Ensure not in fullscreen mode if returning to tiled size
      if (v.webContents.isFullScreen()) {
        v.webContents.setFullScreen(false);
      }
      // Bring header back to front when going back to tiled view
      win.setTopBrowserView(headerView);
    } else if (currentLevel === 1) {
      // 50% of screen, centered
      newWidth = Math.floor(screenWidth * 0.5);
      newHeight = Math.floor(screenHeight * 0.5);
      newX = Math.floor((screenWidth - newWidth) / 2);
      newY = Math.floor((screenHeight - newHeight) / 2);
      // Ensure not in fullscreen mode
      if (v.webContents.isFullScreen()) {
        v.webContents.setFullScreen(false);
      }
      win.setTopBrowserView(v); // Bring enlarged view to front
    } else if (currentLevel === 2) {
      // 75% of screen, centered
      newWidth = Math.floor(screenWidth * 0.75);
      newHeight = Math.floor(screenHeight * 0.75);
      newX = Math.floor((screenWidth - newWidth) / 2);
      newY = Math.floor((screenHeight - newHeight) / 2);
      // Ensure not in fullscreen mode
      if (v.webContents.isFullScreen()) {
        v.webContents.setFullScreen(false);
      }
      win.setTopBrowserView(v); // Bring enlarged view to front
    }
    // No specific handling for currentLevel === 3 as popup windows now handle fullscreen

    // Always set bounds; the popup window takes care of true fullscreen
    v.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
  });

  // IPC handler for opening a popup window showing the view fullscreen
  ipcMain.on('open-view-popup', (_, idx) => {
    const url = urls[idx];
    if (!url) return;

    const popup = new BrowserWindow({
      fullscreen: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    popup.loadURL(url);
    popup.webContents.on('did-finish-load', () => {
      popup.webContents.setZoomFactor(zooms[idx] || 1);
    });
  });
}

app.whenReady().then(create);
app.on('window-all-closed', () => {
  toggleAutoScroll(false); // Stop all scrolling timers on app quit
  app.quit();
});
