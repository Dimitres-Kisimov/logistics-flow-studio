# Build on the floor, then press Play

The main editor now keeps **Add equipment**, **Play simulation**, **Reset**, speed and elapsed time directly above the floor. Play starts animation; it does not merely open a menu or calculate a static report. The same control becomes Pause while running and Replay at the end. Existing report and advanced simulation controls remain available.

1. Choose a worked example or press **Add equipment**.
2. Search the library, then drag a component onto free floor space. Click an item and then the floor remains available for keyboard/touch workflows.
3. Drag a placed component to reposition it. Select it to edit dimensions or other properties.
4. Press **Play simulation** and adjust the visible speed slider. Pause to edit.

The preview defaults to 60x. This fixes a misleading first-run experience: at 1x the existing model processes its first one-minute bucket after a real minute, so an apparently empty floor could actually be running. The underlying engine is still bucket-based; this change does not claim continuous, calibrated physical motion. The clock and running/paused state are visible immediately. The reduced-motion preference is still honoured.

Library drops use the normal placement path. Overlaps and equipment larger than the floor are rejected, and locked equipment cannot be dragged into the layout. A drag from isometric switches to the editable top-down plan. A drop pauses a running simulation before editing. Equipment placed for a test was moved, overlap rejection was checked, then the test addition was removed.

## Resource review timer

The separate scheduled-resource view offers a custom stop time in seconds, minutes, hours or days and a numeric jump to an exact simulated second. Fractional units are supported. A review can stop before the loaded plan ends; unfinished loads retain their waiting/working state. Applying a valid time pauses playback, invalid input preserves the current state, Reset keeps the selected stop, and **Use full plan** restores the imported horizon. A new import resets the timer. Extending beyond the plan is rejected rather than inventing assignments.

## Update reliability

Browser testing exposed new HTML alongside an older cached script. Service-worker installation now uses reload requests for its app shell, so a cache-version change refreshes scripts and styles as well as markup. The app remains locally cached after installation. Network-disconnected operation and every browser-specific update edge case have not been independently revalidated in this increment.

These controls improve access to the existing simulation. Geometry safety, IFC import, live SQL execution and a connected AI assistant remain separate unfinished requirements.
