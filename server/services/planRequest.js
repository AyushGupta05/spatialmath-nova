const SUPPORTED_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024;

function normalizeMode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "guided";
}

function parseSceneSnapshot(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === "string") {
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error("sceneSnapshot must be valid JSON");
    }
  }
  return rawValue;
}

function imageAssetFromBuffer({ bytes, type, name, size }) {
  const format = SUPPORTED_IMAGE_TYPES[type];
  if (!format) {
    throw new Error("Only PNG, JPEG, and WEBP images are supported");
  }
  if (!bytes?.length) {
    throw new Error("Uploaded image is empty");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Uploaded image must be 3.75 MB or smaller");
  }

  return {
    name: name || "diagram",
    mimeType: type,
    format,
    size: size || bytes.length,
    bytes,
  };
}

export async function extractPlanPayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const questionText = String(formData.get("question") || formData.get("questionText") || "").trim();
    const mode = normalizeMode(formData.get("mode"));
    const rawSnapshot = formData.get("sceneSnapshot");
    const imageFile = formData.get("image");
    let imageAsset = null;

    if (imageFile instanceof File && imageFile.size > 0) {
      const arrayBuffer = await imageFile.arrayBuffer();
      imageAsset = imageAssetFromBuffer({
        bytes: new Uint8Array(arrayBuffer),
        type: imageFile.type,
        name: imageFile.name,
        size: imageFile.size,
      });
    }

    return {
      questionText,
      mode,
      sceneSnapshot: parseSceneSnapshot(rawSnapshot),
      imageAsset,
    };
  }

  const payload = await request.json();
  return {
    questionText: String(payload.questionText || payload.question || "").trim(),
    mode: normalizeMode(payload.mode),
    sceneSnapshot: parseSceneSnapshot(payload.sceneSnapshot),
    imageAsset: null,
  };
}

export { MAX_IMAGE_BYTES, SUPPORTED_IMAGE_TYPES };
