# §19 Preview installer release gates

**Do not publish** until all required gates pass on **windows-2022** + owner sign-off:

1. `npm run test:browser-runtime` + profile-config + firefox plan — 0 fail  
2. Offline EXE build succeeds (existing electron-builder path)  
3. Upgrade smoke from Alpha.3 data dir — no destructive migration  
4. Native manual Start verified (log `NATIVE-LAUNCH`)  
5. No retag of `v0.5.0-alpha.3-m1-m17`  
6. Owner explicit approve for preview tag  

Current run: **NO-GO preview** (Firefox runtime PARTIAL, many MISSING Multilogin items).
