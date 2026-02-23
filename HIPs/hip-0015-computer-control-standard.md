---
hip: 0015
title: Computer Control Standard
author: Hanzo AI Team
type: Standards Track
category: Interface
status: Draft
created: 2025-01-09
requires: HIP-9, HIP-10
---

# HIP-15: Computer Control Standard

## Abstract

This proposal defines the Computer Control Standard for Hanzo Operative, a unified interface that enables AI agents to perceive, interpret, and interact with computer environments. The standard covers screen capture and recording, mouse and keyboard input, touch emulation, browser automation via Playwright, AI-driven visual interpretation of screen content, and device emulation across platforms. All computer control in the Hanzo ecosystem MUST conform to this interface.

**Repository**: [github.com/hanzoai/operative](https://github.com/hanzoai/operative)
**MCP Package**: `hanzo-mcp` (computer use tools)
**Platforms**: macOS (Quartz), Linux (X11/Wayland), Windows (Win32)

## Motivation

Large language models can reason, plan, and generate text, but they cannot act on computers. They cannot click a button, fill out a form, navigate a desktop application, or read what is on screen. This gap between "AI that answers questions" and "AI that does work" is the single largest barrier to autonomous agent productivity.

Existing approaches to computer use are fragmented:

1. **Hosted-only solutions**: OpenAI and Anthropic offer computer use as hosted APIs. Enterprise customers cannot send their screens to third-party servers. We need self-hosted computer use for security-sensitive deployments.
2. **Browser-only automation**: Selenium, Puppeteer, and Playwright work for web applications but cannot interact with native desktop software, terminal emulators, IDEs, or system dialogs.
3. **Pixel-perfect OCR approaches**: Traditional screen scraping is brittle. Font changes, resolution differences, and theme variations break hard-coded coordinate systems.
4. **No MCP integration**: No existing computer use system integrates with the Model Context Protocol (HIP-10) or the Agent SDK (HIP-9). Agents cannot seamlessly combine computer use with file operations, search, memory, and other MCP tools.

The Computer Control Standard solves all four problems by defining a single interface that supports native screen interaction, browser automation, AI visual interpretation, and full MCP integration, deployable on-premises or in the cloud.

## Design Philosophy

### Why Computer Use Matters for AI

LLMs are powerful reasoning engines constrained to text input and text output. They can write code but not run it in an IDE. They can describe a UI fix but not verify it visually. They can plan a workflow but not execute it across applications.

Computer use removes this constraint. When an AI agent can see the screen, move the mouse, type on the keyboard, and navigate between applications, it gains the ability to operate any software that a human can operate. This transforms AI from a conversational assistant into a productive worker that can:

- Navigate complex enterprise applications (SAP, Salesforce, internal tools)
- Perform multi-step workflows across multiple applications
- Verify visual output (design reviews, chart validation, UI testing)
- Operate legacy software that has no API
- Debug applications by observing their runtime behavior

### Why Operative Over Third-Party Computer Use

OpenAI and Anthropic both offer computer use capabilities, but as hosted APIs. This creates three problems for production deployments:

1. **Security**: Screen content is sent to third-party servers. For enterprises handling financial data, medical records, or classified information, this is a non-starter. Operative runs entirely on-premises.
2. **Integration**: Third-party computer use exists in isolation. Operative integrates with MCP tools (HIP-10) so an agent can seamlessly switch between reading files, searching code, controlling the browser, and interacting with native applications, all within the same tool protocol.
3. **Customization**: Hosted APIs offer fixed capabilities. Operative supports custom backends, region definitions, batch operations, and platform-specific optimizations that adapt to each deployment environment.

### Why Screen Recording Plus AI Interpretation

Rather than attempting pixel-perfect OCR or maintaining fragile coordinate maps, Operative uses a fundamentally different approach:

1. **Record** the screen for a configurable duration (default 30 seconds, max 120 seconds)
2. **Detect activity** (mouse movement, clicks, typing, window changes)
3. **Extract keyframes** at activity points (typically ~30 frames per 30-second session)
4. **Compress** frames for efficiency (~768px max dimension, 60% JPEG quality, ~500KB total per session)
5. **Send frames to the LLM** for visual interpretation and action planning

This approach is more robust than traditional UI automation because:

- It works with ANY application, not just browsers or applications with accessibility APIs
- It is resolution-independent and theme-independent
- It degrades gracefully: if one frame is ambiguous, surrounding frames provide context
- It captures temporal information: the AI sees what happened before and after each action

### Why Playwright for Browser Automation

For web-specific tasks, screen-based computer use is unnecessarily imprecise. Playwright (by Microsoft) provides a purpose-built browser automation layer with:

- **Cross-browser support**: Chromium, Firefox, WebKit
- **Reliable selectors**: CSS, XPath, text, role, test-id, and other locator strategies
- **Built-in waiting**: Auto-waits for elements to be actionable before interacting
- **Network interception**: Mock APIs, block requests, intercept responses
- **Mobile emulation**: Simulate any device viewport, user agent, and touch input
- **Trace recording**: Debug failing automations with full execution traces

Operative uses both approaches: Playwright for web applications (faster, more reliable, semantically rich) and screen recording for native applications (universal, no API required). The agent chooses the appropriate backend based on the target application.

## Specification

### Core Interfaces

#### Screen Capture

```typescript
interface ScreenCapture {
  // Single screenshot
  screenshot(options?: {
    region?: Region;          // Capture specific area
    optimize?: boolean;       // Compress for LLM (default: true)
    maxSize?: number;         // Max dimension in pixels (default: 768)
    quality?: number;         // JPEG quality 1-100 (default: 60)
  }): Promise<CaptureResult>;

  // Screen recording session
  session(options?: {
    duration?: number;        // Seconds (default: 30, max: 120)
    fps?: number;             // Frame rate (default: 30)
    quality?: "low" | "medium" | "high";
    region?: Region;          // Record specific area
    targetFrames?: number;    // Target keyframes to extract (default: 30)
    activityThreshold?: number; // Activity sensitivity (default: 0.02)
  }): Promise<SessionResult>;

  // Background recording (start/stop)
  record(options?: RecordOptions): Promise<RecordingHandle>;
  stop(handle: RecordingHandle): Promise<SessionResult>;

  // Get display information
  getScreens(): Promise<ScreenInfo[]>;
  screenSize(): Promise<Dimensions>;
  currentScreen(): Promise<ScreenInfo>;
}

interface CaptureResult {
  image: string;              // Base64-encoded image data
  width: number;
  height: number;
  timestamp: number;
  format: "jpeg" | "png";
}

interface SessionResult {
  frames: CaptureResult[];    // Extracted keyframes
  activities: Activity[];     // Detected activity events
  duration: number;           // Actual recording duration
  totalSize: number;          // Total payload size in bytes
}

interface Activity {
  timestamp: number;
  type: "movement" | "click" | "typing" | "window_change" | "scroll";
  position?: Point;
  details?: string;
}
```

#### Input Control

```typescript
interface InputControl {
  // Mouse operations (< 5ms native latency)
  click(x: number, y: number, options?: ClickOptions): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  rightClick(x: number, y: number): Promise<void>;
  middleClick(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  moveRelative(dx: number, dy: number): Promise<void>;
  drag(startX: number, startY: number, endX: number, endY: number,
       options?: DragOptions): Promise<void>;
  scroll(amount: number, x?: number, y?: number): Promise<void>;

  // Keyboard operations (< 2ms native latency)
  type(text: string, options?: TypeOptions): Promise<void>;
  press(key: string): Promise<void>;
  keyDown(key: string): Promise<void>;
  keyUp(key: string): Promise<void>;
  hotkey(keys: string[]): Promise<void>;

  // Touch operations
  tap(x: number, y: number): Promise<void>;
  swipe(direction: Direction, distance?: number): Promise<void>;
  pinch(scale: number): Promise<void>;

  // Batch execution
  batch(actions: Action[]): Promise<BatchResult>;
}

interface ClickOptions {
  button?: "left" | "right" | "middle";
  clickCount?: number;
  delay?: number;             // Delay between mousedown and mouseup
}

interface TypeOptions {
  interval?: number;          // Delay between keystrokes (default: 0.02s)
  clear?: boolean;            // Clear field before typing
}

interface DragOptions {
  duration?: number;          // Drag duration in seconds
  steps?: number;             // Intermediate points for smooth drag
}
```

#### Window Management

```typescript
interface WindowManager {
  getActiveWindow(): Promise<WindowInfo>;
  listWindows(): Promise<WindowInfo[]>;
  focusWindow(title: string, options?: {
    useRegex?: boolean;
  }): Promise<void>;
}

interface WindowInfo {
  title: string;
  bounds: Region;
  pid: number;
  isActive: boolean;
  application: string;
}
```

#### Region Operations

```typescript
interface RegionManager {
  // Define a named region for repeated operations
  defineRegion(name: string, x: number, y: number,
               width: number, height: number): Promise<void>;

  // Capture screenshot of named region
  regionScreenshot(name: string): Promise<CaptureResult>;

  // Find image within named region
  regionLocate(name: string, imagePath: string): Promise<Point | null>;
}
```

#### Image Location

```typescript
interface ImageLocator {
  // Find image on screen, return center point
  locate(imagePath: string, options?: {
    confidence?: number;      // Match confidence (default: 0.9)
  }): Promise<Point | null>;

  // Find all instances of image
  locateAll(imagePath: string): Promise<Point[]>;

  // Wait for image to appear
  waitForImage(imagePath: string, timeout?: number): Promise<Point>;

  // Wait for image to disappear
  waitWhileImage(imagePath: string, timeout?: number): Promise<void>;

  // Get pixel color at point
  pixel(x: number, y: number): Promise<Color>;

  // Check if pixel matches color
  pixelMatches(x: number, y: number, color: Color,
               tolerance?: number): Promise<boolean>;
}
```

#### Browser Automation (Playwright Integration)

```typescript
interface BrowserControl {
  // Navigation
  navigate(url: string): Promise<NavigateResult>;
  reload(): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  url(): Promise<string>;
  title(): Promise<string>;
  content(): Promise<string>;

  // Element interaction
  click(selector: string, options?: BrowserClickOptions): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(selector: string, key: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<void>;
  check(selector: string): Promise<void>;
  uncheck(selector: string): Promise<void>;
  upload(selector: string, files: string[]): Promise<void>;
  hover(selector: string): Promise<void>;

  // Element locators
  locator(selector: string): Locator;
  getByRole(role: string, options?: { name?: string }): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  getByLabel(text: string): Locator;
  getByPlaceholder(text: string): Locator;
  getByTestId(testId: string): Locator;

  // Element state
  getText(selector: string): Promise<string>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  getValue(selector: string): Promise<string>;
  isVisible(selector: string): Promise<boolean>;
  isEnabled(selector: string): Promise<boolean>;

  // Assertions
  expectVisible(selector: string): Promise<void>;
  expectText(selector: string, expected: string): Promise<void>;
  expectValue(selector: string, expected: string): Promise<void>;
  expectUrl(pattern: string): Promise<void>;
  expectTitle(expected: string): Promise<void>;

  // Waiting
  wait(timeout: number): Promise<void>;
  waitForLoad(state?: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
  waitForUrl(pattern: string): Promise<void>;
  waitForSelector(selector: string, options?: WaitOptions): Promise<void>;

  // Screenshots and capture
  screenshot(options?: { fullPage?: boolean }): Promise<CaptureResult>;
  pdf(): Promise<Buffer>;
  snapshot(): Promise<string>;     // Accessibility tree snapshot

  // JavaScript execution
  evaluate(code: string): Promise<unknown>;

  // Device emulation
  emulate(device: DevicePreset): Promise<void>;
  viewport(width: number, height: number): Promise<void>;

  // Network interception
  route(pattern: string, options: RouteOptions): Promise<void>;
  unroute(pattern: string): Promise<void>;

  // Multi-tab / multi-context
  newPage(): Promise<PageHandle>;
  newContext(options?: ContextOptions): Promise<ContextHandle>;
  newTab(): Promise<TabHandle>;
  tabs(): Promise<TabInfo[]>;

  // Storage and cookies
  cookies(): Promise<Cookie[]>;
  clearCookies(): Promise<void>;
  storage(type: "local" | "session"): Promise<Record<string, string>>;

  // Debugging
  highlight(selector: string): Promise<void>;
  traceStart(): Promise<void>;
  traceStop(path: string): Promise<void>;
  console(): Promise<ConsoleMessage[]>;
  errors(): Promise<Error[]>;
}

type DevicePreset =
  | "mobile" | "tablet" | "laptop"
  | "iphone_14" | "pixel_7" | "ipad_pro";

interface ContextOptions {
  device?: DevicePreset;
  locale?: string;
  geolocation?: { latitude: number; longitude: number };
  permissions?: string[];
  storageState?: string;      // Path to saved auth state
}
```

### AI Interpretation Pipeline

The AI interpretation pipeline is the core innovation that distinguishes Operative from traditional automation frameworks. Rather than requiring explicit selectors or coordinates, the agent observes the screen and reasons about what to do next.

```
┌──────────────────────────────────────────────────────────────────┐
│                    AI Interpretation Pipeline                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Screen Recording ──> Activity Detection ──> Keyframe Extraction │
│                                                    │             │
│                                                    v             │
│                                           Frame Compression      │
│                                           (~768px, 60% JPEG)     │
│                                                    │             │
│                                                    v             │
│                                        LLM Visual Analysis       │
│                                        (multimodal reasoning)    │
│                                                    │             │
│                                                    v             │
│                                          Action Planning         │
│                                          (click, type, scroll)   │
│                                                    │             │
│                                                    v             │
│                                         Action Execution         │
│                                         (native or Playwright)   │
│                                                    │             │
│                                                    v             │
│                                        Verification Capture      │
│                                        (screenshot after action) │
│                                                    │             │
│                                                    v             │
│                                            Loop / Complete       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

#### Activity Detection

Activity detection identifies moments of significance in a screen recording. The system monitors for:

| Activity Type | Detection Method | Threshold |
|---------------|-----------------|-----------|
| Mouse movement | Frame-to-frame cursor position delta | > 10px displacement |
| Click events | OS-level input event hooks | Any click |
| Typing | Keyboard event hooks + screen text change | Any keystroke |
| Window change | Active window title change | Title differs |
| Scroll | Viewport content shift without cursor movement | > 5% content shift |
| Animation | Pixel-level frame difference | > 2% of frame area |

#### Keyframe Selection

From a 30-second recording at 30fps (900 raw frames), the system selects approximately 30 keyframes using the following algorithm:

1. Score each frame by the sum of activity intensities at that timestamp
2. Apply non-maximum suppression with a 500ms window to avoid duplicates
3. Always include the first frame, last frame, and frames immediately after click events
4. Fill remaining slots with the highest-scoring frames distributed evenly across the timeline

#### Frame Compression

Each keyframe is compressed for efficient LLM consumption:

- Maximum dimension: 768 pixels (configurable via `HANZO_SCREEN_MAX_SIZE`)
- JPEG quality: 60% (configurable via `HANZO_SCREEN_QUALITY`)
- Target total payload: ~500KB for a 30-frame session
- Average per-frame size: ~15-20KB

### Control Flow: Agent Observe-Act Loop

The standard defines a control flow for agents interacting with computers:

```python
class ComputerUseAgent:
    """
    Agent that controls a computer through the Operative interface.
    Integrates with HIP-9 Agent SDK and HIP-10 MCP tools.
    """

    def __init__(self, operative: OperativeClient, model: LLMClient):
        self.operative = operative
        self.model = model
        self.history = []

    async def execute_task(self, task: str) -> TaskResult:
        """
        Execute a task on the computer by observing and acting in a loop.
        """
        # Initial observation
        screen = await self.operative.screenshot()
        self.history.append({"role": "observation", "image": screen})

        while not self.is_complete():
            # Ask the LLM what to do given the screen and task
            action = await self.model.reason(
                task=task,
                current_screen=screen,
                history=self.history,
                available_actions=self.operative.capabilities()
            )

            if action.type == "done":
                return TaskResult(success=True, output=action.summary)

            # Execute the action
            await self.operative.execute(action)
            self.history.append({"role": "action", "action": action})

            # Observe the result
            await asyncio.sleep(action.wait_after or 0.5)
            screen = await self.operative.screenshot()
            self.history.append({"role": "observation", "image": screen})

        return TaskResult(success=False, output="Max iterations reached")
```

### Batch Operations

Batch operations execute multiple actions atomically with guaranteed ordering:

```typescript
interface BatchOperation {
  actions: Action[];
  options?: {
    stopOnError?: boolean;    // Halt on first failure (default: true)
    delayBetween?: number;    // Milliseconds between actions (default: 50)
  };
}

// Example: login form automation
const loginBatch: BatchOperation = {
  actions: [
    { action: "click", x: 400, y: 300 },
    { action: "type", text: "user@example.com" },
    { action: "press", key: "Tab" },
    { action: "type", text: "password123" },
    { action: "press", key: "Enter" }
  ],
  options: { delayBetween: 100 }
};
```

### Platform Backends

| Platform | Backend | Mouse Latency | Keyboard Latency | Screen Capture |
|----------|---------|---------------|-------------------|----------------|
| macOS | Quartz (native) | < 5ms | < 2ms | < 50ms |
| Linux | X11 | < 5ms | < 2ms | < 50ms |
| Linux | Wayland | < 10ms | < 5ms | < 100ms |
| Windows | Win32 | < 5ms | < 2ms | < 50ms |
| Docker | Virtual Display (Xvfb) | < 10ms | < 5ms | < 100ms |

### MCP Tool Interface

Computer control is exposed as MCP tools (HIP-10) so any MCP-compatible agent can invoke computer use without custom integration.

```yaml
MCP Tool: computer
  Description: Control local computer with native API acceleration
  Actions:
    # Mouse
    - click(x, y)
    - double_click(x, y)
    - right_click(x, y)
    - move(x, y)
    - drag(start_x, start_y, end_x, end_y)
    - scroll(amount, x, y)

    # Keyboard
    - type(text, interval)
    - press(key)
    - hotkey(keys[])
    - key_down(key) / key_up(key)

    # Screen
    - screenshot()
    - screenshot_region(region)
    - get_screens()
    - screen_size()

    # Image location
    - locate(image_path)
    - locate_all(image_path)
    - wait_for_image(image_path, timeout)

    # Pixel
    - pixel(x, y)
    - pixel_matches(x, y, color, tolerance)

    # Windows
    - get_active_window()
    - list_windows()
    - focus_window(title)

    # Regions
    - define_region(name, x, y, w, h)
    - region_screenshot(name)
    - region_locate(name, image)

    # Batch
    - batch(actions[])

    # Timing
    - sleep(seconds)
    - set_pause(seconds)

MCP Tool: screen
  Description: Screen recording and AI interpretation
  Actions:
    - session(duration)        # Record + analyze + compress + return
    - capture()                # Single optimized screenshot
    - record(duration, fps)    # Start background recording
    - stop()                   # Stop and process recording
    - analyze(path)            # Process existing video file
    - status()                 # Check recording state
    - info()                   # System capabilities

MCP Tool: browser
  Description: Full Playwright browser automation
  Actions:
    # Navigation: navigate, reload, go_back, go_forward, url, title
    # Input: click, fill, type, press, select_option, check, upload
    # Locators: locator, get_by_role, get_by_text, get_by_label
    # State: is_visible, is_enabled, is_checked, get_text, get_attribute
    # Assertions: expect_visible, expect_text, expect_value, expect_url
    # Wait: wait, wait_for_load, wait_for_url, wait_for_selector
    # Capture: screenshot, pdf, snapshot, evaluate
    # Device: viewport, emulate, geolocation, permissions
    # Network: route, unroute
    # Multi-tab: new_page, new_context, tabs, close_tab
    # Debug: trace_start, trace_stop, highlight, console, errors
```

### Configuration

Configuration via environment variables:

```bash
# Screen recording defaults
HANZO_SCREEN_DURATION=30           # Default session duration (seconds)
HANZO_SCREEN_TARGET_FRAMES=30     # Target keyframes per session
HANZO_SCREEN_MAX_SIZE=768          # Max frame dimension (pixels)
HANZO_SCREEN_QUALITY=60            # JPEG compression quality (1-100)
HANZO_SCREEN_ACTIVITY_THRESHOLD=0.02  # Activity detection sensitivity

# Browser automation
HANZO_BROWSER_HEADLESS=true        # Run browser in headless mode
HANZO_BROWSER_TIMEOUT=30000        # Default action timeout (ms)
HANZO_BROWSER_SLOW_MO=0            # Slow down actions for debugging (ms)

# Platform
HANZO_OPERATIVE_BACKEND=auto       # auto, quartz, x11, wayland, win32
HANZO_OPERATIVE_DISPLAY=:0         # X11 display (Linux)
```

## Implementation

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent (HIP-9)                           │
│                    (reasoning + planning)                        │
├─────────────────────────────────────────────────────────────────┤
│                       MCP Protocol (HIP-10)                     │
│              (tool invocation + context management)              │
├──────────────────┬──────────────────┬───────────────────────────┤
│  computer tool   │   screen tool    │      browser tool         │
│  (input control) │   (recording)    │      (Playwright)         │
├──────────────────┴──────────────────┴───────────────────────────┤
│                    Operative Core Library                        │
│              (platform abstraction + dispatch)                   │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│    Quartz    │     X11      │   Wayland    │      Win32         │
│   (macOS)    │   (Linux)    │   (Linux)    │    (Windows)       │
├──────────────┴──────────────┴──────────────┴────────────────────┤
│                    Operating System                              │
│              (display server + input subsystem)                  │
└─────────────────────────────────────────────────────────────────┘
```

### Repository Structure

```
operative/
├── src/
│   ├── core/                    # Platform abstraction layer
│   │   ├── backend.py           # Backend interface
│   │   ├── quartz.py            # macOS Quartz backend
│   │   ├── x11.py               # Linux X11 backend
│   │   ├── wayland.py           # Linux Wayland backend
│   │   └── win32.py             # Windows Win32 backend
│   ├── screen/                  # Screen capture and recording
│   │   ├── capture.py           # Screenshot operations
│   │   ├── recorder.py          # Screen recording
│   │   ├── activity.py          # Activity detection
│   │   ├── keyframe.py          # Keyframe extraction
│   │   └── compress.py          # Frame compression
│   ├── input/                   # Input control
│   │   ├── mouse.py             # Mouse operations
│   │   ├── keyboard.py          # Keyboard operations
│   │   ├── touch.py             # Touch emulation
│   │   └── batch.py             # Batch action execution
│   ├── browser/                 # Playwright integration
│   │   ├── engine.py            # Browser engine management
│   │   ├── page.py              # Page interaction
│   │   ├── locators.py          # Element location strategies
│   │   ├── network.py           # Network interception
│   │   └── devices.py           # Device emulation presets
│   ├── window/                  # Window management
│   │   ├── manager.py           # Window operations
│   │   └── regions.py           # Named region management
│   ├── image/                   # Image location
│   │   ├── locator.py           # Template matching
│   │   └── pixel.py             # Pixel operations
│   ├── mcp/                     # MCP tool definitions
│   │   ├── computer_tool.py     # computer() MCP tool
│   │   ├── screen_tool.py       # screen() MCP tool
│   │   └── browser_tool.py      # browser() MCP tool
│   └── security/                # Security and audit
│       ├── permissions.py       # Permission system
│       ├── audit.py             # Action audit trail
│       ├── sandbox.py           # Execution sandbox
│       └── pii.py               # PII detection and blurring
├── tests/
│   ├── test_capture.py
│   ├── test_input.py
│   ├── test_browser.py
│   ├── test_activity.py
│   ├── test_batch.py
│   └── test_security.py
├── pyproject.toml
├── Makefile
└── README.md
```

### Platform Support Matrix

| Feature | macOS (Quartz) | Linux (X11) | Linux (Wayland) | Windows (Win32) | Docker (Xvfb) |
|---------|---------------|-------------|-----------------|-----------------|----------------|
| Screenshot | Yes | Yes | Yes | Yes | Yes |
| Screen recording | Yes | Yes | Yes | Yes | Yes |
| Mouse control | Yes | Yes | Yes | Yes | Yes |
| Keyboard control | Yes | Yes | Yes | Yes | Yes |
| Touch emulation | Yes | No | Yes | Yes | No |
| Window management | Yes | Yes | Partial | Yes | Yes |
| Image location | Yes | Yes | Yes | Yes | Yes |
| Browser (Playwright) | Yes | Yes | Yes | Yes | Yes |
| HiDPI support | Yes | Yes | Yes | Yes | N/A |

### Agent SDK Integration

Agents built with the Agent SDK (HIP-9) can invoke computer use as a first-class capability:

```python
from hanzoai.agent import Agent
from hanzoai.operative import ComputerTool, ScreenTool, BrowserTool

agent = Agent(
    name="desktop-worker",
    model="claude-sonnet-4-20250514",
    tools=[
        ComputerTool(),       # Native mouse/keyboard/screen
        ScreenTool(),         # Screen recording + AI interpretation
        BrowserTool(),        # Playwright browser automation
    ],
    instructions="""You can control this computer. Use the browser tool
    for web tasks and the computer tool for native applications. Take
    screenshots to verify your actions succeeded before moving on."""
)

result = await agent.run("Open the settings app and enable dark mode")
```

### Deployment Modes

#### Local Development

The agent runs directly on the developer machine. Screen capture and input control target the local display.

```bash
pip install hanzo-operative
# or
pip install hanzo-mcp  # includes operative tools
```

#### Docker Container

For CI/CD and headless environments, Operative runs in a Docker container with a virtual display:

```dockerfile
FROM hanzoai/operative:latest

# Virtual display is pre-configured
# Playwright browsers are pre-installed
# MCP tools are registered automatically

ENV DISPLAY=:99
ENV HANZO_OPERATIVE_BACKEND=x11
```

```yaml
# compose.yml
services:
  operative:
    image: hanzoai/operative:latest
    environment:
      - DISPLAY=:99
    ports:
      - "6080:6080"    # noVNC for visual debugging
    volumes:
      - /tmp/.X11-unix:/tmp/.X11-unix
```

#### Cloud Deployment

For production agents running on Hanzo infrastructure, Operative instances are provisioned per-agent with isolated virtual displays:

```
Agent Request → Hanzo Cloud → Provision VM with Operative →
  → Agent connects via MCP → Executes task → Returns result →
  → VM destroyed
```

## Security

### Permission System

All computer use actions require explicit permission grants. Permissions are scoped to specific capabilities and can be restricted to specific applications or screen regions.

```yaml
permissions:
  # Screen capture permissions
  screen.capture:
    allowed: true
    restricted_regions:         # Never capture these areas
      - name: "password_field"
        bounds: { x: 100, y: 200, w: 300, h: 50 }

  # Input control permissions
  input.mouse:
    allowed: true
    restricted_windows:         # Cannot interact with these windows
      - "1Password"
      - "Keychain Access"

  input.keyboard:
    allowed: true
    block_hotkeys:              # Cannot execute these key combinations
      - ["Command", "Q"]       # Prevent quitting applications
      - ["Command", "Shift", "Delete"]  # Prevent emptying trash

  # Browser permissions
  browser.navigate:
    allowed: true
    blocked_domains:
      - "*.bank.com"
      - "mail.google.com"

  browser.network:
    allowed: false              # Cannot intercept network traffic
```

### Sandboxed Execution

Computer use actions run in a restricted context:

1. **Process isolation**: Operative runs as a separate process with minimal OS privileges
2. **Application allowlisting**: Only designated applications can be targeted
3. **Input rate limiting**: Maximum actions per second to prevent runaway automation
4. **Timeout enforcement**: All operations have hard timeouts to prevent hangs
5. **Resource limits**: CPU, memory, and disk usage are capped

### Audit Trail

Every action is logged with full context for forensic analysis:

```json
{
  "id": "act_01HQ3X7...",
  "timestamp": "2025-01-15T10:30:45.123Z",
  "agent_id": "agent_desktop-worker",
  "session_id": "sess_01HQ3X...",
  "action": {
    "type": "click",
    "x": 450,
    "y": 300,
    "button": "left"
  },
  "context": {
    "active_window": "Google Chrome - Settings",
    "screen_resolution": "2560x1440",
    "before_screenshot": "scr_01HQ3X7_before.jpg",
    "after_screenshot": "scr_01HQ3X7_after.jpg"
  },
  "permission": {
    "granted": true,
    "policy": "default_allow_chrome"
  },
  "duration_ms": 3
}
```

### PII Detection and Protection

When screen captures contain sensitive information, the system detects and protects it:

1. **Detection**: On-device ML model identifies common PII patterns (credit card numbers, SSNs, email addresses, passwords) in captured frames
2. **Blurring**: Detected PII regions are blurred before frames are sent to the LLM
3. **Redaction in logs**: Audit trail screenshots have PII regions redacted
4. **Opt-out**: Specific screen regions can be marked as "never capture" in the permission configuration

```python
class PIIDetector:
    """
    Detects and protects personally identifiable information
    in screen captures before they are sent to the LLM.
    """

    PATTERNS = [
        "credit_card",       # 16-digit card numbers
        "ssn",               # Social security numbers
        "email",             # Email addresses in input fields
        "password_field",    # Active password input fields
        "api_key",           # API keys and tokens
    ]

    async def protect(self, frame: CaptureResult) -> CaptureResult:
        """Detect and blur PII regions in a captured frame."""
        detections = await self.detect(frame)
        if detections:
            frame = self.blur_regions(frame, detections)
        return frame
```

### Network Security

When Operative is deployed remotely (Docker, cloud), the connection between agent and Operative instance is secured:

- **mTLS**: Mutual TLS authentication between agent and Operative
- **Encrypted transport**: All screen data and control commands encrypted in transit
- **Session tokens**: Short-lived tokens for each computer use session
- **IP allowlisting**: Operative instances only accept connections from authorized agents

## Compatibility

### Relationship to Other HIPs

| HIP | Relationship |
|-----|-------------|
| HIP-9 (Agent SDK) | Agents invoke computer use through the Agent SDK's tool interface |
| HIP-10 (MCP) | Computer use exposed as MCP tools (`computer`, `screen`, `browser`) |
| HIP-4 (LLM Gateway) | Visual reasoning requests routed through the LLM Gateway |
| HIP-11 (Chat Interface) | Chat UI can display computer use sessions inline |
| HIP-14 (App Deployment) | Operative containers deployed via the application platform |

### Migration from Existing Tools

| Existing Tool | Migration Path |
|---------------|---------------|
| Selenium | Replace with `browser` tool (Playwright-based, same concepts) |
| Puppeteer | Replace with `browser` tool (Playwright is Puppeteer's successor) |
| PyAutoGUI | Replace with `computer` tool (same API concepts, native performance) |
| SikuliX | Replace with `computer` tool + image location (`locate`, `waitForImage`) |
| Anthropic Computer Use | Replace with `computer` + `screen` tools (self-hosted, MCP-integrated) |

## Test Plan

### Unit Tests

```bash
# Run full test suite
pytest tests/ -v

# Platform-specific tests
pytest tests/test_capture.py -v -k "quartz"   # macOS
pytest tests/test_capture.py -v -k "x11"       # Linux
```

### Integration Tests

```python
async def test_observe_act_loop():
    """Test the full observe-act cycle."""
    operative = OperativeClient()

    # Take screenshot
    screen = await operative.screenshot()
    assert screen.width > 0
    assert screen.height > 0
    assert len(screen.image) > 0

    # Click at a position
    await operative.click(100, 100)

    # Verify screen changed
    screen_after = await operative.screenshot()
    assert screen_after.timestamp > screen.timestamp


async def test_screen_recording_session():
    """Test screen recording with activity detection."""
    operative = OperativeClient()

    result = await operative.session(duration=5)

    assert len(result.frames) > 0
    assert len(result.frames) <= 30
    assert result.duration >= 4.5
    assert result.totalSize < 1_000_000  # Under 1MB


async def test_browser_navigation():
    """Test Playwright browser automation."""
    browser = BrowserClient()

    await browser.navigate("https://example.com")

    title = await browser.title()
    assert "Example" in title

    text = await browser.getText("h1")
    assert "Example Domain" in text
```

### Performance Benchmarks

| Operation | Target Latency | Platform |
|-----------|---------------|----------|
| Screenshot | < 50ms | All |
| Mouse click | < 5ms | Native |
| Keyboard type (per char) | < 2ms | Native |
| Screen recording start | < 100ms | All |
| Session processing (30s) | < 5s | All |
| Browser navigate | < 3s | All |
| Image locate | < 200ms | All |

## References

1. [HIP-9: Agent SDK](./hip-0009-agent-sdk-multi-agent-orchestration-framework.md)
2. [HIP-10: MCP Integration Standards](./hip-0010-model-context-protocol-mcp-integration-standards.md)
3. [HIP-4: LLM Gateway](./hip-0004-llm-gateway-unified-ai-provider-interface.md)
4. [Operative Repository](https://github.com/hanzoai/operative)
5. [Playwright Documentation](https://playwright.dev/)
6. [Model Context Protocol Specification](https://modelcontextprotocol.io/)
7. [Apple Quartz Event Services](https://developer.apple.com/documentation/coregraphics/quartz_event_services)
8. [X11 Protocol Reference](https://www.x.org/releases/current/doc/)

## Copyright

Copyright and related rights waived via [CC0](https://creativecommons.org/publicdomain/zero/1.0/).
