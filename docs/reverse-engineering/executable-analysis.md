# Executable Analysis: crusaders.exe

## 1. Overview & Forensic Facts

- **Target Binary:** `Crusaders of Might and Magic/crusaders.exe`
- **File Size:** 1,085,440 bytes (1.03 MB)
- **Format:** Portable Executable 32-bit (PE32)
- **Target Architecture:** Intel 80386+ (x86 32-bit)
- **Linker:** Microsoft Visual C++ 6.0 (Linker Version 6.0)
- **Subsystem:** Windows GUI (Subsystem ID 2)
- **Entry Point:** `0x000D0B9E` (RVA `0x000D0B9E` + Image Base `0x00400000` = `0x004D0B9E`)
- **Image Base:** `0x00400000`
- **Verification Confidence:** `[CONFIRMED]`

---

## 2. PE Section Headers

| Section | Virtual Address | Virtual Size | Raw Data Offset | Raw Data Size | Characteristics / Flags |
|---|---|---|---|---|---|
| **`.text`** | `0x00001000` | 904,229 bytes | `0x00001000` | 905,216 bytes | Executable Code, Read (`0x60000020`) |
| **`.rdata`** | `0x000DE000` | 48,765 bytes | `0x000DE000` | 49,152 bytes | Initialized Read-Only Data (`0x40000040`) |
| **`.data`** | `0x000EA000` | 1,379,480 bytes | `0x000EA000` | 61,440 bytes | Read/Write Initialized/BSS (`0xC0000040`) |
| **`.rsrc`** | `0x0023B000` | 65,536 bytes | `0x000F9000` | 65,536 bytes | Win32 Resource Data (Icons, Menus) |

---

## 3. Dynamic Link Library (DLL) Dependencies

Inspection of the Import Directory Table (`RVA 0x00249000`) reveals the runtime dependencies:

```
crusaders.exe
├── KERNEL32.dll     # Process management, file I/O (CreateFileA, ReadFile), heap memory
├── USER32.dll       # Win32 window message pump (PeekMessageA, DispatchMessageA)
├── GDI32.dll        # DC creation, bitmap blitting for launch screens
├── DINPUT.dll       # DirectInput 7.0 COM interfaces (keyboard, mouse look, gamepad)
├── WINMM.dll        # timeGetTime / timeBeginPeriod (High precision tick scheduling)
├── audio.dll        # 3DO audio engine wrapper (communicates with Miles mss32.dll)
├── COMCTL32.dll     # Common controls for dialog boxes
├── ole32.dll        # COM initialization (CoInitialize)
└── VERSION.dll      # Product version string queries
```

### 3.1 Graphics HAL Dynamic Loading
Notably, neither `d3d.dll` nor `opengl32.dll` appears in the static import table.
Instead, string analysis and configuration examination (`gfxdll.cfg`) show:
1. `crusaders.exe` opens and reads `gfxdll.cfg` at startup.
2. It parses the target driver string (`gfx_d3d.dll` or `gfx_sw.dll`).
3. It calls `LoadLibraryA("gfx_d3d.dll")` and queries function pointers via `GetProcAddress`.
4. This confirms a classic 1999 3DO **Hardware Abstraction Layer (HAL)** design, separating core game logic and physics from the rendering API.

---

## 4. Main Game Loop Architecture

Based on imports from `WINMM.dll` (`timeGetTime`) and `USER32.dll` (`PeekMessageA`), the native loop follows a standard late-90s continuous polling structure:

```cpp
// Architectural reconstruction of the native game loop
timeBeginPeriod(1);
DWORD lastTick = timeGetTime();

while (!bQuit) {
    MSG msg;
    while (PeekMessageA(&msg, NULL, 0, 0, PM_REMOVE)) {
        if (msg.message == WM_QUIT) { bQuit = TRUE; break; }
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    
    DWORD currentTick = timeGetTime();
    float deltaSeconds = (currentTick - lastTick) * 0.001f;
    lastTick = currentTick;
    
    // DirectInput Poll
    PollInput();
    
    // World Physics & Entity Update
    UpdateSimulation(deltaSeconds);
    
    // Render Frame via GFX HAL
    pGfxDriver->RenderScene();
}
timeEndPeriod(1);
```

---

## 5. Architectural Implications for CrusadersOnline

1. **Clean-Room Feasibility:** The decoupling of graphics (`gfx_d3d.dll`), audio (`audio.dll`), and logic (`crusaders.exe`) proves that the original developers cleanly isolated their rendering pipeline from game state.
2. **Timing Model:** The original engine relied on delta time derived from millisecond system timers. In our browser MMORPG, we will separate rendering (which interpolates at browser `requestAnimationFrame` 60–144 Hz) from simulation (which ticks at a fixed 20 Hz on the authoritative server).
3. **No DRM Protection:** The GOG executable contains no SafeDisc, SecuROM, or StarForce DRM wrappers, allowing clean inspection of headers and standard file formats.
