# Face detection (Live Biometrics) – setup

The backend can validate that a selfie contains a human face using TensorFlow.js and Blazeface. Two options:

---

## Option A: tfjs-node (recommended when it builds)

**Faster, uses native bindings.** On Windows it often fails to build without C++ tools.

### Install manually (in backend folder)

```bash
cd backend
npm install @tensorflow/tfjs-node @tensorflow-models/blazeface
```

If you see **“Cannot find module '@tensorflow/tfjs-node'”** or build errors on Windows, use Option B.

### Windows build issues

To get `@tensorflow/tfjs-node` to build on Windows you may need:

- **Visual Studio Build Tools** with “Desktop development with C++”, or  
- **windows-build-tools** (admin PowerShell):  
  `npm install -g windows-build-tools`

Then run `npm install` again in `backend`.

---

## Option B: CPU-only (no native build)

**Works everywhere (including Windows without build tools).** Slightly slower; selfie must be **JPEG** for the CPU path.

### Install manually (in backend folder)

```bash
cd backend
npm install @tensorflow/tfjs @tensorflow-models/blazeface jpeg-js
```

These are already in `package.json` dependencies, so a normal `npm install` in `backend` installs them. The backend will use this path automatically if `@tensorflow/tfjs-node` is not available.

---

## Dependency list (copy-paste)

**Option A (tfjs-node):**

- `@tensorflow/tfjs-node`
- `@tensorflow-models/blazeface`

**Option B (CPU-only):**

- `@tensorflow/tfjs`
- `@tensorflow-models/blazeface`
- `jpeg-js`

**One-line install:**

```bash
# Option A (if your OS supports tfjs-node)
npm install @tensorflow/tfjs-node @tensorflow-models/blazeface

# Option B (no native build; use if A fails)
npm install @tensorflow/tfjs @tensorflow-models/blazeface jpeg-js
```

---

## After installing

1. Restart the backend (`npm start` in `backend`).
2. Check the log: you should see either  
   `[faceCheck] Face detection enabled (tfjs-node).` or  
   `[faceCheck] Face detection enabled (tfjs CPU + jpeg-js).`
3. If you still see “Face detection disabled”, the required packages are missing or failed to load; fix any install errors and restart.

---

## Behaviour

- **Enabled:** Only selfies where at least one face is detected are accepted. Others get “Only your live face is accepted…”.
- **Disabled:** All selfies are rejected (face check is required; no “skip” when disabled).
