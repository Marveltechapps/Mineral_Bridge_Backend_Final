/**
 * Selfie face detection for live biometrics — only human faces are accepted.
 *
 * Option A (faster, needs native build): @tensorflow/tfjs-node + @tensorflow-models/blazeface
 * Option B (no native build, works on Windows): @tensorflow/tfjs + @tensorflow-models/blazeface + jpeg-js
 *
 * Install manually (in backend folder):
 *   npm install @tensorflow/tfjs-node @tensorflow-models/blazeface
 * If tfjs-node fails to build (e.g. on Windows), install CPU-only:
 *   npm install @tensorflow/tfjs @tensorflow-models/blazeface jpeg-js
 *
 * See backend/docs/FACE-DETECTION-SETUP.md for details.
 */

let blazeface = null;
let tf = null;
let useNodeBackend = null; // true = tfjs-node, false = tfjs + jpeg-js

function loadDetector() {
  if (blazeface !== null) return blazeface !== false;

  // Try Option A: tfjs-node (native, faster)
  try {
    tf = require('@tensorflow/tfjs-node');
    blazeface = require('@tensorflow-models/blazeface');
    useNodeBackend = true;
    console.log('[faceCheck] Face detection enabled (tfjs-node).');
    return true;
  } catch (e) {
    // Fall through to Option B
  }

  // Option B: pure JS (no native build) – works on Windows without build tools
  try {
    tf = require('@tensorflow/tfjs');
    blazeface = require('@tensorflow-models/blazeface');
    require('jpeg-js'); // used in decodeImageToTensor
    useNodeBackend = false;
    console.log('[faceCheck] Face detection enabled (tfjs CPU + jpeg-js).');
    return true;
  } catch (e) {
    blazeface = false;
    console.warn('[faceCheck] Face detection disabled. Install deps (see backend/docs/FACE-DETECTION-SETUP.md):', e.message);
    return false;
  }
}

/** Decode image buffer to tensor (Option B only). Supports JPEG via jpeg-js; PNG/other return null. */
function decodeImageToTensor(imageBuffer) {
  try {
    const jpeg = require('jpeg-js');
    const decoded = jpeg.decode(imageBuffer, { useTArray: true });
    if (!decoded || !decoded.data || !decoded.width || !decoded.height) return null;
    const { data, width, height } = decoded;
    // jpeg-js returns RGBA; blazeface expects RGB. Strip alpha and reshape to [height, width, 3].
    const numPixels = width * height;
    const rgb = new Uint8Array(numPixels * 3);
    for (let i = 0; i < numPixels; i++) {
      rgb[i * 3] = data[i * 4];
      rgb[i * 3 + 1] = data[i * 4 + 1];
      rgb[i * 3 + 2] = data[i * 4 + 2];
    }
    return tf.tensor3d(rgb, [height, width, 3]);
  } catch (e) {
    return null;
  }
}

/**
 * @param {Buffer} imageBuffer - JPEG/PNG image buffer (e.g. from multer). JPEG recommended for CPU path.
 * @returns {Promise<boolean>} - true only if at least one human face was detected; false otherwise (reject)
 */
async function detectFaceInImage(imageBuffer) {
  if (!loadDetector()) return false;

  let inputTensor;
  try {
    if (useNodeBackend) {
      inputTensor = tf.node.decodeImage(new Uint8Array(imageBuffer), 3);
    } else {
      inputTensor = decodeImageToTensor(imageBuffer);
      if (!inputTensor) {
        console.warn('[faceCheck] decodeImage failed (CPU path: JPEG only).');
        return false;
      }
    }
  } catch (e) {
    console.warn('[faceCheck] decodeImage failed:', e.message);
    return false;
  }

  try {
    const model = await blazeface.load();
    const predictions = await model.estimateFaces(inputTensor, false);
    inputTensor.dispose();
    const hasFace = Array.isArray(predictions) && predictions.length > 0;
    return hasFace;
  } catch (e) {
    if (inputTensor && inputTensor.dispose) inputTensor.dispose();
    console.warn('[faceCheck] estimateFaces failed:', e.message);
    return false;
  }
}

module.exports = { detectFaceInImage };
