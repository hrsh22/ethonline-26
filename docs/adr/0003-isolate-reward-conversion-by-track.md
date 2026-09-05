# Isolate reward conversion by track

Each Reward Epoch will reserve an equal WETH budget for AAPLc, GOOGLc, METAc, and NVDAc, then process the four Sealed Routes independently. If one stock is paused, unauthorized, illiquid, or otherwise fails conversion, successful tracks may settle while the failed track's WETH becomes a Deferred Track Budget for retry; it cannot be redistributed to another track or withdrawn as treasury funds. This weakens epoch-level atomicity in exchange for preventing one issuer-controlled B20 asset from halting every terminal's rewards.
