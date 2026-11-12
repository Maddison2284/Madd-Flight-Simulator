# Madd Flight aircraft model and audio licenses

All assets below are commercial-OK (CC0 or CC BY 4.0). No NC/ND, no ripped game assets. Sounds are fully procedural (Web Audio oscillators and noise); no third-party samples.

## Aircraft

### Cessna 172 (`public/models/c172.glb`)
- Original: “Cessna 172” by e737, CC BY 4.0
- Redistributed/optimized as a webp GLB by gods-eye-view (bilawalsidhu)
- Source: https://github.com/bilawalsidhu/gods-eye-view
- License: https://creativecommons.org/licenses/by/4.0/
- Modifications: used as published in gods-eye-view; no mesh re-authoring

### Cessna Citation-type business jet (`public/models/citation2.glb`)
- Original: private/business jet by BlenderCommunityHead, CC BY 4.0
- Redistributed/optimized as a webp GLB by gods-eye-view (bilawalsidhu)
- Source: https://github.com/bilawalsidhu/gods-eye-view
- License: https://creativecommons.org/licenses/by/4.0/
- Modifications: used as published in gods-eye-view; spinning engine fan discs added inside the intakes (fan art drawn by MADD Flight, CC0; scripts/rig-fans.mjs)

### Airbus A320, logo-free (`public/models/a320.glb`)
- Author: amvlab
- Source: https://github.com/amvlab/aircraft-models (models/A320_nologo.glb)
- License: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)
- Modifications: gltf-transform optimize (weld, Draco compression) for web delivery; no livery changes; engine fan faces / spinners split into separate spinning nodes with motion-blur discs and a spinner swirl (scripts/rig-fans.mjs)

### Stealth Fighter (`public/models/fighter.glb`)
- Author: tevy.dev
- Source: https://tevy.dev/models/stealth-fighter (v1 LOD0 GLB)
- License: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Modifications: used as published (meshopt + Basis textures)

### Bell 206 (`public/models/bell206.glb`)
- Original: Bell 206 by terran4627, CC BY 4.0
- Redistributed/optimized as a webp GLB by gods-eye-view (bilawalsidhu)
- Source: https://github.com/bilawalsidhu/gods-eye-view
- License: https://creativecommons.org/licenses/by/4.0/
- Modifications: used as published in gods-eye-view; no mesh re-authoring

## Audio

Engine (prop / jet / rotor), wind, stall horn, and ground-contact burst are generated at runtime with the Web Audio API. No sampled recordings are bundled. CC0 by MADD Flight.
