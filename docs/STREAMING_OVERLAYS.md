# 📺 Streaming Overlays Guide (OBS Studio & Streamlabs)

F1 Telemetry includes dedicated broadcast graphics designed for live streamers, virtual racing leagues, and content creators.

---

## 🎨 Available Overlay Widgets

1. **Lower-Third Ticker**: A sleek horizontal ticker scrolling current positions, driver flags, tire compound badges, and gap intervals.
2. **Battle Telemetry (Head-to-Head)**: Real-time side-by-side comparison bars for speed, RPM, throttle percentage, braking force, and DRS activation between two battling drivers.
3. **Mini Timing Tower**: Compact vertical leaderboard designed for screen corners.
4. **Race Control Banner**: Animated pop-up notifications for Safety Car, VSC, Yellow Flags, and penalties.

---

## 🚀 How to Add Overlays in OBS Studio

1. **Open OBS Studio**.
2. In your active **Scene**, click the **`+`** button under **Sources** and select **Browser**.
3. Name your source (e.g., `F1 - Lower Third Ticker`).
4. In the Browser Source Properties dialog:
   - **URL**: `http://localhost/#overlay-ticker` (or `http://<YOUR_IP>/#overlay-battle`)
   - **Width**: `1920`
   - **Height**: `1080`
   - **Custom CSS**: Leave blank (the app renders a 100% transparent background in overlay mode).
   - Check **"Shutdown source when not visible"**.
   - Check **"Refresh browser when scene becomes active"**.
5. Click **OK**.

---

## 🎛️ Customizing Overlay Dimensions

You can scale and position the transparent widgets anywhere on your stream layout:

| Widget | Recommended Resolution | Aspect |
| :--- | :--- | :--- |
| Full Broadcast Overlay | 1920 x 1080 | 16:9 |
| Lower Third Banner | 1920 x 200 | Ultrawide Ribbon |
| Mini Timing Tower | 450 x 800 | Vertical Corner |
| Battle Telemetry Box | 700 x 350 | Box Widget |

---

## 💡 Pro-Tips for Streamers
- **Multi-Monitor Setup**: You can keep the full F1 Dashboard open on a secondary monitor while sending transparent overlay widgets to OBS.
- **Audio Cues**: You can route the synthesized engine sounds and team radio alerts directly to your streaming audio mixer via browser source audio monitoring!
