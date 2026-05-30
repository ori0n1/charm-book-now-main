import { supabase } from "@/integrations/supabase/client";

const BUCKET = "studio-assets";
const MAX_IMAGE_EDGE = 2200;
const IMAGE_QUALITY = 0.86;
const DIRECT_UPLOAD_LIMIT = 1_200_000;

type UploadStage = "preparing" | "uploading" | "done";

type UploadOptions = {
  onStage?: (stage: UploadStage) => void;
};

export async function uploadStudioAsset(
  studioId: string,
  file: File,
  folder = "uploads",
  options: UploadOptions = {},
) {
  const prepared = await prepareUploadFile(file, options);
  const ext = getFileExtension(prepared);
  const path = `${studioId}/${folder}/${createUploadId()}.${ext}`;
  options.onStage?.("uploading");
  const { error } = await supabase.storage.from(BUCKET).upload(path, prepared, {
    cacheControl: "31536000",
    upsert: false,
    contentType: prepared.type || "application/octet-stream",
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  options.onStage?.("done");
  return { url: withAssetVersion(data.publicUrl), path };
}

export async function deleteStudioAsset(path: string) {
  await supabase.storage.from(BUCKET).remove([path]);
}

function withAssetVersion(url: string) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${Date.now()}`;
}

async function prepareUploadFile(file: File, options: UploadOptions) {
  if (file.type.startsWith("video/")) return file;
  if (!isImageLike(file)) {
    throw new Error("Escolha um ficheiro de imagem válido.");
  }

  const isDirectSafe =
    file.size <= DIRECT_UPLOAD_LIMIT &&
    ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (isDirectSafe) return file;

  options.onStage?.("preparing");
  try {
    return await compressImage(file);
  } catch {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
    throw new Error("Não foi possível preparar esta imagem. Tente JPG, PNG ou WEBP.");
  }
}

export function isStudioImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

function isImageLike(file: File) {
  return isStudioImageFile(file);
}

async function compressImage(file: File) {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível.");
  context.drawImage(bitmap, 0, 0, width, height);

  const blob =
    (await canvasToBlob(canvas, "image/webp", IMAGE_QUALITY)) ??
    (await canvasToBlob(canvas, "image/jpeg", IMAGE_QUALITY));
  if (!blob) throw new Error("Não foi possível comprimir a imagem.");

  const name = file.name.replace(/\.[^.]+$/, "") || "imagem";
  return new File([blob], `${name}.${blob.type === "image/webp" ? "webp" : "jpg"}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Imagem inválida."));
    };
    image.src = url;
  });
}

function getFileExtension(file: File) {
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "video/mp4") return "mp4";
  if (file.type === "video/webm") return "webm";
  return file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

function createUploadId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
