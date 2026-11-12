# Sharing protocol v1

`#u=` contains URI-encoded JSON with mandatory `v: 1`. Only values that differ from the defaults are written. A pristine scene has no fragment. The origin and pathname come from the current page; legacy diagnostic query parameters are removed from shared links. Configuration is decoded entirely in the browser.

Example, shown decoded for readability:

```json
{"v":1,"playing":false,"ink":"dark","sprayDistance":70,"speed":2,"phases":{"lower-left":45}}
```

`demo/src/config.js` is the authoritative schema, range/step validation and default set. It includes composition, motion and play/pause, paused time, reveal, all public layers, ink pattern/strength/contours/per-wave visibility, global/per-region cloud motion/strength/visibility, spray travel/active limit, and wave speed/push/lift/per-wave phase. Paused time is preserved; a playing scene uses the most recently chosen anchor time rather than writing every animation frame to history. Language and panel expansion are interface preferences and are excluded.

Unknown versions, malformed JSON, non-object payloads, unsupported fragment syntax or fragments over 12,000 characters restore the whole default scene. Unknown fields are discarded. Invalid types, out-of-range and off-step values restore that field’s default; valid independent fields survive. Decoding always creates fresh data and assigns only known keys. It never merges prototypes or executes payload content.

Controls replace the current URL fragment. External fragment navigation, browser back/forward and refresh reapply the configuration without re-creating the WebGL renderer. Reset clears the fragment. A device’s reduced-motion preference takes priority over shared autoplay; an explicit local Play or Animate action can opt in.

Changing the meaning of a field or default requires a new protocol version with a migration or explicit rejection. Do not silently change v1 defaults. v1 retains the accepted default spray distance 50, limit 100, 28-second loop and original layer set.
